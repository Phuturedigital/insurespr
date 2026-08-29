import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLAINTEXT_CREDENTIAL = /(?:\b0x[A-Za-z0-9_-]{16,}|\b(?:sk|pk|re)_[A-Za-z0-9_-]{12,}|\bsb_secret_[A-Za-z0-9_-]+)/;

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function recursivelyRejectCredentials(value, errors, location = 'inventory') {
  if (typeof value === 'string') {
    pushIf(errors, PLAINTEXT_CREDENTIAL.test(value), `${location} contains plaintext credential material`);
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
      ['siteKey', 'secretKey', 'secretValue', 'credential', 'accountId', 'accountEmail'].includes(key),
      `${location}.${key} is a forbidden sensitive field`,
    );
    recursivelyRejectCredentials(child, errors, `${location}.${key}`);
  }
}

export function validateTurnstileProviderInventory(inventory) {
  const errors = [];
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return ['inventory must be a JSON object'];
  pushIf(errors, inventory.schemaVersion !== 1, 'schemaVersion must equal 1');
  pushIf(errors, inventory.status !== 'verified-prepared-awaiting-confirmation', 'status differs');
  pushIf(errors, !ISO_TIMESTAMP.test(inventory.observedAt ?? '') || Number.isNaN(Date.parse(inventory.observedAt)), 'observedAt must be an ISO timestamp');

  const inspection = inventory.inspection ?? {};
  pushIf(errors, inspection.provider !== 'cloudflare-turnstile', 'provider differs');
  pushIf(errors, inspection.method !== 'authenticated-dashboard-read-only', 'inspection method differs');
  pushIf(errors, inspection.existingWidgetCount !== 1, 'exactly one existing widget must be recorded');
  pushIf(errors, inspection.equivalentInsureSprWidgetFound !== false, 'no equivalent InsureSPR widget was observed');
  pushIf(errors, inspection.credentialValuesRecorded !== false, 'credential values must not be recorded');

  const widgets = inventory.existingWidgets;
  pushIf(errors, !Array.isArray(widgets) || widgets.length !== 1, 'one existing-widget summary is required');
  const widget = widgets?.[0] ?? {};
  pushIf(errors, widget.name !== 'Phuture Digital', 'existing widget name differs');
  pushIf(errors, widget.siteKeyLastSix !== 'OOfGU', 'existing widget last-six reference differs');
  pushIf(errors, widget.mode !== 'managed', 'existing widget mode differs');
  pushIf(errors, widget.hostnameCount !== 2, 'existing widget hostname count differs');
  pushIf(errors, JSON.stringify(widget.hostnames) !== JSON.stringify(['www.phuturedigital.co.za', 'www.phuturesync.co.za']), 'existing widget hostnames differ');
  pushIf(errors, widget.reusableForInsureSpr !== false, 'the unrelated widget must remain non-reusable');
  pushIf(errors, typeof widget.exclusionReason !== 'string' || widget.exclusionReason.length < 40, 'existing widget exclusion reason is incomplete');

  const prepared = inventory.preparedWidget ?? {};
  pushIf(errors, prepared.name !== 'InsureSPR Production Forms', 'prepared widget name differs');
  pushIf(errors, prepared.hostname !== 'www.insuresprhealth.co.za', 'prepared hostname differs');
  pushIf(errors, prepared.mode !== 'managed', 'prepared widget mode differs');
  for (const field of ['preclearanceEnabled', 'previewHostnamesAllowed', 'localhostAllowed', 'created']) {
    pushIf(errors, prepared[field] !== false, `preparedWidget.${field} must remain false`);
  }
  pushIf(errors, prepared.createControlEnabled !== true, 'prepared create control was not verified enabled');
  pushIf(errors, prepared.creationAwaitingActionTimeConfirmation !== true, 'creation must remain awaiting action-time confirmation');

  const custody = inventory.credentialCustody ?? {};
  for (const field of ['siteKeyObserved', 'secretKeyObserved', 'siteKeyStored', 'secretKeyStored', 'plaintextCredentialRecorded']) {
    pushIf(errors, custody[field] !== false, `credentialCustody.${field} must remain false`);
  }

  const release = inventory.releaseState ?? {};
  for (const field of ['officialBridgeSiteKeyPublished', 'vercelProductionSiteKeyConfigured', 'vercelProductionSecretKeyConfigured', 'intakeReady']) {
    pushIf(errors, release[field] !== false, `releaseState.${field} must remain false`);
  }
  pushIf(errors, release.protectedProbeCode !== 'BOT_CHECK_UNAVAILABLE', 'protected probe code differs');
  pushIf(errors, release.operationalRecordCount !== 0, 'operational record count must remain zero');
  pushIf(errors, typeof inventory.nextAuthorizedAction !== 'string' || !inventory.nextAuthorizedAction.includes('immediate user confirmation'), 'next action must preserve action-time confirmation');
  recursivelyRejectCredentials(inventory, errors);
  return errors;
}

async function main() {
  const fileIndex = process.argv.indexOf('--file');
  const filename = fileIndex >= 0 ? process.argv[fileIndex + 1] : path.join(ROOT, 'TURNSTILE-PROVIDER-INVENTORY.json');
  const inventory = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const errors = validateTurnstileProviderInventory(inventory);
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log('Turnstile provider inventory validation passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
