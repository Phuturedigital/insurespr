import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROCESSORS = new Set(['Supabase', 'Vercel', 'Cloudflare Turnstile', 'Resend']);
const LEGAL_FIELDS = [
  'legalEntityName',
  'registrationNumber',
  'registrationEvidenceRef',
  'registeredAddressEvidenceRef',
  'publicPracticeAddressReconciliationRef',
  'verifiedBy',
  'verifiedAt',
];
const INFORMATION_OFFICER_FIELDS = [
  'regulatorReference',
  'registrationEvidenceRef',
  'paiaManualRef',
  'verifiedBy',
  'verifiedAt',
];
const PROCESSOR_FIELDS = [
  'contractAndTermsEvidenceRef',
  'locationAndSubprocessorReviewRef',
  'popiaSection72BasisRef',
  'deletionAndIncidentRouteRef',
  'approvedBy',
  'approvedAt',
];
const OPERATIONS_FIELDS = [
  'privacyRequestOwner',
  'privacyRequestDeputy',
  'privacyMailboxLiveTestRef',
  'identityVerificationPolicyRef',
  'accessCorrectionDeletionResponsePolicyRef',
  'legalHoldOwner',
  'retentionEnforcementOwner',
  'securityIncidentOwner',
  'securityCompromiseEscalationRef',
  'processorIncidentEscalationRef',
  'backupRecoveryApprovalRef',
  'operatorAccessApprovalRef',
];
const FINAL_FIELDS = [
  'approvedVersion',
  'approvedBy',
  'approvedAt',
  'changeReference',
  'processorActivationEvidenceRef',
  'turnstileActivationEvidenceRef',
  'notificationActivationEvidenceRef',
  'databaseMigrationReviewRef',
];

const isNonemptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isIsoTimestamp = (value) => isNonemptyString(value) && Number.isFinite(Date.parse(value));

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function validateImmutableSnapshot(manifest, errors) {
  pushIf(errors, manifest.schemaVersion !== 1, 'schemaVersion must be 1');
  pushIf(errors, manifest.publicNotice?.url !== 'https://www.insuresprhealth.co.za/privacy', 'public notice URL must be canonical');
  pushIf(errors, manifest.publicNotice?.publicationVersion !== '2026-08-21.1', 'publication version must be 2026-08-21.1');
  pushIf(errors, manifest.publicNotice?.databasePrivacyVersion !== 'pending-approval', 'database privacy-version snapshot must remain pending-approval');

  const facts = manifest.ownerApprovedFacts ?? {};
  pushIf(errors, facts.responsiblePartyPublicName !== 'InsureSPR Precision Healthcare', 'responsible-party public name differs');
  pushIf(errors, facts.designatedInformationOfficer !== 'Motselisi R. Mosiana', 'designated Information Officer differs');
  pushIf(errors, facts.designationDate !== '2026-08-21', 'designation date differs');
  pushIf(errors, facts.privacyContact !== 'motselisi@bonevc.co.za', 'privacy contact differs');
  pushIf(errors, facts.phoneE164 !== '+27834507861', 'privacy phone differs');
  pushIf(errors, facts.informationRegulatorRegistrationClaimed !== false, 'owner-approved facts must not claim Information Regulator registration');
  pushIf(errors, facts.websiteRetentionScheduleApproved !== true, 'approved website retention schedule must remain recorded');

  pushIf(errors, !Array.isArray(manifest.processorApprovals), 'processorApprovals must be an array');
  if (Array.isArray(manifest.processorApprovals)) {
    pushIf(errors, manifest.processorApprovals.length !== PROCESSORS.size, 'exactly four processors are required');
    const names = manifest.processorApprovals.map((processor) => processor?.processor);
    pushIf(errors, new Set(names).size !== names.length, 'processor names must be unique');
    for (const name of PROCESSORS) pushIf(errors, !names.includes(name), `missing processor: ${name}`);
    for (const name of names) pushIf(errors, !PROCESSORS.has(name), `unexpected processor: ${name}`);
  }
}

function validateDraft(manifest, errors) {
  pushIf(errors, manifest.status !== 'prepared-not-approved', 'draft status must be prepared-not-approved');
  pushIf(errors, manifest.activationAuthorized !== false, 'draft activationAuthorized must be false');
  pushIf(errors, manifest.approvedWebsiteRetentionSchedule?.operationalBackupCurrentlyVerified !== false, 'draft must not claim operational backup verification');

  for (const [key, value] of Object.entries(manifest.legalIdentityApproval ?? {})) {
    pushIf(errors, value !== null, `draft legalIdentityApproval.${key} must be null`);
  }
  const ioApproval = manifest.informationOfficerApproval ?? {};
  pushIf(errors, ioApproval.registrationStatus !== 'pending-evidence', 'draft Information Officer registration status must be pending-evidence');
  for (const field of INFORMATION_OFFICER_FIELDS) {
    pushIf(errors, ioApproval[field] !== null, `draft informationOfficerApproval.${field} must be null`);
  }
  for (const processor of manifest.processorApprovals ?? []) {
    for (const field of PROCESSOR_FIELDS) {
      pushIf(errors, processor[field] !== null, `draft ${processor.processor}.${field} must be null`);
    }
  }
  for (const [key, value] of Object.entries(manifest.operationsApproval ?? {})) {
    pushIf(errors, value !== null, `draft operationsApproval.${key} must be null`);
  }
  for (const [key, value] of Object.entries(manifest.finalApproval ?? {})) {
    pushIf(errors, value !== null, `draft finalApproval.${key} must be null`);
  }
}

function validateApproved(manifest, errors) {
  pushIf(errors, manifest.status !== 'approved', 'approved status must be approved');
  pushIf(errors, manifest.activationAuthorized !== true, 'approved activationAuthorized must be true');
  pushIf(errors, manifest.approvedWebsiteRetentionSchedule?.operationalBackupCurrentlyVerified !== true, 'approved packet requires verified operational backup and recovery evidence');

  const legal = manifest.legalIdentityApproval ?? {};
  for (const field of LEGAL_FIELDS) {
    const value = legal[field];
    pushIf(errors, field === 'verifiedAt' ? !isIsoTimestamp(value) : !isNonemptyString(value), `legalIdentityApproval.${field} is required`);
  }
  pushIf(errors, isNonemptyString(legal.registrationNumber) && !/^\d{4}\/\d{6}\/\d{2}$/.test(legal.registrationNumber), 'legal registrationNumber must use YYYY/NNNNNN/NN format');

  const ioApproval = manifest.informationOfficerApproval ?? {};
  pushIf(errors, ioApproval.registrationStatus !== 'registered-evidence-held', 'Information Officer registrationStatus must be registered-evidence-held');
  for (const field of INFORMATION_OFFICER_FIELDS) {
    const value = ioApproval[field];
    pushIf(errors, field === 'verifiedAt' ? !isIsoTimestamp(value) : !isNonemptyString(value), `informationOfficerApproval.${field} is required`);
  }

  for (const processor of manifest.processorApprovals ?? []) {
    pushIf(errors, processor.currentTechnicalState !== 'active-verified', `${processor.processor}: currentTechnicalState must be active-verified`);
    for (const field of PROCESSOR_FIELDS) {
      const value = processor[field];
      pushIf(errors, field === 'approvedAt' ? !isIsoTimestamp(value) : !isNonemptyString(value), `${processor.processor}.${field} is required`);
    }
  }

  const operations = manifest.operationsApproval ?? {};
  for (const field of OPERATIONS_FIELDS) {
    pushIf(errors, !isNonemptyString(operations[field]), `operationsApproval.${field} is required`);
  }
  pushIf(errors, !Number.isInteger(operations.responseTargetWorkingDays) || operations.responseTargetWorkingDays < 1 || operations.responseTargetWorkingDays > 30, 'operationsApproval.responseTargetWorkingDays must be 1-30');

  const finalApproval = manifest.finalApproval ?? {};
  for (const field of FINAL_FIELDS) {
    const value = finalApproval[field];
    pushIf(errors, field === 'approvedAt' ? !isIsoTimestamp(value) : !isNonemptyString(value), `finalApproval.${field} is required`);
  }
  pushIf(errors, isNonemptyString(finalApproval.approvedVersion) && finalApproval.approvedVersion !== manifest.publicNotice?.publicationVersion, 'final approvedVersion must equal the published notice version');
  pushIf(errors, isNonemptyString(finalApproval.changeReference) && finalApproval.changeReference.length < 8, 'final changeReference must be at least 8 characters');
}

export function validatePrivacyActivationHandoff(manifest, mode = 'draft') {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['handoff must be a JSON object'];
  validateImmutableSnapshot(manifest, errors);
  if (mode === 'draft') validateDraft(manifest, errors);
  else if (mode === 'approved') validateApproved(manifest, errors);
  else errors.push('mode must be draft or approved');
  return errors;
}

export function validateLivePrivacyState(manifest, servicesPayload, noticeHtml) {
  const errors = [];
  const practice = servicesPayload?.practice ?? {};
  pushIf(errors, practice.practice_name !== manifest.ownerApprovedFacts?.responsiblePartyPublicName, 'live practice name differs from the privacy handoff');
  pushIf(errors, practice.public_email !== manifest.ownerApprovedFacts?.privacyContact, 'live privacy email differs from the privacy handoff');
  pushIf(errors, practice.phone_e164 !== manifest.ownerApprovedFacts?.phoneE164, 'live privacy phone differs from the privacy handoff');
  pushIf(errors, practice.privacy_notice_version !== manifest.publicNotice?.databasePrivacyVersion, 'live database privacy version differs from the privacy handoff');
  pushIf(errors, typeof noticeHtml !== 'string' || !noticeHtml.includes('Publication version:</strong> 2026-08-21.1'), 'live privacy notice version is missing');
  pushIf(errors, typeof noticeHtml !== 'string' || !noticeHtml.includes('Motselisi R. Mosiana'), 'live designated Information Officer is missing');
  pushIf(errors, typeof noticeHtml !== 'string' || !noticeHtml.includes('motselisi@bonevc.co.za'), 'live privacy contact is missing');
  pushIf(errors, typeof noticeHtml !== 'string' || !noticeHtml.includes('does not claim that Information Regulator registration is complete'), 'live regulator-registration disclaimer is missing');
  pushIf(errors, typeof noticeHtml !== 'string' || !noticeHtml.includes('Incomplete or spam submissions: up to 90 days'), 'live retention schedule is missing the 90-day incomplete-submission rule');
  pushIf(errors, typeof noticeHtml !== 'string' || !noticeHtml.includes('6 years after last booking activity'), 'live retention schedule is missing the six-year booking rule');
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'draft';
  const fileIndex = args.indexOf('--file');
  const filename = fileIndex >= 0 ? args[fileIndex + 1] : path.join(ROOT, 'PRIVACY-ACTIVATION-HANDOFF.json');
  const manifest = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const errors = validatePrivacyActivationHandoff(manifest, mode);

  const liveIndex = args.indexOf('--live-services-url');
  const noticeIndex = args.indexOf('--notice-url');
  if (liveIndex >= 0 || noticeIndex >= 0) {
    const servicesUrl = args[liveIndex + 1];
    const noticeUrl = args[noticeIndex + 1];
    for (const [label, value] of [['--live-services-url', servicesUrl], ['--notice-url', noticeUrl]]) {
      if (!isNonemptyString(value) || new URL(value).protocol !== 'https:') throw new Error(`${label} requires an HTTPS URL`);
    }
    const [servicesResponse, noticeResponse] = await Promise.all([
      fetch(servicesUrl, { headers: { accept: 'application/json' } }),
      fetch(noticeUrl, { headers: { accept: 'text/html' } }),
    ]);
    if (!servicesResponse.ok) throw new Error(`live services request returned HTTP ${servicesResponse.status}`);
    if (!noticeResponse.ok) throw new Error(`live notice request returned HTTP ${noticeResponse.status}`);
    errors.push(...validateLivePrivacyState(manifest, await servicesResponse.json(), await noticeResponse.text()));
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Privacy activation handoff ${mode} validation passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
