# Legacy SEO URL inventory and cutover review

Snapshot date: 2026-08-13 (Africa/Johannesburg)

Status: review document only. No redirects, DNS changes, sitemap changes, frontend changes, or content migration are implemented by this document.

## Executive result

The current public footprint contains **153 unique sitemap-listed URLs** across two sites:

| Source | Sitemap children | URL counts | Total |
|---|---:|---|---:|
| `https://insuresprhealth.co.za/wp-sitemap.xml` | 5 | 52 posts + 19 pages + 7 categories + 69 tags + 1 author | **148** |
| `https://xrayonmalebongwe.co.za/sitemap.xml` | 1 URL set | 5 routed pages | **5** |
| Combined | — | No duplicate absolute URLs across the two hosts | **153** |

Count verification was performed directly against the live XML sitemaps. The WordPress REST API independently returned 52 published posts, 19 published pages, and 7 categories. It returned 81 tags in total, but only the 69 non-empty/indexed tags appear in the XML sitemap; the 12 zero-count tags are correctly excluded from this inventory.

The authoritative WordPress sitemap is `https://insuresprhealth.co.za/wp-sitemap.xml`, as declared in `robots.txt`. `https://insuresprhealth.co.za/sitemap_index.xml` is not a sitemap and currently serves the WordPress “Page not found” HTML response.

## How to read the recommendations

- A direct path such as `/dxa-body-composition` means a one-hop permanent redirect is likely appropriate after content and operational approval.
- **Preserve 1:1** means the source has distinct informational value. It should be migrated as its own article before cutover. Redirecting many unique articles to a generic service page would risk being treated as a soft 404 and would discard useful search intent.
- A related hub shown after “Preserve 1:1” is an internal-link destination, not a substitute redirect.
- **Hold / replacement required** means no safe target exists yet. Do not point it at the homepage simply to eliminate a 404.
- “Content/licensing review” includes confirming practice ownership of copy and rights to all photographs, graphics, testimonials, logos, and embedded media.
- “Clinical review” means a suitably authorised practice reviewer must approve medical, diagnostic, radiation, supplement, treatment, screening, or outcome claims before republication.

## WordPress posts — 52 URLs

| Source URL and live title | Type | Recommended destination | Confidence | Content/licensing review | Clinical review |
|---|---|---|---|---|---|
| [2022/03/31/confident-step-for-life](https://insuresprhealth.co.za/2022/03/31/confident-step-for-life/) — Why did I start InsureSPR Health and what does the name means | Brand-origin article | `/spr` | High | Yes—confirm authorship/media | Yes—review service and health claims |
| [2022/10/13/osteoporosis](https://insuresprhealth.co.za/2022/10/13/osteoporosis/) — Osteoporosis | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2022/10/24/diabetes-and-osteoporosisbone](https://insuresprhealth.co.za/2022/10/24/diabetes-and-osteoporosisbone/) — Diabetes and Osteoporosis—A life changing duo | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2023/02/06/keep-your-bones-healthmove-freely-maintain-your-posture-and-balance](https://insuresprhealth.co.za/2023/02/06/keep-your-bones-healthmove-freely-maintain-your-posture-and-balance/) — DXA—More than Bone density test! | DXA education article | Preserve 1:1; related hub `/dxa-bone-density` | High | Yes | Yes |
| [2023/03/05/https-insuresprhealth-co-za-diabetes-prevention-musclehealth-fractures](https://insuresprhealth.co.za/2023/03/05/https-insuresprhealth-co-za-diabetes-prevention-musclehealth-fractures/) — Diabetes shouldn’t be your type because you are more than that | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | Medium | Yes | Yes |
| [2023/03/31/https-www-insuresprhealth-co-za-blog-physicalhealthphysical-function](https://insuresprhealth.co.za/2023/03/31/https-www-insuresprhealth-co-za-blog-physicalhealthphysical-function/) — Physical Health = Physical Function | Preventive-health article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes |
| [2023/04/13/insurespr-bone-vitality-health-what-does-spr-stands-for](https://insuresprhealth.co.za/2023/04/13/insurespr-bone-vitality-health-what-does-spr-stands-for/) — What Does SPR stand for? | Brand explainer | `/spr` | High | Yes—confirm authorship/media | Yes—review health claims |
| [2023/05/03/is-calciuma-friend-or-a-foe](https://insuresprhealth.co.za/2023/05/03/is-calciuma-friend-or-a-foe/) — Is Calcium, A friend or A foe? | Nutrition/medical article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2023/05/21/the-dynamic-link-the-invincible-bond-between-your-mighty-bones-and-resilient-kidneys](https://insuresprhealth.co.za/2023/05/21/the-dynamic-link-the-invincible-bond-between-your-mighty-bones-and-resilient-kidneys/) — The bond between bones and kidneys | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2023/11/02/www-insuresprhealth-co-za-body-composition-blog](https://insuresprhealth.co.za/2023/11/02/www-insuresprhealth-co-za-body-composition-blog/) — Cushing’s syndrome and DXA body composition | Medical/DXA article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2023/11/29/www-insuresprhealth-co-za-blog-menopause](https://insuresprhealth.co.za/2023/11/29/www-insuresprhealth-co-za-blog-menopause/) — Menopause, vitality and bone health | Medical education article | Preserve 1:1; related hubs `/dxa-bone-density` and `/osteoporosis-care` | High | Yes | Yes |
| [2023/12/11/www-insuresprhealth-co-za-blog](https://insuresprhealth.co.za/2023/12/11/www-insuresprhealth-co-za-blog/) — Gut health and bone strength | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2024/02/15/www-insuresprhealth-co-za-dxa-body-composition](https://insuresprhealth.co.za/2024/02/15/www-insuresprhealth-co-za-dxa-body-composition/) — DXA Body Composition | Service/education article | `/dxa-body-composition` if the landing page preserves the material intent; otherwise preserve 1:1 | High | Yes | Yes |
| [2024/03/04/refine-your-fitness-focus-instantly](https://insuresprhealth.co.za/2024/03/04/refine-your-fitness-focus-instantly/) — Refine Your Fitness Focus instantly! | Fitness/DXA article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2024/04/28/chronic-kidney-disease-meets-osteoporosis](https://insuresprhealth.co.za/2024/04/28/chronic-kidney-disease-meets-osteoporosis/) — Chronic Kidney disease meets Osteoporosis | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2024/07/11/insurespr-health-nurse-led-comprehensive-osteoporosis-management](https://insuresprhealth.co.za/2024/07/11/insurespr-health-nurse-led-comprehensive-osteoporosis-management/) — Nurse led Comprehensive Osteoporosis Management | Service/medical article | `/osteoporosis-care` only after service scope and credentials are confirmed; otherwise preserve 1:1 | High | Yes | Yes—priority review |
| [2024/10/03/dxa-body-composition-for-sports](https://insuresprhealth.co.za/2024/10/03/dxa-body-composition-for-sports/) — DXA Body Composition for sports | Service/fitness article | `/dxa-body-composition` if intent is fully represented; otherwise preserve 1:1 | High | Yes | Yes |
| [2024/11/18/neuromuscular-training](https://insuresprhealth.co.za/2024/11/18/neuromuscular-training/) — Neuromuscular Training | Exercise/medical article | Preserve 1:1; related hub `/spr` | High | Yes | Yes |
| [2024/11/22/www-insuresprhealth-co-za-blog-2](https://insuresprhealth.co.za/2024/11/22/www-insuresprhealth-co-za-blog-2/) — Relative Energy Deficiency in Sport (RED-S) | Sports-medicine article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes—priority review |
| [2025/02/13/unlocking-health-insightsthe-power-of-dxa-body-composition-indices](https://insuresprhealth.co.za/2025/02/13/unlocking-health-insightsthe-power-of-dxa-body-composition-indices/) — DXA Body Composition Indices | DXA education article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2025/02/17/understanding-your-body-composition-a-comprehensive-analysis-with-dxa](https://insuresprhealth.co.za/2025/02/17/understanding-your-body-composition-a-comprehensive-analysis-with-dxa/) — Understanding Your Body Composition with DXA | DXA education article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2025/03/26/health-coach-for-bone-muscle-health-preservation](https://insuresprhealth.co.za/2025/03/26/health-coach-for-bone-muscle-health-preservation/) — Health Coach for Bone & Muscle Health | Health-coaching article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes—confirm coaching scope |
| [2025/03/29/after-50-youve-earned-wisdom-now-protect-your-strength](https://insuresprhealth.co.za/2025/03/29/after-50-youve-earned-wisdom-now-protect-your-strength/) — After 50, Protect Your Strength | Preventive-health article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes |
| [2025/03/31/understanding-perimenopause-and-the-role-of-dxa-in-body-composition-analysis](https://insuresprhealth.co.za/2025/03/31/understanding-perimenopause-and-the-role-of-dxa-in-body-composition-analysis/) — Perimenopause and DXA Body Composition | Medical/DXA article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2025/04/14/morning-stiffness-how-to-protect-your-bones-with-a-simple-morning-routine](https://insuresprhealth.co.za/2025/04/14/morning-stiffness-how-to-protect-your-bones-with-a-simple-morning-routine/) — Morning Stiffness and Bone Health | Medical/exercise article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes |
| [2025/04/16/sitting-is-the-new-smoking-but-what-is-it-doing-to-your-bones-and-muscles](https://insuresprhealth.co.za/2025/04/16/sitting-is-the-new-smoking-but-what-is-it-doing-to-your-bones-and-muscles/) — Sitting, Bones and Muscles | Preventive-health article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes |
| [2025/05/19/affordable-osteoporosis-screening-in-randburg-dxa-bone-scans-at-insurespr-health](https://insuresprhealth.co.za/2025/05/19/affordable-osteoporosis-screening-in-randburg-dxa-bone-scans-at-insurespr-health/) — Affordable Osteoporosis Screening in Randburg | Commercial/service article | `/dxa-bone-density`, but remove or approve all price/affordability claims first | High | Yes | Yes—priority review |
| [2025/06/10/gut-health-for-stronger-bones-a-vital-connection](https://insuresprhealth.co.za/2025/06/10/gut-health-for-stronger-bones-a-vital-connection/) — Gut Health for Stronger Bones | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2025/06/11/www-insuresprhealth-co-za-blog-3](https://insuresprhealth.co.za/2025/06/11/www-insuresprhealth-co-za-blog-3/) — Thyroid Function and Bone Health | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2025/06/19/mens-true-power-comes-from-within-strengthen-your-bones-strengthen-your-life](https://insuresprhealth.co.za/2025/06/19/mens-true-power-comes-from-within-strengthen-your-bones-strengthen-your-life/) — Men’s Bone Health | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2025/06/20/www-insuresprhealth-co-za-blog-4](https://insuresprhealth.co.za/2025/06/20/www-insuresprhealth-co-za-blog-4/) — Act now to treat Osteoporosis effectively | Treatment article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes—priority review |
| [2025/06/25/when-back-pain-is-more-than-just](https://insuresprhealth.co.za/2025/06/25/when-back-pain-is-more-than-just/) — Back Pain, Vertebral Wedge Fractures and Osteoporosis | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes—priority review |
| [2025/06/27/www-insuresprhealth-co-za-blog-5](https://insuresprhealth.co.za/2025/06/27/www-insuresprhealth-co-za-blog-5/) — 10 High-Protein Foods to Build Muscle | Nutrition article | Preserve 1:1; related hub `/dxa-body-composition` | Medium | Yes | Yes |
| [2025/07/14/www-insuresprhealth-co-za-blog-6](https://insuresprhealth.co.za/2025/07/14/www-insuresprhealth-co-za-blog-6/) — Falls Prevention, Balance and Mobility | Medical/exercise article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2025/07/30/www-insuresprhealth-co-za-blog-7](https://insuresprhealth.co.za/2025/07/30/www-insuresprhealth-co-za-blog-7/) — Nurse-Led Osteoporosis Clinics prevent fractures | Service/medical article | `/osteoporosis-care` only after credentials, scope, and outcome wording are approved; otherwise preserve 1:1 | High | Yes | Yes—priority review |
| [2025/08/08/www-insuresprhealth-co-za-blog-8](https://insuresprhealth.co.za/2025/08/08/www-insuresprhealth-co-za-blog-8/) — Which tool should monitor weight-management progress? | Body-composition article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2025/08/20/www-insuresprhealth-co-za-blog-9](https://insuresprhealth.co.za/2025/08/20/www-insuresprhealth-co-za-blog-9/) — The Best Protein to Help You Poop | Nutrition/digestive article | Preserve 1:1; no safe service-page redirect | High | Yes | Yes |
| [2025/08/25/osteoporosis-your-smile-what-to-know-and-do](https://insuresprhealth.co.za/2025/08/25/osteoporosis-your-smile-what-to-know-and-do/) — Osteoporosis & Your Smile | Medical/dental article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes—dental/medical review |
| [2025/09/02/www-insuresprhealth-co-za](https://insuresprhealth.co.za/2025/09/02/www-insuresprhealth-co-za/) — Gen Z’s Musculoskeletal Crisis | Medical/lifestyle article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes |
| [2025/09/19/to-do-or-not-do-dxa-vs-inbody](https://insuresprhealth.co.za/2025/09/19/to-do-or-not-do-dxa-vs-inbody/) — DXA vs InBody | Comparison article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes—check comparative claims | Yes |
| [2025/10/02/collagen-for-muscle-strength-mobility-and-bone-density](https://insuresprhealth.co.za/2025/10/02/collagen-for-muscle-strength-mobility-and-bone-density/) — Collagen for Muscle, Mobility and Bone Density | Supplement/medical article | Preserve 1:1; related hub `/spr` | High | Yes | Yes—priority review |
| [2025/10/18/www-insuresprhealth-co-za-blog-10](https://insuresprhealth.co.za/2025/10/18/www-insuresprhealth-co-za-blog-10/) — Strong Core, Strong Bones and Mobility | Exercise/medical article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes |
| [2026/01/15/dxa-body-composition](https://insuresprhealth.co.za/2026/01/15/dxa-body-composition/) — DXA Body Composition | Service/education article | `/dxa-body-composition` if content intent is fully represented; otherwise preserve 1:1 | High | Yes | Yes |
| [2026/02/11/insuresprhealth-co-za](https://insuresprhealth.co.za/2026/02/11/insuresprhealth-co-za/) — Accurate Body Composition and Weight Loss | DXA/weight article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2026/02/17/healthy-ageing-starts-with-what-you-measure-why-dxa-body-composition-matters](https://insuresprhealth.co.za/2026/02/17/healthy-ageing-starts-with-what-you-measure-why-dxa-body-composition-matters/) — Healthy Ageing and DXA Body Composition | DXA education article | Preserve 1:1; related hub `/dxa-body-composition` | High | Yes | Yes |
| [2026/03/02/www-insuresprhealth-co-za-2](https://insuresprhealth.co.za/2026/03/02/www-insuresprhealth-co-za-2/) — DXA for Fitness Monitoring | Service/fitness article | `/dxa-body-composition` if intent is fully represented; otherwise preserve 1:1 | High | Yes | Yes |
| [2026/03/17/www-insuresprhealth-co-za-blog-11](https://insuresprhealth.co.za/2026/03/17/www-insuresprhealth-co-za-blog-11/) — Unlocking Metabolic Health | Medical/DXA article | Preserve 1:1; related hub `/dxa-body-composition` | Medium | Yes | Yes |
| [2026/03/23/www-insuresprhealth-co-za-3](https://insuresprhealth.co.za/2026/03/23/www-insuresprhealth-co-za-3/) — Healthy Muscles, Healthy Movement, Healthier Life | Preventive-health article | Preserve 1:1; related hub `/spr` | Medium | Yes | Yes |
| [2026/04/01/why-mobility-decline-often-starts-at-the-ankle](https://insuresprhealth.co.za/2026/04/01/why-mobility-decline-often-starts-at-the-ankle/) — Why Mobility Decline Often Starts at the Ankle | Medical/exercise article | Preserve 1:1; related hub `/spr` | High | Yes | Yes |
| [2026/04/13/muscle-and-bone-health-our-focus-at-insurespr-health](https://insuresprhealth.co.za/2026/04/13/muscle-and-bone-health-our-focus-at-insurespr-health/) — Muscle and Bone Health: Our Focus | Brand/service article | `/spr` if all service claims are retained and approved; otherwise preserve 1:1 | High | Yes | Yes |
| [2026/05/11/www-insuresprhealth-co-za-family-history](https://insuresprhealth.co.za/2026/05/11/www-insuresprhealth-co-za-family-history/) — Family History and Osteoporosis | Medical education article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes |
| [2026/06/03/understanding-osteoporosis-medications](https://insuresprhealth.co.za/2026/06/03/understanding-osteoporosis-medications/) — Understanding Osteoporosis Medications | Medication article | Preserve 1:1; related hub `/osteoporosis-care` | High | Yes | Yes—priority review |

## WordPress pages — 19 URLs

| Source URL and live title | Type | Recommended destination | Confidence | Content/licensing review | Clinical review |
|---|---|---|---|---|---|
| [privacy-policy-2](https://insuresprhealth.co.za/privacy-policy-2/) — Privacy Policy | Legal/privacy page | `/privacy` after POPIA/legal approval | High | Legal review rather than licensing review | No |
| [falls-results-in-broken-bones](https://insuresprhealth.co.za/falls-results-in-broken-bones/) — About Us | About page | `/about` | High | Yes—confirm biographies, credentials, images, and claims | Yes—review clinical/service claims |
| [insuresprhealth-blog](https://insuresprhealth.co.za/insuresprhealth-blog/) — Blog | Article index | Hold / replacement required. Build an indexable article library before cutover | High | Yes—inherits article rights | Yes—inherits article review |
| [home](https://insuresprhealth.co.za/) — Home | Homepage | `/` | High | Yes—brand and image rights | Yes—service/health claims |
| [book-appointment-today](https://insuresprhealth.co.za/book-appointment-today/) — Book an Appointment Today | Booking page | `/book` | High | Operational/privacy review | No, unless service instructions are carried over |
| [my-bookings](https://insuresprhealth.co.za/my-bookings/) — My Bookings | Transactional/account page | `/manage-booking` after confirming feature parity and access controls | High | Operational/privacy/security review | No |
| [thank-you](https://insuresprhealth.co.za/thank-you/) — Thank you | Transactional confirmation page | Do not blanket-redirect into a stateful confirmation page; use `/book` or a neutral completion page after workflow review | Medium | Operational/privacy review | No |
| [cancel-appointment](https://insuresprhealth.co.za/cancel-appointment/) — Cancel page | Transactional cancellation page | `/manage-booking` | High | Operational/privacy/security review | No |
| [cancel-payment](https://insuresprhealth.co.za/cancel-payment/) — Cancel Payment page | Legacy payment page | Hold; `410 Gone` after confirming no active payment callbacks, otherwise map to replacement payment flow | High | Payment/finance/privacy review | No |
| [https-insuresprhealth-co-za-contact-now](https://insuresprhealth.co.za/https-insuresprhealth-co-za-contact-now/) — Contact | Contact page | `/contact` | High | Verify contact details and media | No |
| [insuresprhealth-dxa-bone-density-test](https://insuresprhealth.co.za/insuresprhealth-dxa-bone-density-test/) — Insure—Strong—Prevent—Reclaim of your Health | Mixed SPR/DXA landing page | `/dxa-bone-density` if the page’s primary intent is the test; otherwise `/spr` | Medium | Yes | Yes |
| [waitlist](https://insuresprhealth.co.za/waitlist/) — Waitlist | Legacy booking/waitlist page | Hold; map to `/book` only if the new operation accepts equivalent requests, otherwise `410 Gone` | Medium | Operational/privacy review | No |
| [appointment-cancellation-confirmation](https://insuresprhealth.co.za/appointment-cancellation-confirmation/) — Appointment cancellation confirmation | Transactional confirmation page | `/manage-booking` or a neutral cancellation-complete page after workflow review | High | Operational/privacy review | No |
| [insuresprhealth-blog/https-insuresprhealth-co-za-blog-resources](https://insuresprhealth.co.za/insuresprhealth-blog/https-insuresprhealth-co-za-blog-resources/) — Resources | Resource index | Hold / replacement required. Build an indexable resource library before cutover | High | Yes—inherits resource rights | Yes—inherits resource review |
| [shop](https://insuresprhealth.co.za/shop/) — Shop | WooCommerce catalogue | Hold; retain until the practice explicitly retires or replaces commerce, then map products individually or return `410 Gone` | High | Commercial, licensing, tax, and terms review | Yes for health-product claims |
| [cart](https://insuresprhealth.co.za/cart/) — Cart | WooCommerce transaction page | Hold; do not redirect until active carts/payment integrations are retired; then `410 Gone` | High | Commerce/privacy/security review | No |
| [checkout](https://insuresprhealth.co.za/checkout/) — Checkout | WooCommerce transaction page | Hold; do not redirect until payment callbacks/orders are audited; then `410 Gone` or replacement checkout | High | Commerce/privacy/security review | No |
| [my-account](https://insuresprhealth.co.za/my-account/) — My account | WooCommerce account page | Hold; migrate/export account and order obligations before retirement; then replacement account or `410 Gone` | High | Privacy/security/data-retention review | No |
| [privacy-policy-3](https://insuresprhealth.co.za/privacy-policy-3/) — Privacy Policy | Legal/privacy page | `/privacy` after POPIA/legal approval | High | Legal review rather than licensing review | No |

Important: the repository currently makes `/learn` a temporary redirect to `/`, and `learn.html` is marked `noindex, nofollow`. It is therefore **not** a safe destination for the Blog, Resources, posts, categories, or tags yet.

## WordPress category archives — 7 URLs

| Source URL and live name | Type | Recommended destination | Confidence | Content/licensing review | Clinical review |
|---|---|---|---|---|---|
| [category/insurespr-brand/bone/osteoporosis](https://insuresprhealth.co.za/category/insurespr-brand/bone/osteoporosis/) — Diabetes and Osteoporosis | Category archive | Future topic hub preferred; interim `/osteoporosis-care` only if it represents the indexed intent | Medium | Inherited from articles | Yes—inherited |
| [category/insurespr-brand](https://insuresprhealth.co.za/category/insurespr-brand/) — InsureSPR Brand | Category archive | `/spr` | High | Inherited from articles | Yes—inherited |
| [category/insurespr-brand/bone](https://insuresprhealth.co.za/category/insurespr-brand/bone/) — Bonehealth | Category archive | Future bone-health hub preferred; interim `/dxa-bone-density` | Medium | Inherited from articles | Yes—inherited |
| [category/insurespr-brand/muscles](https://insuresprhealth.co.za/category/insurespr-brand/muscles/) — Musclehealth | Category archive | Future muscle-health hub preferred; interim `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [category/dxa-body-composition](https://insuresprhealth.co.za/category/dxa-body-composition/) — DXA Body composition | Category archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [category/workplace-wellness](https://insuresprhealth.co.za/category/workplace-wellness/) — Workplace wellness | Category archive | `/workplace-medicals` | High | Inherited from articles | Yes—inherited |
| [category/insurespr-brand/workplace-wellness-insurespr-brand](https://insuresprhealth.co.za/category/insurespr-brand/workplace-wellness-insurespr-brand/) — Workplace wellness | Duplicate category archive | `/workplace-medicals` | High | Inherited from articles | Yes—inherited |

## WordPress tag archives — 69 URLs

These are thin archive pages, not the underlying articles. Redirect only when the destination genuinely represents the tag’s search intent; otherwise retire the archive after its articles have been preserved.

| Source URL | Type | Recommended destination | Confidence | Content/licensing review | Clinical review |
|---|---|---|---|---|---|
| [tag/bone-health](https://insuresprhealth.co.za/tag/bone-health/) | Tag archive | `/osteoporosis-care` | Medium | Inherited from articles | Yes—inherited |
| [tag/musclehealth](https://insuresprhealth.co.za/tag/musclehealth/) | Tag archive | `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [tag/osteoporosis](https://insuresprhealth.co.za/tag/osteoporosis/) | Tag archive | `/osteoporosis-care` | High | Inherited from articles | Yes—inherited |
| [tag/boneloss](https://insuresprhealth.co.za/tag/boneloss/) | Tag archive | `/dxa-bone-density` | High | Inherited from articles | Yes—inherited |
| [tag/muscleloss](https://insuresprhealth.co.za/tag/muscleloss/) | Tag archive | `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [tag/wellness](https://insuresprhealth.co.za/tag/wellness/) | Tag archive | `/spr` | Medium | Inherited from articles | Yes—inherited |
| [tag/diabetes](https://insuresprhealth.co.za/tag/diabetes/) | Tag archive | `/osteoporosis-care`; a dedicated article hub would be safer | Low | Inherited from articles | Yes—inherited |
| [tag/preventivehealth](https://insuresprhealth.co.za/tag/preventivehealth/) | Tag archive | `/spr` | High | Inherited from articles | Yes—inherited |
| [tag/calcium](https://insuresprhealth.co.za/tag/calcium/) | Tag archive | `/osteoporosis-care` | Medium | Inherited from articles | Yes—inherited |
| [tag/vitamin-d](https://insuresprhealth.co.za/tag/vitamin-d/) | Tag archive | `/osteoporosis-care` | Medium | Inherited from articles | Yes—inherited |
| [tag/bonehealth](https://insuresprhealth.co.za/tag/bonehealth/) | Duplicate tag archive | `/osteoporosis-care` | Medium | Inherited from articles | Yes—inherited |
| [tag/bone-density](https://insuresprhealth.co.za/tag/bone-density/) | Tag archive | `/dxa-bone-density` | High | Inherited from articles | Yes—inherited |
| [tag/cushing](https://insuresprhealth.co.za/tag/cushing/) | Tag archive | `/dxa-body-composition`; preserve its underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/menopause](https://insuresprhealth.co.za/tag/menopause/) | Tag archive | `/dxa-bone-density`; a dedicated article hub would be safer | Medium | Inherited from articles | Yes—inherited |
| [tag/gut-health](https://insuresprhealth.co.za/tag/gut-health/) | Tag archive | `/osteoporosis-care`; preserve underlying articles first | Low | Inherited from articles | Yes—inherited |
| [tag/gut-bone-axis](https://insuresprhealth.co.za/tag/gut-bone-axis/) | Tag archive | `/osteoporosis-care`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/dxa-body-composition](https://insuresprhealth.co.za/tag/dxa-body-composition/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/weight-loss](https://insuresprhealth.co.za/tag/weight-loss/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/weight-management](https://insuresprhealth.co.za/tag/weight-management/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/sportsperformance](https://insuresprhealth.co.za/tag/sportsperformance/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/eliteathletes](https://insuresprhealth.co.za/tag/eliteathletes/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/soccerteams](https://insuresprhealth.co.za/tag/soccerteams/) | Tag archive | `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [tag/ckd](https://insuresprhealth.co.za/tag/ckd/) | Tag archive | `/osteoporosis-care`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/vitamind](https://insuresprhealth.co.za/tag/vitamind/) | Duplicate tag archive | `/osteoporosis-care` | Medium | Inherited from articles | Yes—inherited |
| [tag/chronic-kidney-disease](https://insuresprhealth.co.za/tag/chronic-kidney-disease/) | Tag archive | `/osteoporosis-care`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/osteoporosis-management](https://insuresprhealth.co.za/tag/osteoporosis-management/) | Tag archive | `/osteoporosis-care` | High | Inherited from articles | Yes—inherited |
| [tag/neuromuscular](https://insuresprhealth.co.za/tag/neuromuscular/) | Tag archive | `/spr`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/sports-injuries](https://insuresprhealth.co.za/tag/sports-injuries/) | Tag archive | `/dxa-body-composition`; preserve underlying article first | Low | Inherited from articles | Yes—inherited |
| [tag/sports-performance](https://insuresprhealth.co.za/tag/sports-performance/) | Duplicate tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/resistant-training](https://insuresprhealth.co.za/tag/resistant-training/) | Tag archive | `/spr`; preserve underlying article first | Low | Inherited from articles | Yes—inherited |
| [tag/weight-bearing](https://insuresprhealth.co.za/tag/weight-bearing/) | Tag archive | `/spr`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/rugby](https://insuresprhealth.co.za/tag/rugby/) | Tag archive | `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [tag/athletes](https://insuresprhealth.co.za/tag/athletes/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/health-coach](https://insuresprhealth.co.za/tag/health-coach/) | Tag archive | `/spr`; do not imply an offered programme until confirmed | Medium | Inherited from articles | Yes—inherited |
| [tag/workplace-wellness](https://insuresprhealth.co.za/tag/workplace-wellness/) | Tag archive | `/workplace-medicals` | High | Inherited from articles | Yes—inherited |
| [tag/executive-wellness](https://insuresprhealth.co.za/tag/executive-wellness/) | Tag archive | `/workplace-medicals` | Medium | Inherited from articles | Yes—inherited |
| [tag/executive-wellness-near-me](https://insuresprhealth.co.za/tag/executive-wellness-near-me/) | Tag archive | `/workplace-medicals` | Medium | Inherited from articles | Yes—inherited |
| [tag/digestive-health](https://insuresprhealth.co.za/tag/digestive-health/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/immune-health](https://insuresprhealth.co.za/tag/immune-health/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/thyroid-function](https://insuresprhealth.co.za/tag/thyroid-function/) | Tag archive | `/osteoporosis-care`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/testosterone](https://insuresprhealth.co.za/tag/testosterone/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/early-screening](https://insuresprhealth.co.za/tag/early-screening/) | Tag archive | `/dxa-bone-density` | Medium | Inherited from articles | Yes—inherited |
| [tag/musclehealth-2](https://insuresprhealth.co.za/tag/musclehealth-2/) | Duplicate tag archive | `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [tag/fall-prevention](https://insuresprhealth.co.za/tag/fall-prevention/) | Tag archive | `/osteoporosis-care`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/nurse-led-clinic](https://insuresprhealth.co.za/tag/nurse-led-clinic/) | Tag archive | `/osteoporosis-care` only after staff credentials and scope are approved | High | Inherited from articles | Yes—priority review |
| [tag/weightloss](https://insuresprhealth.co.za/tag/weightloss/) | Duplicate tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/constipation](https://insuresprhealth.co.za/tag/constipation/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/fibre](https://insuresprhealth.co.za/tag/fibre/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/gen-z](https://insuresprhealth.co.za/tag/gen-z/) | Tag archive | `/spr`; preserve underlying article first | Low | Inherited from articles | Yes—inherited |
| [tag/mental-health](https://insuresprhealth.co.za/tag/mental-health/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/fads-diets](https://insuresprhealth.co.za/tag/fads-diets/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/inbody](https://insuresprhealth.co.za/tag/inbody/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles; check competitor/trademark references | Yes—inherited |
| [tag/fitness](https://insuresprhealth.co.za/tag/fitness/) | Tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/type-1-collagen](https://insuresprhealth.co.za/tag/type-1-collagen/) | Tag archive | `/spr`; preserve supplement article first | Low | Inherited from articles | Yes—priority review |
| [tag/joint-cartilage](https://insuresprhealth.co.za/tag/joint-cartilage/) | Tag archive | `/spr`; preserve underlying article first | Low | Inherited from articles | Yes—inherited |
| [tag/muscle-health](https://insuresprhealth.co.za/tag/muscle-health/) | Duplicate tag archive | `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [tag/weightloss-2](https://insuresprhealth.co.za/tag/weightloss-2/) | Duplicate tag archive | `/dxa-body-composition` | High | Inherited from articles | Yes—inherited |
| [tag/healthy-ageing](https://insuresprhealth.co.za/tag/healthy-ageing/) | Tag archive | `/spr`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/dexa](https://insuresprhealth.co.za/tag/dexa/) | Tag archive | `/scanning` because the tag spans DXA purposes | High | Inherited from articles | Yes—inherited |
| [tag/bone-density-near-me](https://insuresprhealth.co.za/tag/bone-density-near-me/) | Tag archive | `/dxa-bone-density` | High | Inherited from articles | Yes—inherited |
| [tag/vitality](https://insuresprhealth.co.za/tag/vitality/) | Tag archive | `/spr` | Medium | Inherited from articles | Yes—inherited |
| [tag/chronic-disease](https://insuresprhealth.co.za/tag/chronic-disease/) | Tag archive | `/spr`; preserve underlying article first | Low | Inherited from articles | Yes—inherited |
| [tag/mobility](https://insuresprhealth.co.za/tag/mobility/) | Tag archive | `/spr`; preserve underlying articles first | Medium | Inherited from articles | Yes—inherited |
| [tag/ankle](https://insuresprhealth.co.za/tag/ankle/) | Tag archive | Hold; preserve the article because no equivalent service page exists | High | Inherited from articles | Yes—inherited |
| [tag/joint-health](https://insuresprhealth.co.za/tag/joint-health/) | Tag archive | `/spr`; preserve underlying article first | Low | Inherited from articles | Yes—inherited |
| [tag/muscle](https://insuresprhealth.co.za/tag/muscle/) | Tag archive | `/dxa-body-composition` | Medium | Inherited from articles | Yes—inherited |
| [tag/family-history](https://insuresprhealth.co.za/tag/family-history/) | Tag archive | `/osteoporosis-care`; preserve underlying article first | Medium | Inherited from articles | Yes—inherited |
| [tag/osateoporosis](https://insuresprhealth.co.za/tag/osateoporosis/) | Misspelled duplicate tag archive | `/osteoporosis-care` | High | Inherited from articles | Yes—inherited |
| [tag/osteoporosis-medications](https://insuresprhealth.co.za/tag/osteoporosis-medications/) | Tag archive | `/osteoporosis-care`; preserve medication article first | Medium | Inherited from articles | Yes—priority review |

## WordPress author archive — 1 URL

| Source URL | Type | Recommended destination | Confidence | Content/licensing review | Clinical review |
|---|---|---|---|---|---|
| [author/patloma](https://insuresprhealth.co.za/author/patloma/) | Author archive | `/about` only after the person’s identity, role, credentials, consent, and article attribution are verified; otherwise preserve an author profile or return `410 Gone` | Medium | Yes—identity, attribution, image, and consent review | Yes—credentials and authorship review |

## XrayOnMalebongwe — 5 sitemap URLs

The public sitemap at `https://xrayonmalebongwe.co.za/sitemap.xml` lists exactly five URLs. A search-engine `site:` query surfaced the homepage, while the sitemap and JavaScript application expose the four routed subpages below. No additional first-party public routes were found in the current application bundle.

| Source URL | Type | Recommended destination | Confidence | Content/licensing review | Clinical review |
|---|---|---|---|---|---|
| [xrayonmalebongwe.co.za](https://xrayonmalebongwe.co.za/) | X-Ray homepage | `/xray` | High | Yes—brand, images, testimonials/statistics, and copy | Yes—priority review of service, turnaround, safety, and outcome claims |
| [xrayonmalebongwe.co.za/about](https://xrayonmalebongwe.co.za/about) | X-Ray about page | `/xray` if it is practice/service background; `/about` if it is organisation-wide | Medium | Yes—biographies, credentials, images, and statistics | Yes—credentials and claims |
| [xrayonmalebongwe.co.za/services](https://xrayonmalebongwe.co.za/services) | X-Ray service index | `/xray`, with links to `/primary-healthcare-x-ray`, `/visa-chest-x-ray`, and `/workplace-medicals` | High | Yes | Yes—service scope and requirements |
| [xrayonmalebongwe.co.za/contact](https://xrayonmalebongwe.co.za/contact) | Contact page | `/contact` | High | Verify address, phone, email, hours, and map rights | No, unless service claims appear |
| [xrayonmalebongwe.co.za/referral](https://xrayonmalebongwe.co.za/referral) | Referral/provider route | `/primary-healthcare-x-ray` only if the referral workflow is reproduced; otherwise hold until a secure referral path exists | Medium | Form/privacy/workflow review | Yes—referral requirements and professional scope |

### X-Ray-site facts that must not be carried over without approval

The currently indexed homepage presents claims including “Walk-ins welcome,” “Same-day appointments,” “15+ years experience,” “50K+ scans,” “24/7 emergency services,” “98% patient satisfaction,” “fast turnaround,” “state-of-the-art equipment,” and “affordable.” Those claims are not automatically validated by sitemap presence and conflict with the rebuilt site’s deliberate “Practice confirmation required” posture. They require documentary, clinical, regulatory, and advertising review before republication.

The X-Ray site also publishes `xrayonmalebongwe@gmail.com`, while the main WordPress site publishes `health@insuresprhealth.co.za`. The practice must choose and verify the destination mailbox before cutover.

## Redirect and cutover risks

### Critical risks

1. **Do not switch DNS before the redirect map exists on the destination host.** The old WordPress paths would otherwise fall through to the new static 404 page, losing accumulated links and search signals.
2. **Do not mass-redirect all 52 articles, categories, and tags to `/`, `/spr`, or one service page.** Unique informational intent should be preserved 1:1. Broad redirects are likely to behave like soft 404s and produce a poor visitor experience.
3. **The article destination does not exist yet.** `learn.html` is `noindex, nofollow`, and Vercel currently redirects `/learn` temporarily to `/`. Blog and resource URLs must stay on WordPress or be migrated before domain cutover.
4. **WooCommerce and booking endpoints may carry live obligations.** `shop`, `cart`, `checkout`, `my-account`, payment cancellation, waitlist, and booking-management URLs must be audited for orders, callbacks, stored accounts, refunds, retention duties, and links in email/SMS messages before retirement.
5. **Do not redirect transactional success pages into stateful new pages.** A generic legacy `thank-you` request must not be allowed to manufacture or expose a new booking confirmation. The replacement must be neutral unless it has verified booking state.
6. **Clinical and credential claims need named approval.** Osteoporosis treatment, medication, supplementation, nurse-led care, radiation, referral, emergency, turnaround, price, result, and outcome claims should not be copied merely because they are live today.

### Canonical and host risks

- Every tested X-Ray SPA route (`/`, `/about`, `/services`, `/contact`, and `/referral`) returns an indexable HTML shell with the same title and canonical URL, `https://xrayonmalebongwe.co.za`. This conflicts with its five-URL sitemap and collapses all subpage canonical signals onto the homepage.
- `http://xrayonmalebongwe.co.za/` currently uses a `308` redirect to HTTPS. Preserve a one-hop HTTPS redirect at cutover.
- `www.xrayonmalebongwe.co.za` does not currently resolve. Do not add redirects for that hostname unless DNS and a valid TLS certificate are deliberately provisioned.
- The live domain is spelled **malebongwe**. The road and rebuilt copy use **Malibongwe**. `xrayonmalibongwe.co.za` did not resolve during this audit. Treat the correctly spelled domain as a separate acquisition/brand decision, not as an assumed redirect source.
- `http://insuresprhealth.co.za/` redirects once to HTTPS, and `https://www.insuresprhealth.co.za/` redirects once to the non-`www` HTTPS host. Preserve `https://insuresprhealth.co.za` as the single canonical host to avoid chains and loops.
- The rebuilt site uses extensionless canonicals and Vercel `cleanUrls`. Redirect each legacy URL directly to the final extensionless target; avoid an old URL → `.html` URL → clean URL chain.
- Never configure `insuresprhealth.co.za` to redirect wholesale to `insurespr.vercel.app` while page canonicals point back to `insuresprhealth.co.za`; that would split users and canonical signals. Attach the custom domain to the final project and keep one canonical origin.

### Content and media risks

- Practice ownership of a domain or WordPress login does not prove transferable rights to stock photos, guest copy, diagrams, testimonials, or embedded third-party media. Export source/license records before shutting down WordPress storage.
- Preserve original media filenames, alt text, captions, publication dates, authorship, and article-to-image relationships during migration. Do not hotlink retired WordPress assets from the new site.
- Keep a read-only export of WordPress content, media, redirect sources, WooCommerce records, form submissions, and relevant consent records according to the practice’s approved retention policy.

## Recommended cutover sequence

1. Obtain practice sign-off on services, credentials, pricing/medical-aid language, referral rules, claims, privacy copy, and the two published email addresses.
2. Export WordPress posts, pages, media metadata, authors, taxonomies, WooCommerce data, form/booking dependencies, and analytics landing-page history.
3. Decide which of the 52 articles will be migrated 1:1. Publish and clinically review those destinations before any permanent redirect.
4. Make the future article index crawlable and canonical. Remove the current `/learn` → `/` temporary redirect only when a real replacement is ready.
5. Build a version-controlled redirect map with one row for every approved source URL in this document. Use one-hop permanent redirects for genuine equivalents, and intentional `410 Gone` responses only for approved retired pages with no replacement.
6. Add host-level handling for HTTP and `www` variants without creating a return redirect to WordPress or the Vercel preview hostname.
7. Test every redirect in a staging/custom-domain preview for final status, hop count, canonical, indexability, query-string handling, booking-state safety, and absence of loops.
8. Switch DNS only after the destination, redirect map, forms, notifications, analytics, Search Console verification, robots file, and XML sitemap are ready.
9. Submit the new sitemap in Google Search Console and Bing Webmaster Tools; retain redirects for at least 12 months and preferably indefinitely for durable backlinks.
10. Monitor 404s, redirect chains, canonical mismatches, crawl errors, landing-page traffic, bookings, and calls immediately after cutover.

## Machine-checkable count ledger

| Inventory section | Expected rows |
|---|---:|
| WordPress posts | 52 |
| WordPress pages | 19 |
| WordPress categories | 7 |
| WordPress tags | 69 |
| WordPress authors | 1 |
| XrayOnMalebongwe URLs | 5 |
| **Total** | **153** |

Live evidence used:

- `https://insuresprhealth.co.za/robots.txt`
- `https://insuresprhealth.co.za/wp-sitemap.xml`
- `https://insuresprhealth.co.za/wp-sitemap-posts-post-1.xml`
- `https://insuresprhealth.co.za/wp-sitemap-posts-page-1.xml`
- `https://insuresprhealth.co.za/wp-sitemap-taxonomies-category-1.xml`
- `https://insuresprhealth.co.za/wp-sitemap-taxonomies-post_tag-1.xml`
- `https://insuresprhealth.co.za/wp-sitemap-users-1.xml`
- WordPress REST collections for posts, pages, categories, and tags, used to verify titles and counts
- `https://xrayonmalebongwe.co.za/robots.txt`
- `https://xrayonmalebongwe.co.za/sitemap.xml`
- Live X-Ray HTML metadata and application routes
