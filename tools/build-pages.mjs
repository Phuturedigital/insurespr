/* Generate the inner pages from one shared skeleton.
 *
 *   node tools/build-pages.mjs
 *
 * index.html is hand-written because it is the showcase and its sections are
 * one-offs. Everything else shares the same shell — head, marker comments,
 * page header, body sections, close — so it lives here instead of being copied
 * seven times and drifting.
 *
 * Writes ONLY the marker comments for banner/nav/footer/icons/pd-network; those
 * regions are filled by stamp-chrome.mjs, stamp-icons.mjs and
 * stamp-network.mjs afterwards.
 */
import { writeFileSync } from 'node:fs';

const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Outfit:wght@300;400;500;600&display=swap';

const shell = ({ file, title, desc, header, body }) => `<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — InsureSPR Health concept demo by Phuture Digital</title>
<meta name="description" content="${desc}">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="styles.css">
<!-- Stamp \`.js\` BEFORE first paint. A deferred script cannot do this without a
     flash of content: the stylesheet blocks rendering and the script does not. -->
<script>document.documentElement.className += ' js';</script>
</head>
<body>
<!-- icons:start -->
<!-- icons:end -->

<a class="skip" href="#main">Skip to content</a>

<!-- banner:start -->
<!-- banner:end -->

<!-- nav:start -->
<!-- nav:end -->

<main id="main">
${header}
${body}
</main>

<!-- pd-network:start -->
<!-- pd-network:end -->

<!-- footer:start -->
<!-- footer:end -->

<script src="site.js" defer></script>
</body>
</html>
`;

/* Page header: copy in its own column, picture as a contained tile beside it.
   Deliberately NOT text-over-photo — an audit of the previous build found
   headlines running across two subjects' faces, and a contained tile makes that
   structurally impossible rather than a thing to keep re-checking. */
const pagehead = (eyebrow, h1, lede, img, alt) => `
  <section class="pad-sm">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="eyebrow">${eyebrow}</p>
          <h1>${h1}</h1>
          <p class="lede">${lede}</p>
        </div>
        <div class="media media--wide reveal reveal-d1">
          <img src="assets/${img}" alt="${alt}" width="1600" height="1000" fetchpriority="high">
        </div>
      </div>
    </div>
  </section>`;

const cta = (h, p) => `
  <section>
    <div class="wrap">
      <div class="ink-panel reveal" style="text-align:center">
        <h2 style="max-width:24ch;margin-inline:auto">${h}</h2>
        <p style="color:#a9bcd8;max-width:48ch;margin-inline:auto">${p}</p>
        <div class="btn-row" style="justify-content:center;margin-top:1.75rem">
          <a class="btn btn--light" href="book.html">Book a scan <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></a>
          <a class="btn btn--on-ink" href="contact.html">Ask a question first <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></a>
        </div>
      </div>
    </div>
  </section>`;

/* A translated service row: the practice's own clinical name, what it is, and
   what you get. The blue-to-cyan arc is the site's whole organising idea. */
const row = (icon, term, def, gain) => `
          <div class="plain-row">
            <p class="plain-term"><svg class="icon" aria-hidden="true"><use href="#i-${icon}"></use></svg> ${term}</p>
            <div>
              <p class="plain-def">${def}</p>
              <p class="plain-gain"><svg class="icon" aria-hidden="true"><use href="#i-check"></use></svg> <span>${gain}</span></p>
            </div>
          </div>`;

const PAGES = [];

/* ------------------------------------------------------------ programmes -- */
const prog = (id, name, h, who, included, terms) => `
      <div class="card reveal" id="${id}" style="margin-bottom:1.15rem">
        <p class="pcard-name">${name}</p>
        <h2 style="font-size:clamp(1.5rem,2.6vw,2rem);margin-bottom:.75rem">${h}</h2>
        <div class="split" style="align-items:start;gap:1.5rem clamp(1.5rem,4vw,3rem)">
          <div>
            <p class="pcard-label">Who it&rsquo;s for</p>
            <p style="color:var(--muted)">${who}</p>
            <p class="pcard-label" style="margin-top:1rem">What&rsquo;s included</p>
            <ul class="tagrow" style="margin-top:.5rem">${included.map((i) => `<li>${i}</li>`).join('')}</ul>
          </div>
          <div class="note">
            <svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>
            <span>${terms}</span>
          </div>
        </div>
      </div>`;

PAGES.push({
  file: 'programmes.html',
  title: 'Programmes and services',
  desc: 'Every service InsureSPR Health offers — bone density scanning, body composition, osteoporosis care, fall prevention, mobility work, Breatheez and health coaching — explained in plain English. Concept demo by Phuture Digital.',
  header: pagehead(
    'Programmes',
    'Everything on offer, in words you already use',
    'The practice&rsquo;s own three programmes and its full service list. Each keeps its proper clinical name, gains a sentence explaining what it actually is, and a line on what you get out of it.',
    'mobility.webp',
    'A physiotherapist guiding a patient through a shoulder mobility exercise with a resistance band.',
  ),
  body: `
  <section class="pad-sm">
    <div class="wrap">
${prog('strong', 'InsureStrong', 'Build and maintain healthy bone and muscle mass',
    'Anyone who wants to know their starting point and build on it — including people who train and want real numbers rather than a bathroom scale.',
    ['DXA bone density', 'DXA body composition', 'Fitness &amp; nutrition guidance', 'Repeat scan'],
    '<strong>You cannot build on a number you do not have.</strong> This programme starts with the scan, because everything after it is guesswork otherwise.')}
${prog('prevent', 'InsurePrevent', 'Stop bone and muscle loss before it starts',
    'People who want their fracture risk assessed properly — posture, mobility and bone strength together — before a stumble becomes a break.',
    ['Nurse-led osteoporosis clinic', 'Posture, flexibility &amp; balance', 'Bone density scanning', 'Ongoing management'],
    '<strong>One consultation, one price.</strong> The practice runs this as a single appointment with the bone density scans and assessments included — its own stated approach, rather than three separate bookings.')}
${prog('reclaim', 'InsureReclaim', 'Restore what has been lost, so you can live boldly',
    'People rebuilding after a fall, a fracture, or a long stretch of doing less — where the goal is getting specific things back.',
    ['Personal plan', 'Monthly checkpoints', 'Targeted nutrition', 'Corrective exercise', 'Health coaching'],
    '<strong>The goals are yours to set.</strong> Carrying your own shopping, getting off the floor unaided, walking without watching every step — measured monthly so drift gets caught early.')}
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">The full list</p>
        <h2>Everything else the practice does</h2>
        <p>These are the practice&rsquo;s own service names, kept exactly as it writes them. Underneath each one: what it actually is, then what it gets you.</p>
      </div>
      <div class="plain reveal">
${row('scan', 'DXA bone density screening', 'A ten-minute scan measuring <strong>how strong your bones are</strong>, so thinning gets caught while there is still time to act on it.', 'You leave knowing whether to act now or re-check in a few years — instead of finding out from a fracture.')}
${row('chart', 'DXA body composition', 'The same scan, showing <strong>how much muscle, fat and bone you carry and where</strong>. What you are made of, not just what you weigh.', 'A measurement that moves when the work is working. A scale can sit still for months while your body changes underneath it.')}
${row('spine', 'Osteoporosis clinic consultation', 'Nurse-led care if your bones have already thinned — <strong>the same person following your case</strong>, rather than starting again with a stranger each visit.', 'One appointment at one price with the scans included, covering primary and secondary osteoporosis.')}
${row('balance', 'Posture, flexibility and balance assessment', 'A proper test of <strong>how likely you are to fall</strong> — and which specific thing to work on to change that answer.', 'A straight answer on your fall risk, and the one or two things that actually shift it, rather than being told to &ldquo;be careful&rdquo;.')}
${row('move', 'Neck and shoulder mobility', 'Getting <strong>range of movement back</strong> in the joints that stiffen first and change how everything below them works.', 'Top shelves, blind spots, and a night&rsquo;s sleep your shoulder does not interrupt.')}
${row('move', 'Back, hip and knee mobility', 'The joints that decide whether you can <strong>get out of a chair, climb stairs and walk properly</strong> without thinking about it.', 'Stairs and chairs go back to being things you do, not things you plan around.')}
${row('lungs', 'Breatheez — diaphragmatic gateway', 'Learning to <strong>breathe with your diaphragm</strong> instead of your neck and shoulders. Shallow breathing keeps those muscles permanently switched on, which is where a lot of neck and upper back pain quietly comes from.', 'The tension that always comes back stops coming back, because the load moves off muscles that were never meant to carry it.')}
${row('shield', 'Overuse injury correction', 'Sorting out the <strong>aches that come from doing the same movement too often</strong> — and fixing the pattern causing them, not just the sore spot.', 'The ache stops returning, because the movement that caused it is not the movement you leave with.')}
${row('heart', 'Health coaching', 'Someone <strong>in your corner between appointments</strong>, for the long stretch where a plan either becomes a habit or quietly stops.', 'The plan survives a normal week, because somebody notices it slipping before it stops.')}
${row('target', 'Sports and fitness assessment', 'Real body composition for people who train — <strong>sharper programming, better nutrition decisions, fewer injuries</strong> from imbalances nobody spotted.', 'Training decisions made on your own limb-by-limb breakdown, with left-right imbalances caught while they are still a number rather than an injury.')}
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="split">
        <div class="reveal">
          <p class="eyebrow">Working together</p>
          <h2>If you refer patients or run a facility</h2>
          <p>The practice lists three audiences, and two of them are not the patient.</p>
          <h3 style="margin-top:1.5rem">Medical facilities and health professionals</h3>
          <p style="color:var(--muted)">Screening, diagnosis and ongoing management of <strong>primary and secondary osteoporosis</strong>, with a nurse-led clinic behind it. Your patient comes back understanding their own result, which makes your next conversation with them a shorter one.</p>
          <h3 style="margin-top:1.25rem">Sports and fitness facilities</h3>
          <p style="color:var(--muted)">Body composition analysis for performance and injury prevention, available to your members. Objective numbers to programme against, and a clear before-and-after when the work pays off.</p>
          <div class="btn-row" style="margin-top:1.5rem">
            <a class="btn btn--primary" href="contact.html">Talk about referrals <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></a>
          </div>
        </div>
        <div class="media media--tall reveal reveal-d1">
          <img src="assets/sport.webp" alt="An athlete being assessed by a coach in a training facility." width="1400" height="1750" loading="lazy">
        </div>
      </div>
    </div>
  </section>
${cta('Not sure which one you need?', 'Most people do not, and that is fine — it is what the first consultation is for. Almost everybody starts with the same scan anyway.')}`,
});

/* ------------------------------------------------------------------ scan -- */
PAGES.push({
  file: 'scan.html',
  title: 'The scan, explained',
  desc: 'What actually happens in a DXA bone density and body composition scan at InsureSPR Health — start to finish, without a single word you would have to look up. Concept demo by Phuture Digital.',
  header: pagehead(
    'The scan',
    'Ten minutes lying down. Then you actually know.',
    'Here is the whole thing, start to finish, without a single word you would have to look up.',
    'scan.webp',
    'A person lying fully clothed on a flat, open scanning table while a radiographer operates the machine beside them.',
  ),
  body: `
  <section class="pad-sm">
    <div class="wrap">
      <dl class="statstrip reveal">
        <div><dt>On the table</dt><dd>10 min<small>Fully clothed, lying flat</small></dd></div>
        <div><dt>In the practice</dt><dd>~1 hour<small>Most of it is talking</small></dd></div>
        <div><dt>Needles</dt><dd>None<small>No dye, no injection</small></dd></div>
        <div><dt>Enclosed space</dt><dd>None<small>Open table, not a tunnel</small></dd></div>
      </dl>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">What it measures</p>
        <h2>More than a bone density test</h2>
        <p>The same ten minutes produces two different sets of numbers, which is why the practice calls DXA a blueprint rather than a test.</p>
      </div>
      <div class="pgrid reveal">
        <article class="pcard">
          <p class="pcard-name">Bone</p>
          <h3>How strong your skeleton is</h3>
          <p>Measured against what is normal for your age and sex, so thinning shows up as a number rather than as a broken wrist.</p>
        </article>
        <article class="pcard">
          <p class="pcard-name">Muscle &amp; fat</p>
          <h3>What you are actually made of</h3>
          <p>Muscle, fat and bone separated out and located — limb by limb, not averaged into one figure on a scale.</p>
        </article>
        <article class="pcard">
          <p class="pcard-name">Change</p>
          <h3>Whether anything is working</h3>
          <p>Repeat it later and the difference is measurable. That is the part a scale genuinely cannot tell you.</p>
        </article>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="ink-panel reveal">
        <div class="section-head" style="margin-bottom:1.75rem">
          <p class="eyebrow eyebrow--light">Rethink how you measure health</p>
          <h2>BMI is a population average. You are not a population.</h2>
          <p style="color:#a9bcd8">The practice&rsquo;s own argument, and it is a good one: traditional tools like BMI are population-based and outdated. Two people at the same height and weight can have completely different amounts of muscle and bone.</p>
        </div>
        <div class="split">
          <div>
            <h3 style="color:#fff">What most people go on</h3>
            <p style="color:#a9bcd8">One number from a bathroom scale, which mixes muscle, fat, bone and water together and calls the total your weight. It is the least useful measurement in the room.</p>
          </div>
          <div>
            <h3 style="color:#fff">What the practice measures instead</h3>
            <p style="color:#a9bcd8">Personalised, science-based data you can track over time — the years you live strong and independent, which the practice calls your healthspan.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="split">
        <div class="media media--wide reveal">
          <img src="assets/results.webp" alt="A clinician showing a patient their results on a screen." width="1600" height="1000" loading="lazy">
        </div>
        <div class="reveal reveal-d1">
          <p class="eyebrow">Afterwards</p>
          <h2>You read it with someone</h2>
          <p>The result is explained while you are still in the room, in the same plain language as the rest of this site — not posted to you a week later to decode alone.</p>
          <p>You leave with what to do, what to change, and when to come back and check.</p>
        </div>
      </div>
    </div>
  </section>
${cta('Ten minutes is the whole ask', 'Lying down, fully clothed, on an open table. Everything else is conversation.')}`,
});

/* ----------------------------------------------------------------- about -- */
PAGES.push({
  file: 'about.html',
  title: 'About the practice',
  desc: 'InsureSPR Health is a bone and muscle health practice at EmedCentre in Randburg. What it does, who it serves, and why it exists. Concept demo by Phuture Digital.',
  header: pagehead(
    'About',
    'Strong bones, stronger life',
    'The practice&rsquo;s own words. This page is what they mean.',
    'family.webp',
    'An older woman standing outdoors in her garden on a bright day.',
  ),
  body: `
  <section class="pad-sm">
    <div class="wrap">
      <div class="split">
        <div class="reveal">
          <p class="eyebrow">Why this exists</p>
          <h2>Because a broken bone late in life is rarely just a broken bone</h2>
          <p>The practice was founded after years of personal and professional experience with exactly this: many people never regain their independence after a fall and a fracture.</p>
          <p>Bone loss has no symptoms until something breaks. Measuring it is the only way to know early, and early is when there is still plenty you can do.</p>
        </div>
        <div class="reveal reveal-d1">
          <div class="note"><svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg><span><strong>&ldquo;Falls leading to fractures can drastically reduce quality of life.&rdquo;</strong> The practice&rsquo;s own statement of why it works on prevention rather than repair.</span></div>
          <div class="note" style="margin-top:.85rem"><svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg><span><strong>&ldquo;Don&rsquo;t outlive your health.&rdquo;</strong> Healthspan — the years you live strong, independent and free from disability — is the thing being measured.</span></div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head section-head--center reveal">
        <p class="eyebrow eyebrow--plain">Who it serves</p>
        <h2>Three groups, one set of measurements</h2>
      </div>
      <div class="pgrid reveal">
        <article class="pcard">
          <p class="pcard-name">People</p>
          <h3>Anyone who wants to know where they stand</h3>
          <p>Largely, though not only, people over fifty — and increasingly people who train and want real numbers.</p>
        </article>
        <article class="pcard">
          <p class="pcard-name">Clinicians</p>
          <h3>Medical facilities and health professionals</h3>
          <p>A hub for screening, diagnosis and management of primary and secondary osteoporosis, with a nurse-led clinic behind it.</p>
        </article>
        <article class="pcard">
          <p class="pcard-name">Facilities</p>
          <h3>Sports and fitness facilities</h3>
          <p>Body composition for sports medicine doctors, coaches, dieticians and gyms — to optimise performance and reduce injury risk.</p>
        </article>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="split">
        <div class="media media--tall reveal">
          <img src="assets/nurse.webp" alt="A nurse in conversation with a patient across a desk." width="1400" height="1750" loading="lazy">
        </div>
        <div class="reveal reveal-d1">
          <p class="eyebrow">How it runs</p>
          <h2>Nurse-led, from the first question to the follow-up</h2>
          <p>The osteoporosis clinic is nurse-led, and the practice runs it as a single affordable consultation that includes the bone density scans and assessments at one price.</p>
          <p>Practically, that means the same person follows your case — rather than starting again with a stranger at every visit.</p>
          <ul class="tagrow" style="margin-top:1.25rem">
            <li>Screening</li><li>Diagnosis</li><li>Ongoing management</li><li>Primary &amp; secondary osteoporosis</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="ink-panel reveal">
        <p class="eyebrow eyebrow--light">Straight answers</p>
        <h2>What is real and what is ours</h2>
        <div class="split" style="margin-top:1.5rem">
          <div>
            <h3 style="color:#fff">The practice&rsquo;s own</h3>
            <p style="color:#a9bcd8">The name, mark and tagline. Every service name. The address, hours, phone number and email. The three programmes. The blog article titles. Claims like &ldquo;one consultation at one price&rdquo; are its own words, paraphrased.</p>
          </div>
          <div>
            <h3 style="color:#fff">Ours</h3>
            <p style="color:#a9bcd8">All layout, colour, typography, iconography and motion. Every plain-English translation and outcome line. The photography, which is licence-free stock. And the fact that this is a concept demo, which every page says.</p>
          </div>
        </div>
        <div class="btn-row" style="margin-top:1.75rem">
          <a class="btn btn--on-ink" href="brand.html">How this was designed and built <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></a>
        </div>
      </div>
    </div>
  </section>
${cta('Reclaim your health. Rebuild yourself.', 'The practice&rsquo;s own words for what it does. It starts with knowing where you actually stand.')}`,
});

/* ----------------------------------------------------------------- learn -- */
const post = (cat, title, blurb) => `
        <article class="pcard reveal">
          <p class="pcard-name">${cat}</p>
          <h3>${title}</h3>
          <p>${blurb}</p>
        </article>`;

PAGES.push({
  file: 'learn.html',
  title: 'Learn',
  desc: 'Bone and muscle health explained without the textbook — osteoporosis, DXA, metabolic health, mobility and ageing well. Article titles from InsureSPR Health. Concept demo by Phuture Digital.',
  header: pagehead(
    'Learn',
    'Bone and muscle health, without the textbook',
    'The practice writes regularly about the things it treats. These are its own article titles, grouped by what you might actually be trying to find out.',
    'bones.webp',
    'A wall of spinal MRI films on a lightbox.',
  ),
  body: `
  <section class="pad-sm">
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">If you have just been diagnosed</p>
        <h2>Osteoporosis, start here</h2>
      </div>
      <div class="pgrid">
${post('Medication', 'Understanding Osteoporosis medications', 'Osteoporosis is often called the silent disease because bones weaken over time without symptoms. What the treatment options actually do.')}
${post('Nurse-led care', 'InsureSPR Health: Nurse led Comprehensive Osteoporosis Management', 'How a nurse-led approach to osteoporosis care changes what the appointment looks like.')}
${post('Family history', 'Family History and Osteoporosis: The Hidden Legacy We Often Ignore', 'Inherited risk is real, and it changes when you should start measuring rather than whether you should.')}
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">If another condition is involved</p>
        <h2>When bone health is not the only thing going on</h2>
      </div>
      <div class="pgrid">
${post('Kidneys', 'Chronic Kidney disease meets Osteoporosis', 'What you need to know to manage the relationship while preserving bone health.')}
${post('Kidneys', 'The dynamic link: bones and kidneys', 'How chronic kidney disease affects your bones, and why the two are measured together.')}
${post('Endocrine', 'Overcome Cushing&rsquo;s syndrome', 'DXA body composition as a tool in the management of Cushing&rsquo;s syndrome.')}
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">If you want to stay ahead of it</p>
        <h2>Measuring, moving and ageing well</h2>
      </div>
      <div class="pgrid">
${post('Ageing', 'Healthy Ageing Starts with What You Measure', 'Ageing is inevitable. Frailty is not — and the difference is measurable.')}
${post('Mobility', 'Why Mobility Decline Often Starts at the Ankle', 'Most people think mobility decline starts at the hips, knees or spine. Often it does not.')}
${post('Metabolic', 'Unlocking Metabolic Health', 'The role of DXA in chronic disease and weight management.')}
${post('Fitness', 'DXA for fitness Monitoring', 'Fitness is not about what you weigh — it is about what your body is made of.')}
${post('Weight', 'Measuring What Matters', 'Weight-loss journeys are inspiring and deeply personal. They are also frequently measured with the wrong instrument.')}
${post('Muscle', 'Healthy Muscles, Healthy Movement, Healthier Life!', 'Why muscle mass, not weight, is the number that predicts how the next decade goes.')}
      </div>
      <div class="note reveal" style="margin-top:1.5rem">
        <svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>
        <span><strong>These are real article titles from the practice&rsquo;s own blog</strong>, credited to it. The summaries here are ours and the full articles are not reproduced — this is a design concept, not a copy of their content.</span>
      </div>
    </div>
  </section>
${cta('Reading is not measuring', 'Ten minutes on an open table will tell you more about your own bones than any article can.')}`,
});

/* ------------------------------------------------------------------ book -- */
PAGES.push({
  file: 'book.html',
  title: 'Book a scan',
  desc: 'Request a DXA bone density and body composition scan at InsureSPR Health in Randburg. Concept demo by Phuture Digital — this form does not submit anywhere.',
  header: pagehead(
    'Book',
    'Book a scan',
    'Tell us roughly what you need and when suits you. Someone from the practice comes back to confirm a time.',
    'clinic.webp',
    'A bright, modern clinic reception area.',
  ),
  body: `
  <section class="pad-sm">
    <div class="wrap">
      <div class="split" style="align-items:start">
        <div class="card reveal">
          <h2 style="font-size:clamp(1.4rem,2.4vw,1.8rem)">Request an appointment</h2>
          <div class="note note--warn" style="margin:1rem 0 1.5rem">
            <svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg>
            <span><strong>This form does not go anywhere.</strong> This is a design concept, so nothing you type is sent, stored or seen by anyone — including us. To reach the practice, email <a href="mailto:health@insuresprhealth.co.za">health@insuresprhealth.co.za</a>.</span>
          </div>
          <form id="book-form" novalidate>
            <div class="field-row">
              <div class="field"><label for="bname">Your name</label><input type="text" id="bname" name="name" autocomplete="name"></div>
              <div class="field"><label for="bphone">Phone</label><input type="tel" id="bphone" name="phone" autocomplete="tel"></div>
            </div>
            <div class="field"><label for="bemail">Email</label><input type="email" id="bemail" name="email" autocomplete="email"></div>
            <div class="field">
              <label for="bwhat">What are you after?</label>
              <select id="bwhat" name="what">
                <option>Not sure yet — happy to be advised</option>
                <option>Bone density scan</option>
                <option>Body composition scan</option>
                <option>Osteoporosis clinic consultation</option>
                <option>Fall risk / balance assessment</option>
                <option>Sports and fitness assessment</option>
              </select>
            </div>
            <div class="field"><label for="bwhen">When suits you</label><input type="text" id="bwhen" name="when" placeholder="e.g. weekday mornings"></div>
            <div class="field"><label for="bnotes">Anything the practice should know</label><textarea id="bnotes" name="notes"></textarea></div>
            <button class="btn btn--primary" type="submit">Request appointment <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></button>
            <div class="note" id="book-status" hidden style="margin-top:1rem"></div>
          </form>
        </div>

        <div class="reveal reveal-d1">
          <div class="card" style="margin-bottom:1.15rem">
            <p class="eyebrow eyebrow--plain">How long to set aside</p>
            <h3>About an hour in total</h3>
            <p style="color:var(--muted)">The scan itself is ten minutes of that. The rest is the conversation before and the explanation after — which is the part that makes the number useful.</p>
          </div>
          <div class="card" style="margin-bottom:1.15rem">
            <p class="eyebrow eyebrow--plain">What to wear</p>
            <h3>Your own clothes</h3>
            <p style="color:var(--muted)">You stay dressed. Avoid anything with metal through the middle — zips, heavy buckles — and you are set.</p>
          </div>
          <div class="card">
            <p class="eyebrow eyebrow--plain">Prefer to email</p>
            <h3 style="overflow-wrap:anywhere">health@insuresprhealth.co.za</h3>
            <p style="color:var(--muted)">Email the practice to ask about availability or confirm a time.</p>
            <div class="btn-row" style="margin-top:1rem">
              <a class="btn btn--primary btn--sm" href="mailto:health@insuresprhealth.co.za">Email the practice <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-mail"></use></svg></span></a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>`,
});

/* --------------------------------------------------------------- contact -- */
PAGES.push({
  file: 'contact.html',
  title: 'Contact',
  desc: 'Where InsureSPR Health is, when it is open, and how to reach it. 7 Malibongwe Drive, EmedCentre, Randburg. Concept demo by Phuture Digital.',
  header: pagehead(
    'Contact',
    'Get in touch',
    'A question before you book is a perfectly good reason to email. Keep it short and practical.',
    'nurse.webp',
    'A nurse in conversation with a patient across a desk in a consulting room.',
  ),
  body: `
  <section class="pad-sm">
    <div class="wrap">
      <dl class="statstrip reveal">
        <div><dt>Where</dt><dd style="font-size:1.05rem;line-height:1.4">7 Malibongwe Drive<small>EmedCentre, Randburg</small></dd></div>
        <div><dt>When</dt><dd style="font-size:1.05rem;line-height:1.4">08:00 – 17:00<small>Monday to Friday</small></dd></div>
        <div><dt>Email</dt><dd style="font-size:.95rem;line-height:1.4;overflow-wrap:anywhere"><a href="mailto:health@insuresprhealth.co.za">health@insuresprhealth.co.za</a></dd></div>
      </dl>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="split" style="align-items:start">
        <div class="card reveal">
          <h2 style="font-size:clamp(1.4rem,2.4vw,1.8rem)">Send a question</h2>
          <div class="note note--warn" style="margin:1rem 0 1.5rem">
            <svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg>
            <span><strong>This form does not go anywhere.</strong> This is a design concept, so nothing you type is sent, stored or seen by anyone — including us. To reach the practice, email <a href="mailto:health@insuresprhealth.co.za">health@insuresprhealth.co.za</a>.</span>
          </div>
          <form id="contact-form" novalidate>
            <div class="field-row">
              <div class="field"><label for="cname">Your name</label><input type="text" id="cname" name="name" autocomplete="name"></div>
              <div class="field"><label for="cemail">Email</label><input type="email" id="cemail" name="email" autocomplete="email"></div>
            </div>
            <div class="field"><label for="cmsg">Your question</label><textarea id="cmsg" name="message"></textarea></div>
            <button class="btn btn--primary" type="submit">Send question <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span></button>
            <div class="note" id="contact-status" hidden style="margin-top:1rem"></div>
          </form>
        </div>

        <div class="reveal reveal-d1">
          <div class="card" style="margin-bottom:1.15rem">
            <p class="eyebrow eyebrow--plain">Getting there</p>
            <h3>EmedCentre, Malibongwe Drive</h3>
            <p style="color:var(--muted)">The practice is inside the EmedCentre on Malibongwe Drive in Randburg.</p>
            <div class="btn-row" style="margin-top:1rem">
              <a class="btn btn--ghost btn--sm" href="https://maps.google.com/?q=7+Malibongwe+Drive+EmedCentre+Randburg" rel="noopener noreferrer" target="_blank">Open in Maps <span class="btn-badge"><svg class="icon" aria-hidden="true"><use href="#i-pin"></use></svg></span></a>
            </div>
          </div>
          <div class="card">
            <p class="eyebrow eyebrow--plain">Referrals and partnerships</p>
            <h3>Clinicians and facilities</h3>
            <p style="color:var(--muted)">The practice works with doctors, clinics, gyms and sports medicine teams. Same phone number and email.</p>
          </div>
        </div>
      </div>
    </div>
  </section>`,
});

for (const p of PAGES) {
  writeFileSync(p.file, shell(p));
  console.log(`  ${p.file}`);
}
console.log(`\n${PAGES.length} pages written. Now run stamp-icons, stamp-chrome and stamp-network.`);
