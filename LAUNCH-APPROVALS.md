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
- InsureSPR Precision Healthcare is the responsible party for website intake.
  Motselisi R. Mosiana is the owner and public privacy lead. The site must not
  claim that an Information Officer registration is complete until the
  registration evidence is held.
- The publication wording and website-data retention schedule in
  `PRIVACY-OPERATIONS.md` are approved. Transactional intake stays closed while
  `practice_settings.privacy_notice_version` is pending.
- Cloudflare Turnstile is the approved public-form anti-spam provider. Both the
  site key and secret key are required together; there is no bypass.
- Resend is the approved transactional-email adapter. It remains disabled until
  its account, verified sending domain, sender/reply-to addresses, DNS records,
  independent worker secret and schedule are all proven.
- DXA remains a staff-confirmed request pathway. No duration, horizon, notice,
  weekly hours, closure or generated slot is approved without the actual staff
  rota and equipment capacity.
- The retired phone and WhatsApp channels remain absent. Email and directions
  are the only approved contact routes until a new number is independently
  verified.
- All 153 inventoried legacy URLs are approved to remain in `hold`. The hold is
  a deliberate no-routing decision, not permission to mass-redirect unique
  articles or stateful URLs to unrelated pages.
- The supplied 2026 XOM rate report remains evidence for review, not approved
  patient pricing. No rate is published until its billing meaning, effective
  date, VAT treatment, service mapping and anomalies are confirmed.

## Evidence still required before activation

| Area | Required evidence | Safe state until received |
| --- | --- | --- |
| Information Officer | Regulator registration record and the legal identity of the responsible private body | Owner shown as privacy lead; intake version stays pending |
| Turnstile | Official-domain site key and matching secret | All public mutations return a configuration error before writing |
| Clinical operations | Equipment/use licence, responsible person, practitioner registrations, reporting route and approved service facts | `needs_confirmation`; no invented claims |
| Pricing and aid | Signed current patient tariff, billing/VAT interpretation and scheme arrangements | Prices unpublished or quote-only |
| Availability | Duration, notice, horizon, buffers, weekly rota, closures and named schedule owner | No policies, rules or slots |
| Email | Resend account/key, verified domain, sender, reply-to, SPF, DKIM, DMARC, worker secret and Cron owner | Queue retained; worker not scheduled |
| Phone/WhatsApp | Number, owner confirmation and channel monitoring responsibility | Channel absent |
| Legacy content | One-by-one content/licensing/clinical decision where a URL later leaves hold | No automatic redirect |

## Activation rule

No operator may change the privacy version from a pending value, mark a service
`verified`, publish a price, create availability rules, configure outbound mail,
restore phone/WhatsApp, or activate a legacy route solely because this document
exists. The corresponding evidence must be attached to the release record and
the strict release audit must pass.
