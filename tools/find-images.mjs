/* InsureSPR Health concept — stock image sourcing.
 *
 * Queries Pexels for each image slot the design needs and writes small preview
 * JPEGs to tools/previews/ so every candidate can be looked at before anything
 * is committed. Nothing here runs at build or deploy time; the site is static
 * and ships only the converted webp files under assets/.
 *
 * The brief asked for photography that is *very visible* — large, unambiguous,
 * legible at a glance. That pushes the selection criteria harder than usual:
 * a frame has to still read as "bone scan" or "balance work" when it is 1400px
 * wide behind a headline, not just when you already know what you are looking
 * at. Tight, cluttered or heavily-filtered frames are rejected for that reason.
 *
 * Pexels licence: free for commercial use, no attribution required. Credits are
 * recorded in CONTENT-NOTES.md anyway — this is a client-facing concept, and
 * "where did this image come from" always gets asked.
 *
 * Usage:  node tools/find-images.mjs <slot>       # search + download previews
 *         node tools/find-images.mjs --all        # every slot
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_DIR = join(ROOT, 'tools', 'previews');

/* Pexels' web client key. Public — it ships in their own front-end bundle. */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  Accept: 'application/json',
  'Secret-Key': 'H2jk9uKnhRmL6WPwh89zBezWvr',
};

/* Queries lean deliberately toward African subjects and toward people in their
   50s-70s: this is a Randburg bone-health practice, and the two groups most
   affected by bone and muscle loss are post-menopausal women and older men. A
   South African osteoporosis brand illustrated entirely with young white
   European stock would undercut the whole premise. */
const SLOTS = {
  hero:        'happy senior african woman active outdoors',
  'hero-b':    'older african man walking confident outdoors',
  scan:        'patient lying medical scanner radiology machine',
  'scan-b':    'radiographer operating ct scan machine patient',
  nurse:       'african nurse consultation patient talking clinic',
  strength:    'senior woman lifting dumbbells strength training',
  'strength-b':'older man resistance training gym weights',
  balance:     'senior balance exercise physiotherapy standing',
  mobility:    'physiotherapist stretching patient shoulder mobility',
  breathing:   'woman breathing exercise calm hands on ribs',
  walk:        'senior couple walking park together happy',
  sport:       'african athlete running track training',
  bones:       'x-ray spine bone medical imaging',
  clinic:      'modern medical clinic reception interior bright',
  coach:       'health coach talking with client notes desk',
  family:      'grandmother grandchild playing garden happy',
};

async function search(query, perPage = 6) {
  const url =
    `https://www.pexels.com/en-us/api/v3/search/photos` +
    `?query=${encodeURIComponent(query)}&per_page=${perPage}&page=1&orientation=all`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Pexels ${res.status} for "${query}"`);
  const { data = [] } = await res.json();
  return data.map((d) => ({
    id: d.id,
    photographer: d.attributes?.user?.first_name
      ? `${d.attributes.user.first_name} ${d.attributes.user.last_name ?? ''}`.trim()
      : 'unknown',
    alt: (d.attributes?.image?.alt ?? '').replace(/\s+/g, ' ').trim(),
    width: d.attributes?.width,
    height: d.attributes?.height,
    /* Strip Pexels' download-disposition params and re-size on their CDN. */
    base: String(d.attributes?.image?.download_link ?? '').split('?')[0],
  })).filter((c) => c.base);
}

const sized = (base, w) => `${base}?auto=compress&cs=tinysrgb&w=${w}`;

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const wanted = process.argv[2] === '--all' ? Object.keys(SLOTS) : [process.argv[2]];
await mkdir(PREVIEW_DIR, { recursive: true });

for (const slot of wanted) {
  const query = SLOTS[slot];
  if (!query) { console.error(`unknown slot: ${slot}`); continue; }
  try {
    const results = await search(query);
    console.log(`\n=== ${slot} :: "${query}" ===`);
    for (const [i, c] of results.entries()) {
      const file = join(PREVIEW_DIR, `${slot}-${i}-${c.id}.jpg`);
      await download(sized(c.base, 400), file);
      console.log(`[${i}] id=${c.id} ${c.width}x${c.height} by ${c.photographer} :: ${c.alt}`);
    }
  } catch (err) {
    console.error(`FAIL ${slot}: ${err.message}`);
  }
}
