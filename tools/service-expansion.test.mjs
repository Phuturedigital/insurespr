import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://www.insuresprhealth.co.za';

const newServices = [
  ['musculoskeletal-x-ray', 'xray.html'],
  ['chest-x-ray', 'xray.html'],
  ['orthopaedic-follow-up-x-ray', 'xray.html'],
  ['workplace-chest-x-ray', 'workforce.html'],
  ['runner-athlete-bone-health', 'scanning.html'],
  ['menopause-bone-health', 'scanning.html'],
  ['treatment-related-bone-health', 'scanning.html'],
  ['post-fracture-bone-health', 'scanning.html'],
  ['body-composition-progress', 'scanning.html'],
  ['long-term-condition-bone-health', 'scanning.html'],
];

const text = (file) => readFileSync(join(ROOT, file), 'utf8');
const sitemap = text('sitemap.xml');
const home = text('index.html');

for (const [slug, hub] of newServices) {
  const file = `${slug}.html`;
  assert.ok(existsSync(join(ROOT, file)), `${file} must exist`);

  const html = text(file);
  const canonical = `${ORIGIN}/${slug}`;

  assert.match(html, new RegExp(`<body[^>]+data-service-slug=["']${slug}["']`), `${file} must expose its catalogue slug`);
  assert.ok(html.includes(`rel="canonical" href="${canonical}"`), `${file} must have the canonical URL`);
  assert.ok(html.includes(`property="og:url" content="${canonical}"`), `${file} must have the matching Open Graph URL`);
  assert.ok(html.includes('name="twitter:card"'), `${file} must have Twitter metadata`);
  const primaryRoute = slug === 'workplace-chest-x-ray'
    ? 'workforce.html#request-quote'
    : `book.html?service=${slug}`;
  assert.ok(html.includes(primaryRoute), `${file} must route its primary request to the matching journey`);
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, `${file} must contain one H1`);
  assert.equal((html.match(/<dl class="service-answers">/g) || []).length, 1, `${file} must contain one practical-answer list`);
  assert.ok((html.match(/<dt>/g) || []).length >= 11, `${file} must answer at least 11 practical questions`);
  assert.doesNotMatch(html, /(?:083\s*450\s*7861|tel:|wa\.me\/)/i, `${file} must preserve the current email-only contact state`);

  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, `${file} must include JSON-LD`);
  for (const [, source] of scripts) JSON.parse(source);

  for (const [, source] of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    if (!source.startsWith('assets/')) continue;
    assert.ok(existsSync(join(ROOT, source)), `${file} references missing image ${source}`);
  }

  assert.ok(sitemap.includes(`<loc>${canonical}</loc>`), `${file} must be in sitemap.xml`);
  assert.ok(text(hub).includes(`href="${file}"`), `${hub} must link to ${file}`);
}

for (const slug of newServices.filter(([, hub]) => hub === 'scanning.html').map(([slug]) => slug)) {
  assert.ok(home.includes(`href="${slug}.html"`), `homepage pathway rail must expose ${slug}`);
}

const visa = text('visa-chest-x-ray.html');
const xray = text('xray.html');
const primary = text('primary-healthcare-x-ray.html');
const athlete = text('runner-athlete-bone-health.html');
const bookingScript = text('production.js');

assert.match(visa, /not a South African visa requirement/i, 'administrative page must state the current South African position');
assert.ok(visa.includes('2024 Immigration Regulations amendment'), 'administrative page must cite the 2024 amendment');
assert.ok(visa.includes('DHA Directive 10 of 2026'), 'administrative page must cite the 2026 waiver');

for (const [label, html] of [['visa page', visa], ['X-Ray hub', xray], ['general X-Ray page', primary]]) {
  assert.doesNotMatch(html, /walk-ins are welcome/i, `${label} must not preserve the legacy walk-in claim`);
  assert.doesNotMatch(html, /no referral required/i, `${label} must not advertise referral-free exposure`);
  assert.doesNotMatch(html, /TB-free|guaranteed TB|diagnoses TB by X-ray/i, `${label} must not overclaim chest X-ray capability`);
}

assert.match(xray, /written, signed clinical request/i, 'X-Ray hub must explain the request requirement');
assert.match(primary, /written, signed request/i, 'general X-Ray page must explain the request requirement');
for (const route of ['musculoskeletal-x-ray.html', 'dxa-bone-density.html', 'body-composition-progress.html']) {
  assert.ok(athlete.includes(`href="${route}"`), `athlete pathway must visibly separate and link ${route}`);
}
for (const label of ['X-Ray examinations', 'DXA scans & bone services', 'Choose by health or performance need']) {
  assert.ok(bookingScript.includes(label), `booking selector must group the expanded catalogue under ${label}`);
}

for (const file of ['workforce.html', 'manage-booking.html']) {
  const html = text(file);
  for (const [, , block] of html.matchAll(/<(p|span)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const emailActions = [...block.matchAll(/href="mailto:([^"]+)"/g)].map((match) => match[1].toLowerCase());
    assert.equal(
      emailActions.length,
      new Set(emailActions).size,
      `${file} must not repeat the same email action inside one message block`
    );
  }
}

console.log(`Service expansion contract passed for ${newServices.length} new Johannesburg routes.`);
