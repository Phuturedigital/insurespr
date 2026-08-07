/* Generate the decorative tiles that sit between the programme cards.
 *
 *   node tools/make-tiles.mjs
 *
 * The reference layout fills these slots with stock DNA-helix renders. Stock
 * filler is exactly the criticism this rebuild is answering, so ours are drawn
 * instead — from the one shape the brand already owns: the column of vertebrae
 * dots inside the practice's own logo mark.
 *
 * Two tiles, one idea seen twice:
 *   column  — the vertebral rail itself, dots swelling toward the centre
 *   density — the same dots as a field, dense at one end and sparse at the
 *             other, which is what bone density loss actually looks like
 *
 * Deterministic: no randomness, so re-running produces byte-identical files and
 * the diff stays empty unless the drawing genuinely changed.
 */
import { writeFileSync } from 'node:fs';

const W = 600, H = 440;
const CYAN = '#00aeef', INDIGO = '#2e3192';

const open = (extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${CYAN}"/><stop offset="1" stop-color="${INDIGO}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#e4ecf6"/>${extra}`;

/* ---- tile 1: the vertebral column ---------------------------------------- */
/* A single curved rail of discs, largest at the lumbar swell, tapering both
   ways — the same read as the mark, scaled up and cropped. */
function column() {
  const cx = W / 2;
  let out = '';
  const N = 17;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const y = 40 + t * (H - 80);
    // Gentle S-curve, mirroring the spine in the logo.
    const x = cx + Math.sin(t * Math.PI * 1.15 - 0.35) * 46;
    // Discs swell toward the lower-middle, as vertebrae do.
    const r = 5 + Math.sin(t * Math.PI) * 11;
    const op = (0.16 + Math.sin(t * Math.PI) * 0.5).toFixed(3);
    out += `\n  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#g)" opacity="${op}"/>`;
  }
  // The soft body line the discs sit inside.
  out += `\n  <path d="M ${cx - 96} 24 C ${cx - 54} ${H * 0.32}, ${cx - 62} ${H * 0.62}, ${cx - 104} ${H - 18}" stroke="url(#g)" stroke-width="2" opacity=".28" stroke-linecap="round"/>`;
  out += `\n  <path d="M ${cx + 92} 24 C ${cx + 48} ${H * 0.34}, ${cx + 58} ${H * 0.64}, ${cx + 100} ${H - 18}" stroke="url(#g)" stroke-width="2" opacity=".22" stroke-linecap="round"/>`;
  return open() + out + '\n</svg>\n';
}

/* ---- tile 2: the density field ------------------------------------------- */
/* Dots on a fixed lattice, thinning left to right. Bone density loss made
   literal — the same idea the scan measures. */
function density() {
  const cols = 15, rows = 11;
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 34 + (c * (W - 68)) / (cols - 1);
      const y = 32 + (r * (H - 64)) / (rows - 1);
      const t = c / (cols - 1);
      // Stagger alternate rows so the field reads organic, not like a grid.
      const dx = r % 2 ? (W - 68) / (cols - 1) / 2 : 0;
      if (x + dx > W - 24) continue;
      const rad = (6.5 * (1 - t) + 1.4).toFixed(2);
      const op = (0.55 * (1 - t) + 0.05).toFixed(3);
      out += `\n  <circle cx="${(x + dx).toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="url(#g)" opacity="${op}"/>`;
    }
  }
  return open() + out + '\n</svg>\n';
}

for (const [name, svg] of [['tile-column', column()], ['tile-density', density()]]) {
  writeFileSync(`assets/${name}.svg`, svg);
  console.log(`  assets/${name}.svg  ${(svg.length / 1024).toFixed(1)} KB`);
}
