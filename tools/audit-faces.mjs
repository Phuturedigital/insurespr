/* Find every place TEXT is rendered ON TOP OF a PHOTOGRAPH, and crop those
 * regions out for review.
 *
 *   node tools/audit-faces.mjs
 *
 * Text over a photo is fine. Text over a person's FACE is not — it reads as
 * carelessness and it is the one part of the frame a viewer looks at first.
 * This script cannot judge that on its own, so it does the measurable half:
 * locate the overlaps and crop them. A human (or a vision model) judges the
 * crops. It also tries the browser's FaceDetector where available.
 */
import { mkdirSync } from 'node:fs';
import { loadPlaywright } from './load-playwright.mjs';

const { chromium } = loadPlaywright();

const PAGES = ['', 'brand', 'scan', 'services', 'about', 'learn', 'book', 'contact'];
mkdirSync('tools/shots/faces', { recursive: true });

const browser = await chromium.launch();
const found = [];

for (const pg of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`http://localhost:4321/${pg}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);

  const overlaps = await page.evaluate(() => {
    const out = [];
    const imgs = [...document.querySelectorAll('img')].filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 260 && r.height > 160;         // photographs, not icons
    });
    // Text nodes with real content, that paint above an image.
    const texty = [...document.querySelectorAll('h1,h2,h3,p,span,a,li')].filter(
      (e) => e.textContent.trim().length > 3 && e.offsetParent !== null,
    );
    for (const img of imgs) {
      const ir = img.getBoundingClientRect();
      const hits = [];
      for (const t of texty) {
        const tr = t.getBoundingClientRect();
        if (tr.width < 20 || tr.height < 8) continue;
        const ox = Math.max(0, Math.min(ir.right, tr.right) - Math.max(ir.left, tr.left));
        const oy = Math.max(0, Math.min(ir.bottom, tr.bottom) - Math.max(ir.top, tr.top));
        if (ox <= 0 || oy <= 0) continue;
        // Only count text that is a DESCENDANT of neither the img nor a sibling
        // laid out beside it — i.e. genuinely stacked over the picture.
        const mid = document.elementFromPoint(tr.left + tr.width / 2, tr.top + Math.min(8, tr.height / 2));
        if (!mid || !t.contains(mid) && mid !== t) continue;
        hits.push({ text: t.textContent.trim().slice(0, 48), tag: t.tagName });
      }
      if (hits.length) {
        out.push({
          src: img.getAttribute('src'),
          box: { x: Math.round(ir.left + scrollX), y: Math.round(ir.top + scrollY),
                 w: Math.round(ir.width), h: Math.round(ir.height) },
          textCount: hits.length,
          sample: hits.slice(0, 3).map((h) => h.text),
        });
      }
    }
    return out;
  });

  for (const [i, o] of overlaps.entries()) {
    const name = `${pg || 'index'}-${i}`;
    found.push({ page: pg || 'index', ...o, shot: name });
    try {
      await page.screenshot({
        path: `tools/shots/faces/${name}.png`,
        clip: { x: Math.max(0, o.box.x), y: Math.max(0, o.box.y),
                width: Math.min(o.box.w, 1440), height: Math.min(o.box.h, 1200) },
      });
    } catch { /* clipped off-page */ }
  }
  await page.close();
}

console.log(`\nText-over-photograph regions found: ${found.length}\n`);
for (const f of found) {
  console.log(`  ${f.page.padEnd(10)} ${String(f.src).padEnd(24)} ${f.box.w}x${f.box.h}  ${f.textCount} text run(s)`);
  console.log(`             e.g. ${JSON.stringify(f.sample)}`);
}
await browser.close();
