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
    assert.match(source, /motselisi@bonevc\.co\.za/);
  }
  assert.match(page, /Designated Information Officer/);
  assert.match(page, /does not claim that Information Regulator registration is complete/);
  assert.match(approvals, /does not turn a missing fact into a\s+verified fact/);
});

test('owner-approved booking contacts are consistent across every production page', async () => {
  const pages = [
    'index.html', 'spr.html', 'about.html', 'xray.html', 'scanning.html', 'workforce.html',
    'book.html', 'contact.html', 'privacy.html', 'booking-confirmation.html',
    'manage-booking.html', '404.html', 'dxa-body-composition.html', 'dxa-bone-density.html',
    'osteoporosis-care.html', 'primary-healthcare-x-ray.html', 'visa-chest-x-ray.html',
    'workplace-medicals.html', 'musculoskeletal-x-ray.html', 'chest-x-ray.html',
    'orthopaedic-follow-up-x-ray.html', 'workplace-chest-x-ray.html',
    'runner-athlete-bone-health.html', 'menopause-bone-health.html',
    'treatment-related-bone-health.html', 'post-fracture-bone-health.html',
    'body-composition-progress.html', 'long-term-condition-bone-health.html',
  ];

  for (const pageName of pages) {
    const page = await read(pageName);
    assert.match(page, /Bookings: Motselisi Mosiana/, `${pageName} must name the booking contact`);
    assert.match(page, /href="tel:\+27834507861"/, `${pageName} must expose the approved phone`);
    assert.match(page, /href="https:\/\/wa\.me\/27834507861\?text=Hello%20InsureSPR%2C%20I%20would%20like%20help%20with%20a%20booking\."/, `${pageName} must expose the approved generic WhatsApp route`);
    assert.match(page, /href="mailto:motselisi@bonevc\.co\.za"/, `${pageName} must expose the approved receiving email`);
    assert.doesNotMatch(page, /health@insuresprhealth\.co\.za/, `${pageName} must not route bookings to a domain without verified mail routing`);
  }
});

test('forward-only migration stores the exact contacts without opening intake', async () => {
  const migration = await read('supabase/migrations/20260821140910_restore_owner_booking_contacts.sql');
  assert.match(migration, /phone_display = '083 450 7861'/);
  assert.match(migration, /phone_e164 = '\+27834507861'/);
  assert.match(migration, /whatsapp_e164 = '27834507861'/);
  assert.match(migration, /public_email = 'motselisi@bonevc\.co\.za'/);
  assert.match(migration, /designated Motselisi R\. Mosiana as the Information Officer/);
  assert.match(migration, /privacy_notice_version is distinct from 'pending-approval'/);
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

test('readiness form is hash-bound privately without promoting unsupported claims', async () => {
  const [migration, hardening, register, ignored] = await Promise.all([
    read('supabase/migrations/20260828230538_record_operational_readiness_evidence.sql'),
    read('supabase/migrations/20260828230930_harden_readiness_evidence_access.sql'),
    read('OPERATIONAL-EVIDENCE-REGISTER.md'),
    read('.vercelignore'),
  ]);

  assert.match(migration, /create table private\.readiness_evidence_documents/);
  assert.match(migration, /create table private\.readiness_evidence_claims/);
  assert.match(migration, /3a7558854583a363cc0961fbed68345dc362a873f6d3bfcb57679809e6dbd301/g);
  assert.match(migration, /review_status = 'partially_accepted'/);
  assert.match(migration, /v_claim_count <> 19/);
  assert.match(migration, /only prior owner-approved public contact and designation claims may be public/);
  assert.match(migration, /this form supplies no independently verified claim/);
  assert.match(migration, /submitted readiness boxes must not verify published services/);
  assert.match(migration, /candidate availability values must not activate booking capacity/);
  assert.match(migration, /readiness evidence must not open transactional intake/);
  assert.doesNotMatch(migration, /C:\\Users|AppData|102 Kathleen|0472492/);

  assert.match(hardening, /create policy readiness_evidence_documents_deny_all/);
  assert.match(hardening, /create policy readiness_evidence_claims_deny_all/);
  assert.match(hardening, /create index readiness_evidence_claims_dependency_idx/);
  assert.match(hardening, /from public, anon, authenticated, service_role/);

  assert.match(register, /`owner_approved` \| 2/);
  assert.match(register, /`needs_evidence` \| 8/);
  assert.match(register, /`contradicted` \| 2/);
  assert.match(register, /`missing` \| 7/);
  assert.match(register, /`verified` \| 0/);
  assert.match(ignored, /^OPERATIONAL-EVIDENCE-REGISTER\.md$/m);
});

test('readiness evidence leaves every activation dependency explicit', async () => {
  const migration = await read('supabase/migrations/20260828230538_record_operational_readiness_evidence.sql');
  for (const dependency of [
    'privacy-popia',
    'verified-credentials',
    'clinical-requirements',
    'booking-rules',
    'approved-prices',
    'anti-spam-secrets',
    'email-delivery',
    'notification-operations',
    'google-business-profile',
  ]) {
    assert.match(migration, new RegExp(`where dependency_key = '${dependency}'`));
  }
  assert.match(migration, /v_open_blockers <> 9/);
});

test('retention enforcement is private, dry-run-first and cannot purge business records', async () => {
  const [operations, hardening, privacy, runbook, readme] = await Promise.all([
    read('supabase/migrations/20260829000849_add_guarded_retention_operations.sql'),
    read('supabase/migrations/20260829001229_harden_retention_access.sql'),
    read('PRIVACY-OPERATIONS.md'),
    read('OPERATIONS-RUNBOOK.md'),
    read('README.md'),
  ]);

  assert.match(operations, /create table private\.retention_legal_holds/);
  assert.match(operations, /create table private\.retention_runs/);
  assert.match(operations, /create or replace function private\.retention_inventory/);
  assert.match(operations, /create or replace function private\.apply_retention_policy/);
  assert.match(operations, /p_execute boolean default false/);
  assert.match(operations, /PURGE APPROVED WEBSITE RETENTION RECORDS/);
  assert.match(operations, /security invoker/g);
  assert.match(operations, /from public, anon, authenticated, service_role/g);
  assert.doesNotMatch(operations, /delete from public\.(bookings|customers|employer_leads|contact_enquiries|consent_records|booking_status_history|booking_actions|operational_audit_log)/i);
  assert.doesNotMatch(operations, /cron\.|pg_cron|schedule\s*\(/i);

  assert.match(hardening, /create policy retention_legal_holds_deny_all/);
  assert.match(hardening, /create policy retention_runs_deny_all/);
  assert.match(hardening, /v_inventory_rows <> 9 or v_supported_rows <> 4/);
  assert.match(hardening, /initial production retention dry run unexpectedly found an eligible or held disposal candidate/);
  assert.match(hardening, /run\.status = 'dry_run'/);

  for (const document of [privacy, runbook, readme]) {
    assert.match(document, /retention_inventory/);
    assert.match(document, /apply_retention_policy/);
  }
  for (const document of [privacy, runbook]) {
    assert.match(document, /PURGE APPROVED WEBSITE RETENTION RECORDS/);
  }
  assert.match(runbook, /There is deliberately no scheduled purge/);
  assert.match(privacy, /Bookings, customers, booking history, actions, consent, employer leads/);
});

test('verified Free-plan recovery gap is private, machine-readable and release-blocking', async () => {
  const [migration, manifestText, audit, drill, provider, readiness, ignored] = await Promise.all([
    read('supabase/migrations/20260829003006_record_backup_recovery_readiness.sql'),
    read('RECOVERY-READINESS.json'),
    read('tools/release-audit.mjs'),
    read('RECOVERY-RESTORE-DRILL.md'),
    read('PROVIDER-ACTIVATION.md'),
    read('PRODUCTION-READINESS.md'),
    read('.vercelignore'),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.provider, 'supabase');
  assert.equal(manifest.projectRef, 'ffdmmxffzewqiacsuvhr');
  assert.equal(manifest.organizationPlan, 'free');
  assert.equal(manifest.managedDailyBackups.included, false);
  assert.equal(manifest.pointInTimeRecovery.included, false);
  assert.equal(manifest.offsiteLogicalBackup.implemented, false);
  assert.equal(manifest.recoveryApproval.rpoMinutes, null);
  assert.equal(manifest.recoveryApproval.rtoMinutes, null);
  assert.equal(manifest.recoveryApproval.owner, null);
  assert.equal(manifest.recoveryApproval.lastSuccessfulRestoreDrillAt, null);
  assert.doesNotMatch(manifestText, /password|secret|api.?key|database.?url|connection.?string/i);

  assert.match(migration, /create table private\.platform_recovery_observations/);
  assert.match(migration, /platform_recovery_observations_deny_all/);
  assert.match(migration, /from public, anon, authenticated, service_role/);
  assert.match(migration, /'backup-recovery'/);
  assert.match(migration, /'open'/);
  assert.match(migration, /true,/);
  assert.match(migration, /organization_plan <> 'free'/);
  assert.match(migration, /recovery evidence must not open public intake/);
  assert.doesNotMatch(migration, /postgres(?:ql)?:\/\/|sb_secret_|eyJ[a-zA-Z0-9_-]{20,}|C:\\Users/i);

  assert.match(audit, /--recovery-manifest/);
  assert.match(audit, /function validateRecoveryManifest/);
  assert.match(audit, /forbidden secret-like field names/);
  assert.match(audit, /neither verified managed restore points nor an encrypted verified off-site logical backup is available/);
  assert.match(audit, /no successful restore drill is recorded/);
  assert.match(audit, /await auditRecoveryManifest\(config, results\)/);

  for (const document of [drill, provider, readiness]) {
    assert.match(document, /Free plan/);
    assert.match(document, /backup-recovery/);
    assert.match(document, /RPO/);
    assert.match(document, /RTO/);
    assert.match(document, /restore drill/i);
  }
  assert.match(ignored, /^RECOVERY-READINESS\.json$/m);
});
