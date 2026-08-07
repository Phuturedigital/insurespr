/* Read the InsureSPR brand palette OUT of the supplied logo files.
 *
 * The mark (tools/logo-source-mark.png) is a set of THIN gradient strokes on a
 * white field. That breaks naive sampling: the overwhelming majority of pixels
 * on a 2px antialiased curve are blended toward white, so "most frequent
 * colour" returns a pastel that appears nowhere in the artwork, and a plain
 * average returns near-white.
 *
 * So: drop anything near-white or near-black, bucket the survivors by HUE, and
 * report the PEAK-CHROMA pixel in each bucket. That recovers the colour the
 * designer actually specified, at the one place the stroke is thick enough to
 * hit full strength.
 *
 * Decoding is done in a headless Chromium via canvas — no sharp/ImageMagick.
 *
 * Usage:  node tools/sample-colours.mjs
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire('file:///C:/Users/Acer/thatha/');
const { chromium } = require('playwright');

const FILES = ['tools/logo-source-mark.png', 'tools/logo-source-full.jpeg'];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const rel of FILES) {
  /* Passed as a data: URI rather than a file:// URL. A page at about:blank has
     a null origin, so it cannot decode a file:// image at all — and even on a
     file:// page the canvas would be tainted and getImageData would throw. */
  const mime = extname(rel) === '.png' ? 'image/png' : 'image/jpeg';
  const url = `data:${mime};base64,${(await readFile(join(ROOT, rel))).toString('base64')}`;

  const result = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();

    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);

    /* 24 hue buckets = 15 degrees each. Fine enough to keep cyan, azure and
       indigo apart (they sit within ~60 degrees of one another here) without
       shattering a single gradient into a dozen near-identical entries. */
    const BUCKETS = 24;
    const best = new Array(BUCKETS).fill(null);
    const counts = new Array(BUCKETS).fill(0);

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 250) continue;                       // transparent edge pixels
      const r = data[i], g = data[i + 1], b = data[i + 2];

      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const chroma = max - min;
      const light = (max + min) / 2;

      /* Reject the white field, the near-black, and anything so desaturated it
         is an antialiasing artefact rather than a designed colour. */
      if (chroma < 40) continue;
      if (light > 245 || light < 12) continue;

      /* Hue in degrees. */
      let h;
      if (max === min) h = 0;
      else if (max === r) h = ((g - b) / chroma) % 6;
      else if (max === g) h = (b - r) / chroma + 2;
      else h = (r - g) / chroma + 4;
      h = (h * 60 + 360) % 360;

      const k = Math.floor(h / (360 / BUCKETS));
      counts[k]++;
      /* PEAK chroma, not modal colour — the whole point of this script. */
      if (!best[k] || chroma > best[k].chroma) best[k] = { r, g, b, chroma, h };
    }

    const hex = (n) => n.toString(16).padStart(2, '0');
    return best
      .map((v, k) => (v ? { ...v, count: counts[k], bucket: k } : null))
      .filter(Boolean)
      .filter((v) => v.count > 60)                 // ignore stray JPEG noise
      .sort((a, b) => b.count - a.count)
      .map((v) => ({
        hex: `#${hex(v.r)}${hex(v.g)}${hex(v.b)}`,
        hue: Math.round(v.h),
        chroma: v.chroma,
        px: v.count,
      }));
  }, url);

  console.log(`\n=== ${basename(rel)} ===`);
  for (const c of result) {
    console.log(`  ${c.hex}  hue ${String(c.hue).padStart(3)}°  chroma ${String(c.chroma).padStart(3)}  ${c.px} px`);
  }
}

await browser.close();
