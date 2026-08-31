import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  decryptFileToWritable,
  encryptReadableToFile,
  validateManifest,
} from './recovery-backup.mjs';

const execFileAsync = promisify(execFile);
const toolPath = fileURLToPath(new URL('./recovery-backup.mjs', import.meta.url));
const mockToolPath = fileURLToPath(new URL('./fixtures/recovery-mock-pg-tool.mjs', import.meta.url));
const projectRef = 'ffdmmxffzewqiacsuvhr';
const restoreConfirmation = 'RESTORE APPROVED ISOLATED TARGET';
const mockPayload = 'PRIVATE-PATIENT-DUMP-SENTINEL-9dfe8c';

function collectingWritable(chunks) {
  return new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
}

async function runTool(args, environment = {}) {
  return execFileAsync(process.execPath, [toolPath, ...args], {
    env: {
      ...process.env,
      INSURESPR_PG_DUMP_COMMAND: process.execPath,
      INSURESPR_PG_RESTORE_COMMAND: process.execPath,
      INSURESPR_PG_DUMP_PREFIX_JSON: JSON.stringify([mockToolPath]),
      INSURESPR_PG_RESTORE_PREFIX_JSON: JSON.stringify([mockToolPath]),
      MOCK_PG_DUMP_PAYLOAD: mockPayload,
      ...environment,
    },
    windowsHide: true,
  });
}

async function expectToolFailure(args, environment, pattern) {
  await assert.rejects(
    runTool(args, environment),
    (error) => pattern.test(error.stderr || error.message),
  );
}

test('AES-256-GCM stream encryption round-trips and authenticates the whole artifact', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'insurespr-recovery-crypto-'));
  const artifact = path.join(directory, 'roundtrip.isprbackup');
  const tampered = path.join(directory, 'tampered.isprbackup');
  const key = randomBytes(32);
  const plaintext = Buffer.from('streamed recovery payload with no plaintext file');
  try {
    await encryptReadableToFile(Readable.from(plaintext), artifact, key);
    const encrypted = await readFile(artifact);
    assert.equal(encrypted.includes(plaintext), false);

    const chunks = [];
    await decryptFileToWritable(artifact, collectingWritable(chunks), key);
    assert.deepEqual(Buffer.concat(chunks), plaintext);

    await assert.rejects(
      decryptFileToWritable(artifact, collectingWritable([]), randomBytes(32)),
      /authenticate data|unable to authenticate/i,
    );

    encrypted[Math.floor(encrypted.length / 2)] ^= 0xff;
    await writeFile(tampered, encrypted);
    await assert.rejects(
      decryptFileToWritable(tampered, collectingWritable([]), key),
      /authenticate data|unable to authenticate/i,
    );
  } finally {
    key.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
});

test('backup, verification, isolated restore, and evidence remain fail-closed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'insurespr-recovery-cli-'));
  const artifact = path.join(directory, 'daily.isprbackup');
  const manifestPath = `${artifact}.manifest.json`;
  const evidencePath = path.join(directory, 'restore-evidence.json');
  const capturePath = path.join(directory, 'restored.dump');
  const key = randomBytes(32).toString('base64');
  const commonEnvironment = {
    INSURESPR_BACKUP_KEY_B64: key,
    INSURESPR_BACKUP_DATABASE_URL: 'postgresql://backup-user:source-secret@source.example.test:6543/insurespr?sslmode=require',
  };
  try {
    const backupResult = await runTool([
      'backup',
      '--output', artifact,
      '--project-ref', projectRef,
      '--key-id', 'test-key-2026-08',
    ], commonEnvironment);
    assert.equal(JSON.parse(backupResult.stdout).status, 'backup_created');

    const encrypted = await readFile(artifact);
    assert.equal(encrypted.includes(Buffer.from(mockPayload)), false);
    const manifest = await validateManifest(artifact, manifestPath);
    assert.equal(manifest.plaintextStored, false);
    assert.equal(manifest.offsiteStorageVerified, false);
    assert.equal(manifest.restoreDrillVerified, false);
    assert.equal(manifest.productionRecoveryVerified, false);

    const verifyResult = await runTool([
      'verify',
      '--input', artifact,
    ], commonEnvironment);
    assert.equal(JSON.parse(verifyResult.stdout).status, 'artifact_verified');

    await expectToolFailure([
      'backup',
      '--output', artifact,
      '--project-ref', projectRef,
      '--key-id', 'test-key-2026-08',
    ], commonEnvironment, /Refusing to overwrite existing file/);

    const emptyArtifact = path.join(directory, 'empty.isprbackup');
    await expectToolFailure([
      'backup',
      '--output', emptyArtifact,
      '--project-ref', projectRef,
      '--key-id', 'test-key-2026-08',
    ], {
      ...commonEnvironment,
      MOCK_PG_DUMP_EMPTY: '1',
    }, /pg_dump produced an empty archive/);
    await assert.rejects(readFile(emptyArtifact), /ENOENT/);
    await assert.rejects(readFile(`${emptyArtifact}.manifest.json`), /ENOENT/);

    const restoreArgs = [
      'restore',
      '--input', artifact,
      '--evidence-output', evidencePath,
      '--target-label', 'approved-isolated-test',
    ];
    await expectToolFailure(restoreArgs, {
      ...commonEnvironment,
      INSURESPR_RESTORE_DATABASE_URL: 'postgresql://restore-user:restore-secret@isolated.example.test/isolated_restore?sslmode=disable',
    }, /INSURESPR_RESTORE_CONFIRMATION must equal/);

    await expectToolFailure(restoreArgs, {
      ...commonEnvironment,
      INSURESPR_RESTORE_CONFIRMATION: restoreConfirmation,
      INSURESPR_RESTORE_DATABASE_URL: `postgresql://restore-user:restore-secret@db.${projectRef}.supabase.co/postgres`,
    }, /Refusing to restore into a connection identifying the production project reference/);

    await expectToolFailure(restoreArgs, {
      ...commonEnvironment,
      INSURESPR_RESTORE_CONFIRMATION: restoreConfirmation,
      INSURESPR_RESTORE_DATABASE_URL: `postgresql://postgres.${projectRef}:restore-secret@aws-0-eu-central-1.pooler.supabase.com/postgres`,
    }, /Refusing to restore into a connection identifying the production project reference/);

    await expectToolFailure(restoreArgs, {
      ...commonEnvironment,
      INSURESPR_RESTORE_CONFIRMATION: restoreConfirmation,
      INSURESPR_RESTORE_DATABASE_URL: 'postgresql://different-user:restore-secret@source.example.test:6543/insurespr?sslmode=require',
    }, /Source and restore target database endpoints must be different/);

    const restoreResult = await runTool(restoreArgs, {
      ...commonEnvironment,
      INSURESPR_RESTORE_CONFIRMATION: restoreConfirmation,
      INSURESPR_RESTORE_DATABASE_URL: 'postgresql://restore-user:restore-secret@isolated.example.test/isolated_restore?sslmode=disable',
      MOCK_PG_CAPTURE_FILE: capturePath,
    });
    assert.equal(JSON.parse(restoreResult.stdout).status, 'isolated_restore_command_succeeded');
    assert.equal(await readFile(capturePath, 'utf8'), mockPayload);
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.equal(evidence.databaseRestoreCommandSucceeded, true);
    assert.equal(evidence.applicationVerificationStatus, 'pending');
    assert.equal(evidence.externalDeliveryDisabledVerification, 'pending');
    assert.equal(evidence.isolatedTargetDeletionStatus, 'pending');
    assert.equal(evidence.productionRecoveryVerified, false);
    assert.equal(evidence.activationAuthorized, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('manifest validation detects encrypted-artifact tampering', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'insurespr-recovery-manifest-'));
  const artifact = path.join(directory, 'tamper.isprbackup');
  const key = randomBytes(32).toString('base64');
  try {
    await runTool([
      'backup',
      '--output', artifact,
      '--project-ref', projectRef,
      '--key-id', 'test-key-2026-08',
    ], {
      INSURESPR_BACKUP_KEY_B64: key,
      INSURESPR_BACKUP_DATABASE_URL: 'postgresql://backup-user:source-secret@source.example.test:6543/insurespr?sslmode=require',
    });
    const bytes = await readFile(artifact);
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    await writeFile(artifact, bytes);
    await assert.rejects(
      validateManifest(artifact, `${artifact}.manifest.json`),
      /SHA-256 does not match manifest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
