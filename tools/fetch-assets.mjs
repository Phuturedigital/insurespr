/* InsureSPR Health concept — fetch the CHOSEN stock images into assets/.
 *
 * Candidates were reviewed by eye from tools/sheets/ and the winners are pinned
 * by Pexels photo id below. Re-running this script is deterministic: it always
 * fetches these exact photos at these exact widths.
 *
 * Pexels' CDN does the resize AND the webp encode for us (`fm=webp`), so there
 * is no local image toolchain to install and no sharp/ImageMagick dependency.
 * Widths are ~1.5x the largest CSS display size — crisp on a 2x screen without
 * shipping a 6000px original.
 *
 * EVERY pick here is landscape. The brief asked for photography that is *very
 * visible*, which this design answers with full-bleed bands and large figures;
 * a portrait frame cropped to a 16:7 band loses most of its subject.
 *
 * Usage:  node tools/fetch-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

/* id     = Pexels photo id (pinned)
   out    = path under assets/
   w      = delivered width in px
   credit = photographer, recorded in CONTENT-NOTES.md
   note   = why this frame was chosen */
const ASSETS = [
  /* --- hero -------------------------------------------------------------
     The single most important pick. An older Black woman, grey hair, hand on
     hip, mid-stride confidence — the exact person osteoporosis and muscle loss
     affect first, shown strong rather than frail. Critically the subject sits
     right-of-centre with open grass on the left, so the headline has somewhere
     to live without a heavy scrim flattening the image. */
  { id: 8173545,  out: 'assets/hero.webp',        w: 2000, credit: 'RDNE Stock project',
    note: 'Hero. Confident older woman, park, subject right-of-centre — left third stays clear for type.' },
  { id: 8173548,  out: 'assets/joy.webp',         w: 1600, credit: 'RDNE Stock project',
    note: 'Same subject, same shoot, smiling to camera. Used on the closing CTA so the site bookends on one face.' },

  /* --- the scan ---------------------------------------------------------
     A DXA is an OPEN flat table with a scanning arm passing overhead — it is
     emphatically NOT the enclosed tunnel of a CT or MRI, and you stay in your
     own clothes. Every tunnel frame was therefore rejected: showing one would
     misrepresent what a visitor is actually booking, and explaining the scan
     honestly is the entire point of this concept.

     Two earlier picks were rejected at full size after looking fine as
     thumbnails — 6812457 turned out to be a DENTAL panoramic unit with a child
     in a head brace, and 7089007 was a CT tunnel. Both are the exact failure
     mode a metadata-only selection produces. 7088824 below is the real thing:
     flat open table, overhead gantry, radiographer alongside, patient clothed. */
  { id: 7088824,  out: 'assets/scan.webp',        w: 1600, credit: 'MART PRODUCTION',
    note: 'Flat OPEN table with an overhead scanning arm and the patient fully clothed — true DXA geometry.' },
  { id: 4226124,  out: 'assets/results.webp',     w: 1200, credit: 'Anna Shvets',
    note: 'A spine film on a lightbox being pointed at. Reads as "your results, explained" — and its blue cast happens to sit inside the brand palette.' },

  /* --- the three pillars ------------------------------------------------ */
  { id: 6815693,  out: 'assets/strong.webp',      w: 1200, credit: 'Yan Krukau',
    note: 'InsureStrong. Two older adults pressing dumbbells overhead in a bright room — unambiguous, and age-appropriate.' },
  { id: 7551627,  out: 'assets/prevent.webp',     w: 1200, credit: 'Kampus Production',
    note: 'InsurePrevent. Balance assessment, arms extended, clinician alongside. Reads as a test, not a workout.' },
  { id: 33185461, out: 'assets/reclaim.webp',     w: 1200, credit: '@marcuschanmedia',
    note: 'InsureReclaim. Older man mid-lift, controlled and strong. The "getting it back" frame.' },

  /* --- services --------------------------------------------------------- */
  { id: 7579831,  out: 'assets/nurse.webp',       w: 1400, credit: 'cottonbro studio',
    note: 'Nurse-led consultation. Bright, face-on, clearly a conversation across a desk rather than a procedure.' },
  { id: 4506160,  out: 'assets/mobility.webp',    w: 1000, credit: 'kaboompics.com',
    note: 'Resistance band shoulder work — the clearest single shorthand for mobility assessment.' },
  /* Rejected 4909014 (hands on the lower ribs) on review: cropped to a torso in
     underwear, it reads as a body-image or clinical-abdomen shot rather than
     breath work — wrong register entirely for an audience of older adults. */
  { id: 8939952,  out: 'assets/breathing.webp',   w: 1000, credit: 'Vlada Karpovich',
    note: 'Two older adults doing standing breath work in a park, hands at the chest. Clothed, calm, unmistakably a practice.' },
  { id: 9065264,  out: 'assets/coach.webp',       w: 1000, credit: 'RDNE Stock project',
    note: 'Health coaching. Two people talking, notes on the table — advice, not treatment.' },
  { id: 13980451, out: 'assets/sport.webp',       w: 1400, credit: 'Hawk i i',
    note: 'Athlete in starting blocks. Covers the sports-performance audience the real practice also serves.' },

  /* --- supporting bands -------------------------------------------------- */
  { id: 5723877,  out: 'assets/bones.webp',       w: 1600, credit: 'cottonbro studio',
    note: 'Grid of spine films. Used as a dark texture band behind the "what the scan sees" explainer.' },
  { id: 8972326,  out: 'assets/walk.webp',        w: 1400, credit: 'SHVETS production',
    note: 'Older couple walking together. The outcome the whole service is aimed at.' },
  { id: 11482138, out: 'assets/family.webp',      w: 1400, credit: 'Gabriel Frank',
    note: 'Grandmother and child laughing outdoors. "Independence" made concrete instead of stated.' },
  { id: 6809658,  out: 'assets/clinic.webp',      w: 1400, credit: 'Pavel Danilyuk',
    note: 'Reception desk with a real interaction. Used on Contact so the address has a face.' },
];

/* Resolve a photo id to its CDN base path. Pexels' canonical file URL embeds
   the id twice, which is stable across their API versions. */
const cdn = (id, w) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg` +
  `?auto=compress&cs=tinysrgb&fm=webp&w=${w}`;

await mkdir(join(ROOT, 'assets'), { recursive: true });

let failures = 0;
for (const a of ASSETS) {
  try {
    const res = await fetch(cdn(a.id, a.w), { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    /* Verify we actually got WebP and not a JPEG fallback: RIFF....WEBP. A
       silent fallback would still render, so this has to be checked rather
       than assumed. */
    const isWebp =
      buf.length > 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP';
    if (!isWebp) throw new Error('not a webp — CDN ignored fm=webp');

    await writeFile(join(ROOT, a.out), buf);
    console.log(`ok   ${a.out.padEnd(26)} ${String(Math.round(buf.length / 1024)).padStart(4)} KB  © ${a.credit}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${a.out.padEnd(26)} ${err.message}`);
  }
}
console.log(failures ? `\n${failures} asset(s) failed.` : '\nAll assets fetched.');
process.exit(failures ? 1 : 0);
