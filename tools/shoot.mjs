/* Screenshot harness for the Khanya concept demo.
 *
 * Reuses the Playwright install already present in the sibling THATHA repo
 * rather than adding node_modules to this one — the site itself stays a
 * zero-dependency static build, which is the whole point of the pattern.
 *
 * Usage:  node tools/shoot.mjs [page.html ...]      (default: every page)
 *         node tools/shoot.mjs --url https://…      (shoot a live deploy)
 */
import { createRequire } from 'node:module';
import { mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'shots');

/* Playwright lives next door. If THATHA is ever moved this is the one line
   that needs updating. */
const require = createRequire('file:///C:/Users/Acer/thatha/');
const { chromium } = require('playwright');

/* 320 is the narrowest width worth supporting (iPhone SE 1st gen / Galaxy Fold
   cover screen). 360 is the single most common Android width in South Africa,
   which is the audience this concept is aimed at. 768 catches the iPad portrait
   case that falls between the 980 and 640 breakpoints. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone-l', width: 414, height: 896 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-s', width: 360, height: 800 },
  { name: 'phone-xs', width: 320, height: 568 },
];

const argv = process.argv.slice(2);
const urlFlag = argv.indexOf('--url');
const baseUrl = urlFlag !== -1 ? argv[urlFlag + 1].replace(/\/$/, '') : null;
const named = argv.filter((a) => a.endsWith('.html'));

const pages = named.length
  ? named
  : (await readdir(ROOT)).filter((f) => f.endsWith('.html')).sort();

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
let problems = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  /* Surface anything the page complains about — a 404 on an asset or a JS
     throw is far easier to catch here than by squinting at a screenshot. */
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // Google Fonts may be blocked in a sandbox; that is not a site defect.
    if (!r.url().includes('fonts.g')) errors.push(`requestfailed: ${r.url()}`);
  });

  for (const file of pages) {
    const target = baseUrl
      ? `${baseUrl}/${file.replace(/\.html$/, '')}`
      : pathToFileURL(join(ROOT, file)).href;

    errors.length = 0;
    await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(350);

    /* Scroll the whole page before capturing. The scroll-reveal targets are
       opacity:0 until IntersectionObserver sees them, and it only fires for
       what has actually entered the viewport — so a fullPage screenshot taken
       from a standing start renders everything below the fold as blank. Walk
       down, let the observers fire, then return to the top so the hero is in
       its natural state for the capture. */
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 200));
    });
    await page.waitForTimeout(900);   // let the reveal transitions settle

    /* Horizontal overflow is the single most common responsive defect and is
       invisible in a full-page screenshot. Measure it explicitly. */
    const overflow = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
    );

    /* Touch targets below 24px square are a genuine mobile-usability defect,
       not a nitpick — WCAG 2.2 SC 2.5.8 makes 24x24 the minimum. Only measured
       on narrow viewports, where fingers rather than cursors are in play. */
    const smallTargets = vp.width > 640 ? [] : await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('a, button, input, select, textarea, summary').forEach((el) => {
        if (el.closest('.skip') || el.className === 'skip') return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;          // hidden — not a target
        if (getComputedStyle(el).display === 'none') return;
        /* Off-screen and explicitly-hidden controls are not targets either.
           The spam honeypot ("Website") is a real input with a real 177x22
           layout box, parked at left:-10000px inside a 1x1 clipped wrapper —
           getBoundingClientRect reports its own size regardless of an
           ancestor's overflow, so it was flagged on four pages at every
           viewport. A permanent false positive is worse than no check: it
           trains you to skim the SMALL-TAP line, which is where the genuinely
           undersized consent checkboxes were hiding. */
        if (el.closest('[aria-hidden="true"]')) return;
        if (el.tabIndex < 0) return;
        if (r.right < 0 || r.bottom < 0 || r.left > document.documentElement.scrollWidth) return;
        /* WCAG 2.2 SC 2.5.8 exempts targets sitting inline inside a sentence —
           you cannot enlarge a word in running prose without wrecking the line
           box. Detect that as: the parent holds materially more text than the
           link does. Standalone nav links (an <li> holding only an <a>) still
           get flagged, which is the case that actually matters. */
        const own = (el.textContent || '').trim().length;
        const parent = (el.parentElement?.textContent || '').trim().length;
        if (own && parent > own * 1.4) return;
        if (r.height < 24 || r.width < 24) {
          bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ` +
                   `${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      });
      return [...new Set(bad)];
    });

    const shot = join(OUT, `${file.replace(/\.html$/, '')}-${vp.name}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    const flags = [];
    if (overflow > 1) { flags.push(`H-OVERFLOW ${overflow}px`); problems++; }
    if (smallTargets.length) { flags.push(`SMALL-TAP ${smallTargets.join(', ')}`); problems++; }
    if (errors.length) { flags.push(...errors); problems++; }
    console.log(`${flags.length ? 'WARN' : 'ok  '} ${file.padEnd(20)} ${vp.name.padEnd(8)} ${flags.join(' | ')}`);
  }
  await ctx.close();
}

await browser.close();
console.log(problems ? `\n${problems} issue(s) flagged.` : '\nAll clean.');
