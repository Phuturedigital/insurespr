import assert from 'node:assert/strict';
import test from 'node:test';

import { scanRepository, scanText } from './secret-scan.mjs';

test('detects production credential shapes without returning their values', () => {
  const cases = [
    ['private.pem', `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\nnot-a-real-key`, 'private-key-block'],
    ['config.env', `SUPABASE_SECRET_KEY=${['sb', 'secret', 'abcdefghijklmnopqrstuv'].join('_')}`, 'supabase-secret-key'],
    ['config.env', `RESEND_API_KEY=${['re', 'abcdefghijklmnopqrstuvwxyz1234'].join('_')}`, 'resend-api-key'],
    ['config.env', `TURNSTILE_SECRET_KEY=${['0x4', 'A'.repeat(28)].join('')}`, 'turnstile-key'],
    ['config.env', `DATABASE_URL=${['postgresql:/', '/user:password@db.example.test/postgres'].join('')}`, 'database-credential-uri'],
    ['config.env', 'INSURESPR_PROXY_PRIVATE_KEY_B64=YWJjZGVmZ2hpamtsbW5vcA==', 'nonempty-insurespr_proxy_private_key_b64'],
  ];

  for (const [file, content, type] of cases) {
    const findings = scanText(file, content);
    assert(findings.some((finding) => finding.type === type), `${type} was not detected`);
    assert(findings.every((finding) => !Object.values(finding).includes(content)), `${type} leaked its value`);
  }
});

test('allows blank templates and explicit placeholders', () => {
  const findings = scanText('vercel.env.example', [
    'TURNSTILE_SECRET_KEY=',
    'RESEND_API_KEY=replace_with_provider_value',
    'NOTIFICATION_WORKER_SECRET=${NOTIFICATION_WORKER_SECRET}',
    'INSURESPR_PROXY_PRIVATE_KEY_B64=<stored-in-vercel>',
  ].join('\n'));

  assert.deepEqual(findings, []);
});

test('known synthetic safety fixtures remain scannable without becoming exemptions for other keys', () => {
  assert.deepEqual(
    scanText('tools/turnstile-activation-handoff.test.mjs', `const value = '${['0x4AAAAA', 'example', 'plaintext', 'secret'].join('-')}';`),
    [],
  );
  assert.equal(
    scanText('tools/turnstile-activation-handoff.test.mjs', `const value = '${['0x4', 'B'.repeat(28)].join('')}';`).length,
    1,
  );
});

test('the current tracked and untracked repository contains no credential material', async () => {
  assert.deepEqual(await scanRepository(), []);
});
