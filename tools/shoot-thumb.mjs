/* Capture this site's hero as the 640x400 webp card thumbnail used by the
 * pd-network block on every OTHER concept site.
 *
 * reducedMotion:'reduce' is not cosmetic — every site in the network reveals
 * from opacity:0 and forces full opacity under reduced motion, so this settles
 * the page deterministically instead of racing the reveal timeline.
 *
 * There is no sharp/cwebp on this box, and system32/convert is Windows' FAT
 * converter, NOT ImageMagick. Resize + encode inside Chromium instead.
 */
import { writeFileSync } from 'node:fs';
import { loadPlaywright } from './load-playwright.mjs';

const { chromium } = loadPlaywright();

const URL = process.argv[2] || 'https://insurespr.vercel.app/';
const OUT = process.argv[3] || 'pd-concepts/insurespr.webp';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const shot = await page.screenshot({ type: 'png' });

const b64 = await page.evaluate(async (raw) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + raw;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 640; c.height = 400;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, 640, 400);
  return c.toDataURL('image/webp', 0.82).split(',')[1];
}, shot.toString('base64'));

writeFileSync(OUT, Buffer.from(b64, 'base64'));
await browser.close();
console.log(`${OUT} — ${(Buffer.from(b64, 'base64').length / 1024).toFixed(1)} KB`);
