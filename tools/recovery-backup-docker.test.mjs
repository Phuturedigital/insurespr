import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const toolPath = fileURLToPath(new URL('./recovery-backup.mjs', import.meta.url));
const projectRef = 'ffdmmxffzewqiacsuvhr';
const restoreConfirmation = 'RESTORE APPROVED ISOLATED TARGET';
const dockerEnvironmentOptions = [
  '-e', 'PGHOST',
  '-e', 'PGPORT',
  '-e', 'PGUSER',
  '-e', 'PGPASSWORD',
  '-e', 'PGDATABASE',
  '-e', 'PGSSLMODE',
];

async function docker(args, options = {}) {
  return execFileAsync('docker', args, {
    windowsHide: true,
    ...options,
  });
}

async function waitUntilReady(container) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await docker(['exec', container, 'pg_isready', '-U', 'postgres']);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Disposable PostgreSQL container did not become ready');
}

test('encrypted backup restores into a disposable isolated PostgreSQL database', { timeout: 120_000 }, async () => {
  const suffix = randomBytes(6).toString('hex');
  const container = `insurespr-recovery-${suffix}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'insurespr-recovery-docker-'));
  const artifact = path.join(directory, 'integration.isprbackup');
  const evidence = path.join(directory, 'integration.restore-evidence.json');
  const password = `integration-${suffix}`;
  const key = randomBytes(32).toString('base64');
  const sourceUrl = `postgresql://postgres:${password}@127.0.0.1:5432/source_db?sslmode=disable`;
  const targetUrl = `postgresql://postgres:${password}@127.0.0.1:5432/isolated_restore?sslmode=disable`;

  try {
    await docker([
      'run', '--rm', '--detach',
      '--name', container,
      '--env', `POSTGRES_PASSWORD=${password}`,
      'postgres:17-alpine',
    ]);
    await waitUntilReady(container);
    await docker(['exec', container, 'createdb', '-U', 'postgres', 'source_db']);
    await docker(['exec', container, 'createdb', '-U', 'postgres', 'isolated_restore']);
    await docker([
      'exec', container,
      'psql', '-U', 'postgres', '-d', 'source_db', '-v', 'ON_ERROR_STOP=1',
      '-c', "create table recovery_probe(id integer primary key, value text not null); insert into recovery_probe values (1, 'isolated-restore-verified');",
    ]);

    const commonEnvironment = {
      ...process.env,
      INSURESPR_BACKUP_KEY_B64: key,
      INSURESPR_BACKUP_DATABASE_URL: sourceUrl,
      INSURESPR_PG_DUMP_COMMAND: 'docker',
      INSURESPR_PG_RESTORE_COMMAND: 'docker',
      INSURESPR_PG_DUMP_PREFIX_JSON: JSON.stringify([
        'exec', '-i', ...dockerEnvironmentOptions, container, 'pg_dump',
      ]),
      INSURESPR_PG_RESTORE_PREFIX_JSON: JSON.stringify([
        'exec', '-i', ...dockerEnvironmentOptions, container, 'pg_restore',
      ]),
    };

    await execFileAsync(process.execPath, [
      toolPath,
      'backup',
      '--output', artifact,
      '--project-ref', projectRef,
      '--key-id', `docker-${suffix}`,
    ], { env: commonEnvironment, windowsHide: true });

    const encryptedBytes = await readFile(artifact);
    assert.equal(encryptedBytes.includes(Buffer.from('isolated-restore-verified')), false);

    await execFileAsync(process.execPath, [toolPath, 'verify', '--input', artifact], {
      env: commonEnvironment,
      windowsHide: true,
    });

    await execFileAsync(process.execPath, [
      toolPath,
      'restore',
      '--input', artifact,
      '--evidence-output', evidence,
      '--target-label', `docker-isolated-${suffix}`,
    ], {
      env: {
        ...commonEnvironment,
        INSURESPR_RESTORE_DATABASE_URL: targetUrl,
        INSURESPR_RESTORE_CONFIRMATION: restoreConfirmation,
      },
      windowsHide: true,
    });

    const query = await docker([
      'exec', container,
      'psql', '-U', 'postgres', '-d', 'isolated_restore', '-At',
      '-c', 'select value from recovery_probe where id = 1;',
    ]);
    assert.equal(query.stdout.trim(), 'isolated-restore-verified');

    const restoreEvidence = JSON.parse(await readFile(evidence, 'utf8'));
    assert.equal(restoreEvidence.databaseRestoreCommandSucceeded, true);
    assert.equal(restoreEvidence.applicationVerificationStatus, 'pending');
    assert.equal(restoreEvidence.productionRecoveryVerified, false);
    assert.equal(restoreEvidence.activationAuthorized, false);
  } finally {
    if (/^insurespr-recovery-[a-f0-9]{12}$/.test(container)) {
      await docker(['rm', '--force', container]).catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});
