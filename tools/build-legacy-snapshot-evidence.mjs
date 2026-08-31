import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'LEGACY-REDIRECT-MANIFEST.json');
const OUTPUT = path.join(ROOT, 'LEGACY-SNAPSHOT-EVIDENCE.json');
const ARCHIVE_ORIGIN = 'https://web.archive.org';
const SNAPSHOT_END = '20260828';

const canonicalHost = (hostname) => hostname.toLowerCase().replace(/^www\./, '');
const canonicalPath = (pathname) => {
  const decoded = decodeURIComponent(pathname).replace(/\/{2,}/g, '/');
  if (decoded === '/') return '/';
  return `${decoded.replace(/\/+$/, '')}/`;
};
const canonicalKey = (value) => {
  const url = new URL(value);
  return `${canonicalHost(url.hostname)}${canonicalPath(url.pathname)}`;
};

const cdxUrl = (hostname) => {
  const query = new URLSearchParams({
    url: `${hostname}/*`,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype,digest',
    'filter': 'statuscode:200',
    collapse: 'digest',
    from: '2022',
    to: SNAPSHOT_END,
    limit: '10000',
  });
  // URLSearchParams escapes the wildcard, which the CDX endpoint accepts.
  return `${ARCHIVE_ORIGIN}/cdx/search/cdx?${query}`;
};

const fetchRows = async (hostname) => {
  const response = await fetch(cdxUrl(hostname), {
    headers: { 'user-agent': 'InsureSPR-Legacy-Evidence/1.0' },
  });
  if (!response.ok) {
    throw new Error(`CDX request for ${hostname} failed with ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) return [];
  const [header, ...rows] = body;
  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));
  return rows.map((row) => ({
    timestamp: row[indexes.timestamp],
    original: row[indexes.original],
    statuscode: row[indexes.statuscode],
    mimetype: row[indexes.mimetype],
    digest: row[indexes.digest],
  }));
};

const manifest = JSON.parse(await readFile(SOURCE, 'utf8'));
if (!Array.isArray(manifest.entries) || manifest.entries.length !== 153) {
  throw new Error('Expected the approved 153-entry legacy inventory');
}

const hosts = [...new Set(manifest.entries.map((entry) => canonicalHost(new URL(entry.source).hostname)))];
const rows = (await Promise.all(hosts.map(fetchRows))).flat();
const bySource = new Map();

for (const row of rows) {
  if (row.statuscode !== '200' || row.mimetype !== 'text/html') continue;
  let key;
  try {
    key = canonicalKey(row.original);
  } catch {
    continue;
  }
  const current = bySource.get(key);
  if (!current || row.timestamp > current.timestamp) bySource.set(key, row);
}

const entries = manifest.entries.map((entry) => {
  const row = bySource.get(canonicalKey(entry.source));
  return {
    source: entry.source,
    disposition: entry.state,
    snapshot: row
      ? {
          timestamp: row.timestamp,
          original: row.original,
          digest: row.digest,
          url: `${ARCHIVE_ORIGIN}/web/${row.timestamp}/${row.original}`,
        }
      : null,
  };
});

const captured = entries.filter((entry) => entry.snapshot !== null).length;
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  throughDate: SNAPSHOT_END,
  sourceManifest: 'LEGACY-REDIRECT-MANIFEST.json',
  sourceManifestStatus: manifest.status,
  purpose:
    'Recovery evidence for the legacy content migration. This file records public archive metadata only; it does not approve, republish, or redirect clinical content.',
  summary: {
    inventoryEntries: entries.length,
    captured,
    missing: entries.length - captured,
  },
  entries,
};

await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.basename(OUTPUT)}: ${captured}/${entries.length} sources have a public HTML snapshot.`);
