import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(ROOT, name), 'utf8');

test('Google Business Profile handoff is complete but cannot claim account changes', async () => {
  const [manifestText, sitemap, contact, migrationNames, evidenceMigration, ignored] = await Promise.all([
    read('GOOGLE-BUSINESS-PROFILE-ALIGNMENT.json'),
    read('sitemap.xml'),
    read('contact.html'),
    readdir(path.join(ROOT, 'supabase', 'migrations')),
    read('supabase/migrations/20260829064000_record_google_business_profile_handoff.sql'),
    read('.vercelignore'),
  ]);
  const catalogueMigrations = migrationNames.filter((name) => name.endsWith('.sql'));
  const catalogueSource = (await Promise.all(
    catalogueMigrations.map((name) => read(path.join('supabase', 'migrations', name))),
  )).join('\n');
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'prepared-not-applied');
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.accountSideVerified, false);
  assert.equal(manifest.canonicalIdentity.businessName, 'InsureSPR Precision Healthcare');
  assert.equal(manifest.canonicalIdentity.phoneE164, '+27834507861');
  assert.equal(manifest.canonicalIdentity.website, 'https://www.insuresprhealth.co.za/');
  assert.equal(manifest.websitePublishedHours.accountSideVerified, false);

  const accountFields = manifest.profileFieldsRequiringAccountEvidence;
  assert.equal(accountFields.profileResourceName, null);
  assert.equal(accountFields.authorizedEditor, null);
  assert.equal(accountFields.primaryCategory, null);
  assert.deepEqual(accountFields.additionalCategories, []);
  assert.equal(accountFields.lastAccountReviewAt, null);

  assert.equal(manifest.serviceDestinations.length, 16);
  assert.equal(new Set(manifest.serviceDestinations.map(({ slug }) => slug)).size, 16);
  for (const service of manifest.serviceDestinations) {
    assert.equal(service.url, `https://www.insuresprhealth.co.za/${service.slug}`);
    assert.equal(service.publishToProfileAuthorized, false);
    assert.match(sitemap, new RegExp(`<loc>${service.url}</loc>`));
    await read(`${service.slug}.html`);
    assert.match(catalogueSource, new RegExp(`'${service.slug}'`));
    assert.ok(catalogueSource.includes(`'${service.name}'`), `${service.name} must be seeded in migrations`);
  }

  assert.match(contact, /InsureSPR Precision Healthcare/);
  assert.match(contact, /7 Malibongwe Drive, EmedCentre/);
  assert.match(contact, /href="tel:\+27834507861"/);
  assert.match(contact, /Monday to Friday, 08:00(?:–|&ndash;|-)17:00/);
  assert.doesNotMatch(manifestText, /profileResourceName"\s*:\s*"|primaryCategory"\s*:\s*"|authorizedEditor"\s*:\s*"/);
  assert.match(ignored, /^GOOGLE-BUSINESS-PROFILE-ALIGNMENT\.json$/m);

  assert.match(evidenceMigration, /b4f371f46ebe4af1ffe2a8e1773a618ed29fc9381785d2d073f498e2fea2737c/g);
  assert.match(evidenceMigration, /'prepared-not-applied'/g);
  assert.match(evidenceMigration, /'activation_authorized', false/);
  assert.match(evidenceMigration, /'account_side_verified', false/);
  assert.match(evidenceMigration, /'service_destination_count', 16/);
  assert.match(evidenceMigration, /status = 'open'/);
  assert.match(evidenceMigration, /blocks_launch = true/);
  assert.match(evidenceMigration, /No profile mutation or service publication is authorised/);
  assert.doesNotMatch(evidenceMigration, /update public\.services[\s\S]*verification_status\s*=/i);
});
