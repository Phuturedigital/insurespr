import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateTurnstileActivationHandoff } from './turnstile-activation-handoff.mjs';

const ROOT = new URL('../', import.meta.url);

async function draft() {
  return JSON.parse(await readFile(new URL('TURNSTILE-ACTIVATION-HANDOFF.json', ROOT), 'utf8'));
}

function approvedFrom(source) {
  const manifest = structuredClone(source);
  manifest.status = 'approved-for-controlled-activation';
  manifest.activationAuthorized = true;
  manifest.widgetCreation = {
    created: true,
    widgetReference: 'controlled:cloudflare-widget-reference',
    siteKeyLastSix: 'Abc_12',
    createdBy: 'Authorized Cloudflare operator',
    createdAt: '2026-08-29T10:00:00Z',
    configurationEvidenceRef: 'controlled:turnstile-widget-configuration',
  };
  manifest.secretCustody = {
    siteKeyStoredAt: '2026-08-29T10:02:00Z',
    siteKeyEvidenceRef: 'controlled:vercel-site-key-custody',
    secretKeyFingerprintSha256: 'a'.repeat(64),
    secretKeyStoredAt: '2026-08-29T10:02:00Z',
    secretKeyEvidenceRef: 'controlled:vercel-secret-key-custody',
    custodian: 'Named secret custodian',
    rotationOwner: 'Named rotation owner',
    rotationProcedureRef: 'controlled:turnstile-rotation-procedure',
  };
  manifest.environmentDeployment = {
    vercelProductionSiteKeyConfigured: true,
    vercelProductionSecretKeyConfigured: true,
    vercelDeploymentId: 'dpl_controlled_turnstile_activation',
    deployedAt: '2026-08-29T10:05:00Z',
    deployedBy: 'Authorized deployment operator',
    deploymentEvidenceRef: 'controlled:turnstile-production-deployment',
    supabaseFallbackKeysConfigured: false,
    supabaseFallbackEvidenceRef: null,
  };
  for (const field of ['missingToken', 'invalidToken', 'expiredToken', 'wrongAction', 'wrongHostname', 'replayedToken']) {
    manifest.controlledVerification[field].passed = true;
  }
  Object.assign(manifest.controlledVerification, {
    completed: true,
    testedAt: '2026-08-29T10:15:00Z',
    testedBy: 'Independent test operator',
    evidenceRef: 'controlled:turnstile-test-matrix',
    noUnintendedWrites: true,
    siteKeyAbsentFromServerErrors: true,
    secretAbsentFromResponsesAndLogs: true,
  });
  Object.assign(manifest.controlledVerification.validToken, {
    passed: true,
    turnstileAccepted: true,
  });
  manifest.approval = {
    approvedBy: 'Authorized approver',
    peerReviewedBy: 'Different peer reviewer',
    approvedAt: '2026-08-29T10:20:00Z',
    changeReference: 'change:turnstile-production-activation',
    evidenceDocumentKey: 'controlled:turnstile-activation-evidence',
    rollbackAuthority: 'Named rollback authority',
    rollbackProcedureRef: 'controlled:turnstile-rollback-procedure',
  };
  return manifest;
}

test('committed Turnstile handoff is a valid fail-closed draft', async () => {
  assert.deepEqual(validateTurnstileActivationHandoff(await draft(), 'draft'), []);
});

test('approved mode rejects the incomplete draft', async () => {
  const errors = validateTurnstileActivationHandoff(await draft(), 'approved');
  assert.ok(errors.length > 20);
  assert.ok(errors.some((error) => /widget must be created/.test(error)));
  assert.ok(errors.some((error) => /secretKeyFingerprintSha256/.test(error)));
  assert.ok(errors.some((error) => /controlled verification must be complete/.test(error)));
});

test('a complete, non-secret controlled activation packet can validate', async () => {
  assert.deepEqual(validateTurnstileActivationHandoff(approvedFrom(await draft()), 'approved'), []);
});

test('validator rejects preview, localhost and noncanonical hostnames', async () => {
  const manifest = await draft();
  manifest.approvedConfiguration.allowedHostnames.push('insurespr-preview.vercel.app');
  manifest.approvedConfiguration.previewHostnamesAllowed = true;
  manifest.approvedConfiguration.localhostAllowed = true;
  const errors = validateTurnstileActivationHandoff(manifest, 'draft');
  assert.ok(errors.some((error) => /canonical hostname/.test(error)));
  assert.ok(errors.some((error) => /preview hostnames/.test(error)));
  assert.ok(errors.some((error) => /localhost/.test(error)));
});

test('validator rejects plaintext Turnstile credentials and secret-shaped fields', async () => {
  const manifest = await draft();
  manifest.secretCustody.secretKey = '0x4AAAAA-example-plaintext-secret';
  const errors = validateTurnstileActivationHandoff(manifest, 'draft');
  assert.ok(errors.some((error) => /forbidden plaintext-credential field/.test(error)));
  assert.ok(errors.some((error) => /plaintext credential material/.test(error)));
});

test('validator requires the valid token to stop at the downstream intake gate', async () => {
  const manifest = approvedFrom(await draft());
  manifest.controlledVerification.validToken.expectedDownstreamCode = 'BOOKING_CREATED';
  const errors = validateTurnstileActivationHandoff(manifest, 'approved');
  assert.ok(errors.some((error) => /downstream intake gate/.test(error)));
});

test('database evidence is hash-bound and cannot activate Turnstile or intake', async () => {
  const migration = await readFile(
    new URL('supabase/migrations/20260829093700_record_turnstile_activation_handoff.sql', ROOT),
    'utf8',
  );
  assert.match(migration, /a4c3ac7dd45d9ed3b28c7b109a53f187c468c96288a77e4b71f650628a8a0b77/g);
  assert.match(migration, /'prepared-not-created'/g);
  assert.match(migration, /'needs_evidence'/);
  assert.match(migration, /status = 'open'/);
  assert.match(migration, /blocks_launch = true/);
  assert.match(migration, /BOT_CHECK_UNAVAILABLE/);
  assert.match(migration, /www\.insuresprhealth\.co\.za only/);
  assert.doesNotMatch(migration, /status = 'resolved'/);
  assert.doesNotMatch(migration, /TURNSTILE_(?:SITE|SECRET)_KEY\s*=/);
  assert.doesNotMatch(migration, /\b0x[A-Za-z0-9_-]{16,}/);
});
