/* Maintain the shared page chrome — concept banner, nav, footer — across every
 * page from one definition here.
 *
 *   node tools/stamp-chrome.mjs
 *
 * Eight hand-copied navs drift. One ends up missing a link or keeping a stale
 * contact route, and nobody notices because the page it is on renders fine. The
 * site has no build step and no templating language, so this script IS the
 * templating: it rewrites the region between the markers on every page and sets
 * aria-current from the filename as it goes.
 *
 * Idempotent — markers are preserved and only the block between them replaced.
 *
 * ⚠️ It replaces EVERYTHING between `<!-- footer:start -->` and
 * `<!-- footer:end -->`. Anything inserted into that region by another script
 * is destroyed on the next run. Insert above the marker, not inside it.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Single source of truth for the practice's published details. Every value is
   taken from the practice's own live site — nothing here is invented. */
const PRACTICE = {
  email: 'motselisi@bonevc.co.za',
  address: '7 Malibongwe Drive, EmedCentre, Randburg',
  hours: 'Monday to Friday, 08:00 – 17:00',
  facebook: 'https://www.facebook.com/InsureSPR/',
  linkedin: 'https://www.linkedin.com/company/InsureSPR',
  x: 'https://twitter.com/Bonevitalityc',
};

const NAV = [
  { href: 'index.html', label: 'Home' },
  { href: 'programmes.html', label: 'Programmes' },
  { href: 'scan.html', label: 'The scan' },
  { href: 'about.html', label: 'About' },
  { href: 'learn.html', label: 'Learn' },
  { href: 'contact.html', label: 'Contact' },
];

const banner = () => `
<div class="concept-banner">
  <div class="wrap">
    <svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>
    <p><strong>Concept demo — not a real clinic website.</strong> Phuture Digital built this to show how InsureSPR Health&rsquo;s own content could be presented. It is not affiliated with, endorsed by, or operated by the practice, no appointment made here reaches anyone, and nothing on it is medical advice.</p>
  </div>
</div>`;

const nav = (file) => `
<div class="nav-shell">
  <div class="wrap">
    <nav class="nav" aria-label="Main">
      <a class="brand" href="index.html">
        <img src="assets/mark.svg" alt="" width="34" height="34">
        <span>
          <span class="brand-name">Insure<span>SPR</span></span>
          <span class="brand-sub">Precision Healthcare</span>
        </span>
      </a>

      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links">
        <svg class="icon" aria-hidden="true"><use href="#i-menu"></use></svg>
        Menu
      </button>

      <div class="nav-links" id="nav-links" data-open="false">
${NAV.map((n) => `        <a href="${n.href}"${n.href === file ? ' aria-current="page"' : ''}>${n.label}</a>`).join('\n')}
        <a class="btn btn--primary btn--sm" href="book.html">Book a scan <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></a>
      </div>

      <a class="btn btn--primary btn--sm" href="book.html">Book a scan <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></a>
    </nav>
  </div>
</div>`;

const footer = () => `
<footer class="foot">
  <div class="wrap foot-in">
    <div class="foot-top">
      <div>
        <a class="brand" href="index.html">
          <img src="assets/mark-light.svg" alt="" width="34" height="34">
          <span>
            <span class="brand-name">Insure<span>SPR</span></span>
            <span class="brand-sub">Precision Healthcare</span>
          </span>
        </a>
        <p style="margin-top:1rem;max-width:30ch">Bone and muscle health, measured properly and explained in plain English.</p>
        <div class="foot-social">
          <a href="${PRACTICE.facebook}" rel="noopener" aria-label="InsureSPR Health on Facebook"><svg class="icon" aria-hidden="true"><use href="#i-facebook"></use></svg></a>
          <a href="${PRACTICE.linkedin}" rel="noopener" aria-label="InsureSPR Health on LinkedIn"><svg class="icon" aria-hidden="true"><use href="#i-linkedin"></use></svg></a>
          <a href="${PRACTICE.x}" rel="noopener" aria-label="InsureSPR Health on X"><svg class="icon" aria-hidden="true"><use href="#i-x"></use></svg></a>
        </div>
      </div>

      <div>
        <h4>Pages</h4>
        <ul>
${NAV.map((n) => `          <li><a href="${n.href}">${n.label}</a></li>`).join('\n')}
        </ul>
      </div>

      <div>
        <h4>Programmes</h4>
        <ul>
          <li><a href="programmes.html#strong">InsureStrong</a></li>
          <li><a href="programmes.html#prevent">InsurePrevent</a></li>
          <li><a href="programmes.html#reclaim">InsureReclaim</a></li>
          <li><a href="book.html">Book a scan</a></li>
        </ul>
      </div>

      <div>
        <h4>Find the practice</h4>
        <ul>
          <li><a href="https://maps.google.com/?q=7+Malibongwe+Drive+EmedCentre+Randburg" rel="noopener noreferrer" target="_blank">${PRACTICE.address}</a></li>
          <li><a href="mailto:${PRACTICE.email}">${PRACTICE.email}</a></li>
          <li><a href="contact.html">${PRACTICE.hours}</a></li>
        </ul>
      </div>
    </div>

    <div class="foot-bottom">
      <p><strong>Concept demo.</strong> Designed and built by <a href="https://phuturedigital.co.za" rel="noopener noreferrer" target="_blank">Phuture Digital</a> as an independent redesign concept for InsureSPR Health. It is not the practice&rsquo;s official site and is not affiliated with or endorsed by them. Nothing here is medical advice — speak to a qualified healthcare professional. <a href="brand.html">See how it was designed and built &rarr;</a></p>
      <p>© 2026 Phuture Digital. Practice name, contact details and article titles belong to InsureSPR Health.</p>
    </div>
  </div>
</footer>`;

/* Replace everything between a start and end marker, keeping the markers. */
function swap(html, name, block) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) return null;
  return html.slice(0, a + start.length) + block + '\n' + html.slice(b);
}

const pages = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
let changed = 0;

for (const file of pages) {
  const path = join(ROOT, file);
  const original = await readFile(path, 'utf8');
  let html = original;

  for (const [name, block] of [['banner', banner()], ['nav', nav(file)], ['footer', footer()]]) {
    const next = swap(html, name, block);
    if (next === null) { console.warn(`skip ${file} — no ${name} markers`); continue; }
    html = next;
  }

  if (html !== original) { await writeFile(path, html); console.log(`ok   ${file}`); changed++; }
  else console.log(`--   ${file} (already current)`);
}
console.log(`\n${changed} page(s) updated.`);
