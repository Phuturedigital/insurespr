# Website privacy and POPIA operations

Approved publication version: `2026-08-21.1`

Responsible party: InsureSPR Precision Healthcare

Owner and privacy lead: Motselisi R. Mosiana

Public privacy contact: `health@insuresprhealth.co.za`

The owner has approved this website-specific schedule and procedure. It is not
a substitute for the private body’s PAIA manual, Information Officer
registration, clinical-record policy or professional record-retention duties.
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
| Audit and security-incident evidence | 6 years after closure, or longer under a documented legal hold | Restricted archive, then secure deletion |
| Database backups | Rolling 35 days once backup ownership is confirmed | Provider expiry; restore access restricted |

No website intake record is to be treated as the complete clinical record. If a
record is transferred into a clinical or statutory occupational-health record,
that destination’s approved retention policy governs the copied record.

## Data-subject request procedure

1. Accept access, correction, deletion, restriction or objection requests at
   `health@insuresprhealth.co.za`. Do not require the requester to send medical
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

Immediately contain the incident, preserve evidence, notify the owner/privacy
lead and determine the affected records and people. The responsible party must
report security compromises to the Information Regulator and affected data
subjects as required; provider incidents must be escalated to InsureSPR without
delay. Record notification time, scope, mitigation and follow-up actions in the
incident log. Do not wait for a perfect investigation before escalating a
reasonably suspected compromise.

## Release control

The public notice can be published as version `2026-08-21.1`, but the database
must retain a pending privacy version until the Information Officer registration
evidence, Turnstile keys, processor activation evidence and operational owner
sign-off are on file. The API’s pending-policy and missing-Turnstile gates remain
the authoritative protection against premature intake.
