/* Whole-site health check. Everything here is measured, not eyeballed.
 *   node tools/audit.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire('file:///C:/Users/Acer/thatha/');
const { chromium } = require('playwright');

const PAGES = ['', 'programmes', 'scan', 'about', 'learn', 'book', 'contact', 'brand'];
const b = await chromium.launch();
let fails = 0;
const note = (m) => { console.log('  ' + m); if (m.startsWith('🚨')) fails++; };

for (const pg of PAGES) {
  const name = pg || 'index';
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errs = [], reqFail = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
  p.on('requestfailed', (r) => reqFail.push(r.url().split('/').pop()));

  await p.goto(`http://localhost:4321/${pg}`, { waitUntil: 'networkidle' });
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
  if (r.smallTaps) bad.push(`small-tap-targets:${r.smallTaps}`);
  if (!r.lang) bad.push('no-lang');

  note(bad.length ? `🚨 ${name.padEnd(11)} ${bad.join(' · ')}` : `✓  ${name.padEnd(11)} clean`);
  await p.close();
}
console.log(fails === 0 ? '\n  All pages clean.' : `\n  ${fails} page(s) with findings.`);
await b.close();
