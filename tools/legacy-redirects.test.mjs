import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = path.join(REPO_ROOT, 'LEGACY-SEO-URL-INVENTORY.md');
const MANIFEST_PATH = path.join(REPO_ROOT, 'LEGACY-REDIRECT-MANIFEST.json');
const SOURCE_HOSTS = new Set([
  'insuresprhealth.co.za',
  'xrayonmalebongwe.co.za',
]);
const DECISION_STATES = new Set(['preserve', 'redirect', '410', 'hold']);
const STATEFUL_DESTINATION = /^\/(?:api|auth|manage-booking|booking-confirmation|thank-you|cancel(?:-[a-z0-9-]+)?|appointment-cancellation-confirmation|cart|checkout|my-account|waitlist)(?:\/|$)/i;
const FINAL_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

export function inventorySources(markdown) {
  const sources = [];
  const row = /^\|\s*\[[^\]]+\]\((https:\/\/[^)]+)\)/gm;
  for (const match of markdown.matchAll(row)) {
    let parsed;
    try {
      parsed = new URL(match[1]);
    } catch {
      continue;
    }
    if (SOURCE_HOSTS.has(parsed.hostname)) sources.push(parsed.href);
  }
  return sources;
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(!seen.has(value), `${label} contains duplicate: ${value}`);
    seen.add(value);
  }
}

function sourcePath(source) {
  const parsed = new URL(source);
  return parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
}

function validateSource(source) {
  assert.equal(typeof source, 'string', 'source must be a string');
  const parsed = new URL(source);
  assert.equal(parsed.protocol, 'https:', `source must use HTTPS: ${source}`);
  assert(SOURCE_HOSTS.has(parsed.hostname), `source host is not inventoried: ${source}`);
  assert.equal(parsed.username, '', `source must not contain credentials: ${source}`);
  assert.equal(parsed.password, '', `source must not contain credentials: ${source}`);
  assert.equal(parsed.search, '', `source must not contain a query: ${source}`);
  assert.equal(parsed.hash, '', `source must not contain a fragment: ${source}`);
  assert.equal(parsed.href, source, `source must use URL-normalized inventory form: ${source}`);
}

function validateFinalPath(destination, label) {
  assert.equal(typeof destination, 'string', `${label} must be a string`);
  assert(FINAL_PATH.test(destination), `${label} must be a lowercase extensionless root-relative path: ${destination}`);
  assert(!destination.includes('//'), `${label} must not contain an empty path segment: ${destination}`);
  assert(!STATEFUL_DESTINATION.test(destination), `${label} is stateful or privileged: ${destination}`);
}

function validateApproval(entry) {
  const approval = entry.approval;
  assert(approval && typeof approval === 'object' && !Array.isArray(approval), `${entry.source} requires an approval record`);
  assert.equal(approval.status, 'approved', `${entry.source} is not approved`);
  assert.equal(typeof approval.approvedBy, 'string', `${entry.source} requires approvedBy`);
  assert(approval.approvedBy.trim().length >= 2, `${entry.source} requires a named approver`);
  assert.equal(typeof approval.approvedAt, 'string', `${entry.source} requires approvedAt`);
  assert(!Number.isNaN(Date.parse(approval.approvedAt)), `${entry.source} approvedAt is not an ISO timestamp`);
  assert.equal(new Date(approval.approvedAt).toISOString(), approval.approvedAt, `${entry.source} approvedAt must be canonical ISO-8601`);
}

export function validateManifest(manifest, inventoryMarkdown) {
  assert.equal(manifest.manifestVersion, 1, 'manifestVersion must be 1');
  assert.equal(manifest.status, 'decision-review-only', 'manifest must remain review-only');
  assert.equal(manifest.activationAuthorized, false, 'this manifest must not activate routing');
  assert.equal(manifest.inventory, 'LEGACY-SEO-URL-INVENTORY.md', 'unexpected inventory source');
  assert.equal(manifest.canonicalDestinationOrigin, 'https://www.insuresprhealth.co.za', 'unexpected canonical destination origin');
  assert.deepEqual(manifest.allowedStates, ['preserve', 'redirect', '410', 'hold'], 'allowedStates changed unexpectedly');

  const inventory = inventorySources(inventoryMarkdown);
  assert.equal(inventory.length, 153, `inventory parser expected 153 rows, found ${inventory.length}`);
  assertUnique(inventory, 'inventory');
  assert.equal(manifest.expectedSourceCount, 153, 'expectedSourceCount must remain 153');

  assert(Array.isArray(manifest.approvedDestinations), 'approvedDestinations must be an array');
  assertUnique(manifest.approvedDestinations, 'approvedDestinations');
  for (const destination of manifest.approvedDestinations) {
    validateFinalPath(destination, 'approved destination');
  }
  const approvedDestinations = new Set(manifest.approvedDestinations);

  assert(Array.isArray(manifest.entries), 'entries must be an array');
  assert.equal(manifest.entries.length, inventory.length, 'manifest entry count does not match inventory');
  const sources = manifest.entries.map((entry) => entry?.source);
  assertUnique(sources, 'manifest');
  assert.deepEqual(new Set(sources), new Set(inventory), 'manifest must cover the inventory exactly (no missing or extra sources)');

  const legacyPaths = new Set(inventory.map(sourcePath));
  for (const entry of manifest.entries) {
    assert(entry && typeof entry === 'object' && !Array.isArray(entry), 'each entry must be an object');
    assert.deepEqual(Object.keys(entry).sort(), ['approval', 'destination', 'source', 'state'].sort(), `${entry.source} has unexpected or missing fields`);
    validateSource(entry.source);
    assert(DECISION_STATES.has(entry.state), `${entry.source} has invalid state: ${entry.state}`);

    if (entry.state === 'hold') {
      assert.equal(entry.destination, null, `${entry.source} hold must not have a destination`);
      assert.equal(entry.approval, null, `${entry.source} hold must not claim approval`);
      continue;
    }

    validateApproval(entry);
    if (entry.state === 'redirect') {
      validateFinalPath(entry.destination, `${entry.source} destination`);
      assert(approvedDestinations.has(entry.destination), `${entry.source} destination is not explicitly approved: ${entry.destination}`);
      const ownPath = sourcePath(entry.source);
      assert.notEqual(entry.destination, ownPath, `${entry.source} redirects to itself`);
      assert(!legacyPaths.has(entry.destination), `${entry.source} redirects to another legacy source and would create a chain: ${entry.destination}`);
    } else {
      assert.equal(entry.destination, null, `${entry.source} ${entry.state} must not have a redirect destination`);
    }
  }

  return {
    sourceCount: inventory.length,
    decisionCounts: Object.fromEntries(
      [...DECISION_STATES].map((state) => [state, manifest.entries.filter((entry) => entry.state === state).length]),
    ),
  };
}

async function fixtures() {
  const inventoryMarkdown = await readFile(INVENTORY_PATH, 'utf8');
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  return { inventoryMarkdown, manifest };
}

function clone(value) {
  return structuredClone(value);
}

function approval() {
  return {
    status: 'approved',
    approvedBy: 'Test Reviewer',
    approvedAt: '2026-08-13T00:00:00.000Z',
  };
}

test('production manifest is complete, deterministic, and inactive', async () => {
  const { inventoryMarkdown, manifest } = await fixtures();
  const result = validateManifest(manifest, inventoryMarkdown);
  assert.deepEqual(result, {
    sourceCount: 153,
    decisionCounts: { preserve: 0, redirect: 0, 410: 0, hold: 153 },
  });
  assert.deepEqual(manifest.approvedDestinations, []);
});

test('approved preserve, redirect, and 410 decisions have a valid in-memory shape', async () => {
  const { inventoryMarkdown, manifest } = await fixtures();
  const candidate = clone(manifest);
  candidate.approvedDestinations = ['/xray'];
  candidate.entries[0] = { ...candidate.entries[0], state: 'preserve', approval: approval() };
  candidate.entries[1] = { ...candidate.entries[1], state: '410', approval: approval() };
  const xray = candidate.entries.find((entry) => entry.source === 'https://xrayonmalebongwe.co.za/');
  Object.assign(xray, { state: 'redirect', destination: '/xray', approval: approval() });
  assert.deepEqual(validateManifest(candidate, inventoryMarkdown).decisionCounts, {
    preserve: 1,
    redirect: 1,
    410: 1,
    hold: 150,
  });
});

test('coverage and source identity fail closed', async () => {
  const { inventoryMarkdown, manifest } = await fixtures();
  const missing = clone(manifest);
  missing.entries.pop();
  assert.throws(() => validateManifest(missing, inventoryMarkdown), /entry count/);

  const duplicate = clone(manifest);
  duplicate.entries[1].source = duplicate.entries[0].source;
  assert.throws(() => validateManifest(duplicate, inventoryMarkdown), /duplicate/);

  const extra = clone(manifest);
  extra.entries[0].source = 'https://insuresprhealth.co.za/not-in-the-inventory/';
  assert.throws(() => validateManifest(extra, inventoryMarkdown), /cover the inventory exactly/);

  const changedInventory = inventoryMarkdown.replace(
    'https://insuresprhealth.co.za/2022/03/31/confident-step-for-life/',
    'https://insuresprhealth.co.za/replaced-without-a-decision/',
  );
  assert.throws(() => validateManifest(manifest, changedInventory), /cover the inventory exactly/);
});

test('unapproved, unsafe, looping, and chained redirects fail closed', async () => {
  const { inventoryMarkdown, manifest } = await fixtures();
  const source = manifest.entries.find((entry) => entry.source === 'https://xrayonmalebongwe.co.za/about');

  const unapproved = clone(manifest);
  Object.assign(unapproved.entries.find((entry) => entry.source === source.source), {
    state: 'redirect', destination: '/xray', approval: approval(),
  });
  assert.throws(() => validateManifest(unapproved, inventoryMarkdown), /not explicitly approved/);

  for (const destination of ['/manage-booking', '/checkout', '/api/bookings', '/cancel-payment']) {
    const unsafe = clone(manifest);
    unsafe.approvedDestinations = [destination];
    assert.throws(() => validateManifest(unsafe, inventoryMarkdown), /stateful or privileged/);
  }

  const looping = clone(manifest);
  looping.approvedDestinations = ['/about'];
  Object.assign(looping.entries.find((entry) => entry.source === source.source), {
    state: 'redirect', destination: '/about', approval: approval(),
  });
  assert.throws(() => validateManifest(looping, inventoryMarkdown), /redirects to itself/);

  const chained = clone(manifest);
  chained.approvedDestinations = ['/privacy-policy-2'];
  Object.assign(chained.entries.find((entry) => entry.source === source.source), {
    state: 'redirect', destination: '/privacy-policy-2', approval: approval(),
  });
  assert.throws(() => validateManifest(chained, inventoryMarkdown), /create a chain/);
});

test('decision state, destination shape, approval, and activation fail closed', async () => {
  const { inventoryMarkdown, manifest } = await fixtures();
  const invalidState = clone(manifest);
  invalidState.entries[0].state = 'delete';
  assert.throws(() => validateManifest(invalidState, inventoryMarkdown), /invalid state/);

  const holdTarget = clone(manifest);
  holdTarget.entries[0].destination = '/spr';
  assert.throws(() => validateManifest(holdTarget, inventoryMarkdown), /hold must not have a destination/);

  const missingApproval = clone(manifest);
  missingApproval.entries[0].state = 'preserve';
  assert.throws(() => validateManifest(missingApproval, inventoryMarkdown), /requires an approval record/);

  const absolute = clone(manifest);
  absolute.approvedDestinations = ['https://example.com/'];
  assert.throws(() => validateManifest(absolute, inventoryMarkdown), /root-relative path/);

  const activated = clone(manifest);
  activated.activationAuthorized = true;
  assert.throws(() => validateManifest(activated, inventoryMarkdown), /must not activate routing/);
});
