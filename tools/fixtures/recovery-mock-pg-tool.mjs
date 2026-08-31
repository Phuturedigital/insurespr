#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const forbiddenValues = [
  process.env.INSURESPR_BACKUP_KEY_B64,
  process.env.INSURESPR_BACKUP_DATABASE_URL,
  process.env.INSURESPR_RESTORE_DATABASE_URL,
  process.env.INSURESPR_RESTORE_CONFIRMATION,
].filter(Boolean);

if (forbiddenValues.length) {
  process.stderr.write('Recovery secrets leaked into the database tool environment\n');
  process.exit(20);
}

if (args.some((argument) => /source-secret|restore-secret|postgres(?:ql)?:\/\//i.test(argument))) {
  process.stderr.write('A database URL or password leaked into process arguments\n');
  process.exit(21);
}

if (args.includes('--file=-')) {
  process.stderr.write('pg_dump stdout must be selected by omitting --file\n');
  process.exit(26);
}

if (args.includes('--format=custom')) {
  if (
    process.env.PGHOST !== 'source.example.test'
    || process.env.PGPORT !== '6543'
    || process.env.PGUSER !== 'backup-user'
    || process.env.PGPASSWORD !== 'source-secret'
    || process.env.PGDATABASE !== 'insurespr'
    || process.env.PGSSLMODE !== 'require'
  ) {
    process.stderr.write('Source database environment is incomplete\n');
    process.exit(22);
  }
  if (process.env.MOCK_PG_DUMP_EMPTY !== '1') {
    process.stdout.write(process.env.MOCK_PG_DUMP_PAYLOAD || 'mock-custom-format-dump');
  }
  process.exit(0);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks);
const expected = Buffer.from(process.env.MOCK_PG_DUMP_PAYLOAD || 'mock-custom-format-dump');
if (!input.equals(expected)) {
  process.stderr.write('Decrypted archive did not match the mock dump\n');
  process.exit(23);
}

if (args.includes('--list')) {
  process.stdout.write('; mock pg_restore archive listing\n');
  process.exit(0);
}

const databaseIndex = args.indexOf('--dbname');
if (
  databaseIndex === -1
  || args[databaseIndex + 1] !== 'isolated_restore'
  || process.env.PGHOST !== 'isolated.example.test'
  || process.env.PGPORT !== '5432'
  || process.env.PGUSER !== 'restore-user'
  || process.env.PGPASSWORD !== 'restore-secret'
  || process.env.PGDATABASE !== 'isolated_restore'
  || process.env.PGSSLMODE !== 'disable'
) {
  process.stderr.write('Isolated restore database environment is incomplete\n');
  process.exit(24);
}

if (process.env.MOCK_PG_CAPTURE_FILE) {
  await writeFile(process.env.MOCK_PG_CAPTURE_FILE, input, { flag: 'wx' });
  const captured = await readFile(process.env.MOCK_PG_CAPTURE_FILE);
  if (!captured.equals(expected)) process.exit(25);
}

process.stdout.write('mock restore complete\n');
