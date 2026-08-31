import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(ROOT, name), 'utf8');

test('repository evidence records only the private custody boundary', async () => {
  const evidenceText = await read('HPCSA-REGISTRATION-EVIDENCE.json');
  const evidence = JSON.parse(evidenceText);

  assert.equal(evidence.schema_version, 2);
  assert.equal(evidence.evidence_key, 'hpcsa-practitioner-20260830');
  assert.equal(evidence.record.subject, 'Motselisi R. Mosiana');
  assert.equal(evidence.record.custody, 'Private Supabase readiness evidence');
  assert.match(evidence.record.details, /Withheld from the public website and repository artifact/);
  assert.equal(evidence.publication_scope.public_use_allowed, false);
  assert.deepEqual(evidence.publication_scope.allowed, []);
  assert.match(evidence.publication_scope.reason, /website and public repository not publish/);
  assert.doesNotMatch(evidenceText, /DR\s*0*66079/i);
  assert.doesNotMatch(evidenceText, /hpcsaonline/i);
  assert.doesNotMatch(evidenceText, /"status"\s*:\s*"ACTIVE"/i);
});

test('public owner story does not publish private registration evidence', async () => {
  const page = await read('about.html');

  assert.match(page, /Verified privately, published carefully/);
  assert.match(page, /does not publish registration numbers, regulator status or detailed credential records/);
  assert.match(page, /owns and founded InsureSPR Health/);
  assert.doesNotMatch(page, /DR\s*0*66079/i);
  assert.doesNotMatch(page, /HPCSA/i);
  assert.doesNotMatch(page, /i_reg_form/i);
  assert.doesNotMatch(page, /listed as active/i);
  assert.doesNotMatch(page, /"propertyID":\s*"HPCSA registration"/i);
});

test('forward migration withdraws public use and keeps broader credential and intake gates closed', async () => {
  const [evidenceText, sourceMigration, withdrawalMigration, redactionMigration, ignored, readiness, approvals, register] = await Promise.all([
    read('HPCSA-REGISTRATION-EVIDENCE.json'),
    read('supabase/migrations/20260830200223_record_verified_hpcsa_registration.sql'),
    read('supabase/migrations/20260830201348_withdraw_public_hpcsa_registration_claim.sql'),
    read('supabase/migrations/20260830202643_redact_public_repository_practitioner_evidence.sql'),
    read('.vercelignore'),
    read('PRODUCTION-READINESS.md'),
    read('LAUNCH-APPROVALS.md'),
    read('OPERATIONAL-EVIDENCE-REGISTER.md'),
  ]);
  const digest = createHash('sha256').update(evidenceText).digest('hex');

  assert.equal(digest, '6a1da8c3a790db148c9d7560ccf1c98e7833040330d5e0ce0f98d9fdfe7f6f7d');
  assert.match(sourceMigration, /'motselisi-hpcsa-registration-status'/);
  assert.match(withdrawalMigration, new RegExp(digest, 'g'));
  assert.match(redactionMigration, new RegExp(digest, 'g'));
  assert.match(redactionMigration, /public_use_allowed = false/);
  assert.match(redactionMigration, /public repository artifact records the custody and publication boundary/);
  assert.doesNotMatch(sourceMigration, /DR\s*0*66079/i);
  assert.doesNotMatch(sourceMigration, /hpcsaonline/i);
  assert.doesNotMatch(sourceMigration, /'ACTIVE'/i);
  assert.match(withdrawalMigration, /public_use_allowed = false/);
  assert.match(withdrawalMigration, /claim\.review_status = 'verified'/);
  assert.match(withdrawalMigration, /status = 'open'/);
  assert.match(withdrawalMigration, /blocks_launch = true/);
  assert.match(withdrawalMigration, /publication withdrawal must not verify service capability/);
  assert.match(withdrawalMigration, /publication withdrawal must not create operational records/);
  assert.doesNotMatch(withdrawalMigration, /update public\.services/i);
  assert.doesNotMatch(withdrawalMigration, /update public\.practice_settings/i);
  assert.doesNotMatch(withdrawalMigration, /insert into public\.(?:booking_slots|customers|bookings|employer_leads|contact_enquiries|consent_records|notification_attempts)/i);

  assert.match(ignored, /^HPCSA-REGISTRATION-EVIDENCE\.json$/m);
  assert.match(readiness, /owner subsequently directed[\s\S]*must not display the registration number/);
  assert.match(approvals, /owner has explicitly declined public display of the registration number/);
  assert.match(register, /Private practitioner-register verification/);
  assert.match(register, /detailed query and result are retained only in the private/);
  assert.match(register, /verified-credentials.*remains[\s\S]*open and blocking/i);
});
