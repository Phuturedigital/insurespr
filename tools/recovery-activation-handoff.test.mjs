import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateRecoveryActivationHandoff } from './recovery-activation-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'RECOVERY-ACTIVATION-HANDOFF.json'), 'utf8'));
const clone = (value) => structuredClone(value);

test('recovery activation handoff preserves the exact fail-closed production draft', () => {
  assert.deepEqual(validateRecoveryActivationHandoff(manifest, 'draft'), []);
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.liveSnapshot.recoveryConfigurationCount, 0);
  assert.equal(manifest.liveSnapshot.recoveryExecutionEvidenceCount, 0);
  assert.equal(manifest.liveSnapshot.backupRecoveryBlocksLaunch, true);
  assert.equal(manifest.controlledRehearsal.completed, false);
});

test('draft validation rejects invented route, objectives, custody, schedule, rehearsal and approval evidence', () => {
  const changed = clone(manifest);
  changed.activationAuthorized = true;
  changed.routeDecision.selectedRoute = 'offsite_logical';
  changed.recoveryObjectives.maximumRecoveryPointAgeMinutes = 1440;
  changed.secretCustody.encryptionKeyFingerprintSha256 = 'a'.repeat(64);
  changed.scheduleAndOwnership.recoveryOwner = 'Someone';
  changed.controlledRehearsal.completed = true;
  changed.approval = { approvedBy: 'Someone' };
  const errors = validateRecoveryActivationHandoff(changed, 'draft');
  assert(errors.some((error) => error.includes('activationAuthorized must be false')));
  assert(errors.some((error) => error.includes('route decision must be null')));
  assert(errors.some((error) => error.includes('maximumRecoveryPointAgeMinutes must be null')));
  assert(errors.some((error) => error.includes('encryptionKeyFingerprintSha256 must be null')));
  assert(errors.some((error) => error.includes('scheduleAndOwnership.recoveryOwner must be null')));
  assert(errors.some((error) => error.includes('rehearsal must remain incomplete')));
  assert(errors.some((error) => error.includes('draft approval must be null')));
});

test('approved validation requires full ownership, secret custody and successful isolated restore evidence', () => {
  const changed = clone(manifest);
  changed.status = 'approved-for-activation';
  changed.activationAuthorized = true;
  changed.routeDecision.selectedRoute = 'offsite_logical';
  changed.approval = {
    approvedBy: 'Same',
    peerReviewedBy: 'Same',
    approvedAt: 'not-a-date',
    evidenceDocumentKey: '',
    changeReference: '',
  };
  const errors = validateRecoveryActivationHandoff(changed, 'approved');
  assert(errors.some((error) => error.includes('offsiteStorageProvider is required')));
  assert(errors.some((error) => error.includes('maximum recovery-point age')));
  assert(errors.some((error) => error.includes('encryptionKeyFingerprintSha256 must be SHA-256')));
  assert(errors.some((error) => error.includes('recoveryOwner is required')));
  assert(errors.some((error) => error.includes('controlled rehearsal must be complete')));
  assert(errors.some((error) => error.includes('external delivery must be proven disabled')));
  assert(errors.some((error) => error.includes('peer reviewer must differ')));
});

test('plaintext database URLs, keys, service-role tokens and backup payload fields are rejected', () => {
  for (const [field, value] of [
    ['databaseUrl', 'postgresql://user:password@db.example.test/postgres'],
    ['encryptionKey', 'super-secret-key'],
    ['serviceRoleKey', ['eyJ12345678901234567890', 'abcdefghijklmnopqrstuvwxyz', '1234567890abcdef'].join('.')],
    ['backupPayload', 'patient-records'],
  ]) {
    const changed = clone(manifest);
    changed.secretCustody[field] = value;
    const errors = validateRecoveryActivationHandoff(changed, 'draft');
    assert(errors.some((error) => error.includes('forbidden plaintext-secret or backup field')), `${field} was accepted`);
  }
});

test('database contracts enforce private, append-only, rehearsal-first and dynamic readiness behavior', async () => {
  const [indexMigration, migration, evidenceMigration, api, ignored] = await Promise.all([
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829080652_index_notification_delivery_evidence_fk.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829080656_harden_recovery_activation_provenance.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829080700_record_recovery_activation_handoff.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'functions', 'insurespr-api', 'index.ts'), 'utf8'),
    readFile(path.join(ROOT, '.vercelignore'), 'utf8'),
  ]);
  assert.match(ignored, /^RECOVERY-ACTIVATION-HANDOFF\.json$/m);
  assert.match(indexMigration, /notification_delivery_configurations_evidence_document_id_idx/);
  assert.match(migration, /create table private\.recovery_activation_configurations/);
  assert.match(migration, /create table private\.recovery_execution_evidence/);
  assert.match(migration, /as restrictive/);
  assert.match(migration, /to anon, authenticated, service_role/);
  assert.match(migration, /must enter through rehearsal, never directly as active/);
  assert.match(migration, /recovery execution evidence is append-only/);
  assert.match(migration, /accepted controlled evidence document/);
  assert.match(migration, /recovery-secret-custody-verified/);
  assert.match(migration, /recovery-schedule-verified/);
  assert.match(migration, /public\.public_intake_activation_ready/);
  assert.match(migration, /dynamic freshness remains enforced/i);
  assert.match(migration, /ROLLBACK_RECOVERY_ACTIVATION_PROVENANCE_PROBE/);
  assert.doesNotMatch(migration, /vault\.create_secret\s*\(/i);
  assert.doesNotMatch(migration, /cron\.schedule\s*\(/i);
  assert.match(evidenceMigration, /375b8102b5a57727b99e94ee4e99d0e7dae494ddf5673a318d6eefe81bf4dde2/g);
  assert.match(evidenceMigration, /v_claim_count is distinct from 4/);
  assert.match(evidenceMigration, /prepared handoff accidentally satisfies an activation evidence claim/);
  assert.doesNotMatch(evidenceMigration, /insert into private\.recovery_activation_configurations/i);
  assert.doesNotMatch(evidenceMigration, /insert into private\.recovery_execution_evidence/i);
  assert.match(api, /public_intake_activation_ready/);
  assert.match(api, /INTAKE_ACTIVATION_NOT_READY/);
});
