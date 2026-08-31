begin;

insert into private.readiness_evidence_documents (
  document_key,
  title,
  source_filename,
  source_kind,
  content_sha256,
  document_date,
  supplied_by,
  supplied_role,
  custody_note,
  review_status,
  reviewed_by,
  reviewed_at,
  notes
)
values (
  'insurespr-service-activation-handoff-20260829',
  'InsureSPR 16-service activation handoff',
  'SERVICE-ACTIVATION-HANDOFF.json',
  'internal_record',
  decode('acdb5b227f30a87462a97f995058f3eebcfdad08db18dc2b4c5c106dd054cb8e', 'hex'),
  date '2026-08-29',
  'Phuture Digital production verification',
  'Technical operator',
  'The exact non-secret handoff is version-controlled and excluded from the public Vercel deployment. It contains catalogue identity, current fail-closed states and an approval schema; controlled evidence must be referenced rather than embedded.',
  'accepted',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 08:55:00+02',
  'Prepared-not-approved handoff: 16 live services match the official services endpoint and remain needs_confirmation. Every service approval and every global evidence reference is null. Draft and approved validators fail closed on catalogue drift, incomplete credentials, clinical fields, pricing, booking rules, evidence, reviewer identity and dates.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-service-activation-handoff-20260829'
), claims (
  claim_key,
  section,
  supplied_value,
  linked_dependency_key,
  reviewer_note
) as (
  values
    (
      'service-catalogue-activation-schema-prepared',
      'Production service catalogue',
      jsonb_build_object(
        'status', 'prepared-not-approved',
        'activation_authorized', false,
        'service_count', 16,
        'service_approvals_completed', 0,
        'current_verification_status', 'needs_confirmation'
      ),
      'service-catalogue',
      'The exact 16-service identity and current modes match the live endpoint. Capability decisions and supporting evidence are still absent, so no service is verified by this handoff.'
    ),
    (
      'service-credential-evidence-schema-prepared',
      'Credentials and equipment applicability',
      jsonb_build_object(
        'licence_and_equipment_evidence_ref', null,
        'responsible_practitioner_roster_ref', null,
        'per_service_applicability_refs_completed', 0
      ),
      'verified-credentials',
      'The handoff defines required controlled references for licence, equipment and responsible-practitioner applicability. The references are deliberately null until authoritative records are reviewed.'
    ),
    (
      'service-clinical-approval-schema-prepared',
      'Clinical and patient-facing requirements',
      jsonb_build_object(
        'written_clinical_request_policy_ref', null,
        'reporting_and_results_workflow_ref', null,
        'required_fields', jsonb_build_array(
          'referralRequirement',
          'appointmentRequirement',
          'medicalAidStatus',
          'whatToBring',
          'expectedDuration',
          'resultsProcess',
          'preparationInstructions'
        ),
        'completed_service_approvals', 0
      ),
      'clinical-requirements',
      'Required patient-facing fields are explicit, but no supplied value is promoted to approved clinical guidance until the practice attaches evidence and names a reviewer.'
    ),
    (
      'service-booking-rules-schema-prepared',
      'Booking and availability rules',
      jsonb_build_object(
        'appointment_services', jsonb_build_array('dxa-bone-density', 'dxa-body-composition'),
        'availability_policy_ref', null,
        'approved_appointment_durations', 0,
        'activation_authorized', false
      ),
      'booking-rules',
      'The validator requires duration and a separate availability-policy reference for every approved appointment service. Neither is present, and no slot is created.'
    ),
    (
      'service-price-approval-schema-prepared',
      'Price and payment facts',
      jsonb_build_object(
        'current_unpublished_service_count', 14,
        'current_quote_service_count', 2,
        'approved_price_schedule_ref', null,
        'medical_aid_and_payment_policy_ref', null,
        'completed_service_approvals', 0
      ),
      'approved-prices',
      'The validator enforces price-type and cent-value consistency but the handoff supplies no approved tariff, medical-aid status or payment policy.'
    )
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
  reviewer_note,
  verified_by,
  verified_at
)
select
  evidence_document.id,
  claims.claim_key,
  claims.section,
  1,
  claims.supplied_value,
  'verified',
  true,
  claims.linked_dependency_key,
  claims.reviewer_note,
  'Phuture Digital production verification',
  timestamptz '2026-08-29 08:55:00+02'
from evidence_document
cross join claims;

update public.launch_dependencies
set
  detail = 'A hash-bound prepared-not-approved activation handoff now enumerates all 16 live service identities and their current booking/price modes. Every per-service approval and every global evidence reference remains null. Attach controlled capability evidence and complete an approve-or-hold record for every service; validate the approved packet and apply a reviewed forward-only migration before any verification_status changes.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'service-catalogue';

update public.launch_dependencies
set
  detail = 'The service activation handoff now requires global and per-service licence, equipment-applicability and responsible-practitioner references. All such references remain null. Retain authoritative records in controlled custody, verify applicability and validity, name the reviewer and complete the service approvals before this gate can close.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'verified-credentials';

update public.launch_dependencies
set
  detail = 'The service activation handoff now requires explicit referral, appointment, medical-aid, what-to-bring, duration, results and preparation decisions for every approved service, plus written-request and reporting workflow references. Zero service approvals are complete and those global references remain null.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'clinical-requirements';

update public.launch_dependencies
set
  detail = 'The activation handoff observes DXA bone density and DXA body composition as appointment-mode services and requires 5-480 minute approved durations plus a separate availability-policy reference. No duration or availability approval is supplied, no service approval is complete and no slot is created.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'booking-rules';

update public.launch_dependencies
set
  detail = 'The activation handoff observes 14 unpublished-price services and 2 quote-price workforce services. It enforces fixed/from/range cent-value consistency and ZAR, but the approved price-schedule and medical-aid/payment-policy references remain null and zero service price decisions are approved.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'approved-prices';

do $$
declare
  v_document_id uuid;
  v_claim_count integer;
  v_open_dependencies integer;
  v_unverified_services integer;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-service-activation-handoff-20260829'
    and review_status = 'accepted'
    and content_sha256 = decode('acdb5b227f30a87462a97f995058f3eebcfdad08db18dc2b4c5c106dd054cb8e', 'hex');

  select count(*)
  into v_claim_count
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and review_status = 'verified'
    and public_use_allowed
    and linked_dependency_key in (
      'service-catalogue',
      'verified-credentials',
      'clinical-requirements',
      'booking-rules',
      'approved-prices'
    );

  if v_claim_count is distinct from 5 then
    raise exception using errcode = '23514', message = 'Service activation handoff must create exactly five scoped evidence claims';
  end if;

  select count(*)
  into v_open_dependencies
  from public.launch_dependencies
  where dependency_key in (
      'service-catalogue',
      'verified-credentials',
      'clinical-requirements',
      'booking-rules',
      'approved-prices'
    )
    and status = 'open'
    and blocks_launch
    and resolved_at is null;

  if v_open_dependencies is distinct from 5 then
    raise exception using errcode = '23514', message = 'Prepared service handoff must leave all five service launch gates open';
  end if;

  select count(*)
  into v_unverified_services
  from public.services
  where is_published
    and verification_status = 'needs_confirmation';

  if v_unverified_services is distinct from 16
     or exists (select 1 from public.booking_slots)
     or (select privacy_notice_version from public.practice_settings where id = 'primary') !~* '^pending'
     or exists (select 1 from public.customers)
     or exists (select 1 from public.bookings)
     or exists (select 1 from public.employer_leads)
     or exists (select 1 from public.contact_enquiries)
     or exists (select 1 from public.notification_attempts) then
    raise exception using errcode = '23514', message = 'Prepared service handoff must not verify services, create slots or open intake';
  end if;
end;
$$;

commit;
