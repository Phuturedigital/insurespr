# InsureSPR Precision Healthcare

Production-preparation branch for the InsureSPR acquisition, booking and intake
website. The repository began as an independent Phuture Digital concept; the
historical concept pages and assets remain in git for provenance, but
`.vercelignore` keeps them out of the production artifact.

The public experience is a zero-build static site with three distinct routes:

- individuals and published x-ray pathways (`xray.html`)
- employers and workplace medicals (`workforce.html`)
- DXA bone-density and body-composition scanning (`scanning.html`)

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

The database schema and public API are deployed. The website itself is not
published as InsureSPR's official site from this branch. Publication requires
practice/domain authorization and completion of the release blockers in
`PRODUCTION-READINESS.md`.

## Local preview

Serve the directory over HTTP; do not open the files with a `file:` URL.

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173/`. `localhost:4173` is in the Edge Function's
exact-origin allowlist for local testing.

## Supabase workflow

The committed migration versions match the remote project migration history.
The Supabase CLI configuration deliberately disables automatic exposure of new
tables. All public-schema tables use row-level security; direct `anon` and
`authenticated` access to operational records is revoked. Server-side RPCs own
the transactional writes.

```powershell
deno check production.js site.js supabase/functions/insurespr-api/index.ts \
  supabase/functions/insurespr-notifications/index.ts
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

The current concept deployment is a separate property. Do not repoint the
practice domain, publish healthcare claims, or remove an existing official site
until ownership, redirects, content, privacy wording and operational readiness
have been signed off.
