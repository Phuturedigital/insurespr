/* Stamp the shared "More concepts by Phuture Digital" block into every concept
 * site in the network.
 *
 * Lives here rather than in a scratch directory because it has been lost and
 * re-authored once already. It stamps ALL sites, not just this one.
 *
 *   node tools/stamp-network.mjs           # dry run — reports, writes nothing
 *   node tools/stamp-network.mjs --write
 *   node tools/stamp-network.mjs --write --only insurespr
 *
 * IDEMPOTENT. Insertions are fenced; the fence is stripped before rewriting, so
 * re-running after a rebase is safe and wording changes propagate everywhere in
 * one pass. Adding a concept = add one row to CONCEPTS, re-run.
 *
 * ⚠️ CSS is written ONLY into sites that do not already have a pd-network CSS
 * block. The existing sites carry palettes hand-mapped to their own tokens;
 * regenerating those would risk a visual regression on live sites to achieve
 * nothing. Card markup is what actually changes when a concept is added.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'C:/Users/Acer';
const WRITE = process.argv.includes('--write');
const ONLY = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

/* Every concept in the network. `key` matches pd-concepts/<key>.webp. */
const CONCEPTS = [
  { key: 'khanya',    name: 'Khanya Dental Studio', sector: 'Dental practice',      url: 'https://khanya-concept.phuturedigital.co.za' },
  { key: 'hamba',     name: 'Hamba Freight',        sector: 'Last-mile logistics',  url: 'https://hamba-concept.phuturedigital.co.za' },
  { key: 'umsuka',    name: 'UMSUKA Collection',    sector: 'Boutique hospitality', url: 'https://umsuka-concept.phuturedigital.co.za' },
  { key: 'thatha',    name: 'THATHA',               sector: 'Micro-retail units',   url: 'https://thatha-concept.phuturedigital.co.za' },
  { key: 'africrest', name: 'Africrest',            sector: 'Built-to-rent property', url: 'https://africrest-concept.phuturedigital.co.za' },
  /* `name` and `sector` are interpolated straight into markup — write entities,
     not raw characters. A bare `&` renders fine and is still invalid HTML. */
  { key: 'insurespr', name: 'InsureSPR Health',     sector: 'Bone &amp; muscle health', url: 'https://insurespr-concept.phuturedigital.co.za' },
  { key: 'blueleaf',  name: 'Blue Leaf Ice',        sector: 'Ice supply &amp; delivery', url: 'https://blueleaf-concept.phuturedigital.co.za' },
];

/* Fallback disclaimer, used ONLY when a page has no pd-network block yet.
 *
 * ⚠️ If a page already carries one, its EXISTING disclaimer wins and is copied
 * through verbatim — see `existingMark()`. That is deliberate. These strings
 * were authored per site and are stronger and more specific than anything
 * regenerated from here: Khanya's cites HPCSA registration, Africrest's carries
 * the full "not affiliated with, endorsed by or connected to" reframing that
 * must never be reverted. Overwriting them from this file would be a silent
 * regression on live sites.
 *
 * These are NOT interchangeable: africrest and insurespr are aimed at real
 * companies and must say so; the rest are invented brands and must say that. */
const SITES = [
  /* Khanya's pages nest inside `.shell`, where every band is a rounded card
     floating on mist — full-bleed would read as foreign. It handles that in its
     own base `.pd-network` rule (border-radius + margin-top), NOT via a
     modifier class, so the markup here stays identical across all six sites. */
  { key: 'khanya', dir: 'khanya',
    mark: '<strong>Concept demo.</strong> Khanya Dental Studio is an invented brand, created by Phuture Digital to demonstrate design and build work. It is not a real practice and no service shown is offered.' },
  { key: 'hamba', dir: 'hamba',
    mark: '<strong>Concept demo.</strong> Hamba Freight is an invented brand, created by Phuture Digital to demonstrate design and build work. No deliveries are carried and every figure shown is illustrative.' },
  { key: 'umsuka', dir: 'umsuka',
    mark: '<strong>Concept demo.</strong> UMSUKA Collection is an invented brand, created by Phuture Digital to demonstrate design and build work. No property shown is available to book.' },
  { key: 'thatha', dir: 'thatha',
    mark: '<strong>Concept demo.</strong> THATHA is an invented brand, created by Phuture Digital to demonstrate design and build work. No units are manufactured or sold and every figure shown is illustrative.' },
  { key: 'africrest', dir: 'africrestresi-Pitch',
    mark: '<strong>Concept redesign.</strong> Africrest Properties is a real company. This is Phuture Digital&rsquo;s own take on their brand, built to demonstrate design and build work. It is not their official site and is not affiliated with them.' },
  { key: 'insurespr', dir: 'insurespr',
    mark: '<strong>Concept redesign.</strong> InsureSPR Health is a real practice. This is Phuture Digital&rsquo;s own take on their site, built to demonstrate design and build work. It is not their official site, is not affiliated with them, and nothing here is medical advice.' },
  { key: 'blueleaf', dir: 'blueleaf',
    mark: '<strong>Concept redesign.</strong> Blue Leaf Ice Company is a real business. This is Phuture Digital&rsquo;s own take on their site, built to demonstrate design and build work. It is not their official site, is not affiliated with them, and no order placed on it reaches anyone.' },
];

const card = (c) => `        <li class="pd-network-card">
          <a href="${c.url}">
            <img class="pd-network-thumb" src="/pd-concepts/${c.key}.webp" alt=""
                 width="640" height="400" loading="lazy" decoding="async">
            <span class="pd-network-body">
              <span class="pd-network-name">${c.name}</span>
              <span class="pd-network-sector">${c.sector}</span>
              <span class="pd-network-go">View concept &rarr;</span>
            </span>
          </a>
        </li>`;

/* Pull the disclaimer already on the page, so a re-stamp preserves authored
 * wording instead of overwriting it with this file's fallback. */
const MARK_RE = /<p class="pd-network-mark">([\s\S]*?)<\/p>/;
const existingMark = (html) => (html.match(MARK_RE) || [])[1] || null;

/* The reciprocal link home. Points at /portfolio rather than the bare domain:
 * every concept in this network is a case study there, in its own "Concept Work"
 * band alongside the client work, so it is the page that actually continues the
 * visit. The portfolio's own header carries the nav to the rest of the site, so
 * nothing is lost by being specific.
 *
 * `www`, NOT the apex — phuturedigital.co.za 307-redirects to www, and there is
 * no reason to spend a redirect on 40 pages' worth of outbound links.
 *
 * ⚠️ Explanations live here, not inside the emitted markup: this block is served
 * on ~40 public pages, and HTML comments ship with it. */
const PORTFOLIO_URL = 'https://www.phuturedigital.co.za/portfolio';

const block = (site, mark) => `<!-- pd-network:start -->
<section class="pd-network" aria-labelledby="pd-network-title">
  <div class="pd-network-inner">
    <p class="pd-network-eyebrow">Phuture Digital &middot; Concept work</p>
    <h2 class="pd-network-title" id="pd-network-title">More concepts by Phuture Digital</h2>
    <p class="pd-network-lede">Each of these is a complete site we designed and built to show what the finished thing looks like before anyone commits. Have a look at the others.</p>
    <ul class="pd-network-grid">
${CONCEPTS.filter((c) => c.key !== site.key).map(card).join('\n')}
    </ul>
    <div class="pd-network-cta">
      <p>Want a site like this for your business?</p>
      <a class="pd-network-btn" href="mailto:hello@phuturedigital.co.za">hello@phuturedigital.co.za</a>
      <a class="pd-network-link" href="${PORTFOLIO_URL}" rel="noopener">See the full portfolio &rarr;</a>
    </div>
    <p class="pd-network-mark">${mark}</p>
  </div>
</section>
<!-- pd-network:end -->`;

/* InsureSPR's palette, mapped onto its own tokens: --ink ground, the footer's
 * #7fe0ff accent, --ink-2 cards, Fraunces for the heading. `font-family:
 * inherit` on the block is what makes one markup read as native on six sites. */
const CSS_INSURESPR = `
/* pd-network:start */
/* Shared cross-link block across the Phuture Digital concept sites. Same markup
   and rhythm everywhere; the palette below maps this site's own tokens onto it.
   Appended at the END of the file so every pd-network* class outranks the bare
   a{} p{} ul{} resets above. Keep that ordering. */
.pd-network {
  background: var(--ink);
  color: #a9bcd8;
  font-family: inherit;
  padding: clamp(34px, 4.4vw, 52px) clamp(20px, 3.6vw, 48px);
}
.pd-network-inner { max-width: 1080px; margin: 0 auto; }
.pd-network-eyebrow {
  font-size: 10.5px; letter-spacing: .15em; text-transform: uppercase;
  color: #7fe0ff; font-weight: 700; margin: 0 0 12px;
}
.pd-network-title {
  font-family: Fraunces, Georgia, serif;
  font-size: clamp(21px, 2.5vw, 27px); line-height: 1.15; letter-spacing: -.015em;
  color: #ffffff; font-weight: 600; margin: 0 0 10px; text-wrap: balance;
}
.pd-network-lede {
  font-size: 14.5px; line-height: 1.6; max-width: 56ch;
  color: #a9bcd8; margin: 0 0 26px;
}
.pd-network-grid {
  list-style: none; margin: 0 0 28px; padding: 0;
  /* 150px min keeps all five on one row on desktop (auto-fit collapses empty
     tracks), goes 2-up on phones instead of a very long stack, and avoids the
     awkward wrap a larger min produces around tablet width. */
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;
}
.pd-network-card { margin: 0; }
.pd-network-card a {
  display: flex; flex-direction: column; height: 100%;
  padding: 0; overflow: hidden; text-decoration: none;
  background: var(--ink-2); border: 1px solid rgb(255 255 255 / .14); border-radius: 12px;
  transition: border-color .18s ease, transform .18s ease, background .18s ease;
}
.pd-network-card a:hover,
.pd-network-card a:focus-visible {
  border-color: #7fe0ff; background: #1d3d70; transform: translateY(-2px);
}
.pd-network-card a:focus-visible { outline: 2px solid #7fe0ff; outline-offset: 2px; }
/* height:auto is required, not optional: the width/height attributes on the
   <img> would otherwise pin the height and defeat aspect-ratio. */
.pd-network-thumb {
  display: block; width: 100%; height: auto;
  aspect-ratio: 16 / 10; object-fit: cover; object-position: top center;
  background: #1d3d70; border-bottom: 1px solid rgb(255 255 255 / .14);
}
.pd-network-card a:hover .pd-network-thumb { opacity: .92; }
.pd-network-body { display: flex; flex-direction: column; gap: 3px; flex: 1; padding: 13px 15px 14px; min-width: 0; }
.pd-network-name { color: #ffffff; font-size: 14.5px; font-weight: 650; line-height: 1.25; }
.pd-network-sector { color: #a9bcd8; font-size: 12px; line-height: 1.4; }
.pd-network-go {
  color: #7fe0ff; font-size: 11px; letter-spacing: .05em; font-weight: 650;
  margin-top: auto; padding-top: 11px;
}
.pd-network-cta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px;
  padding-top: 22px; border-top: 1px solid rgb(255 255 255 / .14);
}
.pd-network-cta p { margin: 0 auto 0 0; font-size: 14px; color: #ffffff; font-weight: 600; max-width: none; }
.pd-network-btn {
  background: #7fe0ff; color: var(--ink); text-decoration: none;
  padding: 10px 18px; border-radius: 12px; font-size: 13.5px; font-weight: 650;
}
.pd-network-btn:hover { opacity: .9; }
.pd-network-link {
  color: #a9bcd8; text-decoration: none; font-size: 13px;
  border-bottom: 1px solid rgb(255 255 255 / .14); padding-bottom: 2px;
}
.pd-network-link:hover { color: #ffffff; }
.pd-network-mark {
  margin: 22px 0 0; padding-top: 16px; border-top: 1px solid rgb(255 255 255 / .14);
  font-size: 11.5px; line-height: 1.55; color: #a9bcd8; max-width: 72ch;
}
.pd-network-mark strong { color: #ffffff; font-weight: 650; }
@media (max-width: 560px) {
  .pd-network-cta p { margin-right: 0; width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .pd-network-card a { transition: none; }
  .pd-network-card a:hover { transform: none; }
}
/* pd-network:end */
`;

const FENCE_HTML = /\n?<!-- pd-network:start -->[\s\S]*?<!-- pd-network:end -->\n?/g;

let touched = 0;
for (const site of SITES) {
  if (ONLY && site.key !== ONLY) continue;
  const dir = join(ROOT, site.dir);
  if (!existsSync(dir)) { console.log(`SKIP  ${site.key.padEnd(10)} not cloned at ${dir}`); continue; }

  const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));
  let n = 0;
  let kept = 0;
  for (const page of pages) {
    const path = join(dir, page);
    let html = readFileSync(path, 'utf8');
    if (!/<footer/i.test(html)) continue;          // not a full page
    const mark = existingMark(html);                // authored wording wins
    if (mark) kept++;
    html = html.replace(FENCE_HTML, '\n');          // strip old fence first
    /* Insert ABOVE the chrome fence where one exists.
     *
     * insurespr templates its banner/header/footer with tools/stamp-chrome.mjs,
     * which REPLACES everything between `footer:start` and `footer:end`. A block
     * placed just before `<footer` lands INSIDE that region and is silently
     * destroyed the next time the chrome is stamped. The other five sites
     * hand-maintain their footers and have no such fence, which is why the
     * plain `<footer` anchor was safe there. */
    const fence = html.search(/<!--\s*footer:start\s*-->/i);
    const at = fence !== -1 ? fence : html.search(/<footer/i);
    html = `${html.slice(0, at)}${block(site, mark || site.mark)}\n${html.slice(at)}`;
    if (WRITE) writeFileSync(path, html);
    n++;
  }

  // CSS: only for a site that has none. See the warning at the top of the file.
  const cssPath = join(dir, 'styles.css');
  let cssNote = 'css already present, untouched';
  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, 'utf8');
    if (!css.includes('pd-network:start')) {
      if (site.key !== 'insurespr') {
        cssNote = '⚠️ NO CSS BLOCK and no palette defined — needs hand-mapping';
      } else {
        if (WRITE) writeFileSync(cssPath, css.replace(/\s*$/, '\n') + CSS_INSURESPR);
        cssNote = 'css appended';
      }
    }
  }
  const markNote = kept === n ? 'disclaimers preserved' : `⚠️ ${n - kept} page(s) used the FALLBACK disclaimer`;
  console.log(`${WRITE ? 'WROTE' : 'DRY  '} ${site.key.padEnd(10)} ${String(n).padStart(2)} pages · ${markNote} · ${cssNote}`);
  touched += n;
}
console.log(`\n${WRITE ? 'Stamped' : 'Would stamp'} ${touched} pages across ${ONLY ? 1 : SITES.length} site(s).`);
if (!WRITE) console.log('Dry run — pass --write to apply.');
