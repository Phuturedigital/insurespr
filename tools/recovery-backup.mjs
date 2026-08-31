#!/usr/bin/env node

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
} from 'node:fs';
import {
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('INSPRBACKUP1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const RESTORE_CONFIRMATION = 'RESTORE APPROVED ISOLATED TARGET';

function fail(message) {
  const error = new Error(message);
  error.isOperatorError = true;
  throw error;
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  if (!['backup', 'verify', 'restore'].includes(command)) {
    fail('Usage: recovery-backup.mjs <backup|verify|restore> [options]');
  }
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`);
    if (Object.hasOwn(options, key)) fail(`Duplicate option --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = options[key]?.trim();
  if (!value) fail(`--${key} is required`);
  return value;
}

function parseDatabaseUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be a PostgreSQL connection URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    fail(`${label} must be a PostgreSQL connection URL`);
  }
  return parsed;
}

function databaseEnvironment(value, label) {
  const parsed = parseDatabaseUrl(value, label);
  let username;
  let password;
  let database;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    fail(`${label} contains invalid percent-encoding`);
  }
  if (!username || !database) {
    fail(`${label} must include a database user and database name`);
  }
  const unsupportedParameters = [...parsed.searchParams.keys()]
    .filter((name) => name !== 'sslmode');
  if (unsupportedParameters.length) {
    fail(`${label} contains unsupported connection parameters`);
  }
  const sslMode = parsed.searchParams.get('sslmode')
    || (parsed.hostname.endsWith('.supabase.co') ? 'require' : 'prefer');
  if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    fail(`${label} contains an unsupported sslmode`);
  }
  return {
    parsed,
    username,
    database,
    variables: {
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || '5432',
      PGUSER: username,
      PGPASSWORD: password,
      PGDATABASE: database,
      PGSSLMODE: sslMode,
    },
  };
}

function sameDatabaseEndpoint(left, right) {
  return left.parsed.hostname.toLowerCase() === right.parsed.hostname.toLowerCase()
    && (left.parsed.port || '5432') === (right.parsed.port || '5432')
    && left.database === right.database;
}

function readEncryptionKey(environment = process.env) {
  const encoded = environment.INSURESPR_BACKUP_KEY_B64?.trim();
  if (!encoded) fail('INSURESPR_BACKUP_KEY_B64 is required');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    key.fill(0);
    fail('INSURESPR_BACKUP_KEY_B64 must be canonical base64 for exactly 32 random bytes');
  }
  return key;
}

function parseCommandPrefix(environment, kind) {
  const variable = kind === 'dump'
    ? 'INSURESPR_PG_DUMP_PREFIX_JSON'
    : 'INSURESPR_PG_RESTORE_PREFIX_JSON';
  const raw = environment[variable];
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(`${variable} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item)) {
    fail(`${variable} must be a JSON array of non-empty strings`);
  }
  return parsed;
}

function databaseTool(environment, kind) {
  const commandVariable = kind === 'dump'
    ? 'INSURESPR_PG_DUMP_COMMAND'
    : 'INSURESPR_PG_RESTORE_COMMAND';
  return {
    command: environment[commandVariable]?.trim() || (kind === 'dump' ? 'pg_dump' : 'pg_restore'),
    prefix: parseCommandPrefix(environment, kind),
  };
}

function spawnTool(environment, kind, args, databaseUrl) {
  const tool = databaseTool(environment, kind);
  const childEnvironment = {
    ...environment,
    PGCONNECT_TIMEOUT: environment.PGCONNECT_TIMEOUT || '15',
  };
  for (const secretName of [
    'INSURESPR_BACKUP_KEY_B64',
    'INSURESPR_BACKUP_DATABASE_URL',
    'INSURESPR_RESTORE_DATABASE_URL',
    'INSURESPR_RESTORE_CONFIRMATION',
  ]) {
    delete childEnvironment[secretName];
  }
  if (databaseUrl) {
    Object.assign(
      childEnvironment,
      databaseEnvironment(databaseUrl, kind === 'dump'
        ? 'INSURESPR_BACKUP_DATABASE_URL'
        : 'INSURESPR_RESTORE_DATABASE_URL').variables,
    );
  }
  return spawn(tool.command, [...tool.prefix, ...args], {
    env: childEnvironment,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function consumeBounded(stream) {
  let byteCount = 0;
  for await (const chunk of stream) {
    byteCount += chunk.length;
    if (byteCount > MAX_TOOL_OUTPUT_BYTES) {
      // Continue draining without retaining output. Tool text can contain
      // connection or schema detail and is never copied into normal logs.
      byteCount = MAX_TOOL_OUTPUT_BYTES;
    }
  }
}

async function waitForChild(child, label) {
  const [code, signal] = await once(child, 'close');
  if (code !== 0) {
    fail(`${label} failed with exit code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}; inspect restricted operator logs`);
  }
}

async function sha256File(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function ensureNewOutput(filename) {
  const absolute = path.resolve(filename);
  if (existsSync(absolute)) fail(`Refusing to overwrite existing file: ${absolute}`);
  const parent = path.dirname(absolute);
  const parentStat = await stat(parent).catch(() => null);
  if (!parentStat?.isDirectory()) fail(`Output directory does not exist: ${parent}`);
  return absolute;
}

function partialName(filename) {
  return path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${process.pid}.${randomBytes(6).toString('hex')}.partial`,
  );
}

export async function encryptReadableToFile(readable, filename, key) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const output = createWriteStream(filename, { flags: 'wx', mode: 0o600 });
  await once(output, 'open');
  output.write(Buffer.concat([MAGIC, nonce]));
  await pipeline(readable, cipher, output, { end: false });
  const tag = cipher.getAuthTag();
  output.end(tag);
  await once(output, 'close');
}

async function readArtifactEnvelope(filename) {
  const fileStat = await stat(filename);
  if (fileStat.size <= HEADER_BYTES + TAG_BYTES) fail('Encrypted artifact is too small');
  const handle = await open(filename, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, fileStat.size - TAG_BYTES);
    const magic = header.subarray(0, MAGIC.length);
    if (magic.length !== MAGIC.length || !timingSafeEqual(magic, MAGIC)) {
      fail('Encrypted artifact header is invalid');
    }
    return {
      size: fileStat.size,
      nonce: header.subarray(MAGIC.length),
      tag,
      ciphertextStart: HEADER_BYTES,
      ciphertextEnd: fileStat.size - TAG_BYTES - 1,
    };
  } finally {
    await handle.close();
  }
}

export async function decryptFileToWritable(filename, writable, key) {
  const envelope = await readArtifactEnvelope(filename);
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.nonce);
  decipher.setAuthTag(envelope.tag);
  await pipeline(
    createReadStream(filename, {
      start: envelope.ciphertextStart,
      end: envelope.ciphertextEnd,
    }),
    decipher,
    writable,
  );
}

async function writeJsonAtomic(filename, payload) {
  const target = await ensureNewOutput(filename);
  const temporary = partialName(target);
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function validateManifest(input, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    fail('Backup manifest is missing or invalid JSON');
  }
  const problems = [];
  if (manifest?.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (manifest?.kind !== 'insurespr-encrypted-postgres-logical-backup') problems.push('kind is invalid');
  if (manifest?.artifactFile !== path.basename(input)) problems.push('artifact filename does not match');
  if (!/^[a-z]{20}$/.test(manifest?.projectRef ?? '')) problems.push('projectRef is invalid');
  if (manifest?.cipher !== 'AES-256-GCM') problems.push('cipher is invalid');
  if (manifest?.plaintextStored !== false) problems.push('plaintextStored must be false');
  if (!Number.isInteger(manifest?.encryptedBytes) || manifest.encryptedBytes <= HEADER_BYTES + TAG_BYTES) {
    problems.push('encryptedBytes is invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(manifest?.encryptedSha256 ?? '')) problems.push('encryptedSha256 is invalid');
  if (Number.isNaN(Date.parse(manifest?.createdAt ?? ''))) problems.push('createdAt is invalid');
  if (typeof manifest?.keyId !== 'string' || manifest.keyId.trim().length < 3) problems.push('keyId is invalid');
  if (manifest?.productionRecoveryVerified !== false) problems.push('productionRecoveryVerified must remain false');
  if (problems.length) fail(`Backup manifest contract failed: ${problems.join('; ')}`);

  const fileStat = await stat(input);
  if (fileStat.size !== manifest.encryptedBytes) fail('Encrypted artifact size does not match manifest');
  const digest = await sha256File(input);
  if (digest !== manifest.encryptedSha256) fail('Encrypted artifact SHA-256 does not match manifest');
  return manifest;
}

async function backup(options, environment) {
  const output = await ensureNewOutput(requireOption(options, 'output'));
  if (!output.endsWith('.isprbackup')) fail('Backup output must end with .isprbackup');
  const manifestPath = await ensureNewOutput(options.manifest || `${output}.manifest.json`);
  const projectRef = requireOption(options, 'project-ref');
  const keyId = requireOption(options, 'key-id');
  if (!/^[a-z]{20}$/.test(projectRef)) fail('--project-ref must contain the 20-letter Supabase project reference');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(keyId)) fail('--key-id is invalid');
  const sourceUrl = environment.INSURESPR_BACKUP_DATABASE_URL;
  if (!sourceUrl) fail('INSURESPR_BACKUP_DATABASE_URL is required');
  databaseEnvironment(sourceUrl, 'INSURESPR_BACKUP_DATABASE_URL');
  const key = readEncryptionKey(environment);
  const artifactPartial = partialName(output);
  let artifactCommitted = false;
  try {
    const child = spawnTool(environment, 'dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
    ], sourceUrl);
    child.stdin.end();
    const stderrDrain = consumeBounded(child.stderr);
    await Promise.all([
      encryptReadableToFile(child.stdout, artifactPartial, key),
      waitForChild(child, 'pg_dump'),
      stderrDrain,
    ]);
    const partialStat = await stat(artifactPartial);
    if (partialStat.size <= HEADER_BYTES + TAG_BYTES) {
      fail('pg_dump produced an empty archive; no backup artifact was committed');
    }
    await rename(artifactPartial, output);
    artifactCommitted = true;
    const artifactStat = await stat(output);
    const manifest = {
      schemaVersion: 1,
      kind: 'insurespr-encrypted-postgres-logical-backup',
      projectRef,
      artifactFile: path.basename(output),
      createdAt: new Date().toISOString(),
      encryptedBytes: artifactStat.size,
      encryptedSha256: await sha256File(output),
      cipher: 'AES-256-GCM',
      keyId,
      pgDumpFormat: 'custom',
      plaintextStored: false,
      offsiteStorageVerified: false,
      restoreDrillVerified: false,
      productionRecoveryVerified: false,
    };
    await writeJsonAtomic(manifestPath, manifest);
    process.stdout.write(`${JSON.stringify({
      status: 'backup_created',
      artifact: output,
      manifest: manifestPath,
      encryptedBytes: artifactStat.size,
      encryptedSha256: manifest.encryptedSha256,
      productionRecoveryVerified: false,
    })}\n`);
  } catch (error) {
    await rm(artifactPartial, { force: true }).catch(() => {});
    if (artifactCommitted) await rm(output, { force: true }).catch(() => {});
    throw error;
  } finally {
    key.fill(0);
  }
}

async function verify(options, environment) {
  const input = path.resolve(requireOption(options, 'input'));
  const manifestPath = path.resolve(options.manifest || `${input}.manifest.json`);
  const manifest = await validateManifest(input, manifestPath);
  const key = readEncryptionKey(environment);
  try {
    const child = spawnTool(environment, 'restore', ['--list'], null);
    const stdoutDrain = consumeBounded(child.stdout);
    const stderrDrain = consumeBounded(child.stderr);
    try {
      await Promise.all([
        decryptFileToWritable(input, child.stdin, key),
        waitForChild(child, 'pg_restore verification'),
        stdoutDrain,
        stderrDrain,
      ]);
    } catch (error) {
      child.kill();
      throw error;
    }
    process.stdout.write(`${JSON.stringify({
      status: 'artifact_verified',
      encryptedSha256: manifest.encryptedSha256,
      projectRef: manifest.projectRef,
      keyId: manifest.keyId,
      productionRecoveryVerified: false,
    })}\n`);
  } finally {
    key.fill(0);
  }
}

async function restore(options, environment) {
  const input = path.resolve(requireOption(options, 'input'));
  const manifestPath = path.resolve(options.manifest || `${input}.manifest.json`);
  const evidenceOutput = await ensureNewOutput(requireOption(options, 'evidence-output'));
  const targetLabel = requireOption(options, 'target-label');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(targetLabel)) fail('--target-label is invalid');
  if (environment.INSURESPR_RESTORE_CONFIRMATION !== RESTORE_CONFIRMATION) {
    fail(`INSURESPR_RESTORE_CONFIRMATION must equal ${RESTORE_CONFIRMATION}`);
  }
  const targetUrl = environment.INSURESPR_RESTORE_DATABASE_URL;
  if (!targetUrl) fail('INSURESPR_RESTORE_DATABASE_URL is required');
  const targetConnection = databaseEnvironment(targetUrl, 'INSURESPR_RESTORE_DATABASE_URL');
  const target = targetConnection.parsed;
  const manifest = await validateManifest(input, manifestPath);
  if (
    target.hostname.toLowerCase().includes(manifest.projectRef)
    || targetConnection.username.toLowerCase().includes(manifest.projectRef)
  ) {
    fail('Refusing to restore into a connection identifying the production project reference');
  }
  const sourceUrl = environment.INSURESPR_BACKUP_DATABASE_URL;
  if (sourceUrl) {
    const sourceConnection = databaseEnvironment(sourceUrl, 'INSURESPR_BACKUP_DATABASE_URL');
    if (sameDatabaseEndpoint(sourceConnection, targetConnection)) {
      fail('Source and restore target database endpoints must be different');
    }
  }

  const key = readEncryptionKey(environment);
  const startedAt = new Date().toISOString();
  try {
    const child = spawnTool(environment, 'restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--single-transaction',
      '--dbname',
      targetConnection.database,
    ], targetUrl);
    const stdoutDrain = consumeBounded(child.stdout);
    const stderrDrain = consumeBounded(child.stderr);
    try {
      await Promise.all([
        decryptFileToWritable(input, child.stdin, key),
        waitForChild(child, 'pg_restore'),
        stdoutDrain,
        stderrDrain,
      ]);
    } catch (error) {
      child.kill();
      throw error;
    }
    const completedAt = new Date().toISOString();
    const evidence = {
      schemaVersion: 1,
      kind: 'insurespr-isolated-restore-command-evidence',
      sourceProjectRef: manifest.projectRef,
      sourceEncryptedSha256: manifest.encryptedSha256,
      targetLabel,
      startedAt,
      completedAt,
      databaseRestoreCommandSucceeded: true,
      applicationVerificationStatus: 'pending',
      externalDeliveryDisabledVerification: 'pending',
      isolatedTargetDeletionStatus: 'pending',
      productionRecoveryVerified: false,
      activationAuthorized: false,
    };
    await writeJsonAtomic(evidenceOutput, evidence);
    process.stdout.write(`${JSON.stringify({
      status: 'isolated_restore_command_succeeded',
      evidence: evidenceOutput,
      applicationVerificationStatus: 'pending',
      productionRecoveryVerified: false,
    })}\n`);
  } finally {
    key.fill(0);
  }
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const { command, options } = parseArgs(argv);
  if (command === 'backup') return backup(options, environment);
  if (command === 'verify') return verify(options, environment);
  return restore(options, environment);
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`Recovery tool failed: ${error.isOperatorError ? error.message : 'unexpected internal error'}\n`);
    process.exitCode = 1;
  });
}
