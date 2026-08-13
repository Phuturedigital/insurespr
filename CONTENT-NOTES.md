# Content notes — what is real, what is ours

The standing rule on this site: **no fictions.** Everything factual traces to
the practice's own published material. Where this concept adds something, it is
interpretation of a real claim, never an invented one.

Source: <https://insuresprhealth.co.za> — homepage, About
(`/falls-results-in-broken-bones/`), Blog (`/insuresprhealth-blog/`), Contact and
Book Appointment pages. Verified 7 Aug 2026.

## Verified facts, used as-is

| Fact | Value |
|---|---|
| Address | 7 Malibongwe Drive, EmedCentre, Randburg |
| Hours | 08:00 – 17:00 |
| Phone | 083 450 7861 |
| Email | health@insuresprhealth.co.za |
| Social | Facebook `/InsureSPR` · LinkedIn `/company/InsureSPR` · Twitter `@Bonevitalityc` |

## The three programmes — the practice's own names and definitions

Taken verbatim from the practice's About page mission list:

- **InsureStrong** — "Build and maintain healthy bone and muscle mass"
- **InsurePrevent** — "Stop bone and muscle loss before it starts"
- **InsureReclaim** — "Restore what's been lost so you can live boldly"

The practice groups its clinical services under **"InsureBone Vitality"**.

## The nine service names

Kept exactly as the practice writes them, each given a plain-English translation
and an outcome line. The practice's list:

HealthCoaching · Breatheez (Diaphragmatic gateway) · DXA Bone Density · Overuse
Injury correction · DXA Body composition for Fitness and weight Management ·
Neck and Shoulder Mobility · Back, hip, knees Mobility · Posture, Flexibility
and balance Assessment (fall prevention)

*"Sports and fitness assessment"* is our label for the audience the practice
describes under "Who We Serve → Sports & Fitness Facilities". It is a framing of
a real offering, not an extra service.

## Real claims this concept leans on

Each is a paraphrase of the practice's own wording, not a new assertion:

- **One consultation, one price.** From About: the nurse-led Osteoporosis Clinic
  *"offers a single, affordable consultation that includes your bone density
  scans and assessments all at one price."* This is the practice's own stated
  differentiator and drives the osteoporosis-clinic outcome line.
- **Primary and secondary osteoporosis.** From About: *"We are your hub for
  screening, diagnosis, and management of primary and secondary osteoporosis."*
- **BMI is outdated.** From About: *"Traditional tools like BMI are
  population-based and outdated. DXA scans provide personalised, science-based
  data."* Drives the "Rethink how you measure health" section.
- **Healthspan.** From About: *"improve healthspan – the years you live strong,
  independent, and free from disability"* and *"Don't outlive your health."*
- **Two professional audiences.** Medical facilities/health professionals, and
  sports/fitness facilities. Both are the practice's own.

## Article titles

`learn.html` uses **real article titles from the practice's blog**, credited in
the footer. They are titles and topics only — the article bodies on this concept
are not the practice's text, and no article is reproduced.

## ⚠️ No pricing anywhere

The real site publishes **no prices** — its booking form returns *"No categories
and services added!"*, so even the service list is unconfigured. This concept
therefore shows **no prices at all**, and its booking flow is a design mockup
that submits nothing. Do not add indicative pricing: for a real medical practice
that would be an invented commercial claim, not a design placeholder.

## What is ours

- All layout, typography, colour application, iconography and motion.
- Every plain-English translation and outcome line.
- The photography (licence-free stock, chosen to show real people at the ages
  the practice actually serves).
- The redrawn logo mark. The practice's supplied artwork was sampled for colour
  only — see `tools/sample-colours.mjs` for why thin gradient strokes must be
  sampled by peak chroma rather than by frequency.

## Photography credits

All frames are Pexels licence (free for commercial use, no attribution
required). Credited here anyway — "where did this image come from" always gets
asked. Every id is pinned in `tools/fetch-assets.mjs`, which also records why
each was chosen and, for the near misses, why they were rejected.

Sourced for the **production** service pages:

| Asset | Photographer | Used on |
| --- | --- | --- |
| `xray-room.webp` | Pavel Danilyuk | xray hero, index route card |
| `xray-position.webp` | Pavel Danilyuk | xray — Primary Healthcare X-Ray |
| `xray-chest.webp` | cottonbro studio | xray — Visa Application Chest X-Ray |
| `certificate.webp` | Paloma Gil | xray — Certificates |
| `workforce-med.webp` | cottonbro studio | workforce, index route card |
| `workforce-team.webp` | Harrun Muhammad | workforce — Staff x-rays |
| `workforce-quote.webp` | Ron Lach | workforce — quote aside |
| `scan-body.webp` | RDNE Stock project | scanning, index route card |
| `reception.webp` | Cedric Fauntleroy | book |

`strong.webp`, `prevent.webp` and `reclaim.webp` were sourced during the
concept pass and sat unused until the SPR pillars were built; they carry the
concept-era exercise register, which is correct on `spr.html` and nowhere else
on the production site.

**Three rejections worth keeping on record**, because each looked fine as a
thumbnail:

- A four-frame reception set (`6812426` and siblings) carries a **"DeKo+"
  dental-clinic logo** on the wall. Another practice's branding — a dental one
  — on InsureSPR's booking page.
- Two body-composition frames (`7558818`, `5714350`) are bikini-and-caliper
  shots. They read as an aesthetics or weight-loss service rather than a
  clinical measurement, and this practice's own copy calls BMI
  "population-based and outdated".
- `6812457` is a dental **panoramic** unit. It was rejected once in the concept
  pass and came back to the top of the same query.

## Not built

⚠️ **Superseded.** This section described the concept build, where the booking
and contact forms had no backend and said so on the page. The production site
on `codex/insurespr-production` submits to a real Supabase project
(`insurespr-api`, `insurespr-notifications` and the migrations under
`supabase/`), so a submission now creates a real record and can notify staff.
Do not rely on the old "it is only a mockup" framing when editing these forms.
