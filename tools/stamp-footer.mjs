/* Maintain ONE footer across every production page.
 *
 *   node tools/stamp-footer.mjs [--write]      (dry-run by default)
 *
 * WHY THIS EXISTS
 * ---------------
 * The production build inherited `tools/stamp-chrome.mjs` from the concept
 * site but dropped its `<!-- footer:start -->` / `<!-- footer:end -->` markers,
 * so nothing was templating the footer any more. Eleven hand-maintained
 * footers then drifted exactly the way that script's own header warned they
 * would: index.html and spr.html kept the full four-column footer, and the
 * other nine silently degraded to a one-line legal strip — no Services list,
 * no address or direct contact route.
 *
 * That is worst on precisely the pages where it matters most. A visitor who
 * lands on xray.html from search and scrolls to the bottom got a copyright
 * line and no way to reach Contact, Booking or the practice's email.
 *
 * This script replaces the whole <footer class="foot">...</footer> element,
 * which is a uniquely-identifiable, well-bounded node — not an offset pair
 * computed from chained indexOf calls, which has silently duplicated a chrome
 * block on this network before.
 *
 * Every value below is the practice's own published detail. Nothing invented.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The production surface, as listed in vercel.json / sitemap.xml. The four
   concept-era pages (brand, learn, programmes, scan) are excluded from the
   deploy by .vercelignore and are deliberately left alone. */
const PAGES = [
  'index.html', 'spr.html', 'about.html', 'xray.html', 'scanning.html', 'workforce.html',
  'book.html', 'contact.html', 'privacy.html',
  'booking-confirmation.html', 'manage-booking.html', '404.html',
  'dxa-body-composition.html', 'dxa-bone-density.html',
  'osteoporosis-care.html', 'primary-healthcare-x-ray.html',
  'visa-chest-x-ray.html', 'workplace-medicals.html',
  'musculoskeletal-x-ray.html', 'chest-x-ray.html',
  'orthopaedic-follow-up-x-ray.html', 'workplace-chest-x-ray.html',
  'runner-athlete-bone-health.html', 'menopause-bone-health.html',
  'treatment-related-bone-health.html', 'post-fracture-bone-health.html',
  'body-composition-progress.html', 'long-term-condition-bone-health.html',
];

const PRACTICE = {
  bookingContact: 'Motselisi Mosiana',
  phoneDisplay: '083 450 7861',
  phoneE164: '+27834507861',
  whatsappE164: '27834507861',
  email: 'motselisi@bonevc.co.za',
  address: '7 Malibongwe Drive, EmedCentre, Randburg',
  hours: 'Monday–Friday, 08:00–17:00',
  maps: 'https://maps.google.com/?q=7+Malibongwe+Drive+EmedCentre+Randburg',
};

const COLUMNS = [
  ['Services', [
    ['spr.html', 'The SPR approach'],
    ['xray.html', 'X-Ray'],
    ['scanning.html', 'Body &amp; bone scans'],
    ['workforce.html', 'Workforce medicals'],
  ]],
  ['Information', [
    ['about.html', 'About the owner'],
    ['book.html', 'Request a booking'],
    ['contact.html', 'Contact &amp; directions'],
    ['privacy.html', 'Privacy notice'],
  ]],
];

const col = ([heading, links]) =>
  `<div><h4>${heading}</h4><ul>` +
  links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('') +
  `</ul></div>`;

const FOOTER =
  '<footer class="foot"><div class="wrap foot-in"><div class="foot-top">' +
  '<div><a class="brand" href="index.html">' +
  '<img src="assets/mark-light.svg" alt="" width="34" height="34">' +
  '<span><span class="brand-name">Insure<span>SPR</span></span>' +
  '<span class="brand-sub">Precision Healthcare</span></span></a>' +
  '<p class="foot-blurb">X-Ray, Medicals and Bone Density at EmedCentre in Randburg.</p></div>' +
  COLUMNS.map(col).join('') +
  '<div><h4>Find the practice</h4><ul>' +
  `<li><a href="${PRACTICE.maps}" rel="noopener" target="_blank">${PRACTICE.address}</a></li>` +
  `<li>Bookings: ${PRACTICE.bookingContact}</li>` +
  `<li><a href="tel:${PRACTICE.phoneE164}" data-track="call_clicked">${PRACTICE.phoneDisplay}</a></li>` +
  `<li><a href="https://wa.me/${PRACTICE.whatsappE164}?text=Hello%20InsureSPR%2C%20I%20would%20like%20help%20with%20a%20booking." rel="noopener" target="_blank" data-track="whatsapp_clicked">WhatsApp bookings</a></li>` +
  `<li><a href="mailto:${PRACTICE.email}" data-track="email_clicked">${PRACTICE.email}</a></li>` +
  `<li>${PRACTICE.hours}</li>` +
  '</ul></div></div>' +
  '<div class="foot-bottom">' +
  '<p><strong>InsureSPR Precision Healthcare.</strong> This website provides ' +
  'service-navigation information and does not provide medical advice.</p>' +
  '<p><a href="privacy.html">Privacy</a> · © 2026 InsureSPR Precision Healthcare</p>' +
  '</div></div></footer>';

const write = process.argv.includes('--write');
let changed = 0;
let missing = 0;

for (const page of PAGES) {
  const path = join(ROOT, page);
  let html;
  try {
    html = await readFile(path, 'utf8');
  } catch {
    console.log(`  skip    ${page.padEnd(24)} (not present)`);
    continue;
  }

  const start = html.indexOf('<footer class="foot">');
  const end = html.indexOf('</footer>', start);

  /* booking-confirmation, manage-booking and 404 shipped with NO footer node
     at all. That is worst on booking-confirmation: it is where someone lands
     immediately after requesting an appointment, and it offered no route to
     the practice's contact details. Insert after </main> rather than skipping. */
  if (start === -1 || end === -1) {
    const anchor = html.lastIndexOf('</main>');
    if (anchor === -1) {
      console.log(`  MISSING ${page.padEnd(24)} no <footer> and no </main> to anchor to`);
      missing++;
      continue;
    }
    console.log(`  ${write ? 'INSERT ' : 'would  '} ${page.padEnd(24)} none -> full`);
    changed++;
    if (write) {
      const at = anchor + '</main>'.length;
      await writeFile(path, html.slice(0, at) + FOOTER + html.slice(at));
    }
    continue;
  }

  const current = html.slice(start, end + '</footer>'.length);
  if (current === FOOTER) {
    console.log(`  same    ${page}`);
    continue;
  }

  const kind = current.includes('foot-top') ? 'full' : 'mini';
  console.log(`  ${write ? 'WRITE  ' : 'would  '} ${page.padEnd(24)} ${kind} -> full`);
  changed++;

  if (write) {
    await writeFile(path, html.slice(0, start) + FOOTER + html.slice(end + '</footer>'.length));
  }
}

console.log(
  `\n${changed} page(s) ${write ? 'rewritten' : 'would change'}` +
  (missing ? `, ${missing} with no footer element` : '') +
  (write ? '' : '  — re-run with --write to apply'),
);
process.exit(missing ? 1 : 0);
