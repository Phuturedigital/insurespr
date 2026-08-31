import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  validateLiveNotificationState,
  validateNotificationActivationHandoff,
} from './notification-activation-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'NOTIFICATION-ACTIVATION-HANDOFF.json'), 'utf8'));
const clone = (value) => structuredClone(value);

test('notification handoff is an exact fail-closed production draft', () => {
  assert.deepEqual(validateNotificationActivationHandoff(manifest, 'draft'), []);
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.liveSnapshot.notificationAttemptCount, 0);
  assert.equal(manifest.liveSnapshot.notificationConfigurationCount, 0);
  assert.equal(manifest.schedulerActivation.authorized, false);
  assert.equal(manifest.controlledDeliveryTest.completed, false);
});

test('draft validation rejects invented provider, DNS, secret, schedule and delivery evidence', () => {
  const changed = clone(manifest);
  changed.activationAuthorized = true;
  changed.dnsEvidence.spf = { verified: true };
  changed.providerConfiguration.emailFrom = 'bookings@insuresprhealth.co.za';
  changed.secretCustody.providerApiKeyFingerprintSha256 = 'a'.repeat(64);
  changed.schedulerActivation.authorized = true;
  changed.controlledDeliveryTest.completed = true;
  changed.approval = { approvedBy: 'Someone' };
  const errors = validateNotificationActivationHandoff(changed, 'draft');
  assert(errors.some((error) => error.includes('activationAuthorized must be false')));
  assert(errors.some((error) => error.includes('dnsEvidence.spf must be null')));
  assert(errors.some((error) => error.includes('providerConfiguration.emailFrom must be null')));
  assert(errors.some((error) => error.includes('providerApiKeyFingerprintSha256 must be null')));
  assert(errors.some((error) => error.includes('scheduler must remain unauthorized')));
  assert(errors.some((error) => error.includes('delivery test must be incomplete')));
  assert(errors.some((error) => error.includes('draft approval must be null')));
});

test('approved validation requires complete independent evidence and operational ownership', () => {
  const changed = clone(manifest);
  changed.status = 'approved-for-controlled-activation';
  changed.activationAuthorized = true;
  changed.approval = {
    approvedBy: 'Same person',
    peerReviewedBy: 'Same person',
    approvedAt: 'not-a-date',
    evidenceDocumentKey: '',
    changeReference: '',
  };
  const errors = validateNotificationActivationHandoff(changed, 'approved');
  assert(errors.some((error) => error.includes('dnsEvidence.spf proof is required')));
  assert(errors.some((error) => error.includes('providerConfiguration.providerAccountReference is required')));
  assert(errors.some((error) => error.includes('providerApiKeyFingerprintSha256 must be SHA-256')));
  assert(errors.some((error) => error.includes('schedulerActivation.authorized must be true')));
  assert(errors.some((error) => error.includes('controlled delivery test must be complete')));
  assert(errors.some((error) => error.includes('peer reviewer must differ')));
});

test('plaintext provider and platform secret shapes are rejected anywhere in the handoff', () => {
  for (const [field, value] of [
    ['apiKey', 're_1234567890abcdef'],
    ['workerSecret', 'a-secret-value-that-must-not-be-here'],
    ['serviceRoleKey', ['eyJ12345678901234567890', 'abcdefghijklmnopqrstuvwxyz', '1234567890abcdef'].join('.')],
  ]) {
    const changed = clone(manifest);
    changed.secretCustody[field] = value;
    const errors = validateNotificationActivationHandoff(changed, 'draft');
    assert(errors.some((error) => error.includes('forbidden plaintext-secret field')), `${field} was accepted`);
  }
});

test('live readiness comparison detects accidental notification activation', () => {
  const safe = {
    status: 200,
    readyHeader: 'false',
    body: { ok: true, ready: false, readiness: 'not_ready' },
  };
  assert.deepEqual(validateLiveNotificationState(manifest, safe), []);
  const active = {
    status: 200,
    readyHeader: 'true',
    body: { ok: true, ready: true, readiness: 'ready' },
  };
  const errors = validateLiveNotificationState(manifest, active);
  assert(errors.some((error) => error.includes('unexpectedly reports ready')));
  assert(errors.some((error) => error.includes('header differs')));
});

test('database, evidence and worker contracts bind delivery to exact approved configuration', async () => {
  const [migration, denyPolicy, rehearsal, evidence, worker, ignored] = await Promise.all([
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829072912_harden_notification_activation_provenance.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829073933_add_notification_configuration_deny_policy.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829074321_add_notification_rehearsal_stage.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829074026_record_notification_activation_handoff.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'functions', 'insurespr-notifications', 'index.ts'), 'utf8'),
    readFile(path.join(ROOT, '.vercelignore'), 'utf8'),
  ]);
  assert.match(ignored, /^NOTIFICATION-ACTIVATION-HANDOFF\.json$/m);
  assert.match(migration, /create table private\.notification_delivery_configurations/);
  assert.match(migration, /provider_api_key_fingerprint text/);
  assert.match(migration, /worker_secret_fingerprint text/);
  assert.match(migration, /approved_by <> peer_reviewed_by/);
  assert.match(migration, /configuration and evidence are immutable/);
  assert.match(migration, /notification_delivery_activation_ready/);
  assert.match(migration, /extname = 'pg_cron'/);
  assert.match(migration, /extname = 'pg_net'/);
  assert.match(migration, /ROLLBACK_NOTIFICATION_ACTIVATION_PROVENANCE_PROBE/);
  assert.doesNotMatch(migration, /cron\.schedule\s*\(/i);
  assert.doesNotMatch(migration, /vault\.create_secret\s*\(/i);

  assert.match(denyPolicy, /as restrictive/);
  assert.match(denyPolicy, /to anon, authenticated, service_role/);
  assert.match(denyPolicy, /using \(false\)/);

  assert.match(rehearsal, /state in \('rehearsal', 'active', 'revoked'\)/);
  assert.match(rehearsal, /interval '24 hours'/);
  assert.match(rehearsal, /never directly as active/);
  assert.match(rehearsal, /p_mode text/);
  assert.match(rehearsal, /p_mode = 'rehearsal'/);
  assert.match(rehearsal, /ROLLBACK_NOTIFICATION_REHEARSAL_STAGE_PROBE/);
  assert.doesNotMatch(rehearsal, /cron\.schedule\s*\(/i);

  assert.match(evidence, /bde0a6ecd538a0bd9be1af6cae2144fdabfbe25fc73f50a72d2c6d3e49725c6f/g);
  assert.match(evidence, /v_claim_count is distinct from 4/);
  assert.match(evidence, /scheduler activation remains explicitly unauthorized/);
  assert.match(evidence, /exists \(select 1 from public\.notification_attempts\)/);
  assert.doesNotMatch(evidence, /insert into public\.notification_attempts/i);
  assert.doesNotMatch(evidence, /insert into private\.notification_delivery_configurations/i);
  assert.doesNotMatch(evidence, /cron\.schedule\s*\(/i);

  assert.match(worker, /NOTIFICATION_CONFIG_SHA256/);
  assert.match(worker, /NOTIFICATION_WORKER_SOURCE_SHA256/);
  assert.match(worker, /NOTIFICATION_ACTIVATION_MODE/);
  assert.match(worker, /notification_delivery_activation_ready/);
  assert.match(worker, /p_mode: mode/);
  assert.match(worker, /if \(!key\.startsWith\('sb_secret_'\)\)/);
});
