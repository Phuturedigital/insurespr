/* Render the redrawn mark at the sizes it actually has to survive.
 *
 * A logo that looks right at 400px routinely turns to mush at 16px — thin
 * strokes merge, small circles vanish, gradients flatten to a single muddy
 * value. So both files are rendered across the real range (favicon tab icon
 * through nav lockup through a large display use) on BOTH a light and a dark
 * ground, and reviewed as one sheet.
 *
 * Usage:  node tools/render-mark.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'sheets');
const { chromium } = loadPlaywright();

const mark = await readFile(join(ROOT, 'assets', 'mark.svg'), 'utf8');
const fav = await readFile(join(ROOT, 'assets', 'favicon.svg'), 'utf8');

const SIZES = [16, 24, 32, 48, 96, 180];

const row = (svg, label, bg, fg) => `
  <section style="background:${bg};color:${fg};padding:20px 24px">
    <div style="font:600 12px ui-monospace;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:14px">${label}</div>
    <div style="display:flex;align-items:flex-end;gap:28px">
      ${SIZES.map((s) => `
        <div style="text-align:center">
          <div style="height:${s}px;display:flex;align-items:center">${svg.replace('<svg', `<svg height="${s}" width="${s}"`)}</div>
          <div style="font:11px ui-monospace;opacity:.55;margin-top:8px">${s}px</div>
        </div>`).join('')}
    </div>
  </section>`;

const html = `<style>body{margin:0;font-family:system-ui}</style>
  ${row(mark, 'mark.svg on bone', '#FAF6EF', '#0E2140')}
  ${row(mark, 'mark.svg on ink', '#0E2140', '#FAF6EF')}
  ${row(fav, 'favicon.svg on bone', '#FAF6EF', '#0E2140')}
  ${row(fav, 'favicon.svg on white', '#FFFFFF', '#0E2140')}`;

await mkdir(OUT, { recursive: true });
const tmp = join(OUT, 'mark.html');
await writeFile(tmp, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
await page.goto(`file:///${tmp.replace(/\\/g, '/')}`);
await page.screenshot({ path: join(OUT, 'mark.png'), fullPage: true });
await browser.close();
console.log('tools/sheets/mark.png');
