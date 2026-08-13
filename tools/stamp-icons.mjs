/* Push tools/icons.svg into every page between the icons markers.
 *
 * Why stamp rather than reference: `<use href="icons.svg#i-bone">` — a
 * cross-document reference — has never been reliable across browsers, and the
 * site has no build step and no framework to render a partial. Inlining the
 * sprite in each page is the option that actually works everywhere, including
 * with JavaScript off. This script is what keeps those seven copies from
 * drifting: icons.svg stays the single source of truth.
 *
 * The markers are stripped and rewritten on every run, so it is idempotent and
 * an edit to one icon propagates to the whole site in one pass.
 *
 * Usage:  node tools/stamp-icons.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- icons:start -->';
const END = '<!-- icons:end -->';

const sprite = (await readFile(join(ROOT, 'tools', 'icons.svg'), 'utf8')).trim();
const pages = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));

let stamped = 0;

for (const file of pages) {
  const path = join(ROOT, file);
  const html = await readFile(path, 'utf8');

  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1) {
    const bodyStart = html.search(/<body\b[^>]*>/i);
    if (bodyStart === -1) {
      throw new Error(`${file} has no body element`);
    }
    const bodyEnd = html.indexOf('>', bodyStart) + 1;
    const block = `\n${START}\n${sprite}\n${END}\n`;
    await writeFile(path, html.slice(0, bodyEnd) + block + html.slice(bodyEnd));
    console.log(`add  ${file}`);
    stamped++;
    continue;
  }

  const next = html.slice(0, a + START.length) + '\n' + sprite + '\n' + html.slice(b);
  if (next !== html) {
    await writeFile(path, next);
    console.log(`ok   ${file}`);
    stamped++;
  } else {
    console.log(`--   ${file} (already current)`);
  }
}

console.log(`\n${stamped} page(s) updated.`);
