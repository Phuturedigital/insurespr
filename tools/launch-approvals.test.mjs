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
