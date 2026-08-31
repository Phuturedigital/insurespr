import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/20260831143019_record_owner_confirmed_service_catalogue.sql',
  import.meta.url,
);
const approvalsUrl = new URL('../LAUNCH-APPROVALS.md', import.meta.url);

const expectedSlugs = [
  'body-composition-progress',
  'chest-x-ray',
  'dxa-body-composition',
  'dxa-bone-density',
  'long-term-condition-bone-health',
  'menopause-bone-health',
  'musculoskeletal-x-ray',
  'orthopaedic-follow-up-x-ray',
  'osteoporosis-care',
  'post-fracture-bone-health',
  'primary-healthcare-x-ray',
  'runner-athlete-bone-health',
  'treatment-related-bone-health',
  'visa-chest-x-ray',
  'workplace-chest-x-ray',
  'workplace-medicals',
];

test('owner confirmation covers exactly the known 16-service catalogue', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const slugs = [...sql.matchAll(/^\s{4}'([a-z0-9-]+)'[,]?$/gm)].map((match) => match[1]);

  assert.deepEqual(slugs, expectedSlugs);
  assert.match(sql, /v_affected <> 16/);
  assert.match(sql, /count\(\*\) from public\.services where is_published\) <> 16/);
  assert.match(sql, /catalogue_status = 'owner_confirmed'/);
});

test('catalogue confirmation cannot be mistaken for clinical verification', async () => {
  const [sql, approvals] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(approvalsUrl, 'utf8'),
  ]);

  assert.doesNotMatch(sql, /set\s+verification_status\s*=\s*'verified'/i);
  assert.match(sql, /verification_status <> 'needs_confirmation'/);
  assert.match(sql, /Does not verify current capability/);
  assert.match(approvals, /explicitly reconfirmed all 16 published catalogue\s+entries/);
  assert.match(approvals, /does not\s+change any service's separate clinical `verification_status`/i);
});

test('only the catalogue-membership dependency is closed by this decision', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const dependencyUpdates = [...sql.matchAll(/where dependency_key = '([^']+)'/g)].map((match) => match[1]);

  assert.deepEqual([...new Set(dependencyUpdates)], ['service-catalogue']);
  assert.match(sql, /status = 'resolved'/);
  assert.match(sql, /blocks_launch = false/);
  assert.match(sql, /corresponding clinical, credential, commercial and operations dependencies remain open/);
});
