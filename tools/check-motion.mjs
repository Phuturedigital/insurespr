/* Guard against the worst failure mode of a scroll-reveal system: content that
 * is hidden by CSS and never un-hidden, leaving a blank page.
 *
 * Checks three states per page:
 *   reduce  — prefers-reduced-motion: the CSS must force reveal targets visible
 *   nojs    — JavaScript disabled: the `.js` class is never stamped, so nothing
 *             should be hidden in the first place
 *   normal  — JS on, no scrolling: above-fold content must already be visible
 *
 * Usage:  node tools/check-motion.mjs
 */
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire('file:///C:/Users/Acer/thatha/');
const { chromium } = require('playwright');

const SEL = '.sec-head, .card, .well, .svc-card, .about-figure, .about-copy,'
  + '.prac-pair, .stat, .stats-note, .quote, .post, .note-box, .price-row,'
  + '.cta-band, .foot-top, .reviews';

const pages = (await readdir(ROOT)).filter((f) => f.endsWith('.html')).sort();
const browser = await chromium.launch();
let problems = 0;

for (const mode of ['reduce', 'nojs', 'normal']) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference',
    javaScriptEnabled: mode !== 'nojs',
  });
  const page = await ctx.newPage();

  for (const file of pages) {
    await page.goto(pathToFileURL(join(ROOT, file)).href, { waitUntil: 'networkidle' });
    /* Long enough for the slowest reveal to finish: up to 400ms of stagger
       delay plus an 800ms transition. Sampling earlier flags elements that are
       merely mid-fade, which is not the defect this is looking for. */
    await page.waitForTimeout(1800);

    const hidden = await page.evaluate((sel) => {
      const out = [];
      document.querySelectorAll(sel).forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        // Only judge what is actually on screen; below-fold reveals are correct
        // to be hidden in the 'normal' pass.
        const onScreen = r.top < window.innerHeight && r.bottom > 0;
        if (!onScreen) return;
        if (parseFloat(cs.opacity) < 0.9) {
          out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
        }
      });
      return [...new Set(out)];
    }, SEL);

    const bad = hidden.length > 0;
    if (bad) problems++;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${mode.padEnd(7)} ${file.padEnd(20)} ${bad ? 'invisible above fold: ' + hidden.join(', ') : ''}`);
  }
  await ctx.close();
}

await browser.close();
console.log(problems ? `\n${problems} page/mode combination(s) hide visible content.` : '\nNo content is stranded invisible in any mode.');
process.exit(problems ? 1 : 0);
