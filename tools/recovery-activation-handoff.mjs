import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORBIDDEN_SECRET = /(?:postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@|\bsb_secret_[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/;

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function iso(value) {
  return nonempty(value) && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function positiveInteger(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value > 0 && value <= max;
}

function rejectSecrets(value, errors, location = 'handoff') {
  if (typeof value === 'string') {
    pushIf(errors, FORBIDDEN_SECRET.test(value), `${location} appears to contain plaintext secret material`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecrets(item, errors, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    pushIf(
      errors,
      ['encryptionKey', 'databaseUrl', 'databasePassword', 'serviceRoleKey', 'secretValue', 'backupPayload'].includes(key),
      `${location}.${key} is a forbidden plaintext-secret or backup field`,
    );
    rejectSecrets(child, errors, `${location}.${key}`);
  }
}

function validateBase(manifest, errors) {
  pushIf(errors, manifest.schemaVersion !== 1, 'schemaVersion must equal 1');
  pushIf(errors, manifest.source?.projectRef !== 'ffdmmxffzewqiacsuvhr', 'project reference differs');
  pushIf(errors, manifest.source?.provider !== 'supabase', 'provider differs');
  pushIf(errors, manifest.source?.organizationPlan !== 'free', 'observed organization plan differs');
  pushIf(errors, manifest.source?.timezone !== 'Africa/Johannesburg', 'timezone differs');
  pushIf(errors, !SHA256.test(manifest.source?.repositoryToolSourceSha256 ?? ''), 'repository recovery-tool hash is invalid');
  pushIf(errors, manifest.liveSnapshot?.projectStatus !== 'ACTIVE_HEALTHY', 'live project status differs');
  for (const field of ['managedDailyBackupsIncluded', 'verifiedManagedRestorePoints', 'pointInTimeRecoveryIncluded', 'verifiedPitrWindow', 'offsiteLogicalBackupVerified']) {
    pushIf(errors, manifest.liveSnapshot?.[field] !== false, `liveSnapshot.${field} must remain false`);
  }
  pushIf(errors, manifest.liveSnapshot?.recoveryConfigurationCount !== 0, 'recovery configuration snapshot must remain zero');
  pushIf(errors, manifest.liveSnapshot?.recoveryExecutionEvidenceCount !== 0, 'recovery execution evidence snapshot must remain zero');
  pushIf(errors, manifest.liveSnapshot?.operationalSubmissionCount !== 0, 'operational submission snapshot must remain zero');
  pushIf(errors, manifest.liveSnapshot?.backupRecoveryDependencyStatus !== 'open', 'backup dependency snapshot must remain open');
  pushIf(errors, manifest.liveSnapshot?.backupRecoveryBlocksLaunch !== true, 'backup dependency must remain blocking');
  pushIf(errors, !String(manifest.liveSnapshot?.privacyNoticeVersion ?? '').startsWith('pending'), 'privacy snapshot must remain pending');
  pushIf(errors, manifest.secretCustody?.plaintextSecretsForbidden !== true, 'plaintext secret prohibition is missing');
  rejectSecrets(manifest, errors);
}

function validateDraft(manifest, errors) {
  pushIf(errors, manifest.status !== 'prepared-not-approved', 'draft status must be prepared-not-approved');
  pushIf(errors, manifest.activationAuthorized !== false, 'draft activationAuthorized must be false');
  pushIf(errors, manifest.routeDecision?.selectedRoute !== null, 'draft route decision must be null');
  for (const [key, value] of Object.entries(manifest.routeDecision ?? {})) {
    if (!['providerPlanEvidenceRef', 'selectedRoute'].includes(key)) pushIf(errors, value !== null, `draft routeDecision.${key} must be null`);
  }
  for (const [key, value] of Object.entries(manifest.recoveryObjectives ?? {})) pushIf(errors, value !== null, `draft recoveryObjectives.${key} must be null`);
  for (const field of ['encryptionKeyFingerprintSha256', 'keyStorageLocation', 'keyCustodian', 'databaseCredentialFingerprintSha256', 'databaseCredentialStorageLocation']) {
    pushIf(errors, manifest.secretCustody?.[field] !== null, `draft secretCustody.${field} must be null`);
  }
  for (const [key, value] of Object.entries(manifest.scheduleAndOwnership ?? {})) pushIf(errors, value !== null, `draft scheduleAndOwnership.${key} must be null`);
  const rehearsal = manifest.controlledRehearsal ?? {};
  pushIf(errors, rehearsal.authorized !== false, 'draft rehearsal must remain unauthorized');
  pushIf(errors, rehearsal.completed !== false, 'draft rehearsal must remain incomplete');
  pushIf(errors, rehearsal.externalDeliveryDisabled !== false, 'draft external-delivery test must remain false');
  for (const [key, value] of Object.entries(rehearsal)) {
    if (!['authorized', 'completed', 'externalDeliveryDisabled'].includes(key)) pushIf(errors, value !== null, `draft controlledRehearsal.${key} must be null`);
  }
  pushIf(errors, manifest.approval !== null, 'draft approval must be null');
}

function validateApproved(manifest, errors) {
  pushIf(errors, manifest.status !== 'approved-for-activation', 'approved status must be approved-for-activation');
  pushIf(errors, manifest.activationAuthorized !== true, 'approved activationAuthorized must be true');
  const route = manifest.routeDecision ?? {};
  pushIf(errors, !['offsite_logical', 'supabase_managed_daily', 'supabase_pitr'].includes(route.selectedRoute), 'approved recovery route is invalid');
  pushIf(errors, !nonempty(route.backupRunnerReference), 'routeDecision.backupRunnerReference is required');
  if (route.selectedRoute === 'offsite_logical') {
    for (const field of ['offsiteStorageProvider', 'offsiteStorageReference']) pushIf(errors, !nonempty(route[field]), `routeDecision.${field} is required for offsite_logical`);
  }
  if (route.selectedRoute === 'supabase_managed_daily') pushIf(errors, !nonempty(route.managedRestorePointEvidenceRef), 'managed restore-point evidence is required');
  if (route.selectedRoute === 'supabase_pitr') pushIf(errors, !nonempty(route.pitrWindowEvidenceRef), 'PITR-window evidence is required');

  const objectives = manifest.recoveryObjectives ?? {};
  pushIf(errors, !positiveInteger(objectives.maximumRecoveryPointAgeMinutes, 10080), 'maximum recovery-point age must be 1-10080 minutes');
  pushIf(errors, !positiveInteger(objectives.recoveryTimeObjectiveMinutes, 10080), 'RTO must be 1-10080 minutes');
  pushIf(errors, !positiveInteger(objectives.retentionDays, 3650), 'retention must be 1-3650 days');
  pushIf(errors, !positiveInteger(objectives.restoreDrillIntervalDays, 365), 'restore-drill interval must be 1-365 days');

  const custody = manifest.secretCustody ?? {};
  if (route.selectedRoute === 'offsite_logical') {
    pushIf(errors, custody.encryptionKeyName !== 'INSURESPR_BACKUP_KEY_B64', 'encryption key name differs');
    for (const field of ['encryptionKeyFingerprintSha256', 'databaseCredentialFingerprintSha256']) pushIf(errors, !SHA256.test(custody[field] ?? ''), `secretCustody.${field} must be SHA-256`);
    for (const field of ['keyStorageLocation', 'keyCustodian', 'databaseCredentialStorageLocation']) pushIf(errors, !nonempty(custody[field]), `secretCustody.${field} is required`);
  }

  const ownership = manifest.scheduleAndOwnership ?? {};
  for (const field of ['schedulePlatform', 'scheduleReference', 'scheduleExpression', 'recoveryOwner', 'recoveryDeputy', 'backupCustodian', 'scheduleOwner', 'failureAlertOwner', 'rollbackAuthority', 'scheduleHealthEvidenceRef']) pushIf(errors, !nonempty(ownership[field]), `scheduleAndOwnership.${field} is required`);
  pushIf(errors, ownership.scheduleTimezone !== 'Africa/Johannesburg', 'schedule timezone differs');
  pushIf(errors, !EMAIL.test(ownership.failureAlertRecipient ?? ''), 'failure alert recipient is invalid');
  pushIf(errors, nonempty(ownership.recoveryOwner) && ownership.recoveryOwner === ownership.recoveryDeputy, 'recovery deputy must differ from owner');

  const rehearsal = manifest.controlledRehearsal ?? {};
  pushIf(errors, rehearsal.authorized !== true, 'controlled rehearsal must be authorized');
  pushIf(errors, rehearsal.completed !== true, 'controlled rehearsal must be complete');
  for (const field of ['authorizedAt', 'expiresAt', 'backupRecoveryPointAt', 'restoreCompletedAt', 'isolatedTargetDeletedAt']) pushIf(errors, !iso(rehearsal[field]), `controlledRehearsal.${field} must be an ISO timestamp`);
  if (iso(rehearsal.authorizedAt) && iso(rehearsal.expiresAt)) {
    const span = Date.parse(rehearsal.expiresAt) - Date.parse(rehearsal.authorizedAt);
    pushIf(errors, span <= 0 || span > 72 * 60 * 60 * 1000, 'rehearsal window must be positive and at most 72 hours');
  }
  for (const field of ['backupArtifactSha256', 'backupManifestSha256']) pushIf(errors, !SHA256.test(rehearsal[field] ?? ''), `controlledRehearsal.${field} must be SHA-256`);
  for (const field of ['isolatedTargetReference', 'authorizationEvidenceRef', 'backupEvidenceRef', 'artifactVerificationEvidenceRef', 'restoreEvidenceRef', 'failureAlertTestEvidenceRef']) pushIf(errors, !nonempty(rehearsal[field]), `controlledRehearsal.${field} is required`);
  pushIf(errors, rehearsal.externalDeliveryDisabled !== true, 'external delivery must be proven disabled during restore');

  const approval = manifest.approval ?? {};
  for (const field of ['approvedBy', 'peerReviewedBy', 'evidenceDocumentKey', 'changeReference']) pushIf(errors, !nonempty(approval[field]), `approval.${field} is required`);
  pushIf(errors, nonempty(approval.approvedBy) && approval.approvedBy === approval.peerReviewedBy, 'approval peer reviewer must differ from approver');
  pushIf(errors, !iso(approval.approvedAt), 'approval.approvedAt must be an ISO timestamp');
}

export function validateRecoveryActivationHandoff(manifest, mode = 'draft') {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['handoff must be a JSON object'];
  validateBase(manifest, errors);
  if (mode === 'draft') validateDraft(manifest, errors);
  else if (mode === 'approved') validateApproved(manifest, errors);
  else errors.push('mode must be draft or approved');
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'draft';
  const fileIndex = args.indexOf('--file');
  const filename = fileIndex >= 0 ? args[fileIndex + 1] : path.join(ROOT, 'RECOVERY-ACTIVATION-HANDOFF.json');
  const manifest = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const errors = validateRecoveryActivationHandoff(manifest, mode);
  if (errors.length) {
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Recovery activation handoff ${mode} validation passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
