/* Assert WCAG AA contrast for every text node inside a navy band.
 *
 *   node tools/contrast.mjs
 *
 * A dark band inverts the text colours inside it, and the failure mode is not
 * obvious by eye: pale-ground partner colours look fine on the pale ground
 * they were designed for, and become unreadable when a section around them
 * turns navy. Three real failures came out of this on first run:
 *
 *   --muted (#6b7a96) was 4.35:1 on white — under the AA floor for body text,
 *     on every card on every page, and nothing to do with the navy band. It is
 *     now #5d6a85, solved against the DARKEST ground it sits on (--ground-2),
 *     because a value that passes on white can still fail on a pale band.
 *   --cyan-ink is 3.19:1 on navy. It carries small text on pale grounds and
 *     needs the light partner inside a band.
 *   The statstrip's phone and email links landed at 1.5:1 — pale cyan on the
 *     WHITE card sitting on the navy, because a blanket `.band-ink a` rule
 *     reached into light cards it had no business repainting.
 *
 * Walks up for the first opaque background rather than assuming the band's,
 * which is what lets it catch that last case.
 */
import { loadPlaywright } from './load-playwright.mjs';

const { chromium } = loadPlaywright();
const b = await chromium.launch();
let fails = 0;
for (const pg of ['index','spr','xray','scanning','workforce','book']) {
  const p = await b.newPage({ viewport:{width:1440,height:900}, reducedMotion:'reduce' });
  await p.route('**/functions/v1/**', r=>r.abort()); await p.goto(`http://localhost:4321/${pg}.html`, { waitUntil:'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(1200);
  const bad = await p.evaluate(() => {
    const lum = (c) => { const [r,g,bl] = c.map(v => { v/=255; return v<=.03928? v/12.92 : Math.pow((v+.055)/1.055,2.4); });
      return .2126*r + .7152*g + .0722*bl; };
    const parse = (s) => (s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    /* Walk up for the first opaque background. */
    const bgOf = (el) => { let e = el;
      while (e) { const c = getComputedStyle(e).backgroundColor;
        const m = parse(c); const a = (c.match(/[\d.]+/g)||[])[3];
        if (m.length === 3 && a !== '0') return m; e = e.parentElement; }
      return [255,255,255]; };
    const out = [];
    document.querySelectorAll('.band-ink *').forEach(el => {
      if (!el.childNodes.length) return;
      const hasText = [...el.childNodes].some(n => n.nodeType===3 && n.textContent.trim().length>1);
      if (!hasText) return;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      const fg = parse(cs.color), bg = bgOf(el);
      if (fg.length<3) return;
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight)>=700;
      const large = size>=24 || (size>=18.66 && bold);
      const min = large?3:4.5;
      if (ratio < min) out.push({ el: el.tagName.toLowerCase()+'.'+String(el.className).split(' ')[0],
        ratio: Math.round(ratio*100)/100, min, size: Math.round(size),
        text: el.textContent.trim().slice(0,40) });
    });
    return out;
  });
  if (bad.length) { console.log(`\nFAIL ${pg}`); bad.forEach(x=>console.log(`   ${x.ratio} < ${x.min}  ${x.el} ${x.size}px  "${x.text}"`)); fails+=bad.length; }
  else console.log(`ok   ${pg}  all .band-ink text passes AA`);
  await p.close();
}
await b.close();
console.log(fails ? `\n${fails} contrast failure(s)` : '\nAll navy-band text passes WCAG AA');
