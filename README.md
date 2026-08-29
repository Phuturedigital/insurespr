# InsureSPR Precision Healthcare

Production-preparation branch for the InsureSPR acquisition, booking and intake
website. The repository began as an independent Phuture Digital concept; the
historical concept pages and assets remain in git for provenance, but
`.vercelignore` keeps them out of the production artifact.

The public experience is a zero-build static site with three clear route families:

- individuals and published x-ray pathways (`xray.html`)
- employers and workplace medicals (`workforce.html`)
- DXA bone-density and body-composition scanning (`scanning.html`)

Sixteen standalone, crawlable service and need-led pathway pages sit beneath
those route pages, including ten Johannesburg-focused X-Ray and DXA additions,
with separate SPR and owner/founder stories. Every page remains a portable HTML
file; there is no framework build step or browser-side database credential.

Booking, contact, employer-quote and booking-management requests go through a
validated public Supabase Edge Function. A separate, scheduler-only function
processes notification intent after the underlying record commits. Browser code
has no database key and cannot query operational tables directly.

The booking review has two deliberate completion routes: save the request and
show the confirmation, or save it and continue on WhatsApp. The WhatsApp route
persists the same structured booking first, carries a one-time scheduling draft
to the confirmation page, and lets the visitor copy it before opening the
approved `27834507861` chat. Names, services, contact details, notes and booking
references are never placed in the WhatsApp URL; the draft is removed from
session storage as soon as it is rendered.

## Current state

- Supabase project: `ffdmmxffzewqiacsuvhr`
- API: `https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-api`
- Database migrations: `supabase/migrations/`
- Public Edge Function: `supabase/functions/insurespr-api/`
- Fail-closed notification worker: `supabase/functions/insurespr-notifications/`
- Prepared notification activation and rehearsal contract:
  `NOTIFICATION-ACTIVATION-HANDOFF.json` and `NOTIFICATION-ACTIVATION.md`
- Staff operations runbook: `OPERATIONS-RUNBOOK.md`
- Production browser integration: `production.js`
- Launch and approval checklist: `PRODUCTION-READINESS.md`
- Prepared Google Business Profile account handoff:
  `GOOGLE-BUSINESS-PROFILE-ALIGNMENT.json` (excluded from Vercel; not applied)
- Prepared 16-service evidence and approval handoff:
  `SERVICE-ACTIVATION-HANDOFF.json` (excluded from Vercel; not approved)
- Prepared privacy and processor activation handoff:
  `PRIVACY-ACTIVATION-HANDOFF.json` (excluded from Vercel; privacy still pending)
- Prepared DXA availability, schedule and rollback handoff:
  `AVAILABILITY-ACTIVATION-HANDOFF.json` (excluded from Vercel; no slots created)
- Recovery ownership and restore drill: `RECOVERY-RESTORE-DRILL.md`
- Fact provenance: `CONTENT-NOTES.md`
- Supplied rate evidence review: `XOM-RATES-2026-REVIEW.md`
- Exact legacy URL inventory: `LEGACY-SEO-URL-INVENTORY.md`
- Public-archive recovery metadata for the exact inventory:
  `LEGACY-SNAPSHOT-EVIDENCE.json` (timestamps and digests only; no copied or
  approved clinical article content)
- Owner decisions and evidence boundaries: `LAUNCH-APPROVALS.md`
- Private operational evidence reconciliation: `OPERATIONAL-EVIDENCE-REGISTER.md`
- Website retention and data-subject procedure: `PRIVACY-OPERATIONS.md`
- Owner-only privacy-request and incident templates:
  `supabase/snippets/privacy_operations.sql`
- Owner-only acquisition funnel templates:
  `supabase/snippets/acquisition_reporting.sql`
- Owner-only bounded daily work queues:
  `supabase/snippets/staff_work_queues.sql`
- Owner-only aggregate launch-control snapshot:
  `supabase/snippets/launch_readiness.sql` (no submission fields, contact
  values, evidence locations or secrets)
- Turnstile, email and contact-channel activation: `PROVIDER-ACTIVATION.md`

The database schema, public API and canonical frontend are deployed. The public
site is served at `https://www.insuresprhealth.co.za/`. Privacy publication
version `2026-08-21.1` is owner-approved, but transactional intake is still
deliberately fail-closed until Information Officer evidence, Turnstile,
service facts, availability and notification dependencies in
`PRODUCTION-READINESS.md` are approved and configured. The uncached services
response exposes only the composite `intake_ready` boolean, and the existing
forms remain disabled unless it is explicitly `true`.

## Local preview

Serve the directory over HTTP; do not open the files with a `file:` URL.

```powershell
python -m http.server 5177
```

Then open `http://localhost:5177/`. The production Edge Function intentionally
accepts only the official apex and `www` origins, so local forms stay gated
unless they are run against a separate local/test API. `tools/audit.mjs` stubs
the public configuration and analytics endpoints; it never weakens production
CORS or writes to the production project.

The browser audit also accepts an explicit preview origin when its usual port
is occupied:

```powershell
node tools/audit.mjs http://127.0.0.1:4319
```

## Supabase workflow

The committed migration names and SQL correspond to the remote project history;
MCP-applied rows can have later deployment timestamps than their local files.
The Supabase CLI configuration deliberately disables automatic exposure of new
tables. All public-schema tables use row-level security; direct `anon` and
`authenticated` access to operational records is revoked. Server-side RPCs own
the transactional writes.

Owner-supplied readiness documents are represented by private, hash-bound
metadata and field-level claims rather than being copied into the public
website or repository. A supplied claim remains distinct from independent
verification and publication permission; see `OPERATIONAL-EVIDENCE-REGISTER.md`.

The approved website retention schedule is backed by private owner-only
database controls. `private.retention_inventory()` is non-mutating, and
`private.apply_retention_policy()` defaults to a recorded dry run. An executed
run needs the exact confirmation phrase and a change reference, honours active
legal holds, and can purge only terminal delivery metadata, unlinked anonymous
analytics, stale rate-limit rows and expired token hashes. No scheduler is
installed, and bookings, customers, leads, enquiries, consent and audit records
remain inventory-only. See `PRIVACY-OPERATIONS.md` and `OPERATIONS-RUNBOOK.md`.

Data-subject requests and suspected security compromises have separate private
registers, `private.privacy_request_register` and
`private.security_incident_register`, with immutable, privacy-minimised event
histories. Guard triggers
reject unsafe state changes, and `private.privacy_operations_inventory()`
returns only operational and six-year-retention review counts. The four tables,
their event histories and helper functions are unavailable to `anon`,
`authenticated` and `service_role`; operate them only through the controlled SQL
templates in `supabase/snippets/privacy_operations.sql`.

Verified privacy requests also have an owner-only record locator.
`private.locate_privacy_request_records()` searches by a verified email and/or
E.164 mobile value without retaining that value or a guessable hash, then links
the relevant website records into a minimal review index. Guarded scope reviews
through `private.review_privacy_request_record()` and immutable events are
separate from any disclosure, correction, restriction or deletion action. The
locator tables and functions are unavailable to
`anon`, `authenticated` and `service_role`; use the controlled privacy
operations snippet only as the database owner.

Acquisition measurement is available without installing a third-party tracker.
The owner-only `private.acquisition_outcome_report()` connects safe campaign,
landing, referrer and service dimensions to aggregate booking, employer and
enquiry outcomes. `private.acquisition_event_report()` summarizes allowlisted
conversion events without returning anonymous session identifiers. Both reject
unbounded reporting windows and are unavailable to application roles. Revenue
is deliberately reported as unavailable until approved price and actual
payment/claim data exist; see `supabase/snippets/acquisition_reporting.sql`.

Daily staff triage is available through the Supabase SQL Editor without a
public admin panel. `private.staff_operations_summary()` returns counts without
identifiers; four owner-only active work queues return bounded next-action views
for bookings, employer leads, enquiries and notification exceptions. Detailed
results contain operational personal information, accept only limits from
1-200, and are unavailable to `anon`, `authenticated` and `service_role`. Use
`supabase/snippets/staff_work_queues.sql` to review work and the guarded
procedures in `supabase/snippets/staff_actions.sql` to make status changes.

```powershell
node --check production.js
node --check site.js
deno check supabase/functions/insurespr-api/index.ts
deno check supabase/functions/insurespr-notifications/index.ts
```

Do not put a secret/service-role key in HTML, `production.js`, browser-exposed
environment variables or screenshots. Notification-worker secrets belong in
Supabase's encrypted function-secret store. Turnstile and the Ed25519 signing
private key belong in sensitive server-only Vercel variables; only the matching
public verification key is committed. See `PROVIDER-ACTIVATION.md`.

The notification worker is deployed, but its read-only `GET` readiness signal
returns `ready:false` and authenticated delivery invocations return `503` until
an exact database-approved configuration/source hash, sender, provider key,
reply-to address, independent worker secret and activation mode are configured.
Reviewed configurations must pass a short-lived rehearsal before activation;
active mode also requires both launch dependencies and the exact Vault-backed
Cron job. The worker uses atomic queue leases, provider idempotency keys,
bounded backoff and a terminal `dead` state; deploying it does not authorize or
enable outbound mail. Modern opaque Supabase secret keys are sent through
`apikey` only rather than being misparsed as Bearer JWTs.

## Production artifact

Vercel serves flat HTML with clean URLs. `vercel.json` provides redirects,
security headers and a restrictive Content Security Policy. `robots.txt` and
`sitemap.xml` cover only the proposed public routes. Confirmation and
token-based booking-management pages are marked `noindex`.

### Read-only release preflight

Run the strict production preflight before a release. It exits nonzero while
technical or practice-owned launch blockers remain:

```powershell
node tools/release-audit.mjs
node tools/release-audit.mjs --mode preview
node tools/release-audit.mjs --self-test
```

`--base`, `--api` and `--notifications` can target another candidate release;
`--email-reply-to` selects the approved receiving mailbox; `--dkim-host` selects
the exact provider-issued DKIM hostname; and `--return-path-host` selects the
provider-issued SPF/MX Return-Path. `--legacy-manifest` can point to a
machine-readable redirect manifest, while `--recovery-manifest` selects the
machine-readable backup/recovery evidence record. Preview mode downgrades practice-owned
readiness items, while metadata, crawlability, DNS resolution, security and
API-integrity checks remain strict. `--report-only` always exits zero for
dashboards, and `--json` emits structured output.

The audit is read-only. It performs public `GET` requests and sends only an
invalid empty JSON object to each official form endpoint through both the direct
Edge API and the same-origin verification bridge. It requires bridge services
to match Supabase, run in the configured Frankfurt region, retain security and
no-store headers, expose no secret marker, and reject every empty protected
probe. Those probes contain no personal information and cannot satisfy the
write contract. Notification readiness is
checked only through an unauthenticated `GET`; no scheduler secret is supplied
and the notification worker is never invoked. Return-Path SPF/MX, sender DKIM
and DMARC plus the approved Reply-To domain's MX route are resolved independently
through Cloudflare and Google DNS. An official-domain MX record is reported
separately: it is not required while the approved Reply-To remains on
`bonevc.co.za`, but its absence prevents publication of an
`@insuresprhealth.co.za` receiving address.

### Automated production regression monitor

`tools/release-monitor.mjs` runs the same live, read-only release audit against
the canonical site and compares it with `RELEASE-MONITOR-BASELINE.json`. The
baseline requires every currently healthy technical check to remain a pass,
requires all 21 checks to remain present, permits known readiness blockers to
improve, and fails on a new technical warning/failure, a missing check, or a new
or worsened readiness issue. It never converts a known blocker into approval.

GitHub workflow `.github/workflows/production-monitor.yml` runs the monitor each
day at 04:17 UTC (06:17 South Africa time) and on manual dispatch. It uses no
database, notification-provider or patient-data secret. Its JSON report contains
only the public audit state, is retained as a private GitHub Actions artifact for
30 days, and is kept out of both Git and the Vercel public artifact. A failed run
is an operational alert to inspect before changing any launch dependency.

Run the same comparison locally:

```powershell
node tools/release-monitor.mjs
npm run test:release-monitor
```

The preflight also fails closed on recovery readiness. The current management
evidence records an active, healthy Supabase project on the Free plan, with no
managed daily backup/PITR and no verified encrypted off-site export, approved
RPO/RTO, named owner or successful restore drill. The non-secret state is held
in `RECOVERY-READINESS.json`; it is kept out of the public Vercel artifact.
The repository includes streamed AES-256-GCM logical-backup, authenticated
verification and isolated-restore tooling in `tools/recovery-backup.mjs`, plus
deterministic and disposable-PostgreSQL tests. The tooling writes no plaintext
dump and cannot make the recovery manifest ready; scheduling, off-site storage,
key custody, monitoring, ownership, objectives and a completed authorized drill
remain operational approvals.

`RECOVERY-ACTIVATION-HANDOFF.json` and `RECOVERY-ACTIVATION.md` now provide the
controlled promotion path. Live private tables bind an exact non-secret
configuration to accepted evidence and append-only execution records. A
configuration must rehearse first, and activation requires a current encrypted
backup, matching artifact verification, an isolated restore with external
delivery disabled and target deletion, a failure-alert test and scheduler-health
evidence. `public.public_intake_activation_ready()` is the service-role-only
runtime gate used before public form side effects; it fails closed when privacy,
any launch dependency or recovery freshness is not ready. Production still has
zero recovery configurations and zero recovery execution records.

### Deterministic browser and SEO gates

Install the exact development dependency graph and matching Chromium runtime,
then run the complete local quality suite. Local prerequisites are Node.js 20
or newer with npm, plus Deno 2.9.2 on `PATH`:

```powershell
npm ci
npx --no-install playwright install chromium
npm test
```

`npm test` checks JavaScript syntax, the offline release-audit fixtures, the
inactive legacy redirect manifest, Deno formatting/linting/type safety, both
Edge Function test suites, form fail-closed behaviour, the mocked booking
journey and bounded keyboard/focus accessibility scenarios. The tests use local
fixtures or an ephemeral loopback server; they do
not call live Supabase write endpoints or Vercel. CI installs the same locked
Playwright release and Deno 2.9.2 before running those deterministic phases.

The performance audit remains an explicit local diagnostic because its timing
measurements are machine-sensitive; it is intentionally not a CI timing gate:

```powershell
node tools/audit.mjs
node tools/form-safety.test.mjs
node tools/booking-journey.test.mjs
node tools/accessibility-journey.test.mjs
node --test tools/legacy-redirects.test.mjs
npm run test:performance
npm run test:recovery:docker
```

The browser suites use an ephemeral loopback server and mocked public API
contracts; they do not write to production. Performance limits and measurement
caveats are documented in `PERFORMANCE-BUDGETS.md`. The legacy decision
manifest covers every inventoried URL but remains inactive and fail-closed until
each non-hold decision has named approval. Availability activation, rehearsal,
monitoring and rollback are documented in `AVAILABILITY-ACTIVATION.md`.
Recovery inventory, approval fields, isolation rules and restoration order are
documented in `RECOVERY-RESTORE-DRILL.md`, including the encrypted backup tool's
operator contract. It does not authorize a production restore or invent the
practice's owner, off-site store, key custodian, RPO, RTO or retention period.

The canonical frontend is live on the practice domain. Keep online form intake
fail-closed and do not publish unapproved healthcare claims, prices, schedules
or credentials. Do not remove legacy WordPress content or activate the full
redirect map until ownership, licensing, clinical review and redirect decisions
have been signed off.
