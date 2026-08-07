/* One-shot migration: old .btn-* buttons -> the new pill with a trailing badge.
 *
 *   node tools/migrate-buttons.mjs [--write]
 *
 * The redesign introduced a `.btn` whose padding is asymmetric because it is
 * built around a circular badge on the right. The old `.btn` was symmetric with
 * an optional leading icon. Two button systems on one site is worse than either,
 * and the new base rule sits later in the stylesheet so it would silently win
 * for shared properties anyway — leaving old buttons with a squashed right side.
 * So everything moves.
 *
 * Leading icons are dropped: in this design language the badge is the signal,
 * and an icon on both ends reads cluttered at button size.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const ROOT = 'C:/Users/Acer/insurespr';

/* old modifier -> new modifier. `btn-light` and `btn-outline-light` both sat on
   dark grounds; they collapse to the two dark-ground fills. */
const MAP = {
  'btn-primary': 'btn--primary',
  'btn-ghost': 'btn--ghost',
  'btn-light': 'btn--primary',
  'btn-outline-light': 'btn--on-ink',
};

const BADGE = '<span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span>';

let total = 0;
for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
  const path = `${ROOT}/${file}`;
  const before = readFileSync(path, 'utf8');
  let html = before;
  let n = 0;

  /* Match a whole <a|button class="btn ..."> ... </a|button> so the badge can be
     appended inside it and any leading icon removed from its label. */
  html = html.replace(
    /<(a|button)([^>]*\bclass="btn ([a-z-]+)"[^>]*)>([\s\S]*?)<\/\1>/g,
    (whole, tag, attrs, mod, inner) => {
      const next = MAP[mod];
      if (!next) return whole;
      if (inner.includes('btn-badge')) return whole;      // already migrated
      n++;
      const label = inner
        .replace(/<svg class="icon"[^>]*>[\s\S]*?<\/svg>/g, '')  // drop leading icon
        .trim();
      return `<${tag}${attrs.replace(`class="btn ${mod}"`, `class="btn ${next}"`)}>${label} ${BADGE}</${tag}>`;
    },
  );

  if (n) {
    if (WRITE) writeFileSync(path, html);
    console.log(`  ${file.padEnd(16)} ${n} button(s)`);
    total += n;
  }
}
console.log(`\n${WRITE ? 'Migrated' : 'Would migrate'} ${total} buttons.`);
if (!WRITE) console.log('Dry run — pass --write to apply.');
