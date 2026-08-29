# InsureSPR operational evidence register

Status date: 29 August 2026

This register separates three things that must not be collapsed into one:

1. a fact or claim supplied by the owner;
2. independently checked evidence for that claim; and
3. permission to publish or activate the related service.

A checked box in a questionnaire is not automatically regulatory, clinical or
operational verification. Source documents remain in controlled private
custody. The repository and database retain only the minimum metadata and
review summary needed to prove which document was reviewed and which claims
remain blocked.

## Evidence document recorded

| Field | Recorded value |
| --- | --- |
| Database key | `insurespr-readiness-20260825-01` |
| Source filename | `InsureSPR_Evidence_and_Operational_Readiness_Form.pdf` |
| Document date | 25 August 2026 |
| Form version | `20260825-01` |
| Supplied by | Motselisi Mosiana, Director |
| SHA-256 | `3a7558854583a363cc0961fbed68345dc362a873f6d3bfcb57679809e6dbd301` |
| Review result | `partially_accepted` |
| Source custody | Private source held outside the public repository |

The PDF itself is not committed or uploaded to the public website. The digest
allows a future reviewer to establish whether a presented copy is the exact
document that was reviewed.

## Live database representation

Migration `20260828230538_record_operational_readiness_evidence` adds:

- `private.readiness_evidence_documents` for immutable source identity,
  controlled-custody metadata and overall review state;
- `private.readiness_evidence_claims` for field-level supplied values, review
  status, publication permission, blocker notes and the linked launch
  dependency; and
- a reconciliation of the relevant rows in `public.launch_dependencies`.

Migration `20260828230930_harden_readiness_evidence_access` adds explicit deny
policies and the evidence-to-dependency index. Both private tables have RLS and
no `PUBLIC`, `anon`, `authenticated` or `service_role` data privileges. They
are intended for controlled database-owner review in Supabase Studio or SQL,
not for the website or Edge Functions.

Migration `20260829064000_record_google_business_profile_handoff` records the
SHA-256 of `GOOGLE-BUSINESS-PROFILE-ALIGNMENT.json`. That machine-readable
handoff is `prepared-not-applied`: it checks the website-side identity, phone,
published weekday hours and 16 service destinations while leaving the profile
resource, authorised editor, categories, special hours and account review as
explicit nulls. The file is retained in git, excluded from Vercel and does not
authorise or imply a Google account change.

Migration `20260829065000_record_service_activation_handoff` records the exact
SHA-256 of `SERVICE-ACTIVATION-HANDOFF.json` and five scoped evidence claims
covering catalogue, credentials, clinical requirements, booking rules and
prices. The packet matches all 16 live services but every service approval and
global evidence reference is null. All five linked launch gates remain open;
the migration cannot verify a service, create a slot or open intake.

Migration `20260829070000_record_privacy_activation_handoff` records the exact
SHA-256 of `PRIVACY-ACTIVATION-HANDOFF.json` and six scoped claims covering
legal/Information Officer evidence, active platform processor reviews,
Turnstile, Resend, privacy operations and backup retention. The packet matches
the live notice/API but remains `prepared-not-approved`; the database privacy
version and all five linked launch dependencies remain pending/open.

Migrations `20260829071000_harden_availability_approval_provenance` and
`20260829072000_record_availability_activation_handoff` add revision-bound,
peer-reviewed availability approval metadata and record the exact SHA-256 of
`AVAILABILITY-ACTIVATION-HANDOFF.json`. Three scoped claims verify the zero-state
DXA baseline and prepared policy/operations contract. No duration, policy, rule,
exception, slot, booking or Cron job is created.

The recorded 19 claims currently resolve to:

| Review status | Count | Meaning |
| --- | ---: | --- |
| `owner_approved` | 2 | Already-approved public designation or channel data |
| `needs_evidence` | 8 | Supplied candidate that still needs an authoritative record and review |
| `contradicted` | 2 | Conflicts internally or with an already approved production fact |
| `missing` | 7 | Required section or proof was not supplied |
| `verified` | 0 | No new claim in this form met independent verification requirements |

Only these two claims are permitted for public use because they were approved
and evidenced before this form was supplied:

- Motselisi Mosiana is the owner-designated Information Officer. This is not a
  claim that Information Regulator registration is complete.
- `083 450 7861` is the approved booking phone and WhatsApp channel.

## Items that remain evidence-bound

- Resolve the conflicting company-registration years and attach the
  authoritative legal-entity record.
- Reconcile the practice, registered/principal and Google Business Profile
  address variants without publishing a private registered address.
- Attach the Information Regulator registration record and reference.
- Hold the SAHPRA licence/equipment identity in controlled custody and record
  its verifier, validity and applicable address without publishing a private
  licence number unnecessarily.
- Verify the responsible-person appointment and the current professional
  registration/category of every practitioner whose role may be published.
- Verify the masked BHF/practice-number candidate, its registered entity,
  medical-aid claim route, exclusions and service applicability.
- Supply approved reporting, written-request, preparation, result-delivery and
  turnaround workflows with accountable owners.
- Supply a signed current price schedule with service mapping, billing basis,
  effective date and publication approval.
- Clarify which service the proposed 45-minute duration applies to; clarify the
  one-day horizon, daily/weekly capacity and closures; then supply opening
  times, staff/equipment rota, schedule owner and a controlled materialisation
  test before creating availability.
- Test any proposed `info@insuresprhealth.co.za` mailbox end to end and supply
  provider, MX, SPF, DKIM, DMARC, sender, reply-to, worker-secret and scheduler
  evidence before changing the approved public booking mailbox.
- Apply the prepared Google Business Profile handoff inside the controlled
  account, then retain account-side category, hours, destinations, editor
  ownership and before/after verification evidence.
- Complete the final readiness decision, approver, date, version and scope
  limitations only after the evidence-bound dependencies close.

## Evidence update procedure

1. Keep the original source in controlled custody; never commit licence scans,
   identity documents, secrets or patient data.
2. Compute the source SHA-256 and register a new document version through a
   forward-only migration. Do not overwrite a prior digest or source identity.
3. Record each material claim separately. `owner_approved` means the owner has
   authorised the fact or direction; `verified` requires the authoritative
   external or controlled internal evidence, a verifier and a verification
   timestamp.
4. Link unresolved claims to the applicable `launch_dependencies` row. Keep the
   dependency open and blocking until all facts required for that activation
   are verified and the real operational test passes.
5. Publish or activate a service fact only through a reviewed migration that
   updates the evidence claim, launch dependency and operational table in one
   auditable change.
6. Re-run migration-history comparison, database advisors, the strict release
   audit and the relevant end-to-end test before changing a pending privacy
   version, verified service, public price, availability policy or provider
   readiness state.

The evidence register is a provenance and gating mechanism. It is not a
clinical record, licence repository, password manager or substitute for the
authoritative regulator/provider record.

## Later verified public DNS evidence

On 29 August 2026, the public TXT record
`_dmarc.insuresprhealth.co.za = v=DMARC1; p=none` was returned by both
Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`). Migration
`20260829045554_record_dmarc_monitoring_policy` records the canonical
observation as a separate accepted external-source document and one verified
claim. It does not modify the 19 claims extracted from readiness form
`20260825-01`.

The DMARC policy is deliberately non-enforcing. `email-delivery` remains open
until the selected provider's exact SPF, Return-Path MX and DKIM records,
verified sender and Reply-To, provider/worker secrets, notification schedule
ownership, failure alerts and controlled delivery tests are complete. The
absence of an inbound MX route also means `info@insuresprhealth.co.za` remains
an unverified candidate rather than the public receiving mailbox.
