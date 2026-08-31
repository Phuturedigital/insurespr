import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateTurnstileProviderInventory } from './turnstile-provider-inventory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventory = JSON.parse(await readFile(path.join(ROOT, 'TURNSTILE-PROVIDER-INVENTORY.json'), 'utf8'));
const migration = await readFile(path.join(ROOT, 'supabase', 'migrations', '20260829104500_record_turnstile_provider_inventory.sql'), 'utf8');

test('verified provider inventory records the unrelated widget without credentials', () => {
  assert.deepEqual(validateTurnstileProviderInventory(inventory), []);
});

test('inventory cannot claim that an equivalent InsureSPR widget already exists', () => {
  const changed = structuredClone(inventory);
  changed.inspection.equivalentInsureSprWidgetFound = true;
  assert(validateTurnstileProviderInventory(changed).some((error) => error.includes('equivalent InsureSPR')));
});

test('prepared widget cannot become created or activated without a new evidence state', () => {
  const changed = structuredClone(inventory);
  changed.preparedWidget.created = true;
  changed.credentialCustody.siteKeyObserved = true;
  assert(validateTurnstileProviderInventory(changed).some((error) => error.includes('must remain false')));
});

test('canonical scope, managed mode and pre-clearance policy are immutable', () => {
  const changed = structuredClone(inventory);
  changed.preparedWidget.hostname = 'insuresprhealth.co.za';
  changed.preparedWidget.mode = 'invisible';
  changed.preparedWidget.preclearanceEnabled = true;
  const errors = validateTurnstileProviderInventory(changed);
  assert(errors.some((error) => error.includes('prepared hostname')));
  assert(errors.some((error) => error.includes('prepared widget mode')));
  assert(errors.some((error) => error.includes('preclearanceEnabled')));
});

test('plaintext site keys and sensitive account fields are rejected anywhere', () => {
  const changed = structuredClone(inventory);
  changed.inspection.siteKey = ['0x4AAAAAA', 'TESTFULLCREDENTIAL'].join('');
  changed.inspection.accountEmail = 'operator@example.test';
  const errors = validateTurnstileProviderInventory(changed);
  assert(errors.some((error) => error.includes('forbidden sensitive field')));
  assert(errors.some((error) => error.includes('plaintext credential material')));
});

test('private database evidence is hash-bound and cannot activate Turnstile or intake', () => {
  assert.match(migration, /d32c70c93dd10c685fd474105d6a4cddd3044be07a05e00c97858638df48c580/);
  assert.match(migration, /'needs_evidence'/);
  assert.match(migration, /public_use_allowed[\s\S]*false/);
  assert.match(migration, /status = 'open'/);
  assert.match(migration, /blocks_launch = true/);
  assert.match(migration, /pending immediate user confirmation/);
  assert.doesNotMatch(migration, /update public\.practice_settings/i);
  assert.doesNotMatch(migration, /insert into public\.(?:booking_slots|customers|bookings|employer_leads|contact_enquiries|notification_attempts)/i);
});
