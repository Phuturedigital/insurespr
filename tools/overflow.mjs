/* Find which elements actually exceed the viewport at a given width.
 * Horizontal overflow is nearly always one specific inflexible child, and
 * guessing at it from a screenshot wastes more time than measuring it.
 *
 * Usage:  node tools/overflow.mjs <page.html> [width]
 */
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = loadPlaywright();

const file = process.argv[2] || 'about.html';
const width = Number(process.argv[3] || 390);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 844 } });
await page.goto(pathToFileURL(join(ROOT, file)).href, { waitUntil: 'networkidle' });

const offenders = await page.evaluate((vw) => {
  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 46) : '',
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34),
      });
    }
  });
  return out;
}, width);

console.log(`${file} @ ${width}px — ${offenders.length} element(s) past the edge\n`);
/* Deepest-first is the useful order: ancestors overflow only because a
   descendant forced them to, so the last entries name the real culprit. */
for (const o of offenders.slice(-14)) {
  console.log(`  <${o.tag}${o.cls ? ' class="' + o.cls + '"' : ''}>  left=${o.left} right=${o.right} w=${o.w}  "${o.text}"`);
}

await browser.close();
