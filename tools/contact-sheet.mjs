/* Render tools/previews/ into labelled contact sheets.
 *
 * Selecting stock photography from search-result metadata alone is how a
 * courier concept once ended up with military aircraft on it. Every candidate
 * has to actually be LOOKED at. Reviewing ~100 separate JPEGs one by one is
 * impractical, so this lays them out as grids — filename under each frame, one
 * sheet per group of slots — which makes the whole shortlist reviewable in a
 * handful of images.
 *
 * Usage:  node tools/contact-sheet.mjs              # review search candidates
 *         node tools/contact-sheet.mjs --assets     # review what actually shipped
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEWS = join(ROOT, 'tools', 'previews');
const OUT = join(ROOT, 'tools', 'sheets');

const { chromium } = loadPlaywright();

/* --assets reviews the CONVERTED webp files rather than the JPEG candidates.
   Worth doing as its own pass: the winners are re-encoded and re-sized on the
   Pexels CDN, so what ships is not byte-identical to what was shortlisted. */
const ASSETS_MODE = process.argv.includes('--assets');
const SRC = ASSETS_MODE ? join(ROOT, 'assets') : PREVIEWS;
const EXT = ASSETS_MODE ? '.webp' : '.jpg';
const MIME = ASSETS_MODE ? 'image/webp' : 'image/jpeg';

const files = (await readdir(SRC)).filter((f) => f.endsWith(EXT)).sort();

/* Group by slot name — everything before the first "-<digit>" chunk. In
   --assets mode each file is its own slot, since names are already final. */
const bySlot = new Map();
for (const f of files) {
  const slot = ASSETS_MODE ? 'shipped' : f.replace(/-\d+-\d+\.jpg$/, '');
  if (!bySlot.has(slot)) bySlot.set(slot, []);
  bySlot.get(slot).push(f);
}

/* Four slots per sheet keeps each sheet readable at a normal screenshot size. */
const slots = [...bySlot.keys()];
const CHUNK = 4;
const sheets = [];
for (let i = 0; i < slots.length; i += CHUNK) sheets.push(slots.slice(i, i + CHUNK));

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

for (const [n, group] of sheets.entries()) {
  let html = `<style>
    body{font:13px/1.3 system-ui;background:#fff;margin:0;padding:16px}
    h2{font:600 15px system-ui;margin:18px 0 8px;padding:4px 8px;background:#111;color:#fff}
    .row{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
    figure{margin:0}
    img{width:100%;height:190px;object-fit:cover;display:block;background:#eee;border:1px solid #ccc}
    figcaption{font:11px/1.25 ui-monospace,monospace;padding:3px 0;word-break:break-all}
  </style>`;

  for (const slot of group) {
    html += `<h2>${slot}</h2><div class="row">`;
    for (const f of bySlot.get(slot)) {
      const b64 = (await readFile(join(SRC, f))).toString('base64');
      html += `<figure><img src="data:${MIME};base64,${b64}"><figcaption>${f.replace(`${slot}-`, '')}</figcaption></figure>`;
    }
    html += `</div>`;
  }

  const tmp = join(OUT, `sheet-${n}.html`);
  await writeFile(tmp, html);
  await page.goto(`file:///${tmp.replace(/\\/g, '/')}`);
  await page.screenshot({ path: join(OUT, `sheet-${n}.png`), fullPage: true });
  console.log(`sheet-${n}.png  ${group.join(', ')}`);
}

await browser.close();
