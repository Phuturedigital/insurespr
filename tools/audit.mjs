/* Whole-site health check. Everything here is measured, not eyeballed.
 *   node tools/audit.mjs
 */
import { loadPlaywright } from './load-playwright.mjs';
const { chromium } = loadPlaywright();

const PAGES = [
  'index.html',
  'spr.html',
  'about.html',
  'xray.html',
  'primary-healthcare-x-ray.html',
  'visa-chest-x-ray.html',
  'workforce.html',
  'workplace-medicals.html',
  'scanning.html',
  'dxa-bone-density.html',
  'dxa-body-composition.html',
  'osteoporosis-care.html',
  'book.html',
  'contact.html',
  'privacy.html',
  'booking-confirmation.html',
  'manage-booking.html',
  '404.html',
];
const b = await chromium.launch();
let fails = 0;
const note = (m) => { console.log('  ' + m); if (m.startsWith('🚨')) fails++; };
const localOrigin = process.argv[2] || process.env.AUDIT_BASE_URL || 'http://localhost:4321';
const apiOrigin = 'https://ffdmmxffzewqiacsuvhr.supabase.co';
const apiBase = `${apiOrigin}/functions/v1/insurespr-api`;

/*
 * Production intentionally accepts only the two official website origins.
 * Keep this render audit deterministic and offline-safe by supplying the same
 * fail-closed public configuration that a pending release would expose. This
 * validates the gated form UI without weakening production CORS or writing to
 * the production project.
 */
const auditConfig = {
  practice: {
  privacy_notice_version: 'pending-approval',
  },
  categories: [],
  services: [],
  intake_ready: false,
  turnstile_site_key: null,
};

for (const pg of PAGES) {
  const name = pg.replace('.html', '');
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  p.setDefaultTimeout(10_000);
  await p.route(`${apiBase}/services`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': localOrigin,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(auditConfig),
    });
  });
  await p.route(`${apiBase}/events`, async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': localOrigin,
      'Access-Control-Allow-Headers': 'content-type, x-client-version',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ recorded: true }) });
  });
  const errs = [], reqFail = [], advisory = [];
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const source = m.location().url || '';
    if (source && !source.startsWith(localOrigin) && !source.startsWith(apiOrigin)) {
      advisory.push(`external-console:${m.text().slice(0, 60)}`);
      return;
    }
    errs.push(m.text().slice(0, 90));
  });
  p.on('requestfailed', (r) => {
    const failure = r.failure();
    const label = `${r.url().split('/').pop()}:${failure?.errorText || 'unknown'}`;
    const url = new URL(r.url());
    if (url.origin !== localOrigin || url.pathname.endsWith('/events')) {
      advisory.push(label);
      return;
    }
    reqFail.push(label);
  });

  await p.goto(`${localOrigin}/${pg}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  if (pg === 'xray.html' || pg === 'workforce.html') {
    await p.waitForResponse((response) => response.url().endsWith('/events'), { timeout: 15_000 })
      .catch(() => { /* A persisted keepalive may outlive this diagnostic page. */ });
  }
  await p.waitForTimeout(1_200);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(900);

  const r = await p.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    return {
      brokenImg: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      noAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
      h1: document.querySelectorAll('h1').length,
      emptyLinks: [...document.querySelectorAll('a')].filter((a) => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img')).length,
      btnNoName: [...document.querySelectorAll('button')].filter((x) => !x.textContent.trim() && !x.getAttribute('aria-label')).length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      /* Tap targets. WCAG 2.5.8 exempts links that sit INSIDE a sentence —
         their size is constrained by the line-height of the text around them,
         so demanding 44px there would mean breaking the paragraph. Only
         standalone controls are judged. */
      smallTaps: [...document.querySelectorAll('a,button')].filter((e) => {
        const q = e.getBoundingClientRect();
        if (!q.width) return false;
        const p = e.parentElement;
        const inline = p && getComputedStyle(e).display.startsWith('inline') &&
          p.textContent.trim().length > e.textContent.trim().length + 4;
        if (inline) return false;
        return q.height < 30 || q.width < 30;
      }).length,
      title: document.title,
      lang: document.documentElement.lang,
    };
  });

  const bad = [];
  if (errs.length) bad.push(`console:${errs.length} (${errs[0]})`);
  if (reqFail.length) bad.push(`failed-req:${reqFail.join(',')}`);
  if (r.brokenImg.length) bad.push(`broken-img:${r.brokenImg.join(',')}`);
  if (r.noAlt) bad.push(`img-no-alt:${r.noAlt}`);
  if (r.h1 !== 1) bad.push(`h1-count:${r.h1}`);
  if (r.emptyLinks) bad.push(`unnamed-links:${r.emptyLinks}`);
  if (r.btnNoName) bad.push(`unnamed-buttons:${r.btnNoName}`);
  if (r.horizontalOverflow) bad.push('horizontal-overflow');
  if (r.smallTaps) bad.push(`small-tap-targets:${r.smallTaps}`);
  if (!r.lang) bad.push('no-lang');

  const suffix = advisory.length ? ` (${advisory.length} non-blocking advisory)` : '';
  note(bad.length ? `🚨 ${name.padEnd(11)} ${bad.join(' · ')}` : `✓  ${name.padEnd(11)} clean${suffix}`);
  await p.close();
}
console.log(fails === 0 ? '\n  All pages clean.' : `\n  ${fails} page(s) with findings.`);
await b.close();
process.exitCode = fails === 0 ? 0 : 1;
