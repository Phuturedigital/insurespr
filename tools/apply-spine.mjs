/* Wrap a page's <main> in the vertebrae column and give each top-level section
 * a numbered node.
 *
 *   node tools/apply-spine.mjs index.html [--write]
 *
 * Regex replacement only — never index slicing. Offsets computed from chained
 * indexOf have no integrity check and silently duplicated a whole chrome block
 * earlier in this build; a regex either matches or it does not.
 *
 * The hero is skipped: it is the page's opening statement and a node beside it
 * reads as a numbered list item rather than a headline.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const WRITE = process.argv.includes('--write');
let html = readFileSync(file, 'utf8');
const before = (html.match(/^  <section/gm) || []).length;

if (html.includes('class="spine"')) { console.log('  already spined — nothing to do'); process.exit(0); }

// 1. Wrap the contents of <main> in the rail container.
html = html.replace(/(<main id="main">)/, '$1\n<div class="spine">');
html = html.replace(/(<\/main>)/, '</div>\n$1');

// 2. Number every top-level section except the hero.
let n = 0;
html = html.replace(/^  <section( class="([^"]*)")?>/gm, (whole, _attr, cls = '') => {
  if (cls.includes('hero')) return whole;               // the hero opens, it does not enumerate
  n++;
  const num = String(n).padStart(2, '0');
  const classes = `${cls} spine-sec`.trim();
  return `  <section class="${classes}">\n    <div class="spine-node" aria-hidden="true"><span class="spine-num">${num}</span><span class="spine-dot"></span></div>`;
});

const after = (html.match(/^  <section/gm) || []).length;
if (after !== before) { console.error(`  🚨 section count changed ${before} -> ${after}; refusing`); process.exit(1); }

console.log(`  ${file}: ${before} sections, ${n} numbered nodes added`);
if (WRITE) writeFileSync(file, html);
else console.log('  dry run — pass --write');
