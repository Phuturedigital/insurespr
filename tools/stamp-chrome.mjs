/* Maintain the shared page chrome — concept banner, header/nav, footer —
 * across every page from one definition here.
 *
 * Seven hand-copied headers drift. One of them ends up missing a nav item, or
 * keeps a stale phone number, and nobody notices because the page it is on
 * renders fine. The site has no build step and no templating language, so this
 * script is the templating: it rewrites the region between the chrome markers
 * on every page, setting aria-current from the filename as it goes.
 *
 * Idempotent — the markers are preserved and the block between them replaced,
 * so a wording change propagates site-wide in one pass.
 *
 * Usage:  node tools/stamp-chrome.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Single source of truth for the practice's published details. Everything here
   is taken from the practice's own live site — nothing is invented. */
const PRACTICE = {
  phone: '083 450 7861',
  phoneHref: '+27834507861',
  email: 'health@insuresprhealth.co.za',
  address: '7 Malibongwe Drive, EmedCentre, Randburg',
  hours: 'Monday to Friday, 08:00 – 17:00',
  facebook: 'https://www.facebook.com/InsureSPR/',
  linkedin: 'https://www.linkedin.com/company/InsureSPR',
  x: 'https://twitter.com/Bonevitalityc',
};

const NAV = [
  { href: 'index.html', label: 'Home' },
  { href: 'scan.html', label: 'The scan' },
  { href: 'services.html', label: 'Services' },
  { href: 'about.html', label: 'About' },
  { href: 'learn.html', label: 'Learn' },
  { href: 'contact.html', label: 'Contact' },
];

const banner = () => `
<div class="concept-banner">
  <div class="wrap">
    <svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>
    <p><strong>This is a design concept, not a real clinic website.</strong> Phuture Digital built it to show how InsureSPR Health's own content could be presented. It is not affiliated with, endorsed by, or operated by the practice, and nothing here is medical advice.</p>
  </div>
</div>`;

const header = (file) => `
<header class="head">
  <div class="wrap head-in">
    <a class="brand" href="index.html">
      <img src="assets/mark.svg" alt="" width="30" height="40">
      <span>
        <span class="brand-name">Insure<span>SPR</span> Health</span>
        <span class="brand-sub">Bone &amp; muscle health</span>
      </span>
    </a>

    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
      <svg class="icon" aria-hidden="true"><use href="#i-menu"></use></svg>
      <span class="nav-toggle-label">Menu</span>
    </button>

    <nav class="nav" id="site-nav" aria-label="Main">
${NAV.map((n) => `      <a href="${n.href}"${n.href === file ? ' aria-current="page"' : ''}>${n.label}</a>`).join('\n')}
      <a class="btn btn-primary" href="book.html">
        <svg class="icon" aria-hidden="true"><use href="#i-calendar"></use></svg>
        Book a scan
      </a>
    </nav>
  </div>
</header>`;

const footer = () => `
<footer class="foot">
  <div class="wrap">
    <div class="foot-top">
      <div>
        <a class="brand" href="index.html">
          <img src="assets/mark-light.svg" alt="" width="30" height="40">
          <span>
            <span class="brand-name">Insure<span>SPR</span> Health</span>
            <span class="brand-sub">A confident movement for life</span>
          </span>
        </a>
        <p style="margin-top:1rem">Bone and muscle health for confident, independent living — measured properly, explained plainly.</p>
        <div class="foot-social">
          <a href="${PRACTICE.facebook}" aria-label="InsureSPR Health on Facebook" rel="noopener noreferrer" target="_blank"><svg class="icon" aria-hidden="true"><use href="#i-facebook"></use></svg></a>
          <a href="${PRACTICE.linkedin}" aria-label="InsureSPR Health on LinkedIn" rel="noopener noreferrer" target="_blank"><svg class="icon" aria-hidden="true"><use href="#i-linkedin"></use></svg></a>
          <a href="${PRACTICE.x}" aria-label="InsureSPR Health on X" rel="noopener noreferrer" target="_blank"><svg class="icon" aria-hidden="true"><use href="#i-x"></use></svg></a>
        </div>
      </div>

      <div>
        <h4>Explore</h4>
        <ul>
          <li><a href="index.html">Home</a></li>
          <li><a href="scan.html">The scan explained</a></li>
          <li><a href="services.html">Services</a></li>
          <li><a href="about.html">About the practice</a></li>
          <li><a href="learn.html">Learn</a></li>
        </ul>
      </div>

      <div>
        <h4>Programmes</h4>
        <ul>
          <li><a href="services.html#strong">InsureStrong</a></li>
          <li><a href="services.html#prevent">InsurePrevent</a></li>
          <li><a href="services.html#reclaim">InsureReclaim</a></li>
          <li><a href="book.html">Book a scan</a></li>
          <li><a href="contact.html">Contact</a></li>
        </ul>
      </div>

      <div>
        <h4>Find the practice</h4>
        <ul>
          <li><a href="https://maps.google.com/?q=7+Malibongwe+Drive+EmedCentre+Randburg" rel="noopener noreferrer" target="_blank">${PRACTICE.address}</a></li>
          <li><a href="tel:${PRACTICE.phoneHref}">${PRACTICE.phone}</a></li>
          <li><a href="mailto:${PRACTICE.email}">${PRACTICE.email}</a></li>
          <li><a href="contact.html">${PRACTICE.hours}</a></li>
        </ul>
      </div>
    </div>

    <div class="foot-bottom">
      <p><strong style="color:#cdd9ec">Concept site.</strong> Designed and built by <a href="https://phuturedigital.co.za" rel="noopener noreferrer" target="_blank">Phuture Digital</a> as an independent redesign concept for InsureSPR Health. Not affiliated with or endorsed by the practice. Nothing on this site is medical advice — speak to a qualified healthcare professional.</p>
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
  if (a === -1 || b === -1) return null;
  return html.slice(0, a + start.length) + block + '\n' + html.slice(b);
}

const pages = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
let changed = 0;
let missing = 0;

for (const file of pages) {
  const path = join(ROOT, file);
  const original = await readFile(path, 'utf8');
  let html = original;

  for (const [name, block] of [
    ['banner', banner()],
    ['header', header(file)],
    ['footer', footer()],
  ]) {
    const next = swap(html, name, block);
    if (next === null) {
      console.warn(`skip ${file} — no ${name} markers`);
      missing++;
      continue;
    }
    html = next;
  }

  if (html !== original) {
    await writeFile(path, html);
    console.log(`ok   ${file}`);
    changed++;
  } else {
    console.log(`--   ${file} (already current)`);
  }
}

console.log(`\n${changed} page(s) updated${missing ? `, ${missing} marker block(s) missing` : ''}.`);
