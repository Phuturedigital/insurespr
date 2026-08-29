import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  validateLivePrivacyState,
  validatePrivacyActivationHandoff,
} from './privacy-activation-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'PRIVACY-ACTIVATION-HANDOFF.json'), 'utf8'));
const clone = (value) => structuredClone(value);

test('privacy activation handoff is a complete fail-closed draft', () => {
  assert.deepEqual(validatePrivacyActivationHandoff(manifest, 'draft'), []);
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.publicNotice.databasePrivacyVersion, 'pending-approval');
  assert.equal(manifest.ownerApprovedFacts.informationRegulatorRegistrationClaimed, false);
});

test('draft validation rejects premature legal, processor and final approval', () => {
  const changed = clone(manifest);
  changed.activationAuthorized = true;
  changed.legalIdentityApproval.registrationNumber = '2025/177122/07';
  changed.informationOfficerApproval.registrationStatus = 'registered-evidence-held';
  changed.processorApprovals[0].approvedBy = 'Unreviewed';
  changed.finalApproval.approvedVersion = '2026-08-21.1';
  const errors = validatePrivacyActivationHandoff(changed, 'draft');
  assert(errors.some((error) => error.includes('activationAuthorized must be false')));
  assert(errors.some((error) => error.includes('legalIdentityApproval.registrationNumber must be null')));
  assert(errors.some((error) => error.includes('registration status must be pending-evidence')));
  assert(errors.some((error) => error.includes('Supabase.approvedBy must be null')));
  assert(errors.some((error) => error.includes('finalApproval.approvedVersion must be null')));
});

test('approved validation rejects weak or incomplete release evidence', () => {
  const changed = clone(manifest);
  changed.status = 'approved';
  changed.activationAuthorized = true;
  changed.legalIdentityApproval.registrationNumber = 'not-a-registration';
  changed.informationOfficerApproval.registrationStatus = 'registered-evidence-held';
  changed.processorApprovals[0].currentTechnicalState = 'active-verified';
  changed.operationsApproval.responseTargetWorkingDays = 0;
  changed.finalApproval.approvedVersion = 'wrong-version';
  changed.finalApproval.changeReference = 'short';
  const errors = validatePrivacyActivationHandoff(changed, 'approved');
  assert(errors.some((error) => error.includes('requires verified operational backup')));
  assert(errors.some((error) => error.includes('legal registrationNumber must use')));
  assert(errors.some((error) => error.includes('informationOfficerApproval.regulatorReference is required')));
  assert(errors.some((error) => error.includes('Vercel: currentTechnicalState must be active-verified')));
  assert(errors.some((error) => error.includes('responseTargetWorkingDays must be 1-30')));
  assert(errors.some((error) => error.includes('approvedVersion must equal')));
  assert(errors.some((error) => error.includes('changeReference must be at least 8')));
});

test('live privacy comparison detects database and notice drift', () => {
  const payload = {
    practice: {
      practice_name: 'InsureSPR Precision Healthcare',
      public_email: 'motselisi@bonevc.co.za',
      phone_e164: '+27834507861',
      privacy_notice_version: 'pending-approval',
      data_retention_policy: 'Approved website retention schedule',
    },
  };
  const notice = 'Publication version:</strong> 2026-08-21.1 Motselisi R. Mosiana motselisi@bonevc.co.za does not claim that Information Regulator registration is complete Incomplete or spam submissions: up to 90 days 6 years after last booking activity';
  assert.deepEqual(validateLivePrivacyState(manifest, payload, notice), []);

  payload.practice.privacy_notice_version = 'unreviewed-version';
  payload.practice.public_email = 'other@example.invalid';
  const errors = validateLivePrivacyState(manifest, payload, notice.replace('does not claim that Information Regulator registration is complete', ''));
  assert(errors.some((error) => error.includes('live database privacy version differs')));
  assert(errors.some((error) => error.includes('live privacy email differs')));
  assert(errors.some((error) => error.includes('regulator-registration disclaimer is missing')));
});

test('database evidence records the packet without approving privacy or intake', async () => {
  const [migration, ignored] = await Promise.all([
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829070000_record_privacy_activation_handoff.sql'), 'utf8'),
    readFile(path.join(ROOT, '.vercelignore'), 'utf8'),
  ]);
  assert.match(ignored, /^PRIVACY-ACTIVATION-HANDOFF\.json$/m);
  assert.match(migration, /6778b1b810cce32d44394ddd4edbbe76076dff981cce6845b2e2e4abe6566b81/g);
  assert.match(migration, /v_claim_count is distinct from 6/);
  assert.match(migration, /v_open_dependencies is distinct from 5/);
  assert.match(migration, /privacy_notice_version is distinct from 'pending-approval'/);
  assert.match(migration, /data_retention_policy not like 'Website schedule approved 2026-08-21:%'/);
  assert.match(migration, /Do not change privacy_notice_version until the approved-mode packet passes/);
  assert.doesNotMatch(migration, /set\s+privacy_notice_version\s*=/i);
  assert.doesNotMatch(migration, /insert into public\.(customers|bookings|employer_leads|contact_enquiries|notification_attempts)/i);
});
