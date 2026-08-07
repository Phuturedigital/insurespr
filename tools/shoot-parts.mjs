/* Screenshot individual sections at full resolution.
 *
 * A full-page capture of a long page shrinks to a thumbnail strip that is
 * useless for judging a scrim, a type size or a crop. This grabs named
 * elements at their real pixel size instead.
 *
 * Usage:  node tools/shoot-parts.mjs index.html ".hero" ".band"
 *         node tools/shoot-parts.mjs index.html            (common sections)
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'shots');
const require = createRequire('file:///C:/Users/Acer/thatha/');
const { chromium } = require('playwright');

const [file = 'index.html', ...sel] = process.argv.slice(2);
const selectors = sel.length ? sel : ['.hero', '.band'];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
/* reducedMotion settles every scroll-reveal immediately, so a section can be
   captured without walking the page down first. */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await page.goto(pathToFileURL(join(ROOT, file)).href, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

for (const s of selectors) {
  const nodes = await page.$$(s);
  for (const [i, node] of nodes.entries()) {
    const name = `${file.replace(/\.html$/, '')}--${s.replace(/[^a-z0-9]/gi, '')}${nodes.length > 1 ? `-${i}` : ''}.png`;
    await node.screenshot({ path: join(OUT, name) });
    console.log(name);
  }
}

await browser.close();
