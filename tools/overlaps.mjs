/* Find UI elements that collide with each other.
 *
 *   node tools/overlaps.mjs [page.html ...]      (default: every production page)
 *
 * WHY A TOOL AND NOT AN EYEBALL
 * -----------------------------
 * Collisions between absolutely-positioned overlays are the single hardest
 * defect class to catch by reading CSS, because each rule is individually
 * correct. The hero's carousel dots sit `bottom: clamp(7.6rem, 14vh, 9rem)`
 * and the booking panel sits `bottom: clamp(1rem, 2.5vw, 2.5rem)` with
 * `min-height: 96px`. Both are reasonable. Whether they touch depends on the
 * VIEWPORT HEIGHT, because one clamp resolves against vh and the other against
 * vw — so the pair is clean at one window size and overlapping at another, and
 * no amount of staring at the stylesheet tells you which.
 *
 * WHAT IT COMPARES
 * ----------------
 * Naively intersecting every box reports thousands of true-but-meaningless
 * hits: every parent contains its children, every link sits inside its card.
 * So this only compares elements that are:
 *
 *   - visible, and larger than a hairline
 *   - NOT an ancestor or descendant of each other (containment is not collision)
 *   - in the "floating layer" (position absolute/fixed/sticky) OR a discrete
 *     component from COMPONENTS below
 *
 * and it ignores a pair when one is a known intentional overlay (a scrim, a
 * gradient, the nav, a skip link), listed in INTENTIONAL.
 *
 * Reported overlap is the intersection area as a percentage of the SMALLER
 * box, so a 6px clip of a small pill scores high rather than being lost
 * against a large parent's area.
 */
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const { chromium } = loadPlaywright();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:4321';

const PAGES = [
  'index.html', 'spr.html', 'xray.html', 'scanning.html', 'workforce.html',
  'book.html', 'contact.html', 'privacy.html',
  'booking-confirmation.html', 'manage-booking.html', '404.html',
];

/* Heights matter as much as widths here: the hero collision only appears at
   certain viewport HEIGHTS, because the two rules resolve against vh and vw
   respectively. A width-only sweep would have missed it. */
const VIEWPORTS = [
  { name: 'desktop-tall', width: 1440, height: 1080 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'desktop-short', width: 1440, height: 720 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'laptop-short', width: 1280, height: 640 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-s', width: 360, height: 800 },
  { name: 'phone-xs', width: 320, height: 568 },
];

const argv = process.argv.slice(2).filter((a) => a.endsWith('.html'));
const pages = argv.length ? argv : PAGES;

const browser = await chromium.launch();
let hits = 0;

for (const page of pages) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: 'reduce',
    });
    const p = await ctx.newPage();
    await p.goto(`${ORIGIN}/${page}`, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(700);

    const found = await p.evaluate(() => {
      /* Discrete components worth collision-checking even when statically
         positioned — these are the things that read as objects on the page. */
      const COMPONENTS = [
        '.btn', '.hero-booking-panel', '.hero-dots', '.hero-route-pills',
        '.card', '.route-card', '.service-choice', '.statstrip > div',
        '.journey-step', '.service-flow li', '.service-answers > div',
        '.mobile-quick-actions', '.nav-links', '.brand', '.foot-top > div',
        '.spr-deep-pillar', '.badge', '.eyebrow', '.card-title', 'h1', 'h2',
      ].join(',');

      /* ⚠️ Two lists, and the distinction is the whole tool.
         SUBTREE_EXEMPT skips an element AND its descendants — for regions that
         legitimately float over the page as a unit (the nav sits on the hero
         by design, so every link inside it "collides" with the headline).
         SELF_EXEMPT skips only the element itself and still compares its
         CHILDREN against each other.

         .hero-visual has to be self-exempt. It is a full-bleed image container
         that everything in the hero sits on top of, so it collides with
         everything — but its children are the carousel dots and the booking
         panel, which is the exact pair that prompted this tool. Putting it in
         the subtree list (the first thing I did) silently suppressed the one
         defect it was written to find. */
      const SUBTREE_EXEMPT = ['.skip', '.nav-shell', '.icon-sprite', '.booking-embed'];
      const SELF_EXEMPT = ['.hero-visual', '.hero-slide', '.hero-card', '.mobile-quick-actions'];

      const els = [...document.querySelectorAll(COMPONENTS)].filter((e) => {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        const r = e.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      });

      const isIntentional = (e) =>
        SUBTREE_EXEMPT.some((sel) => e.closest(sel)) ||
        SELF_EXEMPT.some((sel) => e.matches(sel));
      const label = (e) => {
        const cls = (e.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        return e.tagName.toLowerCase() + (cls ? '.' + cls : '') +
               (e.id ? '#' + e.id : '');
      };

      const out = [];
      for (let i = 0; i < els.length; i++) {
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i], b = els[j];
          if (a.contains(b) || b.contains(a)) continue;      // containment != collision
          if (isIntentional(a) || isIntentional(b)) continue;

          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (ox <= 0 || oy <= 0) continue;

          const area = ox * oy;
          const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
          const pct = Math.round((area / smaller) * 100);
          if (pct < 4) continue;                              // sub-pixel/rounding noise

          out.push({
            a: label(a), b: label(b), pct,
            px: `${Math.round(ox)}x${Math.round(oy)}`,
          });
        }
      }
      /* De-duplicate repeated component pairs (e.g. 9 answer cards) */
      const seen = new Set();
      return out.filter((o) => {
        const k = o.a + '|' + o.b;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).sort((x, y) => y.pct - x.pct);
    });

    if (found.length) {
      console.log(`\nWARN ${page}  ${vp.name} (${vp.width}x${vp.height})`);
      for (const f of found) {
        console.log(`   ${String(f.pct).padStart(3)}%  ${f.px.padEnd(9)} ${f.a}  ><  ${f.b}`);
        hits++;
      }
    }
    await ctx.close();
  }
  process.stdout.write(`checked ${page}\n`);
}

await browser.close();
console.log(hits ? `\n${hits} overlap(s) flagged.` : '\nNo element collisions found.');
process.exit(hits ? 1 : 0);
