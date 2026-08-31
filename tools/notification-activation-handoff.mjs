import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CRON = /^(?:\S+\s+){4}\S+$/;
const FORBIDDEN_SECRET_VALUE = /(?:\bre_[A-Za-z0-9_-]{8,}|\bsb_secret_[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/;

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function iso(value) {
  return nonempty(value) && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function recursivelyRejectSecrets(value, errors, location = 'handoff') {
  if (typeof value === 'string') {
    pushIf(errors, FORBIDDEN_SECRET_VALUE.test(value), `${location} appears to contain plaintext secret material`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => recursivelyRejectSecrets(item, errors, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    pushIf(errors, ['apiKey', 'workerSecret', 'serviceRoleKey', 'secretValue', 'decryptedSecret'].includes(key), `${location}.${key} is a forbidden plaintext-secret field`);
    recursivelyRejectSecrets(child, errors, `${location}.${key}`);
  }
}

function validateBase(manifest, errors) {
  pushIf(errors, manifest.schemaVersion !== 1, 'schemaVersion must equal 1');
  pushIf(errors, manifest.source?.workerEndpoint !== 'https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-notifications', 'worker endpoint differs');
  pushIf(errors, manifest.source?.timezone !== 'Africa/Johannesburg', 'source timezone differs');
  pushIf(errors, manifest.approvedFacts?.providerAdapter !== 'resend', 'approved provider adapter differs');
  pushIf(errors, manifest.approvedFacts?.practiceRecipient !== 'motselisi@bonevc.co.za', 'practice recipient differs');
  pushIf(errors, manifest.approvedFacts?.emailReplyTo !== 'motselisi@bonevc.co.za', 'Reply-To differs');
  pushIf(errors, manifest.approvedFacts?.bookingOwner !== 'Motselisi Mosiana', 'booking owner differs');
  pushIf(errors, manifest.approvedFacts?.publicPhone !== '+27834507861', 'public phone differs');
  pushIf(errors, manifest.liveSnapshot?.workerReadiness !== 'not_ready', 'live worker snapshot must remain not_ready');
  pushIf(errors, manifest.liveSnapshot?.workerReadyHeader !== false, 'live ready header snapshot must be false');
  pushIf(errors, manifest.liveSnapshot?.notificationAttemptCount !== 0, 'notification attempt snapshot must remain zero');
  pushIf(errors, manifest.liveSnapshot?.notificationConfigurationCount !== 0, 'notification configuration snapshot must remain zero');
  pushIf(errors, manifest.liveSnapshot?.pgCronInstalled !== false, 'pg_cron snapshot must remain absent');
  pushIf(errors, manifest.liveSnapshot?.pgNetInstalled !== false, 'pg_net snapshot must remain absent');
  pushIf(errors, manifest.liveSnapshot?.notificationCronJobCount !== 0, 'Cron job snapshot must remain zero');
  pushIf(errors, manifest.liveSnapshot?.notificationVaultSecretNameCount !== 0, 'Vault secret-name snapshot must remain zero');
  pushIf(errors, !SHA256.test(manifest.liveSnapshot?.repositoryWorkerSourceSha256 ?? ''), 'repository worker source SHA-256 is invalid');
  const dmarc = manifest.dnsEvidence?.dmarc;
  pushIf(errors, dmarc?.verified !== true, 'verified DMARC observation is missing');
  pushIf(errors, dmarc?.hostname !== '_dmarc.insuresprhealth.co.za', 'DMARC hostname differs');
  pushIf(errors, dmarc?.record !== 'v=DMARC1; p=none', 'DMARC record differs');
  pushIf(errors, JSON.stringify(dmarc?.resolvers) !== JSON.stringify(['1.1.1.1', '8.8.8.8']), 'DMARC resolver evidence differs');
  pushIf(errors, manifest.dnsEvidence?.approvedReplyDomainMx?.verified !== true, 'approved Reply-To MX evidence is missing');
  pushIf(errors, manifest.dnsEvidence?.approvedReplyDomainMx?.domain !== 'bonevc.co.za', 'approved Reply-To domain differs');
  recursivelyRejectSecrets(manifest, errors);
}

function validateDraft(manifest, errors) {
  pushIf(errors, manifest.status !== 'prepared-not-approved', 'draft status must be prepared-not-approved');
  pushIf(errors, manifest.activationAuthorized !== false, 'draft activationAuthorized must be false');
  for (const field of ['spf', 'returnPathMx', 'dkim', 'officialInboundMx']) pushIf(errors, manifest.dnsEvidence?.[field] !== null, `draft dnsEvidence.${field} must be null`);
  for (const [key, value] of Object.entries(manifest.providerConfiguration ?? {})) pushIf(errors, value !== null, `draft providerConfiguration.${key} must be null`);
  for (const field of ['providerApiKeyFingerprintSha256', 'providerSecretStoredAt', 'providerSecretEvidenceRef', 'workerSecretFingerprintSha256', 'workerSecretStoredAt', 'workerSecretEvidenceRef', 'activationMode', 'vaultProjectUrlSecretName', 'vaultPublishableKeySecretName', 'vaultWorkerSecretName']) pushIf(errors, manifest.secretCustody?.[field] !== null, `draft secretCustody.${field} must be null`);
  pushIf(errors, manifest.schedulerActivation?.authorized !== false, 'draft scheduler must remain unauthorized');
  for (const [key, value] of Object.entries(manifest.schedulerActivation ?? {})) if (key !== 'authorized') pushIf(errors, value !== null, `draft schedulerActivation.${key} must be null`);
  const test = manifest.controlledDeliveryTest ?? {};
  pushIf(errors, test.completed !== false, 'draft delivery test must be incomplete');
  for (const field of ['testRecipient', 'providerMessageId', 'providerAcceptedAt', 'mailboxReceivedAt', 'evidenceRef']) pushIf(errors, test[field] !== null, `draft controlledDeliveryTest.${field} must be null`);
  for (const field of ['duplicateSuppressionVerified', 'retryVerified', 'failurePathVerified']) pushIf(errors, test[field] !== false, `draft controlledDeliveryTest.${field} must be false`);
  pushIf(errors, manifest.approval !== null, 'draft approval must be null');
}

function validateDnsProof(label, proof, errors) {
  pushIf(errors, !proof || typeof proof !== 'object' || Array.isArray(proof), `${label} proof is required`);
  if (!proof || typeof proof !== 'object') return;
  pushIf(errors, proof.verified !== true, `${label}.verified must be true`);
  pushIf(errors, !nonempty(proof.hostname), `${label}.hostname is required`);
  pushIf(errors, !nonempty(proof.record), `${label}.record is required`);
  pushIf(errors, JSON.stringify(proof.resolvers) !== JSON.stringify(['1.1.1.1', '8.8.8.8']), `${label}.resolvers must contain both approved public resolvers`);
  pushIf(errors, !iso(proof.observedAt), `${label}.observedAt must be an ISO timestamp`);
  pushIf(errors, !nonempty(proof.evidenceRef), `${label}.evidenceRef is required`);
}

function validateApproved(manifest, errors) {
  pushIf(errors, manifest.status !== 'approved-for-controlled-activation', 'approved status must be approved-for-controlled-activation');
  pushIf(errors, manifest.activationAuthorized !== true, 'approved activationAuthorized must be true');
  for (const key of ['spf', 'returnPathMx', 'dkim']) validateDnsProof(`dnsEvidence.${key}`, manifest.dnsEvidence?.[key], errors);

  const provider = manifest.providerConfiguration ?? {};
  for (const field of ['providerAccountReference', 'providerDomainReference', 'senderDomain', 'returnPathHostname', 'dkimHostname', 'emailFrom', 'senderVerificationEvidenceRef']) pushIf(errors, !nonempty(provider[field]), `providerConfiguration.${field} is required`);
  pushIf(errors, !iso(provider.senderVerifiedAt), 'providerConfiguration.senderVerifiedAt must be an ISO timestamp');
  if (nonempty(provider.senderDomain)) pushIf(errors, provider.senderDomain !== 'insuresprhealth.co.za' && !provider.senderDomain.endsWith('.insuresprhealth.co.za'), 'sender domain must be the official domain or its subdomain');
  if (nonempty(provider.emailFrom) && nonempty(provider.senderDomain)) pushIf(errors, !provider.emailFrom.toLowerCase().includes(`@${provider.senderDomain}`), 'emailFrom must use senderDomain');

  const custody = manifest.secretCustody ?? {};
  pushIf(errors, custody.providerSecretName !== 'RESEND_API_KEY', 'provider secret name differs');
  pushIf(errors, custody.workerSecretName !== 'NOTIFICATION_WORKER_SECRET', 'worker secret name differs');
  pushIf(errors, custody.configHashSecretName !== 'NOTIFICATION_CONFIG_SHA256', 'config hash secret name differs');
  pushIf(errors, custody.workerHashSecretName !== 'NOTIFICATION_WORKER_SOURCE_SHA256', 'worker hash secret name differs');
  pushIf(errors, custody.activationMode !== 'active', 'approved activation mode must be active');
  for (const field of ['providerApiKeyFingerprintSha256', 'workerSecretFingerprintSha256']) pushIf(errors, !SHA256.test(custody[field] ?? ''), `secretCustody.${field} must be SHA-256`);
  for (const field of ['providerSecretStoredAt', 'workerSecretStoredAt']) pushIf(errors, !iso(custody[field]), `secretCustody.${field} must be an ISO timestamp`);
  for (const field of ['providerSecretEvidenceRef', 'workerSecretEvidenceRef', 'vaultProjectUrlSecretName', 'vaultPublishableKeySecretName', 'vaultWorkerSecretName']) pushIf(errors, !nonempty(custody[field]), `secretCustody.${field} is required`);

  const scheduler = manifest.schedulerActivation ?? {};
  pushIf(errors, scheduler.authorized !== true, 'schedulerActivation.authorized must be true');
  pushIf(errors, !nonempty(scheduler.scheduleName), 'scheduler scheduleName is required');
  pushIf(errors, !CRON.test(scheduler.scheduleExpression ?? ''), 'scheduler scheduleExpression must be a five-field Cron expression');
  pushIf(errors, scheduler.scheduleTimezone !== 'Africa/Johannesburg', 'scheduler timezone must be Africa/Johannesburg');
  for (const field of ['scheduleOwner', 'failureAlertOwner', 'failureAlertRecipient', 'failureAlertTestEvidenceRef', 'rollbackAuthority', 'rollbackProcedureEvidenceRef', 'pgCronEnabledEvidenceRef', 'pgNetEnabledEvidenceRef', 'cronJobEvidenceRef']) pushIf(errors, !nonempty(scheduler[field]), `schedulerActivation.${field} is required`);
  if (nonempty(scheduler.failureAlertRecipient)) pushIf(errors, !EMAIL.test(scheduler.failureAlertRecipient), 'failure alert recipient must be an email address');

  const delivery = manifest.controlledDeliveryTest ?? {};
  pushIf(errors, delivery.completed !== true, 'controlled delivery test must be complete');
  pushIf(errors, !EMAIL.test(delivery.testRecipient ?? ''), 'controlled delivery test recipient is invalid');
  for (const field of ['providerMessageId', 'evidenceRef']) pushIf(errors, !nonempty(delivery[field]), `controlledDeliveryTest.${field} is required`);
  for (const field of ['providerAcceptedAt', 'mailboxReceivedAt']) pushIf(errors, !iso(delivery[field]), `controlledDeliveryTest.${field} must be an ISO timestamp`);
  for (const field of ['duplicateSuppressionVerified', 'retryVerified', 'failurePathVerified']) pushIf(errors, delivery[field] !== true, `controlledDeliveryTest.${field} must be true`);

  const approval = manifest.approval ?? {};
  for (const field of ['approvedBy', 'peerReviewedBy', 'evidenceDocumentKey', 'changeReference']) pushIf(errors, !nonempty(approval[field]), `approval.${field} is required`);
  pushIf(errors, nonempty(approval.approvedBy) && approval.approvedBy === approval.peerReviewedBy, 'approval peer reviewer must differ from approver');
  pushIf(errors, !iso(approval.approvedAt), 'approval.approvedAt must be an ISO timestamp');
}

export function validateNotificationActivationHandoff(manifest, mode = 'draft') {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['handoff must be a JSON object'];
  validateBase(manifest, errors);
  if (mode === 'draft') validateDraft(manifest, errors);
  else if (mode === 'approved') validateApproved(manifest, errors);
  else errors.push('mode must be draft or approved');
  return errors;
}

export function validateLiveNotificationState(manifest, response) {
  const errors = [];
  pushIf(errors, response?.status !== 200, 'live worker readiness must return HTTP 200');
  pushIf(errors, response?.readyHeader !== 'false', 'live x-insurespr-ready header differs from false');
  pushIf(errors, response?.body?.ok !== true, 'live readiness body ok flag differs');
  pushIf(errors, response?.body?.ready !== false, 'live worker unexpectedly reports ready');
  pushIf(errors, response?.body?.readiness !== 'not_ready', 'live readiness state differs');
  pushIf(errors, manifest.liveSnapshot?.workerReadiness !== 'not_ready', 'handoff live snapshot no longer describes not_ready');
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'draft';
  const fileIndex = args.indexOf('--file');
  const filename = fileIndex >= 0 ? args[fileIndex + 1] : path.join(ROOT, 'NOTIFICATION-ACTIVATION-HANDOFF.json');
  const manifest = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const errors = validateNotificationActivationHandoff(manifest, mode);

  const workerIndex = args.indexOf('--live-worker-url');
  if (workerIndex >= 0) {
    const workerUrl = args[workerIndex + 1];
    if (!nonempty(workerUrl) || new URL(workerUrl).protocol !== 'https:') throw new Error('--live-worker-url requires an HTTPS URL');
    const response = await fetch(workerUrl, { headers: { accept: 'application/json' } });
    let body = null;
    try {
      body = await response.json();
    } catch {
      errors.push('live worker readiness did not return JSON');
    }
    errors.push(...validateLiveNotificationState(manifest, {
      status: response.status,
      readyHeader: response.headers.get('x-insurespr-ready'),
      body,
    }));
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Notification activation handoff ${mode} validation passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
