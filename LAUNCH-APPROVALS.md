# InsureSPR launch authority record

Decision date: 21 August 2026

Approver: Motselisi R. Mosiana, owner

Recorded from: the owner’s written approval in the InsureSPR production task

This record distinguishes an owner decision from evidence that only a regulator,
provider account, practitioner register, equipment licence, DNS record or staff
schedule can supply. An approved direction does not turn a missing fact into a
verified fact and does not override the application’s fail-closed controls.

## Approved decisions

- The public catalogue is approved as a conservative, request-led catalogue.
  Services may remain published as `needs_confirmation`; this approval does not
  verify a licence, practitioner, report route, price, medical-aid arrangement,
  preparation instruction, result time or operating capacity.
- On 31 August 2026 the owner explicitly reconfirmed all 16 published catalogue
  entries. This confirms catalogue membership and permission to advertise each
  route using its current conservative, staff-confirmed wording. It does not
  change any service's separate clinical `verification_status`, price,
  availability, referral, preparation, reporting or medical-aid evidence.
- InsureSPR Precision Healthcare is the responsible party for website intake.
  The owner designated Motselisi R. Mosiana as Information Officer on
  21 August 2026. This records the internal designation; the site must not
  claim Information Regulator registration until the registration record is
  held.
- The publication wording and website-data retention schedule in
  `PRIVACY-OPERATIONS.md` are approved. Transactional intake stays closed while
  `practice_settings.privacy_notice_version` is pending.
- Cloudflare Turnstile is the approved public-form anti-spam provider. Both the
  site key and secret key are required together; there is no bypass.
- Resend is the approved transactional-email adapter. It remains disabled until
  its account, verified sending domain, sender/reply-to addresses, DNS records,
  independent worker secret and schedule are all proven. A later configuration
  must bind the exact non-secret controls, secret-generation fingerprints and
  worker-source SHA-256 to evidence, pass a short-lived rehearsal, and then
  match an active Vault-backed Cron job before readiness can become true.
- DXA remains a staff-confirmed request pathway. No duration, horizon, notice,
  weekly hours, closure or generated slot is approved without the actual staff
  rota and equipment capacity.
- `083 450 7861` is approved as the booking phone and WhatsApp number.
  Motselisi R. Mosiana is the named booking contact and first-line response
  owner during the published Monday–Friday practice hours.
- `motselisi@bonevc.co.za` is approved as the public booking and privacy email.
  Public supplier evidence links the address and phone to Motselisi/QSIGHT and
  the receiving domain had an MX record on 21 August 2026. This does not prove
  that automated transactional sending is configured.
- All 153 inventoried legacy URLs are approved to remain in `hold`. The hold is
  a deliberate no-routing decision, not permission to mass-redirect unique
  articles or stateful URLs to unrelated pages.
- The supplied 2026 XOM rate report remains evidence for review, not approved
  patient pricing. No rate is published until its billing meaning, effective
  date, VAT treatment, service mapping and anomalies are confirmed.

## Evidence still required before activation

| Area | Required evidence | Safe state until received |
| --- | --- | --- |
| Information Officer | Information Regulator registration record and the legal identity of the responsible private body | Motselisi is shown as owner-designated Information Officer; intake version stays pending |
| Turnstile | Official-domain site key and matching secret in Vercel plus the tested signed Vercel-to-Supabase verification path | All public mutations return a configuration error before writing |
| Clinical operations | A private regulator-register check is retained in the controlled evidence record. The owner has explicitly declined public display of the registration number, register status, result and regulator source trail. Equipment/use licence, responsible-person appointment, any other practitioner registrations, reporting route and approved service facts remain required. | `needs_confirmation`; keep the practitioner-register evidence private and do not infer the remaining controls |
| Pricing and aid | Signed current patient tariff, billing/VAT interpretation and scheme arrangements | Prices unpublished or quote-only |
| Availability | Duration, notice, horizon, buffers, weekly rota, closures and named schedule owner | No policies, rules or slots |
| Email delivery | Resend account/key, verified sending domain, sender, reply-to, SPF, DKIM, DMARC, worker secret and Cron owner | Direct email to the approved receiving address is available; automated queue retained and worker not scheduled |
| Booking contacts | Controlled live-call/WhatsApp delivery check and any out-of-hours escalation process | Owner-approved number and named monitor are published |
| Legacy content | One-by-one content/licensing/clinical decision where a URL later leaves hold | No automatic redirect |

## Activation rule

No operator may change the privacy version from a pending value, mark a service
`verified`, publish a price, create availability rules, configure outbound mail,
or activate a legacy route solely because this document exists. The approved
phone, WhatsApp and receiving email may be published; the remaining provider,
registration and clinical evidence must be attached to the release record and
the strict release audit must pass.

## Readiness form received after these decisions

The owner-supplied `InsureSPR Evidence & Operational Readiness Form`, version
`20260825-01`, was reviewed on 29 August 2026 and registered by SHA-256 in the
private database evidence register. It corroborates the already-approved phone,
WhatsApp and Information Officer designation, but it does not close a launch
dependency: the form contains conflicting company-registration years, no
Information Regulator reference, no controlled credential evidence, no clinical
workflow, no pricing approval, incomplete scheduling data, no provider/DNS
test, and no final release decision. See `OPERATIONAL-EVIDENCE-REGISTER.md`.
