begin;

create table private.readiness_evidence_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  document_key text not null unique
    check (document_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 240),
  source_filename text not null check (char_length(source_filename) between 1 and 255),
  source_kind text not null
    check (source_kind in ('owner_supplied_private_document', 'external_public_source', 'internal_record')),
  content_sha256 bytea not null unique check (octet_length(content_sha256) = 32),
  document_date date,
  form_version text check (form_version is null or char_length(form_version) between 1 and 80),
  supplied_by text check (supplied_by is null or char_length(supplied_by) between 1 and 160),
  supplied_role text check (supplied_role is null or char_length(supplied_role) between 1 and 160),
  custody_note text not null check (char_length(custody_note) between 1 and 1000),
  review_status text not null
    check (review_status in ('received', 'reviewed', 'partially_accepted', 'accepted', 'rejected', 'superseded')),
  reviewed_by text check (reviewed_by is null or char_length(reviewed_by) between 1 and 160),
  reviewed_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reviewed_at is null) = (reviewed_by is null)),
  check ((review_status = 'received') = (reviewed_at is null))
);

create table private.readiness_evidence_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  document_id uuid not null
    references private.readiness_evidence_documents(id) on delete restrict,
  claim_key text not null check (claim_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  section text not null check (char_length(section) between 1 and 160),
  source_page smallint not null check (source_page between 1 and 500),
  supplied_value jsonb not null check (jsonb_typeof(supplied_value) = 'object'),
  review_status text not null
    check (review_status in ('owner_approved', 'needs_evidence', 'contradicted', 'missing', 'verified', 'rejected', 'not_applicable')),
  public_use_allowed boolean not null default false,
  linked_dependency_key text
    references public.launch_dependencies(dependency_key) on delete restrict,
  reviewer_note text not null check (char_length(reviewer_note) between 1 and 2000),
  verified_by text check (verified_by is null or char_length(verified_by) between 1 and 160),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, claim_key),
  check ((verified_at is null) = (verified_by is null)),
  check ((review_status = 'verified') = (verified_at is not null)),
  check (not public_use_allowed or review_status in ('owner_approved', 'verified'))
);

comment on table private.readiness_evidence_documents is
  'Private, hash-bound metadata for operational evidence. Source documents remain in controlled custody and are not exposed through the Data API.';
comment on table private.readiness_evidence_claims is
  'Field-level readiness claims separated from verification status so owner-supplied statements cannot silently become public verified facts.';

create trigger readiness_evidence_documents_set_updated_at
before update on private.readiness_evidence_documents
for each row execute function public.set_updated_at();

create trigger readiness_evidence_claims_set_updated_at
before update on private.readiness_evidence_claims
for each row execute function public.set_updated_at();

alter table private.readiness_evidence_documents enable row level security;
alter table private.readiness_evidence_claims enable row level security;

revoke all on private.readiness_evidence_documents from public, anon, authenticated, service_role;
revoke all on private.readiness_evidence_claims from public, anon, authenticated, service_role;

insert into private.readiness_evidence_documents (
  document_key,
  title,
  source_filename,
  source_kind,
  content_sha256,
  document_date,
  form_version,
  supplied_by,
  supplied_role,
  custody_note,
  review_status,
  reviewed_by,
  reviewed_at,
  notes
)
values (
  'insurespr-readiness-20260825-01',
  'InsureSPR Evidence & Operational Readiness Form',
  'InsureSPR_Evidence_and_Operational_Readiness_Form.pdf',
  'owner_supplied_private_document',
  decode('3a7558854583a363cc0961fbed68345dc362a873f6d3bfcb57679809e6dbd301', 'hex'),
  date '2026-08-25',
  '20260825-01',
  'Motselisi Mosiana',
  'Director',
  'The private source PDF is held outside the public repository. The database stores its filename, SHA-256 digest and reviewed claim summary, but not the source file or local workstation path.',
  'partially_accepted',
  'Phuture Digital evidence review',
  timestamptz '2026-08-29 00:00:00+02',
  'The AcroForm contains 335 canonical fields and 335 widgets with matching values and appearances. Checked statuses are not treated as verification where the evidence reference, verifier or verification date is blank. The final release decision is blank.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-readiness-20260825-01'
)
insert into private.readiness_evidence_claims (
  document_id,
  claim_key,
  section,
  source_page,
  supplied_value,
  review_status,
  public_use_allowed,
  linked_dependency_key,
  reviewer_note
)
select
  evidence_document.id,
  claim.claim_key,
  claim.section,
  claim.source_page,
  claim.supplied_value,
  claim.review_status,
  claim.public_use_allowed,
  claim.linked_dependency_key,
  claim.reviewer_note
from evidence_document
cross join (
  values
    (
      'legal-entity-registration',
      '1.1 Responsible private body legal identity',
      2::smallint,
      jsonb_build_object(
        'legal_name', 'Qsight (Pty) Ltd',
        'document_control_registration_number', '2015/177122/07',
        'legal_identity_registration_number', '2025/177122/07',
        'selected_status', 'not_applicable'
      ),
      'contradicted',
      false,
      'privacy-popia',
      'The registration year conflicts between pages 1 and 2, and legal identity is applicable despite the selected not-applicable status. Obtain the authoritative company record before verification.'
    ),
    (
      'practice-and-registered-addresses',
      'Document control and legal identity',
      2::smallint,
      jsonb_build_object(
        'practice_address_variant_present', true,
        'registered_or_principal_address_present', true,
        'addresses_match_each_other', false,
        'practice_address_matches_current_public_address', false
      ),
      'needs_evidence',
      false,
      'google-business-profile',
      'The form distinguishes a practice address from a registered or principal address but does not reconcile the practice address with the current 7 Malibongwe Drive public address.'
    ),
    (
      'information-officer-designation',
      '1.2 Information Officer registration',
      2::smallint,
      jsonb_build_object('name', 'Motselisi Mosiana', 'role', 'Administrator', 'basis', 'owner designation'),
      'owner_approved',
      true,
      'privacy-popia',
      'The form corroborates the owner designation already approved on 2026-08-21. It does not prove Information Regulator registration.'
    ),
    (
      'information-regulator-registration',
      '1.2 Information Officer registration',
      2::smallint,
      jsonb_build_object('regulator_reference', null, 'evidence_reference', null, 'verification_date', null),
      'missing',
      false,
      'privacy-popia',
      'No regulator reference, evidence record, verifier or verification date is supplied. Public intake must remain privacy-gated.'
    ),
    (
      'turnstile-production-configuration',
      '2.1 Cloudflare Turnstile production credentials',
      3::smallint,
      jsonb_build_object('hostname', null, 'site_key_identifier', null, 'secret_storage_location', null, 'live_test', null),
      'missing',
      false,
      'anti-spam-secrets',
      'The production anti-spam section is blank. No key or activation state is inferred.'
    ),
    (
      'transactional-email-configuration',
      '2.2 Outbound email provider and application values',
      3::smallint,
      jsonb_build_object(
        'resend_api_key', 'not supplied',
        'email_from', 'not supplied',
        'email_reply_to', 'not supplied',
        'notification_worker_secret', 'not supplied'
      ),
      'missing',
      false,
      'email-delivery',
      'All provider and application configuration fields are blank. No secrets are stored in this evidence register.'
    ),
    (
      'receiving-mailbox-and-dns',
      '3. Mailbox, DNS authentication and monitoring',
      4::smallint,
      jsonb_build_object(
        'requested_receiving_address', 'info@insuresprhealth.co.za',
        'provider', null,
        'mailbox_owner', null,
        'inbound_reply_test', null,
        'mx', null,
        'spf', null,
        'dkim', null,
        'dmarc', null
      ),
      'needs_evidence',
      false,
      'email-delivery',
      'The address is a requested candidate only. The form supplies no receiving test, provider or DNS authentication evidence, so the current public booking address is unchanged.'
    ),
    (
      'sahpra-equipment-use-licence',
      '4.1 SAHPRA equipment / use licence',
      5::smallint,
      jsonb_build_object(
        'selected_status', 'verified_operational',
        'licence_reference', 'Not for public',
        'licensed_address', '18 Aimee Street, EmedCentre, Ruiterhof, Randburg',
        'equipment_serial_or_model', null,
        'evidence_reference', null,
        'verification_date', null
      ),
      'needs_evidence',
      false,
      'verified-credentials',
      'A non-public licence may be kept confidential, but an internal controlled reference, equipment identity, verifier and verification date are still required before the claim is verified.'
    ),
    (
      'responsible-person',
      '4.2 Responsible person',
      5::smallint,
      jsonb_build_object(
        'selected_status', 'verified_operational',
        'name', 'Motselisi Mosiana',
        'role', 'Diagnostic Radiographer',
        'contact', '083 450 7861',
        'evidence_reference', null,
        'verification_date', null
      ),
      'needs_evidence',
      false,
      'verified-credentials',
      'The named role is owner-supplied, but the appointment evidence, HPCSA category/number, current registration check and verification date are absent.'
    ),
    (
      'practitioner-professional-status',
      '4.3 Practitioners and current professional status',
      5::smallint,
      jsonb_build_object('practitioners', jsonb_build_array(), 'evidence_reference', null),
      'missing',
      false,
      'verified-credentials',
      'No practitioner names, categories, registration numbers or current-status evidence are supplied.'
    ),
    (
      'clinical-workflow-and-patient-instructions',
      '5. Workflow & patient instructions',
      6::smallint,
      jsonb_build_object(
        'reporting_route', null,
        'written_request_rules', null,
        'preparation', null,
        'result_delivery', null,
        'turnaround', null
      ),
      'missing',
      false,
      'clinical-requirements',
      'The complete reporting, referral, preparation, results and turnaround page is blank.'
    ),
    (
      'medical-aid-and-bhf',
      '6.1 Medical-aid and BHF arrangements',
      7::smallint,
      jsonb_build_object(
        'selected_status', 'verified_operational',
        'bhf_or_practice_number_masked', '***2492',
        'claim_route', null,
        'exclusions_cash_pre_authorisation_rules', null,
        'evidence_reference', null
      ),
      'needs_evidence',
      false,
      'verified-credentials',
      'The number is an owner-supplied candidate. The registered entity, current BHF evidence, claim route, exclusions and medical-aid applicability per service remain unverified.'
    ),
    (
      'service-capability',
      '6.2 Service-specific operational capability',
      7::smallint,
      jsonb_build_object(
        'marked_ready', jsonb_build_array('X-Ray', 'DXA Bone Density', 'DXA Spine', 'DXA VFA', 'DXA 1/3 Forearm'),
        'unresolved', jsonb_build_array('DXA Body Composition'),
        'evidence_or_blockers_completed', false,
        'owners_completed', false
      ),
      'needs_evidence',
      false,
      'clinical-requirements',
      'Ready boxes are not accepted as verification because every evidence/blocker and owner field is blank and the workflow page is incomplete.'
    ),
    (
      'pricing-publication',
      '7. Pricing & publication approval',
      8::smallint,
      jsonb_build_object('approved_prices', jsonb_build_array(), 'approver', null, 'approval_date', null),
      'missing',
      false,
      'approved-prices',
      'No service price, basis, effective date, approval, approver or publication rule is supplied. Prices remain unpublished or quote-only.'
    ),
    (
      'appointment-availability-policy',
      '8. Appointment availability & staff rota',
      9::smallint,
      jsonb_build_object(
        'appointment_duration_minutes_candidate', 45,
        'booking_horizon_days_candidate', 1,
        'minimum_notice_minutes_candidate', 1440,
        'buffer_minutes_candidate', 30,
        'capacity_candidate', 6,
        'closures_candidate', jsonb_build_array('Saturday', 'Sunday', 'public holidays'),
        'weekly_rota', null,
        'schedule_owner', null,
        'materialisation_test', null
      ),
      'needs_evidence',
      false,
      'booking-rules',
      'These are candidate values only. The form does not identify the affected service, distinguish daily from weekly capacity, supply operating times, name an owner or show a booking test. No availability policy or slot may be materialised from them.'
    ),
    (
      'phone-whatsapp-channel',
      '9.1 Controlled phone and WhatsApp channels',
      10::smallint,
      jsonb_build_object('phone', '083 450 7861', 'whatsapp', '083 450 7861'),
      'owner_approved',
      true,
      'notification-operations',
      'The channel values match the prior owner approval and public evidence already used by production.'
    ),
    (
      'phone-response-hours-and-monitoring',
      '9.1 Controlled phone and WhatsApp channels',
      10::smallint,
      jsonb_build_object('supplied_response_hours', 'Always available', 'channel_owner', null, 'live_test', null),
      'contradicted',
      false,
      'notification-operations',
      'Always available conflicts with the currently approved Monday-Friday 08:00-17:00 publication and lacks a channel owner and live-test record. Production hours are unchanged.'
    ),
    (
      'google-business-profile',
      '9.2 Google Business Profile account-side verification',
      10::smallint,
      jsonb_build_object(
        'business_name', 'InsureSPR Health',
        'address', '18 Aimee Street, EmedCentre, Ruiterhof, Randburg',
        'business_hours', '6 hrs',
        'primary_category', null,
        'website_destination', null,
        'booking_destination', null,
        'account_owner', null,
        'verification_evidence', null
      ),
      'needs_evidence',
      false,
      'google-business-profile',
      'The account-side verification section is incomplete and supplies no authorised editor or evidence. No Google Business Profile mutation is authorised from this form.'
    ),
    (
      'final-readiness-signoff',
      '10. Final readiness sign-off',
      11::smallint,
      jsonb_build_object(
        'legal_and_information_officer_checkbox', true,
        'overall_release_decision', null,
        'approver', null,
        'approval_date', null,
        'release_reference', null,
        'scope_limitations', null
      ),
      'missing',
      false,
      null,
      'The checked legal/Information Officer item conflicts with the incomplete evidence fields, and no overall decision or approver is recorded. The form is not a release approval.'
    )
) as claim(
  claim_key,
  section,
  source_page,
  supplied_value,
  review_status,
  public_use_allowed,
  linked_dependency_key,
  reviewer_note
);

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 reaffirms Motselisi Mosiana as the designated Information Officer, but supplies no Information Regulator reference, registration evidence, verifier or verification date. Legal identity also contains conflicting 2015/2025 registration years. Intake remains blocked pending authoritative identity and regulator evidence plus final operational sign-off.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'privacy-popia';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 marks SAHPRA equipment/use and the responsible person as operational and supplies a masked BHF/practice-number candidate ending 2492, but provides no controlled licence/equipment reference, practitioner registration, verifier, verification date, claim route or service-specific medical-aid evidence. All credential claims remain unverified.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'verified-credentials';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 marks X-Ray, DXA Bone Density, DXA Spine, DXA VFA and DXA 1/3 Forearm ready, leaves DXA Body Composition unresolved, and leaves every evidence/owner field plus the reporting, referral, preparation, result and turnaround workflow blank. Conservative request-led wording and needs_confirmation remain mandatory.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'clinical-requirements';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 supplies candidate values of 45-minute appointments, one-day horizon, 24-hour notice, 30-minute buffer, capacity 6 and weekend/public-holiday closure. It does not identify affected services, clarify daily versus weekly capacity, provide opening times/rota/equipment rule, name a schedule owner or show a materialisation test. No policy, rule or slot is approved.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'booking-rules';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 contains no price, price basis, effective date, approval, approver or publication rule. Existing prices remain unpublished or quote-only; the earlier rate report remains review evidence only.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'approved-prices';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 leaves the production hostname, Turnstile site-key identifier, secret storage location and live-test result blank. Intake remains blocked until both keys are configured together and official-domain rejection/acceptance tests pass.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'anti-spam-secrets';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 proposes info@insuresprhealth.co.za as a receiving address but supplies no mailbox provider, owner, inbound/reply test, MX, SPF, DKIM, DMARC, Resend configuration or worker secret. The approved public booking address remains motselisi@bonevc.co.za; automated delivery remains blocked.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'email-delivery';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 matches the approved 083 450 7861 phone/WhatsApp route but supplies no channel monitor or live-test record and claims Always available, which is not accepted over the published Monday-Friday 08:00-17:00 hours. Cron owner, alert recipient, escalation process and controlled notification delivery test remain required.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'notification-operations';

update public.launch_dependencies
set
  detail = 'Owner readiness form 20260825-01 supplies the InsureSPR Health name, an 18 Aimee Street/EmedCentre address variant and the incomplete value 6 hrs. It does not supply a primary category, contact method, destination URLs, authorised editor or account-side verification evidence. Existing canonical website data remains unchanged pending reconciliation.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'google-business-profile';

do $$
declare
  v_document_id uuid;
  v_claim_count integer;
  v_open_blockers integer;
  v_published_services integer;
  v_unverified_services integer;
  v_public_privileges integer;
  v_rls_tables integer;
begin
  select document.id
  into strict v_document_id
  from private.readiness_evidence_documents as document
  where document.document_key = 'insurespr-readiness-20260825-01'
    and document.content_sha256 = decode('3a7558854583a363cc0961fbed68345dc362a873f6d3bfcb57679809e6dbd301', 'hex')
    and document.review_status = 'partially_accepted'
    and document.document_date = date '2026-08-25'
    and document.form_version = '20260825-01';

  select count(*)
  into v_claim_count
  from private.readiness_evidence_claims as claim
  where claim.document_id = v_document_id;

  if v_claim_count <> 19 then
    raise exception using errcode = '23514', message = 'readiness evidence claim inventory is incomplete';
  end if;

  if (
    select count(*)
    from private.readiness_evidence_claims as claim
    where claim.document_id = v_document_id
      and claim.public_use_allowed
  ) <> 2 then
    raise exception using errcode = '23514', message = 'only prior owner-approved public contact and designation claims may be public';
  end if;

  if exists (
    select 1
    from private.readiness_evidence_claims as claim
    where claim.document_id = v_document_id
      and claim.review_status = 'verified'
  ) then
    raise exception using errcode = '23514', message = 'this form supplies no independently verified claim';
  end if;

  select count(*)
  into v_open_blockers
  from public.launch_dependencies as dependency
  where dependency.dependency_key in (
      'privacy-popia',
      'verified-credentials',
      'clinical-requirements',
      'booking-rules',
      'approved-prices',
      'anti-spam-secrets',
      'email-delivery',
      'notification-operations',
      'google-business-profile'
    )
    and dependency.status = 'open'
    and dependency.blocks_launch
    and dependency.resolved_at is null;

  if v_open_blockers <> 9 then
    raise exception using errcode = '23514', message = 'evidence-bound dependencies must remain fail-closed';
  end if;

  select count(*), count(*) filter (where service.verification_status = 'needs_confirmation')
  into v_published_services, v_unverified_services
  from public.services as service
  where service.is_published;

  if v_published_services <> 16 or v_unverified_services <> 16 then
    raise exception using errcode = '23514', message = 'submitted readiness boxes must not verify published services';
  end if;

  if exists (
    select 1
    from public.services as service
    where service.is_published
      and (
        service.cash_price_cents is not null
        or service.appointment_duration_minutes is not null
        or service.preparation_instructions is not null
        or service.results_process is not null
      )
  ) then
    raise exception using errcode = '23514', message = 'unsubstantiated service facts were published';
  end if;

  if exists (select 1 from private.booking_availability_policies)
    or exists (select 1 from public.availability_rules)
    or exists (select 1 from public.availability_exceptions)
    or exists (select 1 from public.booking_slots)
  then
    raise exception using errcode = '23514', message = 'candidate availability values must not activate booking capacity';
  end if;

  if (
    select settings.privacy_notice_version
    from public.practice_settings as settings
    where settings.id = 'primary'
  ) !~* '^pending'
  then
    raise exception using errcode = '23514', message = 'readiness evidence must not open transactional intake';
  end if;

  if exists (
    select 1
    from public.practice_settings as settings
    where settings.id = 'primary'
      and (
        settings.phone_display is distinct from '083 450 7861'
        or settings.phone_e164 is distinct from '+27834507861'
        or settings.whatsapp_e164 is distinct from '27834507861'
        or settings.public_email is distinct from 'motselisi@bonevc.co.za'
        or settings.opening_hours is distinct from '{"monday":"08:00-17:00","tuesday":"08:00-17:00","wednesday":"08:00-17:00","thursday":"08:00-17:00","friday":"08:00-17:00"}'::jsonb
      )
  ) then
    raise exception using errcode = '23514', message = 'unverified mailbox or always-available claims must not replace approved public contact operations';
  end if;

  if exists (select 1 from public.customers)
    or exists (select 1 from public.bookings)
    or exists (select 1 from public.employer_leads)
    or exists (select 1 from public.contact_enquiries)
    or exists (select 1 from public.notification_attempts)
  then
    raise exception using errcode = '23514', message = 'evidence registration must not create patient or notification records';
  end if;

  select count(*)
  into v_public_privileges
  from (
    values
      ('private.readiness_evidence_documents'::text),
      ('private.readiness_evidence_claims'::text)
  ) as relation(name)
  cross join (
    values
      ('public'::text),
      ('anon'::text),
      ('authenticated'::text),
      ('service_role'::text)
  ) as grantee(name)
  where has_table_privilege(grantee.name, relation.name, 'SELECT')
     or has_table_privilege(grantee.name, relation.name, 'INSERT')
     or has_table_privilege(grantee.name, relation.name, 'UPDATE')
     or has_table_privilege(grantee.name, relation.name, 'DELETE');

  if v_public_privileges <> 0 then
    raise exception using errcode = '42501', message = 'private readiness evidence tables have unexpected data privileges';
  end if;

  select count(*)
  into v_rls_tables
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname in ('readiness_evidence_documents', 'readiness_evidence_claims')
    and relation.relrowsecurity;

  if v_rls_tables <> 2 then
    raise exception using errcode = '42501', message = 'private readiness evidence tables must retain RLS defense in depth';
  end if;
end;
$$;

commit;
