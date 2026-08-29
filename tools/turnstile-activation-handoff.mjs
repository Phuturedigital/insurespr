import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FORBIDDEN_CREDENTIAL = /(?:\b0x[A-Za-z0-9_-]{16,}|\b(?:sk|pk|re)_[A-Za-z0-9_-]{12,}|\bsb_secret_[A-Za-z0-9_-]+)/;

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function iso(value) {
  return nonempty(value) && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function recursivelyRejectCredentials(value, errors, location = 'handoff') {
  if (typeof value === 'string') {
    pushIf(errors, FORBIDDEN_CREDENTIAL.test(value), `${location} appears to contain plaintext credential material`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => recursivelyRejectCredentials(item, errors, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    pushIf(
      errors,
      ['siteKey', 'secretKey', 'secretValue', 'turnstileSecret', 'credential'].includes(key),
      `${location}.${key} is a forbidden plaintext-credential field`,
    );
    recursivelyRejectCredentials(child, errors, `${location}.${key}`);
  }
}

function validateBase(manifest, errors) {
  pushIf(errors, manifest.schemaVersion !== 1, 'schemaVersion must equal 1');
  pushIf(errors, manifest.source?.canonicalOrigin !== 'https://www.insuresprhealth.co.za', 'canonical origin differs');
  pushIf(errors, manifest.source?.canonicalHostname !== 'www.insuresprhealth.co.za', 'canonical hostname differs');
  pushIf(errors, manifest.source?.servicesEndpoint !== 'https://www.insuresprhealth.co.za/api/insurespr?route=services', 'services endpoint differs');
  pushIf(errors, manifest.source?.protectedEndpoint !== 'https://www.insuresprhealth.co.za/api/insurespr', 'protected endpoint differs');
  pushIf(errors, manifest.source?.supabaseFunction !== 'insurespr-api', 'Supabase function differs');
  pushIf(errors, manifest.source?.supabaseFunctionVersion !== 18, 'Supabase function version differs');
  pushIf(errors, manifest.source?.verificationRegion !== 'fra1', 'verification region differs');

  const approved = manifest.approvedConfiguration ?? {};
  pushIf(errors, approved.widgetName !== 'InsureSPR Production Forms', 'widget name differs');
  pushIf(errors, approved.widgetMode !== 'managed', 'widget mode must be managed');
  pushIf(errors, JSON.stringify(approved.allowedHostnames) !== JSON.stringify(['www.insuresprhealth.co.za']), 'allowed hostnames must contain only the canonical hostname');
  pushIf(errors, JSON.stringify(approved.allowedActions) !== JSON.stringify(['book', 'contact', 'employer']), 'allowed actions differ');
  pushIf(errors, approved.previewHostnamesAllowed !== false, 'preview hostnames must remain disallowed');
  pushIf(errors, approved.localhostAllowed !== false, 'localhost must remain disallowed');
  pushIf(errors, approved.siteKeyEnvironmentName !== 'TURNSTILE_SITE_KEY', 'site-key environment name differs');
  pushIf(errors, approved.secretKeyEnvironmentName !== 'TURNSTILE_SECRET_KEY', 'secret-key environment name differs');
  pushIf(errors, approved.environmentTarget !== 'vercel-production-only', 'environment target must remain Vercel Production only');

  const snapshot = manifest.liveSnapshot ?? {};
  pushIf(errors, snapshot.widgetInventoryVerified !== false, 'draft live widget inventory must remain unverified');
  pushIf(errors, snapshot.widgetReference !== null, 'draft live widget reference must remain null');
  pushIf(errors, snapshot.siteKeyPublishedByOfficialBridge !== false, 'draft bridge site-key snapshot must be false');
  pushIf(errors, snapshot.directApiSiteKeyPublished !== false, 'draft direct API site-key snapshot must be false');
  pushIf(errors, snapshot.vercelProductionSiteKeyConfigured !== false, 'draft Vercel site-key snapshot must be false');
  pushIf(errors, snapshot.vercelProductionSecretKeyConfigured !== false, 'draft Vercel secret-key snapshot must be false');
  pushIf(errors, snapshot.directProtectedProbeCode !== 'BOT_CHECK_UNAVAILABLE', 'direct protected-probe code differs');
  pushIf(errors, snapshot.bridgeProtectedProbeCode !== 'BOT_CHECK_UNAVAILABLE', 'bridge protected-probe code differs');
  pushIf(errors, snapshot.intakeReady !== false, 'draft intake readiness must remain false');
  pushIf(errors, snapshot.operationalRecordCount !== 0, 'draft operational-record snapshot must remain zero');
  recursivelyRejectCredentials(manifest, errors);
}

function validateDraft(manifest, errors) {
  pushIf(errors, manifest.status !== 'prepared-not-created', 'draft status must be prepared-not-created');
  pushIf(errors, manifest.activationAuthorized !== false, 'draft activationAuthorized must be false');

  const widget = manifest.widgetCreation ?? {};
  pushIf(errors, widget.created !== false, 'draft widget must remain uncreated');
  for (const field of ['widgetReference', 'siteKeyLastSix', 'createdBy', 'createdAt', 'configurationEvidenceRef']) {
    pushIf(errors, widget[field] !== null, `draft widgetCreation.${field} must be null`);
  }

  for (const [field, value] of Object.entries(manifest.secretCustody ?? {})) {
    pushIf(errors, value !== null, `draft secretCustody.${field} must be null`);
  }

  const deployment = manifest.environmentDeployment ?? {};
  pushIf(errors, deployment.vercelProductionSiteKeyConfigured !== false, 'draft Vercel site key must remain unconfigured');
  pushIf(errors, deployment.vercelProductionSecretKeyConfigured !== false, 'draft Vercel secret key must remain unconfigured');
  pushIf(errors, deployment.supabaseFallbackKeysConfigured !== false, 'draft Supabase fallback keys must remain unconfigured');
  for (const field of ['vercelDeploymentId', 'deployedAt', 'deployedBy', 'deploymentEvidenceRef', 'supabaseFallbackEvidenceRef']) {
    pushIf(errors, deployment[field] !== null, `draft environmentDeployment.${field} must be null`);
  }

  const verification = manifest.controlledVerification ?? {};
  pushIf(errors, verification.completed !== false, 'draft controlled verification must remain incomplete');
  for (const field of ['testedAt', 'testedBy', 'evidenceRef']) {
    pushIf(errors, verification[field] !== null, `draft controlledVerification.${field} must be null`);
  }
  for (const field of ['missingToken', 'invalidToken', 'expiredToken', 'wrongAction', 'wrongHostname', 'replayedToken']) {
    pushIf(errors, verification[field]?.passed !== false, `draft controlledVerification.${field}.passed must be false`);
  }
  pushIf(errors, verification.validToken?.passed !== false, 'draft controlledVerification.validToken.passed must be false');
  pushIf(errors, verification.validToken?.turnstileAccepted !== false, 'draft valid token must remain unaccepted');
  for (const field of ['noUnintendedWrites', 'siteKeyAbsentFromServerErrors', 'secretAbsentFromResponsesAndLogs']) {
    pushIf(errors, verification[field] !== false, `draft controlledVerification.${field} must be false`);
  }
  pushIf(errors, manifest.approval !== null, 'draft approval must be null');
}

function validateApproved(manifest, errors) {
  pushIf(errors, manifest.status !== 'approved-for-controlled-activation', 'approved status must be approved-for-controlled-activation');
  pushIf(errors, manifest.activationAuthorized !== true, 'approved activationAuthorized must be true');

  const widget = manifest.widgetCreation ?? {};
  pushIf(errors, widget.created !== true, 'approved widget must be created');
  for (const field of ['widgetReference', 'siteKeyLastSix', 'createdBy', 'configurationEvidenceRef']) {
    pushIf(errors, !nonempty(widget[field]), `widgetCreation.${field} is required`);
  }
  pushIf(errors, nonempty(widget.siteKeyLastSix) && !/^[A-Za-z0-9_-]{6}$/.test(widget.siteKeyLastSix), 'widgetCreation.siteKeyLastSix must contain exactly six safe characters');
  pushIf(errors, !iso(widget.createdAt), 'widgetCreation.createdAt must be an ISO timestamp');

  const custody = manifest.secretCustody ?? {};
  pushIf(errors, !iso(custody.siteKeyStoredAt), 'secretCustody.siteKeyStoredAt must be an ISO timestamp');
  pushIf(errors, !nonempty(custody.siteKeyEvidenceRef), 'secretCustody.siteKeyEvidenceRef is required');
  pushIf(errors, !SHA256.test(custody.secretKeyFingerprintSha256 ?? ''), 'secretCustody.secretKeyFingerprintSha256 must be SHA-256');
  pushIf(errors, !iso(custody.secretKeyStoredAt), 'secretCustody.secretKeyStoredAt must be an ISO timestamp');
  for (const field of ['secretKeyEvidenceRef', 'custodian', 'rotationOwner', 'rotationProcedureRef']) {
    pushIf(errors, !nonempty(custody[field]), `secretCustody.${field} is required`);
  }

  const deployment = manifest.environmentDeployment ?? {};
  pushIf(errors, deployment.vercelProductionSiteKeyConfigured !== true, 'Vercel Production site key must be configured');
  pushIf(errors, deployment.vercelProductionSecretKeyConfigured !== true, 'Vercel Production secret key must be configured');
  for (const field of ['vercelDeploymentId', 'deployedBy', 'deploymentEvidenceRef']) {
    pushIf(errors, !nonempty(deployment[field]), `environmentDeployment.${field} is required`);
  }
  pushIf(errors, !iso(deployment.deployedAt), 'environmentDeployment.deployedAt must be an ISO timestamp');
  pushIf(errors, deployment.supabaseFallbackKeysConfigured !== false, 'Supabase fallback keys must remain disabled unless separately reviewed');
  pushIf(errors, deployment.supabaseFallbackEvidenceRef !== null, 'Supabase fallback evidence must remain null while fallback keys are disabled');

  const verification = manifest.controlledVerification ?? {};
  pushIf(errors, verification.completed !== true, 'controlled verification must be complete');
  pushIf(errors, !iso(verification.testedAt), 'controlledVerification.testedAt must be an ISO timestamp');
  for (const field of ['testedBy', 'evidenceRef']) pushIf(errors, !nonempty(verification[field]), `controlledVerification.${field} is required`);
  const expectedCodes = {
    missingToken: 'BOT_CHECK_REQUIRED',
    invalidToken: 'BOT_CHECK_FAILED',
    expiredToken: 'BOT_CHECK_FAILED',
    wrongAction: 'BOT_CHECK_FAILED',
    wrongHostname: 'BOT_CHECK_FAILED',
    replayedToken: 'BOT_CHECK_FAILED',
  };
  for (const [field, code] of Object.entries(expectedCodes)) {
    pushIf(errors, verification[field]?.passed !== true, `controlledVerification.${field}.passed must be true`);
    pushIf(errors, verification[field]?.expectedCode !== code, `controlledVerification.${field}.expectedCode differs`);
  }
  pushIf(errors, verification.validToken?.passed !== true, 'controlledVerification.validToken.passed must be true');
  pushIf(errors, verification.validToken?.turnstileAccepted !== true, 'controlledVerification.validToken.turnstileAccepted must be true');
  pushIf(errors, verification.validToken?.expectedDownstreamCode !== 'INTAKE_ACTIVATION_NOT_READY', 'valid token must remain blocked by the downstream intake gate');
  for (const field of ['noUnintendedWrites', 'siteKeyAbsentFromServerErrors', 'secretAbsentFromResponsesAndLogs']) {
    pushIf(errors, verification[field] !== true, `controlledVerification.${field} must be true`);
  }

  const approval = manifest.approval ?? {};
  for (const field of ['approvedBy', 'peerReviewedBy', 'approvedAt', 'changeReference', 'evidenceDocumentKey', 'rollbackAuthority', 'rollbackProcedureRef']) {
    pushIf(errors, !nonempty(approval[field]), `approval.${field} is required`);
  }
  pushIf(errors, nonempty(approval.approvedBy) && approval.approvedBy === approval.peerReviewedBy, 'approval peer reviewer must differ from approver');
  pushIf(errors, nonempty(approval.approvedAt) && !iso(approval.approvedAt), 'approval.approvedAt must be an ISO timestamp');
}

export function validateTurnstileActivationHandoff(manifest, mode = 'draft') {
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
  const filename = fileIndex >= 0 ? args[fileIndex + 1] : path.join(ROOT, 'TURNSTILE-ACTIVATION-HANDOFF.json');
  const manifest = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const errors = validateTurnstileActivationHandoff(manifest, mode);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Turnstile activation handoff ${mode} validation passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
