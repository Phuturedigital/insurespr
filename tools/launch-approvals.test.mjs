import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(ROOT, name), 'utf8');

test('approved privacy publication is explicit without claiming registration', async () => {
  const [page, operations, approvals] = await Promise.all([
    read('privacy.html'),
    read('PRIVACY-OPERATIONS.md'),
    read('LAUNCH-APPROVALS.md'),
  ]);

  for (const source of [page, operations]) {
    assert.match(source, /2026-08-21\.1/);
    assert.match(source, /Motselisi R\. Mosiana/);
    assert.match(source, /health@insuresprhealth\.co\.za/);
  }
  assert.match(page, /does not claim that Information Officer registration is complete/);
  assert.match(approvals, /does not turn a missing fact into a\s+verified fact/);
});

test('provider template contains every runtime key without a secret value', async () => {
  const env = await read('supabase/functions/.env.example');
  for (const key of [
    'TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'EMAIL_REPLY_TO',
    'NOTIFICATION_WORKER_SECRET',
  ]) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} is missing`);
  }
  for (const secret of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'NOTIFICATION_WORKER_SECRET']) {
    assert.match(env, new RegExp(`^${secret}=$`, 'm'), `${secret} must remain blank in git`);
  }
  assert.doesNotMatch(env, /BOOKING_FROM_EMAIL|SITE_URL/);
});

test('decision migration records policy but cannot open intake', async () => {
  const migration = await read('supabase/migrations/20260821074451_record_owner_approved_launch_decisions.sql');
  assert.match(migration, /data_retention_policy\s*=/);
  assert.doesNotMatch(migration, /set\s+privacy_notice_version\s*=/i);
  assert.match(migration, /v_notice !~\* '\^pending'/);
  assert.match(migration, /'service-catalogue', 'blog-migration', 'domain-redirects'/);
  assert.match(migration, /'anti-spam-secrets'/);
  assert.match(migration, /'email-delivery'/);
});

test('legacy decision is owner-approved hold with routing inactive', async () => {
  const manifest = JSON.parse(await read('LEGACY-REDIRECT-MANIFEST.json'));
  assert.equal(manifest.status, 'approved-hold-no-routing');
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.holdApproval.status, 'approved');
  assert.equal(manifest.holdApproval.approvedBy, 'Motselisi R. Mosiana, owner');
  assert.equal(manifest.entries.length, 153);
  assert(manifest.entries.every((entry) => entry.state === 'hold' && entry.destination === null));
});
