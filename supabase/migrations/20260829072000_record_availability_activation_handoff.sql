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
  'insurespr-availability-activation-handoff-20260829',
  'InsureSPR DXA availability activation handoff',
  'AVAILABILITY-ACTIVATION-HANDOFF.json',
  'internal_record',
  decode('107122a6462b95fe766893d19be1f732d2704020184fce55445c2fa1d3b3592e', 'hex'),
  date '2026-08-29',
  'Phuture Digital production verification',
  'Technical operator',
  'The exact non-secret handoff is version-controlled and excluded from the public Vercel deployment. It records the zero-state production observation and the evidence contract for policy, weekly rules, closures, operations, rehearsal and bounded first materialisation.',
  'accepted',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 09:25:00+02',
  'Prepared-not-approved handoff: both DXA services are appointment mode, have null duration, remain needs_confirmation and expose zero live slots. Production has zero availability policies, rules, exceptions, conflicts, slots and bookings. No operating value, closure or Cron schedule is inferred.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-availability-activation-handoff-20260829'
), claims (
  claim_key,
  section,
  supplied_value,
  reviewer_note
) as (
  values
    (
      'availability-zero-state-verified',
      'Production availability zero state',
      jsonb_build_object(
        'appointment_services', jsonb_build_array('dxa-bone-density', 'dxa-body-composition'),
        'service_duration_values', jsonb_build_object('dxa-bone-density', null, 'dxa-body-composition', null),
        'service_verification_status', 'needs_confirmation',
        'policy_count', 0,
        'rule_count', 0,
        'exception_count', 0,
        'conflict_count', 0,
        'slot_count', 0,
        'booking_count', 0
      ),
      'The live database and public availability responses contain no policy or slot data. This verifies the safe starting state, not operating availability.'
    ),
    (
      'availability-policy-approval-schema-prepared',
      'Duration, policy, rules and closures',
      jsonb_build_object(
        'status', 'prepared-not-approved',
        'activation_authorized', false,
        'approved_service_count', 0,
        'closure_review_completed', false,
        'required_peer_review', true,
        'approved_policy_rows_require_revision_bound_evidence', true
      ),
      'The handoff and database constraints require duration, horizon, notice, buffer, capacity one, Johannesburg timezone, non-overlapping weekly rules, explicit closure review, controlled evidence and a different peer reviewer.'
    ),
    (
      'availability-operations-activation-schema-prepared',
      'Rehearsal, materialisation and rollback operations',
      jsonb_build_object(
        'schedule_owner', null,
        'daily_monitor_owner', null,
        'alert_recipient', null,
        'rollback_authority', null,
        'rehearsal_evidence_ref', null,
        'synthetic_journey_evidence_ref', null,
        'initial_materialization_days', null,
        'cron_authorized', false
      ),
      'A reviewed initial 1-14 day materialisation and synthetic journey are required. Cron remains explicitly unauthorized until a later post-materialisation proof.'
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
  'booking-rules',
  claims.reviewer_note,
  'Phuture Digital production verification',
  timestamptz '2026-08-29 09:25:00+02'
from evidence_document
cross join claims;

update public.launch_dependencies
set
  detail = 'A hash-bound prepared-not-approved DXA availability handoff now verifies the exact zero-state production baseline and defines duration, horizon, notice, buffer, capacity-one, Johannesburg-timezone, non-overlapping weekly-rule, exception, closure, rota, peer-review, rehearsal, monitor and rollback requirements. Approved policy rows are now bound to a named evidence document and exact config revision; any rule, exception or service scheduling change automatically invalidates that approval. Both DXA durations and approvals remain absent, no policy/rule/exception/slot exists, initial materialisation is not authorised and Cron remains explicitly unauthorised.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'booking-rules';

do $$
declare
  v_document_id uuid;
  v_claim_count integer;
  v_dependency public.launch_dependencies%rowtype;
  v_dxa_count integer;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-availability-activation-handoff-20260829'
    and review_status = 'accepted'
    and content_sha256 = decode('107122a6462b95fe766893d19be1f732d2704020184fce55445c2fa1d3b3592e', 'hex');

  select count(*)
  into v_claim_count
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and review_status = 'verified'
    and public_use_allowed
    and linked_dependency_key = 'booking-rules';

  if v_claim_count is distinct from 3 then
    raise exception using errcode = '23514', message = 'Availability handoff must create exactly three booking-rule evidence claims';
  end if;

  select *
  into strict v_dependency
  from public.launch_dependencies
  where dependency_key = 'booking-rules';

  if v_dependency.status is distinct from 'open'
     or not v_dependency.blocks_launch
     or v_dependency.resolved_at is not null
     or v_dependency.detail not like '%Cron remains explicitly unauthorised%' then
    raise exception using errcode = '23514', message = 'Availability handoff must leave booking-rules open and Cron unauthorized';
  end if;

  select count(*)
  into v_dxa_count
  from public.services
  where slug in ('dxa-bone-density', 'dxa-body-composition')
    and booking_mode = 'appointment'
    and appointment_duration_minutes is null
    and verification_status = 'needs_confirmation';

  if v_dxa_count is distinct from 2
     or exists (select 1 from private.booking_availability_policies)
     or exists (select 1 from public.availability_rules)
     or exists (select 1 from public.availability_exceptions)
     or exists (select 1 from private.booking_availability_conflicts)
     or exists (select 1 from public.booking_slots)
     or exists (select 1 from public.bookings)
     or (select privacy_notice_version from public.practice_settings where id = 'primary') !~* '^pending' then
    raise exception using errcode = '23514', message = 'Availability handoff must preserve null DXA durations and the empty fail-closed booking state';
  end if;
end;
$$;

commit;
