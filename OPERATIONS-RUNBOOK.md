# InsureSPR operations runbook

Status: technically implemented. Motselisi R. Mosiana is the owner-designated
booking contact and first-line response owner. Least-privilege account
provisioning, deputy coverage and response-time targets still require evidence.

This runbook uses the Supabase dashboard as the initial staff interface. Do not
share a service-role key with staff, embed it in browser code, or build a public
admin panel around these procedures. Give named operators the least access the
practice approves and remove access promptly when responsibilities change.

## Start and end of each operating day

1. Open the project dashboard and run
   `supabase/snippets/staff_work_queues.sql` in the SQL editor. Start with the
   identifier-free summary, then open only the bounded queue needed for the
   current task. Use `supabase/snippets/daily_operations.sql` only for deeper
   diagnostic and availability checks.
2. Work oldest unresolved booking requests first, then workforce leads and
   general enquiries, subject to the practice's approved clinical escalation
   rules.
3. Check `failed`, `dead`, and stale `processing` notifications. A `dead` item
   must never be treated as delivered.
4. Check open launch dependencies before publishing prices, service facts,
   hours, slots, privacy wording or credentials.
5. Review the latest audit events for unexpected changes and record/escalate
   discrepancies outside the patient record.
6. After availability is activated, run queries 7–9 in
   `supabase/snippets/daily_operations.sql` to review approved policy coverage,
   current revision/open-slot horizon, materialization freshness, provenance,
   and unresolved conflicts. Follow `AVAILABILITY-ACTIVATION.md`; do not invent
   or silently repair schedules.
7. When a privacy request or suspected compromise is received, stop ordinary
   queue handling only to the extent required for safe escalation and use
   `supabase/snippets/privacy_operations.sql`. Do not place these records in the
   ordinary contact-enquiry queue.

Motselisi R. Mosiana is the named first-line booking contact. The practice must
still provision named operator accounts, appoint deputy/leave coverage, assign
the remaining operational queues and approve response-time targets. Until then,
this is a technical procedure, not a promise to patients or employers.

## Owner-only staff work queues

Live migration `20260829034523_add_private_staff_work_queues` provides one
identifier-free summary and four detailed next-action queues:

- `private.staff_operations_summary()`
- `private.staff_booking_work_queue(p_limit)`
- `private.staff_employer_lead_work_queue(p_limit)`
- `private.staff_contact_enquiry_work_queue(p_limit)`
- `private.staff_notification_exception_queue(p_limit)`

Each detailed queue is limited to 1-200 rows, ordered for operational triage and
includes an explicit next action. The functions are read-only, stable,
security-invoker functions in the private schema with a cleared search path.
They are unavailable to `anon`, `authenticated` and `service_role`; run the
controlled snippet only as an approved named operator in the Supabase SQL
Editor. Detailed results contain patient or prospect personal information. Do
not export them to personal devices, tickets, chat, analytics or unapproved
spreadsheets. Use `supabase/snippets/staff_actions.sql` for every status change
or reviewed notification requeue; never directly edit a status column.

## Booking handling

For a pending or reschedule-requested booking:

1. Confirm the service and any operational notes in the secure record.
2. Select a future `booking_slots` row for the same service. The slot must be
   `open` and not owned by another active booking.
3. Run `public.staff_confirm_booking` using the template in
   `supabase/snippets/staff_actions.sql` and identify yourself with the approved
   staff identifier.
4. Verify that the booking is `confirmed`, the status history contains a staff
   transition, an audit event exists, and a patient confirmation notification is
   queued.

Use `public.staff_close_booking` for `completed`, `cancelled`, or `no_show`.
Every closure requires a reason. The database rejects unsafe transitions; do
not bypass the procedure with a direct table edit. A completed transition also
records the one trusted, privacy-minimised `booking_completed` analytics event;
the browser records only `booking_request_submitted`.

The confirmation email contains the exact slot time only after staff assigns a
slot. A pending request must never be described as a confirmed appointment.
Status emails use an immutable event-time snapshot and are delivered in order
within each patient or practice recipient stream. If an earlier patient email
is retrying, the later patient event waits; a practice-recipient retry does not
hold up the patient's stream. Do not bypass or rewrite transition snapshots.

## Employer leads and contact enquiries

- Employer flow: `new` → `contacted` or `qualified` → `won`/`lost`. Spam may be
  marked from the active states. `lost` and `spam` require a reason.
- Contact flow: `new` → `contacted` → `resolved`. Spam may be marked from an
  active state and requires a reason.
- Use the service-role-only procedures in `staff_actions.sql`; they append an
  audit event without copying the full message, notes, or contact record into
  the audit log.

## Notification failures

The worker claims at most eight rows per run. Each lease expires after five
minutes. Retryable failures back off at 1, 5, 15, 60, and 180 minutes; the sixth
failed delivery becomes `dead`. Non-retryable provider errors become `dead`
immediately.

Before requeueing:

1. Confirm the sender domain and provider are healthy.
2. Check that the recipient and template are approved and correct.
3. Decide whether another email is appropriate; do not repeatedly contact a
   patient merely to clear an operational queue.
4. Run `public.staff_requeue_notification` with a clear audit reason.
5. Verify the next worker run changes the row to `sent` or records a new safe
   error code. Provider response bodies and message content must not be copied
   into application logs.

## Enabling outbound email after approval

The deployed `insurespr-notifications` function reports `ready:false` on its
read-only `GET` and returns `503` for delivery invocations until all required
configuration exists. This is intentional.

1. Verify the selected sender domain and complete SPF, DKIM and DMARC setup.
   Run `node tools/release-audit.mjs --mode preview` and require matching results
   from both Cloudflare and Google DNS. Pass Resend's exact selector and
   Return-Path through `--dkim-host` and `--return-path-host` if either differs
   from the documented default.
2. Put `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and a random
   `NOTIFICATION_WORKER_SECRET` of at least 32 characters in Supabase Edge
   Function secrets. Never put them in this repository.
3. Store the same worker secret in Supabase Vault under a clearly named secret,
   then schedule a once-per-minute POST with Supabase Cron and `pg_net`. Send the
   secret only as `x-worker-secret`. Follow the current official guide:
   <https://supabase.com/docs/guides/functions/schedule-functions>.
4. Invoke the worker manually with a synthetic `.invalid`-style test record only
   after the sender is in provider test mode. Verify `sent`, provider message ID,
   and idempotent replay, then remove the synthetic record.
5. Test a retryable provider outage and a non-retryable rejection. Confirm the
   queue enters `failed`/`dead` as designed and that the assigned staff monitor
   sees it.
6. Approve the rendered patient, employer and practice templates before enabling
   the recurring schedule.

The 29 August 2026 audit found no Supabase Vault secret and no installed
`pg_cron` extension. Treat both as absent until a later metadata-only inspection
proves otherwise; do not infer scheduler readiness from a deployed function.

Do not put the service-role key in the Cron request. The worker has access to the
server-side key inside Supabase; the scheduler authenticates with the separate
worker secret.

## Publishing the privacy notice and testing forms locally

Cloud deployments are never a localhost test backend. The deployed default
Origin allowlist contains only `https://insuresprhealth.co.za` and
`https://www.insuresprhealth.co.za`; it has no localhost, loopback, preview or
command-client exception. While the policy setting is pending, the privacy gate
runs before Origin, Turnstile, rate limiting and mutation work, so every caller
receives the same fail-closed response and an unapproved Origin receives no
cross-origin permission.

For local development, run a local/mocked API and explicitly set a local-only
`ALLOWED_ORIGINS` value there. Never add `localhost` or `127.0.0.1` to cloud
function secrets and never add an Origin-based pending-policy bypass. Handler
tests must assert that official, spoofed-localhost, absent-Origin and arbitrary
Origin requests create no rate-limit or RPC calls while policy is pending.

Treat privacy wording and its version as one release unit:

1. Set the public setting to a clearly pending value before replacing approved
   wording. Confirm all three mutation routes return `503
   PRIVACY_NOTICE_NOT_READY` without creating rate-limit, consent, business or
   notification rows.
2. Deploy the reviewed wording and a client that visibly presents the exact
   version returned by the uncached `/services` response and sends that same
   nonblank string with the accepted form.
3. Deploy the matching API version, then apply the strict displayed-version
   migration and its self-cleaning assertions. Keep forms closed until both are
   verified.
4. Set `practice_settings.privacy_notice_version` to the exact approved version
   only after the wording is public and reviewed. Verify a new submission stores
   that version in `consent_records`.
5. Leave an old form page open, publish a new version through the same
   pending-first process, and submit the old page. It must receive `409
   PRIVACY_NOTICE_CHANGED`, reload, and require fresh review/acceptance. A retry
   of an already-created record may recover only with the version stored on its
   original consent.

Public-form analytics must record request receipt as
`booking_request_submitted`, not `booking_completed`; completion is a trusted
staff lifecycle fact. Campaign/referrer metadata must remain attribution-only.
If a campaign value resembles an email address, phone/identity number, explicit
PII key/value or contains control characters, the database sanitizer omits it.

### Acquisition and conversion reporting

Run `supabase/snippets/acquisition_reporting.sql` as the database owner for an
aggregate 30-day acquisition review. `private.acquisition_outcome_report()`
groups stored bookings, employer quote requests and contact enquiries by safe
UTM, landing-path, referrer and service dimensions. Its workflow meanings are:

- Booking progressed: `confirmed`, `rescheduled`, `completed` or `no_show`;
  successful: `completed`; unsuccessful: `cancelled` or `no_show`.
- Employer quote progressed: `contacted`, `qualified` or `won`; successful:
  `won`; unsuccessful: `lost` or `spam`.
- Contact enquiry progressed: `contacted` or `resolved`; successful:
  `resolved`; unsuccessful: `spam`.

`private.acquisition_event_report()` groups the allowlisted browser and trusted
completion events and counts distinct anonymous sessions inside the database.
Neither function returns names, companies, contact details, messages, notes,
references, record IDs or anonymous session IDs. Both reject invalid or
greater-than-366-day windows and are unavailable to browser and service roles.

Revenue remains explicitly unavailable: there is no approved price/payment or
claim-settlement ledger. Do not multiply request counts by proposed prices or
describe enquiries as revenue. Add financial attribution only after its source,
refund/claim rules, access, retention and accountable owner are approved.

## Enabling Cloudflare Turnstile after approval

Turnstile protects the booking, workforce-lead and contact forms in addition to
the existing honeypot and rate limits. Its two keys form one deployment unit.
Do not configure or release them independently.

1. Create the production widget in Cloudflare and restrict it to the approved
   official hostnames. A protected preview must be an explicit, temporary
   release configuration in both Turnstile and `ALLOWED_ORIGINS`; it is not in
   the cloud default. Use Cloudflare's test keys with a local/mock API for
   localhost rather than weakening the production hostname or Origin lists.
2. Put both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Supabase Edge
   Function secrets. The site key is public configuration; the secret must
   never enter git, HTML, `production.js`, Vercel browser variables, logs or
   screenshots.
3. Redeploy `insurespr-api` after setting both secrets. Missing both keys and a
   partial configuration are unusable and fail closed: site-key-only renders a
   challenge but the API refuses submissions, while secret-only makes the
   server require a token that the browser cannot obtain. Approving the privacy
   notice without both keys must therefore leave form mutations at `503
   BOT_CHECK_UNAVAILABLE`.
4. From each explicitly approved release origin, call `GET /services` and
   verify that `turnstile_site_key` is non-null. Confirm that the response never
   exposes `TURNSTILE_SECRET_KEY` or any other server credential, then load the
   booking, workforce and contact forms and verify that each renders a widget.
5. Complete one synthetic form flow. Confirm that completion populates a token,
   one submission consumes it, and an expiry, error or retry requires a new
   token. Turnstile tokens are single-use and expire after five minutes; never
   cache or reuse them between forms or requests.
6. Test missing, invalid, expired and replayed tokens. The API must reject them
   without creating a booking, lead, enquiry, consent or notification row. Also
   simulate an unreachable or non-successful Siteverify response and confirm
   the API fails closed with a service error rather than accepting the form.
7. Inspect Edge Function logs and database counts after the test. Logs must not
   contain form contents, Turnstile tokens, the secret or raw IP addresses;
   remove only the explicitly identified synthetic records through a reviewed,
   self-cleaning migration.

The API validates the Siteverify response hostname against the approved request
origin and requires the distinct `book`, `employer` or `contact` action for the
route. Keep these checks enabled and include action/hostname mismatch cases in
every release test. Follow Cloudflare's server-side validation guidance:
<https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>.

## Retention inventory and housekeeping

Run retention work only as the database owner in the Supabase SQL editor. Never
grant the private functions to `anon`, `authenticated` or `service_role`, and do
not expose them through an Edge Function or public RPC.

1. Record any active complaint, incident, access request, statutory duty or
   litigation hold in `private.retention_legal_holds`. Use the concrete record
   identifier shown by the controlled review process, or `*` to pause an entire
   class. Name the person opening the hold and set a review date.
2. Run the non-mutating inventory:

   ```sql
   select * from private.retention_inventory();
   ```

3. Run and retain the default dry-run record:

   ```sql
   select * from private.apply_retention_policy();
   ```

4. Reconcile every eligible and held count with the Information Officer. Do not
   proceed while a hold is unresolved, a count is unexpected, the policy has
   changed, or the change has no accountable approver.
5. For an approved disposal only, use a unique change reference and the exact
   confirmation phrase. The function still cannot delete bookings, customers,
   leads, enquiries, consent, booking history/actions or audit evidence:

   ```sql
   select *
   from private.apply_retention_policy(
     true,
     'PURGE APPROVED WEBSITE RETENTION RECORDS',
     'CHANGE-REFERENCE-REQUIRED'
   );
   ```

6. Save the returned counts and `run_id` in the controlled change record. Review
   `private.retention_runs` as the database owner and confirm the deletion counts
   match the approved dry run.

There is deliberately no scheduled purge. Assigning Cron ownership and failure
alerts is a separate launch decision; it must not be inferred from this manual
control.

## Incident and privacy handling

- Disable or unschedule the worker if the wrong recipient, sender, or template
  is detected. Preserve queue/audit evidence and notify the responsible owner.
- Treat email as a notification channel, not a clinical record. Free-text form
  notes and contact messages are intentionally omitted from worker payloads and
  staff emails.
- Do not export production submissions to personal devices or unapproved tools.
- Follow the approved POPIA incident, data-subject request and website-retention
  procedures in `PRIVACY-OPERATIONS.md`. Backup ownership, RPO and RTO remain
  unapproved and must not be inferred by this repository.
- Use `RECOVERY-RESTORE-DRILL.md` for the technical inventory, isolated
  quarterly rehearsal, evidence checklist and production restoration order.
  Its blank owner/RPO/RTO/retention fields are launch dependencies, not defaults.
- The encrypted logical-backup tool is implemented and tested, but is not a
  scheduled production backup. Only a named authorized operator may load its
  database URL and vault-held key on the approved runner. Every artifact must
  be authenticated before off-site upload; every failure or stale run must page
  the recovery owner. Never mark recovery ready from a command exit alone.
- The `Production monitor` GitHub workflow performs a daily public read-only
  website/API/DNS/readiness comparison. A failure means a healthy check
  regressed, a check disappeared, or a new/worsened issue appeared. Review the
  retained JSON artifact and rerun `node tools/release-audit.mjs` before making
  a provider, DNS, privacy, catalogue or availability change. A green monitor
  does not mean the listed launch blockers have been approved.

### Private privacy-request, record-locator and security-incident controls

The live database contains owner-only privacy-operation tables, including:

- `private.privacy_request_register`
- `private.privacy_request_events`
- `private.privacy_request_search_runs`
- `private.privacy_request_record_links`
- `private.privacy_request_record_link_events`
- `private.security_incident_register`
- `private.security_incident_events`

Use `supabase/snippets/privacy_operations.sql` for queues, history and lifecycle
templates. These records are deliberately outside the public API and
service-role surface. Every update must identify a named operator and a concrete
reason. Guard triggers reject invalid status transitions and prevent recorded
receipt, identity, response, containment, notification and closure milestones
from being silently rewritten. Event histories are immutable and omit request
contact, decision narrative, incident summary and affected-person details.

After identity verification, run
`private.locate_privacy_request_records()` with only the verified email and/or
E.164 mobile locator. The request must already be `under_review` or `actioning`.
The function does not retain either search value; it creates a minimal record
index and count-only search run. Review each linked record with
`private.review_privacy_request_record()` and a named operator plus concrete
reason. A scope label is not authority to export, disclose, change, restrict or
delete the source record. Complete those actions only through a separately
approved procedure and then record the outcome. Never give application or
service-role access to these locator functions.

Do not store identity-document images, clinical records, mailbox bodies,
credentials, raw logs or forensic exports in either register. Store only the
minimum operational locator and a reference to controlled evidence custody.
For a confirmed or reasonably believed compromise, use the current Information
Regulator eServices and written affected-person notification process; the
database register is tracking evidence, not the regulatory submission itself.

Run `select * from private.privacy_operations_inventory();` during the
Information Officer’s retention review. Its count-only six-year review queue is
never deletion authority. Open or retain an `audit_security_evidence` legal hold
using `privacy_request:<uuid>`, `security_incident:<uuid>`, or `*` before any
approved disposal review.

## Operational evidence review

- Use `OPERATIONAL-EVIDENCE-REGISTER.md` for the evidence-state vocabulary and
  current readiness-form reconciliation. A checked questionnaire box is an
  owner-supplied claim until its required source, verifier and verification
  date exist.
- Keep source PDFs, licence records, practitioner documents and regulator
  records in controlled private custody. Do not commit them, upload them to the
  public website or paste secrets/identity documents into a database note.
- Register each new document version by filename and SHA-256 in
  `private.readiness_evidence_documents`; never replace an existing digest.
  Record material claims in `private.readiness_evidence_claims` with the linked
  launch dependency and an explicit review state.
- The private evidence tables are database-owner review surfaces. They have RLS,
  explicit deny policies and no browser or service-role privileges. Do not add
  an Edge Function or public RPC for them merely for convenience.
- Change `review_status` to `verified` only when the authoritative evidence is
  held and `verified_by` plus `verified_at` are recorded. Publication permission
  is a separate decision and must remain false for private/internal facts.
- Activate a price, service fact, privacy version, availability policy, provider
  or public credential only through a forward migration that also closes the
  corresponding launch dependency and proves the real operational test.
