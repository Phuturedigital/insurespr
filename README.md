# InsureSPR Precision Healthcare

Production-preparation branch for the InsureSPR acquisition, booking and intake
website. The repository began as an independent Phuture Digital concept; the
historical concept pages and assets remain in git for provenance, but
`.vercelignore` keeps them out of the production artifact.

The public experience is a zero-build static site with three clear route families:

- individuals and published x-ray pathways (`xray.html`)
- employers and workplace medicals (`workforce.html`)
- DXA bone-density and body-composition scanning (`scanning.html`)

Six standalone, crawlable service-detail pages sit beneath those route pages,
with separate SPR and owner/founder stories. Every page remains a portable HTML
file; there is no framework build step or browser-side database credential.

Booking, contact, employer-quote and booking-management requests go through a
validated public Supabase Edge Function. A separate, scheduler-only function
processes notification intent after the underlying record commits. Browser code
has no database key and cannot query operational tables directly.

## Current state

- Supabase project: `ffdmmxffzewqiacsuvhr`
- API: `https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-api`
- Database migrations: `supabase/migrations/`
- Public Edge Function: `supabase/functions/insurespr-api/`
- Fail-closed notification worker: `supabase/functions/insurespr-notifications/`
- Staff operations runbook: `OPERATIONS-RUNBOOK.md`
- Production browser integration: `production.js`
- Launch and approval checklist: `PRODUCTION-READINESS.md`
- Fact provenance: `CONTENT-NOTES.md`
- Supplied rate evidence review: `XOM-RATES-2026-REVIEW.md`
- Exact legacy URL inventory: `LEGACY-SEO-URL-INVENTORY.md`

The database schema, public API and canonical frontend are deployed. The public
site is served at `https://www.insuresprhealth.co.za/`. Transactional intake is
still deliberately fail-closed until the privacy notice, Turnstile, service
facts, availability and notification dependencies in
`PRODUCTION-READINESS.md` are approved and configured.

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

The committed migration versions match the remote project migration history.
The Supabase CLI configuration deliberately disables automatic exposure of new
tables. All public-schema tables use row-level security; direct `anon` and
`authenticated` access to operational records is revoked. Server-side RPCs own
the transactional writes.

```powershell
node --check production.js
node --check site.js
deno check supabase/functions/insurespr-api/index.ts
deno check supabase/functions/insurespr-notifications/index.ts
```

Do not put a secret/service-role key in HTML, `production.js`, Vercel browser
environment variables or screenshots. Edge Function secrets belong in
Supabase's encrypted function-secret store.

The notification worker is deployed but intentionally returns `503` until an
approved sender, provider key, reply-to address and independent worker secret
are configured. It uses atomic queue leases, provider idempotency keys, bounded
backoff and a terminal `dead` state; deploying it does not authorize or enable
outbound mail.

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
`--legacy-manifest` can point to a machine-readable redirect manifest. Preview
mode downgrades practice-owned readiness items, while metadata, crawlability,
security and API-integrity checks remain strict. `--report-only` always exits
zero for dashboards, and `--json` emits structured output.

The audit is read-only. It performs public `GET` requests and sends only an
invalid empty JSON object to each official form endpoint to confirm that origin,
privacy and validation gates respond safely. Those probes contain no personal
information and cannot satisfy the write contract. Notification readiness is
checked only through an unauthenticated `GET`; no scheduler secret is supplied
and the notification worker is never invoked.

The canonical frontend is live on the practice domain. Keep online form intake
fail-closed and do not publish unapproved healthcare claims, prices, schedules
or credentials. Do not remove legacy WordPress content or activate the full
redirect map until ownership, licensing, clinical review and redirect decisions
have been signed off.
