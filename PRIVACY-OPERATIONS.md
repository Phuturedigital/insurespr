# Website privacy and POPIA operations

Approved publication version: `2026-08-21.1`

Responsible party: InsureSPR Precision Healthcare

Owner-designated Information Officer: Motselisi R. Mosiana

Designation recorded: 21 August 2026

Public privacy contact: `motselisi@bonevc.co.za`

The owner has approved this website-specific schedule and procedure and has
designated Motselisi R. Mosiana as Information Officer. The designation is not
a substitute for the private body’s PAIA manual, Information Regulator
registration record, clinical-record policy or professional record-retention duties.
Where another law or a defensible legal hold requires longer retention, that
documented requirement takes precedence and access must be restricted.

## Website record schedule

| Record | Working retention rule | Disposal action |
| --- | --- | --- |
| Incomplete or spam public submissions | Up to 90 days | Delete or irreversibly de-identify |
| Contact enquiries and employer leads that do not become an engagement | 24 months after last activity | Delete or de-identify |
| Booking requests, booking history and linked consent evidence | 6 years after the last booking activity | Delete or archive only where another documented duty applies |
| Notification attempts and delivery metadata | 12 months after terminal delivery state | Delete; do not retain message bodies outside the approved queue |
| Anonymous website analytics | 13 months from event creation | Delete or aggregate irreversibly |
| Rate-limit and anti-abuse records | Shortest operational window; no more than 30 days | Delete automatically |
| Booking-management credentials | Expire after 90 days; retain only cryptographic hashes | Delete expired hashes during housekeeping |
| Privacy-request, audit and security-incident evidence | 6 years after closure, or longer under a documented legal hold | Restricted archive, then secure deletion |
| Database backups | Rolling 35 days once backup ownership is confirmed | Provider expiry; restore access restricted |

No website intake record is to be treated as the complete clinical record. If a
record is transferred into a clinical or statutory occupational-health record,
that destination’s approved retention policy governs the copied record.

The 35-day database-backup row is an approved retention target, not a claim that
backups currently exist. The production Supabase organization was verified on
29 August 2026 as Free plan, which has no managed daily backup or PITR coverage.
No encrypted off-site logical backup has been verified. Public intake therefore
remains blocked by `backup-recovery`; see `RECOVERY-RESTORE-DRILL.md`.

## Retention enforcement

The live database implements the schedule through private, owner-only controls:

- `private.retention_inventory()` reports all nine record classes without
  changing data. It distinguishes eligible rows, active legal holds, supported
  guarded purges and inventory-only classes.
- `private.apply_retention_policy()` records a dry run by default. It supports
  deletion only for terminal notification metadata, analytics without a booking
  link, rate-limit rows older than 30 days and already-expired booking-management
  token hashes.
- Bookings, customers, booking history, actions, consent, employer leads,
  contact enquiries and operational audit evidence are never deleted by the
  function. Their counts are an owner review queue, not disposal authority.
- Active holds in `private.retention_legal_holds` exclude an individual record
  or an entire class when the identifier is `*`. Holds must be resolved before
  disposal and their release must name the responsible person.
- Every dry run or executed run writes a count-only entry to
  `private.retention_runs`. Deleted payloads and management credentials are not
  copied into the run record.
- The functions use caller permissions, are executable only by the database
  owner, and are not exposed to browser, authenticated or service roles. Both
  private tables have RLS, explicit deny-all policies and revoked application
  privileges.
- No Cron job or automatic schedule is installed. Automatic housekeeping must
  remain disabled until the practice assigns an accountable owner, alert route,
  legal-hold check and reviewed change procedure.

The production migration recorded an initial dry run with nine inventory
classes, four guarded-purge classes, zero eligible disposal candidates and zero
deletions. A future executed run requires the exact confirmation phrase
`PURGE APPROVED WEBSITE RETENTION RECORDS` and a change reference of at least
eight characters.

## Data-subject request procedure

1. Accept access, correction, deletion, restriction or objection requests at
   `motselisi@bonevc.co.za`. Do not require the requester to send medical
   details in the first email.
2. Acknowledge the request within two working days and give it an internal
   reference. Verify identity proportionately before disclosing or changing a
   record; never request more identity information than necessary.
3. Search the website booking, contact, employer, consent, notification and
   analytics stores using authorised staff access. Record who searched, when,
   and the decision.
4. Respond as soon as reasonably practicable. If access is refused, retention
   is legally required, or deletion cannot be completed, explain the basis and
   the route to complain to the Information Regulator.
5. Use the Information Regulator’s prescribed forms when applicable. Never
   erase a record subject to a legal hold, active complaint, security incident
   or another documented statutory duty; restrict it instead.

### Private request register

The live database implements this procedure through
`private.privacy_request_register` and the immutable,
data-minimised `private.privacy_request_events` history:

- Records are created and handled only by the database owner or an explicitly
  approved operator in the Supabase SQL editor. The browser, `anon`,
  `authenticated` and `service_role` have no table privileges.
- Each request receives a `DSR-...` reference and an explicit type, workflow
  state, identity-verification state, response outcome, accountable assignee
  and lifecycle timestamps.
- A request cannot be recorded as responded until identity is verified or the
  Information Officer records that identity verification is not required. It
  cannot be closed before a response milestone exists. Invalid lifecycle
  regressions are rejected by the database.
- The register stores only the minimum requester contact locator needed to
  handle the request. Identity documents, disclosed records, medical details
  and mailbox-message bodies must remain in approved controlled custody.
- Every insert and update appends an immutable event containing only workflow
  state, assignee, operator and reason. The event omits requester contact,
  identity evidence and decision narrative.
- `private.privacy_operations_inventory()` reports count-only open, closed,
  six-year-review and held records for both privacy requests and security
  incidents. It does not disclose payloads or authorise deletion.

Use `supabase/snippets/privacy_operations.sql` as the controlled operating
template. Do not bypass its lifecycle with direct status-only edits.

## Processor and transfer register

| Processor | Purpose | Data boundary | Activation condition |
| --- | --- | --- | --- |
| Supabase | EU-hosted operational database, Edge Functions and encrypted function secrets | Form records, consents, limited analytics and notification queue | Active; service-role data access restricted |
| Vercel | Static website delivery, TLS and request logs | Public assets and ordinary web-request metadata | Active |
| Cloudflare Turnstile | Bot verification through Siteverify | Verification token and requesting IP supplied to Cloudflare | Not active until both keys are configured and the notice version is approved in the database |
| Resend | Transactional email delivery | Minimum recipient, subject and approved message content | Not active until domain and sender authentication pass |

Before a new processor is enabled, record its purpose, location, contractual
privacy/security terms, sub-processors, deletion route and incident contact.
Cross-border processing must have a documented POPIA section 72 basis.

## Security compromise procedure

Immediately contain the incident, preserve evidence, notify the designated
Information Officer and determine the affected records and people. The responsible party must
report security compromises to the Information Regulator and affected data
subjects as required; provider incidents must be escalated to InsureSPR without
delay. Record notification time, scope, mitigation and follow-up actions in the
incident log. Do not wait for a perfect investigation before escalating a
reasonably suspected compromise.

The live `private.security_incident_register` now provides that restricted log,
with an immutable `private.security_incident_events` lifecycle. It records the
discovery source and time, accountable owner, determination, affected record
classes/count, containment, regulator and affected-person notification states,
controlled portal reference and closure. The database prevents a confirmed
compromise from being closed without a completed regulator notification and a
completed or documented-impossible affected-person notification. Incident
summaries must not contain names, contact details, credentials, raw logs or
compromised record contents.

All four privacy-operations tables use RLS, explicit deny-all policies and
owner-only ACLs. Their trigger and inventory functions are also unavailable to
the browser and service role. The production migration’s transaction-scoped
request and incident probes completed their valid workflows and rolled back to
zero retained records.

The Information Regulator states that security-compromise notifications must be
submitted through its eServices portal and that the Information Officer should
notify affected data subjects in writing. Use the current official procedure
and forms rather than copying a stale form into this repository:
<https://inforegulator.org.za/popia/> and
<https://inforegulator.org.za/popia-forms/>.

## Release control

The public notice can be published as version `2026-08-21.1`, but the database
must retain a pending privacy version until the Information Officer registration
evidence, Turnstile keys, processor activation evidence and operational owner
sign-off are on file. The API’s pending-policy and missing-Turnstile gates remain
the authoritative protection against premature intake.
