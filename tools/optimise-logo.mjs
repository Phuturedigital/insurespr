/* Turn the supplied brand SVGs into web-weight assets.
 *
 *   node tools/optimise-logo.mjs
 *
 * WHY THIS EXISTS
 * The supplied files are genuine vector (no <text>, no embedded rasters — a
 * first for this network), but the exporter flattened each linear gradient into
 * ~202 discrete <stop>s. That is 62 of the mark's 63KB and 90 of the lockup's
 * 91KB, for a gradient that is a plain two-colour ramp.
 *
 * Verified linear before collapsing: the middle stop is rgb(21,113,193) and a
 * straight blend of the endpoints is rgb(23,112,193) — inside 2/255. So two
 * stops reproduce it, and the file drops ~97%.
 *
 * AUTHORITATIVE BRAND COLOURS, read off the vector rather than sampled from a
 * raster (which is what the first pass had to do):
 *   gradient start  #00AEEF   (Pantone Process Cyan)
 *   gradient end    #2E3192
 *   wordmark        #004AAD
 *   figure          #F7F7F7
 *
 * Emits light-ground and dark-ground variants. The dark variant is not
 * optional: the wordmark is a hardcoded #004AAD and the gradient's deep end is
 * #2E3192, both of which sit a shade off the --ink navy and disappear on it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOWNLOADS_ROOT = join(homedir(), 'Downloads');
const SRC_LOCKUP = join(DOWNLOADS_ROOT, 'Motselisi Mosiana.svg');
const SRC_MARK = join(DOWNLOADS_ROOT, 'Motselisi Mosiana (1).svg');

const BRAND = { start: '#00AEEF', end: '#2E3192', word: '#004AAD', figure: '#F7F7F7' };
/* Dark-ground ramp: keep the cyan identity but lift the deep end off the navy
   so the lower third of the disc does not vanish into the background. */
const DARK = { start: '#7FE0FF', end: '#0072C6' };

/* Replace every gradient's stop list with two stops, preserving the opening tag
   (its gradientTransform and coordinates are what position the ramp). */
function collapseStops(svg, start, end) {
  return svg.replace(
    /(<linearGradient[^>]*>)([\s\S]*?)(<\/linearGradient>)/g,
    (_m, open, _stops, close) =>
      `${open}<stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/>${close}`,
  );
}

/* The exporter writes every coordinate to 6 decimal places ("0.316406",
   "79.914062"), which is 60 of the lockup's 71KB after the gradients are dealt
   with. On a 300-unit viewBox drawn at ~185px, one unit is well under a pixel,
   so 2dp is already finer than the display grid — the error ceiling is
   0.01/300 = 0.003%. Trailing zeros and a leading "0." are dropped too, since
   ".5" is valid path syntax and one byte shorter. */
const round = (svg, dp = 2) =>
  svg.replace(/\sd="([^"]*)"/g, (_m, d) => {
    const tight = d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return n;
      let s = v.toFixed(dp).replace(/\.?0+$/, '');
      if (s === '' || s === '-') s = '0';
      return s.replace(/^(-?)0\./, '$1.');
    });
    return ` d="${tight}"`;
  });

const strip = (svg) =>
  round(
    svg
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim(),
  );

/* Give the file an accessible name. These are decorative beside a text brand
   name in the header, but the standalone mark is used alone in places. */
function titled(svg, label) {
  return svg.replace(
    /<svg([^>]*)>/,
    `<svg$1 role="img" aria-label="${label}"><title>${label}</title>`,
  );
}

const out = [];

// ---- mark, light ground -----------------------------------------------------
let mark = strip(readFileSync(SRC_MARK, 'utf8'));
out.push(['assets/mark.svg', titled(collapseStops(mark, BRAND.start, BRAND.end), 'InsureSPR Health')]);

// ---- mark, dark ground ------------------------------------------------------
out.push(['assets/mark-light.svg', titled(collapseStops(mark, DARK.start, DARK.end), 'InsureSPR Health')]);

// ---- lockup, light ground ---------------------------------------------------
let lock = strip(readFileSync(SRC_LOCKUP, 'utf8'));
out.push(['assets/lockup.svg', titled(collapseStops(lock, BRAND.start, BRAND.end), 'InsureSPR — Precision Healthcare')]);

// ---- lockup, dark ground ----------------------------------------------------
// Recolour the wordmark to white as well; #004AAD on navy is unreadable.
const lockDark = collapseStops(lock, DARK.start, DARK.end)
  .replace(new RegExp(BRAND.word, 'gi'), '#FFFFFF');
out.push(['assets/lockup-light.svg', titled(lockDark, 'InsureSPR — Precision Healthcare')]);

for (const [relativePath, svg] of out) {
  writeFileSync(join(REPO_ROOT, relativePath), svg + '\n');
  console.log(`${relativePath.padEnd(28)} ${(svg.length / 1024).toFixed(1)} KB`);
}
