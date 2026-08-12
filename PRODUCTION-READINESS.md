# InsureSPR production readiness

Status date: 12 August 2026  
Target Supabase project: `ffdmmxffzewqiacsuvhr`  
Website publication status: **not authorized / not launched**

This file is the release gate. A technically working form is not enough for a
healthcare acquisition site: the business facts, privacy position, staff
workflow and domain transition must all be ready at the same time.

## Implemented and verified

### Public information architecture

- Master-brand homepage, not a scan-only campaign.
- Separate individual, workforce and DXA-scanning journeys.
- Dedicated employer quote form rather than a patient booking form.
- Persistent call, directions, email and WhatsApp fallbacks.
- Explicit “request received” versus “confirmed” booking language.
- No public cash prices, preparation instructions, durations, report timing,
  mobile-service promises or practitioner credentials have been invented.
- Confirmation and booking-management pages are `noindex`.
- Sitemap, robots rules, clean URLs, a 404 page and initial route redirects are
  included.

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
- Booking writes are transactional and idempotent.
- A partial unique index prevents two active bookings from owning one slot.
- Slot selection is rechecked under a row lock during booking.
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
- Edge Function validation includes body-size limits, field allowlists, phone
  normalization, exact-origin CORS, a honeypot, rate limiting and optional
  Turnstile verification. Raw IP addresses are not persisted by the app.
- Supabase security advisor: zero findings after hardening.
- Supabase performance advisor: only expected `unused_index` informational
  notices on the newly created, empty operational database. Keep the indexes
  until real query statistics exist; reference:
  <https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index>.
- The notification worker's executable tests pass for exact secret matching,
  pending-versus-confirmed wording, Johannesburg slot formatting, HTML escaping,
  and omission of free-text booking/contact content from email bodies.
- Self-cleaning database contracts pass for queue claim/retry/reclaim/complete,
  booking confirmation/completion, lead and enquiry transitions, manual
  notification requeue, status history and operational audit effects.
- The ten-page desktop/static browser audit passes with no console, request,
  image, accessible-name, heading or tap-target findings. Analytics writes are
  intercepted in this audit so a visual/markup check cannot pollute production
  measurement data.
- Live API release checks return `200` for health/services, `403` for an
  unapproved origin, `422` for an invalid booking, and `503` for the
  deliberately unconfigured notification worker. The analytics route returns a
  CORS-visible `200` acknowledgement after persistence.
- After all self-cleaning tests, the live project contains zero customers,
  bookings, slots, booking history, employer leads, contact enquiries,
  notification attempts, operational audit events and analytics events.

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

## Release blockers — practice decisions or credentials required

These also exist as rows in `public.launch_dependencies` so an operator can
track them in the Supabase dashboard.

1. **Authority and ownership**
   - Written confirmation that this repository may represent InsureSPR as its
     official website.
   - Named owner for the domain, hosting account, Supabase project and incident
     response.

2. **Service catalogue and operating rules**
   - Approve each service name, status and category.
   - Confirm which services are walk-in, request-only or live-slot bookable.
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
   - Confirm the responsible party and registered Information Officer contact.
   - Approve the lawful-purpose wording, processor/subprocessor list,
     cross-border position, retention schedule, backup deletion behaviour,
     access controls and data-subject request procedure.
   - Replace the visible pending-approval notice in `privacy.html` only after
     counsel or the responsible owner approves it.

6. **Email and staff notifications**
   - Approve the proposed Resend adapter (or replace it with the selected
     transactional provider) and verify the sending domain.
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
   - Create the Cloudflare Turnstile site/secret pair for the official domains.
   - Add the secret to Supabase Edge Function secrets and the widget to public
     forms. Rate limiting and honeypots are already active, but Turnstile is
     deliberately not claimed as active without its secret.

8. **Admin operating procedure**
   - Choose named staff with least-privilege access.
   - Assign owners and response-time targets for daily handling of new booking
     requests, employer leads, enquiries and queued/failed notifications.
   - Review and approve `OPERATIONS-RUNBOOK.md`, including duplicate handling,
     manual recovery and audit review.
   - The Supabase dashboard is the initial internal interface; no public admin
     panel is exposed. The underlying status procedures and audit log are
     implemented, but named accounts and routine ownership remain prerequisites.

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
4. Configure email and Turnstile; test success, rejection, provider outage,
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
