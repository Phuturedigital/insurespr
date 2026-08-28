# InsureSPR production readiness

Status date: 29 August 2026
Target Supabase project: `ffdmmxffzewqiacsuvhr`  
Public frontend status: **live at `https://www.insuresprhealth.co.za/`**

Transactional intake status: **fail-closed pending launch approvals and configuration**

This file is the release gate. A technically working form is not enough for a
healthcare acquisition site: the business facts, privacy position, staff
workflow and domain transition must all be ready at the same time.

## Implemented and verified

### Public information architecture

- Master-brand homepage, not a scan-only campaign.
- Separate individual, workforce and DXA-scanning journeys.
- Dedicated employer quote form rather than a patient booking form.
- Persistent email and directions fallbacks.
- Explicit “request received” versus “confirmed” booking language.
- No public cash prices, preparation instructions, durations, report timing,
  mobile-service promises or practitioner credentials have been invented.
- Confirmation and booking-management pages are `noindex`.
- Sitemap, robots rules, clean URLs, a 404 page and initial route redirects are
  included.
- The public catalogue now contains 16 staff-confirmed routes: six core
  services, four additional request-led X-Ray examinations and six DXA/bone-
  health pathways shaped around Johannesburg needs. The booking selector
  separates X-Ray examinations, DXA procedures and need-led pathways instead
  of presenting one undifferentiated list. Ten new crawlable detail pages are
  in the sitemap and linked from the appropriate X-Ray, scanning or workforce
  hub.

### Database and API

- Practice settings, categories, services, availability rules/exceptions,
  bookable slots, customers, bookings, status history, management tokens,
  booking actions, employer leads, contact enquiries, consent records,
  notification attempts, operational audit events, analytics events and launch
  dependencies.
- Row-level security is enabled on every exposed-schema table.
- Operational table privileges are revoked from `anon` and `authenticated`;
  the Edge Function uses the server-side key.
- Explicit deny policies provide defence in depth.
- Booking, employer-lead and contact-enquiry writes are transactional and bind
  each idempotency key to a canonical request fingerprint. A matching network
  retry returns the existing reference without duplicate consent or
  notification work; reusing a key for different details is rejected.
- A partial unique index prevents two active bookings from owning one slot.
- Slot selection is rechecked under a row lock during booking.
- The deployed availability engine is revisioned, timezone-aware and
  fail-closed. It preserves manual/booked slots, records materialization
  conflicts and refuses stale generated slots. It remains intentionally
  inactive because the two appointment services have no approved durations,
  policies, rules or slots. Rehearsal, activation, monitoring and rollback are
  defined in `AVAILABILITY-ACTIVATION.md`; no Cron schedule has been invented.
- Raw booking-management tokens are returned once; only a cryptographic hash is
  stored.
- Consent version, time and source are retained with each applicable record.
- Notification intent is committed after the underlying booking/lead/enquiry,
  never before it.
- Notification claims are atomic and lease-based. Retryable failures use bounded
  backoff; non-retryable or exhausted deliveries enter a visible `dead` state.
- Provider requests have stable idempotency keys, so a lost completion response
  can be retried without creating a second provider message during the
  provider's idempotency window.
- Booking confirmation, cancellation and reschedule status changes enqueue the
  appropriate patient acknowledgement; patient-originated changes also enqueue
  a practice alert.
- Service-role-only staff procedures validate booking/slot transitions, lead and
  enquiry workflows, manual notification requeue, and append privacy-minimised
  before/after state to an operational audit log.
- A self-cleaning migration assertion verified queue claim, retry, reclaim and
  completion without retaining synthetic records.
- Event capture uses anonymous session identifiers and campaign/referrer
  metadata; it does not send patient names, contact details or form notes.
- Live migration
  `20260813192722_record_trusted_booking_completion_analytics` adds the
  pseudonymous booking key as a dedicated, service-role-only lifecycle link.
  The browser records request receipt; only the audited staff transition that
  actually sets a booking to `completed` records the deduplicated completion
  event. Its transactional contract passed without retaining synthetic rows.
- Edge Function validation includes body-size limits, field allowlists, phone
  normalization, exact-origin CORS, a honeypot, rate limiting and mandatory,
  fail-closed Turnstile verification for public form mutations. Raw IP
  addresses are not persisted by the app.
- Supabase security advisor: zero findings after hardening.
- Live migration
  `20260820234210_expand_johannesburg_xray_dxa_pathways` publishes the expanded
  catalogue in request/quote, staff-confirmed mode. All 16 live services remain
  `needs_confirmation`; prices, duration, preparation, report timing,
  medical-aid arrangements and slot availability remain unpublished. The
  migration also replaces the old generic X-Ray walk-in mode with a written-
  request/suitability-first route and corrects the administrative chest-X-Ray
  wording so it is not represented as a current South African DHA visa
  requirement.
- Live migration
  `20260821001443_restore_hardened_analytics_event_contract` preserves the new
  email-click event while restoring canonical UUID sessions, safe page paths,
  sanitized attribution and the truthful `booking_request_submitted` taxonomy.
  Browser input cannot create the staff-reserved `booking_completed` event;
  legacy input is normalized to a request submission. Its rollback contract
  left the existing 24 privacy-minimised QA events unchanged.
- Live migration
  `20260821074451_record_owner_approved_launch_decisions` records the approved
  website retention schedule, confirms the conservative catalogue and the
  inactive legacy-content hold, and deliberately leaves privacy, anti-spam,
  email, credentials, prices, clinical requirements and booking rules open.
  Its contract requires the database privacy version to remain pending, so it
  cannot open transactional intake.
- Live migration
  `20260821140910_restore_owner_booking_contacts` records Motselisi R. Mosiana
  as the booking contact and owner-designated Information Officer, restores
  `083 450 7861` for phone/WhatsApp, and routes public booking email to
  `motselisi@bonevc.co.za`. The contact fields are live, but the migration
  deliberately preserves the pending privacy version and every remaining
  registration, anti-spam and delivery gate.
- Live migrations
  `20260828230538_record_operational_readiness_evidence` and
  `20260828230930_harden_readiness_evidence_access` register the private
  25 August readiness form by filename and SHA-256, classify 19 field-level
  claims, link unresolved claims to launch dependencies, and keep the source
  PDF outside the repository. The review records seven missing claims, eight
  needing evidence, two internal/production contradictions, two prior
  owner-approved public facts and zero newly verified facts. Explicit deny
  policies, RLS and revoked `PUBLIC`/browser/service-role data privileges keep
  the evidence register outside the website and Edge Function surface.
- The evidence-form reconciliation deliberately leaves all 16 services as
  `needs_confirmation`, all public prices and durations null, all availability
  policy/rule/exception/slot tables empty, the approved public contact and
  Monday-Friday hours unchanged, and the database privacy version pending.
- Supabase performance advisor: only expected `unused_index` informational
  notices on the newly created, empty operational database. Keep the indexes
  until real query statistics exist; reference:
  <https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index>.
- The notification worker's thirteen executable tests pass for exact secret
  matching, pending-versus-confirmed wording, Johannesburg slot formatting,
  verified preparation inclusion/omission and HTML escaping, and omission of
  free-text booking/contact content from email bodies. Immutable transition
  snapshots and recipient-stream ordering prevent a delayed confirmation from
  being rebuilt from later cancellation/reschedule state or overtaking a prior
  patient delivery; an unrelated practice-recipient retry does not block the
  patient stream.
- Self-cleaning database contracts pass for queue claim/retry/reclaim/complete,
  booking confirmation/completion, lead and enquiry transitions, manual
  notification requeue, status history and operational audit effects.
- The 18-page desktop/static browser audit passes with no console, request,
  image, accessible-name, heading, tap-target or horizontal-overflow findings.
  A separate 390-by-844 sweep confirms one H1, no horizontal overflow, no
  unnamed buttons and equal 163-by-48 centred quick actions on every page that
  uses them. Analytics writes are intercepted in the deterministic desktop
  audit so a visual/markup check cannot pollute production measurement data.
- A deterministic mocked-backend booking suite passes 10 end-to-end scenarios,
  including the five booking steps and review, Back/Forward restoration,
  invalid fields, no slots, slot races, duplicate clicks, stable idempotent
  retries, API/database/network failures, confirmation refresh, cancel and
  reschedule wording, Turnstile/honeypot rejection, reference-only email
  fallback, analytics minimisation and partial-JavaScript fail-closed behavior.
- A bounded keyboard/focus regression passes eight critical scenarios: skip
  navigation, visible focus, mobile-menu Enter/Escape return, booking validation
  and live regions, booking-dialog focus containment/return, keyboard booking
  changes, a 200% reflow proxy, reduced motion and semantic/accessibility-tree
  checks. This is regression evidence, not screen-reader certification or a
  WCAG-conformance claim.
- The offline performance regression passes all eight homepage, X-Ray, booking
  and workforce scenarios at 390-by-844 and 1440-by-900. Transfer, request,
  layout, image, DOM, FCP/LCP/CLS and initial-load long-task budgets are defined
  in `PERFORMANCE-BUDGETS.md`; the report explicitly does not claim Lighthouse
  or field Core Web Vitals.
- `LEGACY-REDIRECT-MANIFEST.json` accounts for all 153 inventoried legacy URLs
  and passes its deterministic contract test. Every decision remains `hold`,
  and activation is false, until named content, clinical and redirect approval
  is recorded; the manifest does not change live routing.
- Live API release checks return `200` for health/services, `403` for an
  unapproved origin after the privacy gate is open, `503
  PRIVACY_NOTICE_NOT_READY` for every form-mutation origin while approval is
  pending (including spoofed localhost and absent Origin). Notification
  readiness returns `200` with `ready:false`; delivery remains fail-closed until
  its provider configuration is complete. The deployed cloud default CORS list
  contains only the exact apex and `www` official origins. `/services` is
  `no-store` so a privacy or Turnstile configuration change cannot be masked by
  a stale public response.
- The 29 August provider audit confirms that both Edge Functions are active,
  while the notification readiness signal remains `ready:false`, Supabase Vault
  contains no configured secret, and `pg_cron` is not installed. Vercel has no
  production environment variable because the public frontend is deliberately
  static and receives no server credential. Cloudflare and Google DNS both
  resolve the approved `bonevc.co.za` Reply-To MX route, but neither resolver
  finds SPF/MX on the default `send.insuresprhealth.co.za` Return-Path, Resend
  DKIM, DMARC or an inbound MX route for `insuresprhealth.co.za`. These are
  observed configuration facts, not inferred secret values; email delivery and
  scheduling remain open launch dependencies.
- The official apex now returns a one-hop `308` to the canonical `www` host,
  and the repository's Auth `site_url`, page canonicals, sitemap, Open Graph and
  JSON-LD all use that same `www` origin.
- Migration
  `20260813194724_include_confirmed_booking_preparation_in_notifications` and
  notification worker v9 are deployed. Only a verified service's trimmed,
  nonblank preparation text can enter a confirmed/rescheduled patient
  confirmation. All live services remain `needs_confirmation`, so no draft
  preparation text is currently eligible. Public worker readiness remains
  `200`, `ready:false` and `no-store` until approved provider configuration is
  supplied.
- Live migration
  `20260813210017_immutable_ordered_booking_notification_events` and worker v9
  snapshot minimal status-transition context, enforce kind/status compatibility
  and release only the head unresolved delivery per entity/channel/recipient.
  Any legacy unsent status event without a trustworthy snapshot is safely
  skipped. Its self-cleaning SQL contract and the 13 worker tests passed; live
  queue/business counts remained zero and the security advisor remained clear.
- After all self-cleaning tests, the live project contains zero customers,
  bookings, slots, booking history, employer leads, contact enquiries,
  notification attempts, trusted completion events and operational audit
  events. It retains 24
  privacy-minimised QA analytics events; all session identifiers and paths pass
  the current database constraints.

### API routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/` | Health response |
| `GET` | `/services` | Public service and practice configuration |
| `GET` | `/availability` | Published slots for one service and range |
| `POST` | `/bookings` | Transactional booking request |
| `POST` | `/employer-leads` | Structured employer quote lead |
| `POST` | `/contact-enquiries` | Short non-clinical enquiry |
| `POST` | `/booking-actions` | Token-based cancellation/reschedule request |
| `POST` | `/events` | Privacy-minimised conversion event |

### Applied strict-consent and attribution release package

The coordinated browser, API and database hardening package is deployed. Live
migration history includes `20260813172057_enforce_displayed_privacy_notice_version`
and `20260813172127_harden_marketing_and_booking_analytics`:

- Each public form must display the nonblank `privacy_notice_version` returned
  by the uncached `/services` response and submit that exact version unchanged.
  The API forwards it; the database accepts a new record only while the same
  approved version is share-locked as current. A stale open page receives `409
  PRIVACY_NOTICE_CHANGED` and must reload and show the new notice.
- A matching idempotent retry remains recoverable after a later policy change,
  but only when the submitted version equals the consent stored with the
  original record. Policy version remains excluded from the canonical business
  fingerprint so a policy publication cannot strand a lost-response replay.
- Pending or blank policy configuration remains fail-closed with `503
  PRIVACY_NOTICE_NOT_READY` before Turnstile, rate limiting or mutation work.
- Attribution sanitization rejects control data and common email-, phone-,
  identity- and explicit-PII-shaped campaign values. Public booking submission
  analytics use `booking_request_submitted`; `booking_completed` is reserved for
  a trusted staff completion workflow.

The technical release order was completed while the database policy version
remained pending: the client displays/sends the version, the API forwards and
maps it, and the migrations were applied and verified. Privacy notice
`2026-08-21.1` is approved for publication, but it must not be copied into
`practice_settings.privacy_notice_version` until the Information Officer
evidence, both Turnstile keys and the other intake dependencies are ready.
Submissions must remain closed until then.

## Owner decisions recorded; activation evidence still required

These also exist as rows in `public.launch_dependencies` so an operator can
track them in the Supabase dashboard. Motselisi R. Mosiana recorded the owner
decisions in `LAUNCH-APPROVALS.md` on 21 August 2026. The owner approved the
conservative catalogue, privacy publication copy and retention schedule,
Cloudflare Turnstile, the Resend adapter, the owner-approved booking contacts
and the inactive 153-URL hold. That approval does not fabricate account keys,
registrations, licences, tariffs, schedules or provider/DNS evidence.

1. **Authority and ownership**
   - Website publication authority is recorded in `LAUNCH-APPROVALS.md`.
   - Named owner for the domain, hosting account, Supabase project and incident
     response.

2. **Service catalogue and operating rules**
   - The 16-service conservative catalogue and current request-led modes are
     owner-approved; individual service evidence remains unverified.
   - Approve opening hours, closures, booking horizon, slot length, capacity,
     buffers, minimum notice and cancellation/reschedule rules.
   - Publish real `booking_slots` only after those rules are approved.

3. **Commercial facts**
   - Approve every public price or range and its effective date.
   - Confirm medical-aid/payment wording and quote rules.
   - Until then, `price_type = unpublished` is intentional.

4. **Clinical and regulatory review**
   - Approve preparation, eligibility, contraindication/escalation, referral,
     result-delivery and turnaround wording for every service.
   - Supply verified practitioner names, roles, qualifications, professional
     registrations and regulator-checkable references before displaying them.
   - Decide whether any public medical content needs a named reviewer and review
     date.

5. **Privacy / POPIA**
   - Publication notice `2026-08-21.1`, the responsible-party wording,
     processor register, website retention schedule and request procedure are
     owner-approved and published.
   - Obtain and file the Information Officer registration and legal-entity
     evidence. Keep the database privacy version pending until that evidence,
     Turnstile and processor activation checks are complete.

6. **Email and staff notifications**
   - Resend is the owner-approved adapter; create the account and verify the
     sending domain.
   - Approve patient, staff and employer templates plus reply-to addresses.
   - Add `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` and a strong independent
     `NOTIFICATION_WORKER_SECRET` to Supabase function secrets, then configure
     the documented Vault-backed Cron invocation.
   - Configure sender authentication (SPF, DKIM and DMARC), assign daily
     dead-letter monitoring and test live delivery plus provider rejection.
   - The queue, retry/backoff, dead-letter state and worker are implemented and
     tested without delivery. The worker is deliberately fail-closed and no
     email is sent until the missing secrets and schedule are configured.

7. **Anti-spam production secret**
   - Cloudflare Turnstile is owner-approved; create its site/secret pair for the
     official domains.
   - Configure `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` together in
     Supabase Edge Function secrets, then redeploy `insurespr-api`. The site key
     is deliberately returned to the browser by `GET /services`; the secret
     must remain server-side. Never release only one key: a site key without a
     secret displays a challenge but the API refuses submissions, while a
     secret without a site key leaves the browser unable to obtain a token.
     Missing both keys and either partial state fail closed with a configuration
     error; privacy approval alone can never open unprotected forms.
   - Verify that `GET /services` returns a non-null `turnstile_site_key`, each
     public form renders the widget, and every retry obtains a fresh token.
     Exercise missing, invalid, expired and replayed tokens plus a simulated
     Turnstile provider outage; rejected verification must not create a
     booking, lead, enquiry, consent or notification row.
   - The API validates the Siteverify response's hostname against the approved
     request-origin hostname and requires the distinct `book`, `employer` or
     `contact` action for the route. Focused tests cover exact matches,
     cross-form action mismatch, cross-host mismatch and incomplete responses.
     Rate limiting and honeypots remain active independently.

8. **Admin operating procedure**
   - Choose named staff with least-privilege access.
   - Assign owners and response-time targets for daily handling of new booking
     requests, employer leads, enquiries and queued/failed notifications.
   - Review and approve `OPERATIONS-RUNBOOK.md`, including duplicate handling,
     manual recovery and audit review.
   - The Supabase dashboard is the initial internal interface; no public admin
     panel is exposed. The underlying status procedures and audit log are
     implemented, but named accounts and routine ownership remain prerequisites.
   - `RECOVERY-RESTORE-DRILL.md` defines the technical inventory, safe isolated
     rehearsal, restoration order and evidence checklist. Incident authority,
     RPO, RTO, backup plan, data access and retention remain deliberately blank
     until the practice approves them.

9. **Domain, search and migration**
   - Inventory every indexed URL on the current official property.
   - Map each retained or replaced URL to a reviewed destination; do not rely on
     the small concept-route redirects as a full migration map.
   - Migrate approved/licensed articles and images with dates, authors and
     canonical URLs intact.
   - Connect and verify the official domain only after a rollback plan exists.
   - Update Google Business Profile links and verify Search Console/sitemap
     ownership after cutover.

10. **Analytics and marketing approval**
    - Approve campaign naming, conversion definitions and access.
    - Decide whether a third-party analytics platform is needed and complete
      the corresponding privacy/cookie assessment before adding one.
    - Test that no form values or personally identifiable information enter
      event names, URLs, referrers or campaign fields.

## Go-live runbook

1. Close every required launch-dependency row with an owner, evidence note and
   completion timestamp.
2. Enter approved practice settings and service facts in Supabase; peer-review
   the changes.
3. Publish a small set of real slots and test book, double-book rejection,
   cancellation and reschedule behaviour with synthetic identities.
4. Configure email and both Turnstile keys, redeploy `insurespr-api`, confirm
   `/services` exposes the site key but never the secret, and test successful
   submission, token expiry/replay, rejection, provider outage, notification
   retry and dead-letter handling.
5. Run database security/performance advisors and inspect Edge Function/API
   logs for unexpected personal data.
6. Run the complete responsive/accessibility/browser test suite against a
   protected preview deployment.
7. Obtain clinical, commercial, privacy and business-owner sign-off on the
   preview and on the redirect map.
8. Take a recoverable backup/export of the current official property and DNS
   configuration.
9. Deploy, connect the domain, verify HTTPS/security headers, forms, mail,
   canonical tags, redirects, sitemap and robots rules from the public URL.
10. Monitor submissions and errors closely during the first operating days;
    retain the rollback path until the new workflow is stable.

## Never place in browser code or git

- Supabase secret/service-role keys
- email-provider API keys
- Turnstile secret keys
- SMTP credentials
- patient exports or production form submissions
- practitioner identity documents or credential evidence containing private
  information

The browser endpoint URL is public by design. Database credentials are not.
