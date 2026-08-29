begin;

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
  'insurespr-recovery-activation-handoff-20260829',
  'InsureSPR recovery activation handoff',
  'RECOVERY-ACTIVATION-HANDOFF.json',
  'internal_record',
  decode('375b8102b5a57727b99e94ee4e99d0e7dae494ddf5673a318d6eefe81bf4dde2', 'hex'),
  date '2026-08-29',
  '1',
  'Phuture Digital release audit',
  'technical delivery partner',
  'The exact JSON packet is retained in git and excluded from the Vercel deployment. It contains no database credential, encryption key, backup payload or patient data.',
  'accepted',
  'Phuture Digital recovery control review',
  timestamptz '2026-08-29 10:14:00+02',
  'The packet is accepted as exact fail-closed technical and live-state evidence. It is not recovery approval and deliberately leaves route, objectives, owners, storage, key custody, schedule and rehearsal evidence empty.'
)
on conflict (document_key) do nothing;

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-recovery-activation-handoff-20260829'
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
  claim.claim_key,
  claim.section,
  1::smallint,
  claim.supplied_value,
  claim.review_status,
  false,
  'backup-recovery',
  claim.reviewer_note,
  claim.verified_by,
  claim.verified_at
from evidence_document
cross join (
  values
    (
      'recovery-handoff-live-zero-state',
      'Live fail-closed recovery state',
      jsonb_build_object(
        'project_ref', 'ffdmmxffzewqiacsuvhr',
        'project_status', 'ACTIVE_HEALTHY',
        'organization_plan', 'free',
        'managed_restore_points_verified', false,
        'pitr_window_verified', false,
        'offsite_backup_verified', false,
        'configuration_count', 0,
        'execution_evidence_count', 0,
        'operational_submission_count', 0,
        'privacy_version', 'pending-approval'
      ),
      'verified',
      'The exact packet preserves the observed Free-plan, zero-configuration and zero-submission production state. It cannot be used to imply a backup exists.',
      'Phuture Digital recovery control review',
      timestamptz '2026-08-29 10:14:00+02'
    ),
    (
      'recovery-handoff-provenance-contract',
      'Private recovery activation contract',
      jsonb_build_object(
        'tool_source_sha256', '65b52e4cdd797ebdcfd540bf6e0c095b1e19b6313f3f6a450672269a1e9ac350',
        'configuration_table', 'private.recovery_activation_configurations',
        'execution_table', 'private.recovery_execution_evidence',
        'runtime_gate', 'public.public_intake_activation_ready',
        'rehearsal_first', true,
        'append_only_execution_evidence', true,
        'dynamic_freshness', true
      ),
      'verified',
      'The database contract is installed without a configuration, schedule, backup, secret or activation. Its rollback-only probe leaves no operational evidence rows.',
      'Phuture Digital recovery control review',
      timestamptz '2026-08-29 10:14:00+02'
    ),
    (
      'recovery-handoff-route-and-objectives',
      'Route and recovery objectives',
      jsonb_build_object(
        'selected_route', null,
        'maximum_recovery_point_age_minutes', null,
        'recovery_time_objective_minutes', null,
        'retention_days', null,
        'restore_drill_interval_days', null
      ),
      'missing',
      'The practice has not selected and approved a paid managed route or encrypted off-site route, RPO, RTO, retention or drill interval.',
      null,
      null
    ),
    (
      'recovery-handoff-operations-and-rehearsal',
      'Storage, custody, schedule, ownership and rehearsal',
      jsonb_build_object(
        'storage', null,
        'runner', null,
        'key_fingerprint', null,
        'owners', null,
        'schedule', null,
        'backup_artifact', null,
        'isolated_restore', null,
        'alert_test', null
      ),
      'missing',
      'No storage provider, credential/key custody, owners, schedule, failure alert, production backup, artifact verification or isolated restore evidence is supplied.',
      null,
      null
    )
) as claim(
  claim_key,
  section,
  supplied_value,
  review_status,
  reviewer_note,
  verified_by,
  verified_at
)
on conflict (document_id, claim_key) do nothing;

update public.launch_dependencies
set
  detail = 'A hash-bound, rehearsal-first recovery activation contract now exists and is connected to the public mutation gate. Production remains on the Free plan with zero recovery configurations or execution-evidence rows. No approved route, RPO/RTO, retention, runner, off-site storage, key custody, schedule, owners, monitored backup or isolated restore drill exists; the dependency remains open and blocking.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null,
  updated_at = now()
where dependency_key = 'backup-recovery';

do $$
declare
  v_document_id uuid;
  v_claim_count integer;
  v_verified_count integer;
  v_missing_count integer;
begin
  select evidence.id
  into strict v_document_id
  from private.readiness_evidence_documents as evidence
  where evidence.document_key = 'insurespr-recovery-activation-handoff-20260829'
    and evidence.content_sha256 = decode('375b8102b5a57727b99e94ee4e99d0e7dae494ddf5673a318d6eefe81bf4dde2', 'hex')
    and evidence.review_status = 'accepted';

  select
    count(*),
    count(*) filter (where review_status = 'verified'),
    count(*) filter (where review_status = 'missing')
  into v_claim_count, v_verified_count, v_missing_count
  from private.readiness_evidence_claims
  where document_id = v_document_id;

  if v_claim_count is distinct from 4
     or v_verified_count is distinct from 2
     or v_missing_count is distinct from 2 then
    raise exception using errcode = '23514', message = 'recovery handoff claim inventory differs from the reviewed packet';
  end if;

  if exists (
    select 1
    from private.readiness_evidence_claims as claim
    where claim.document_id = v_document_id
      and claim.claim_key in (
        'recovery-route-approved',
        'recovery-objectives-approved',
        'recovery-ownership-approved',
        'recovery-secret-custody-verified',
        'recovery-schedule-verified'
      )
  ) then
    raise exception using errcode = '23514', message = 'prepared handoff accidentally satisfies an activation evidence claim';
  end if;

  if exists (select 1 from private.recovery_activation_configurations)
     or exists (select 1 from private.recovery_execution_evidence) then
    raise exception using errcode = '23514', message = 'recording the recovery handoff must not create a configuration or execution evidence';
  end if;

  if not exists (
    select 1
    from public.launch_dependencies as dependency
    where dependency.dependency_key = 'backup-recovery'
      and dependency.status = 'open'
      and dependency.blocks_launch
      and dependency.resolved_at is null
  ) then
    raise exception using errcode = '23514', message = 'recording the recovery handoff must keep backup-recovery open';
  end if;

  if (select privacy_notice_version from public.practice_settings where id = 'primary') !~* '^pending'
     or public.public_intake_activation_ready() then
    raise exception using errcode = '23514', message = 'recording the recovery handoff must preserve fail-closed public intake';
  end if;

  if exists (select 1 from public.customers)
     or exists (select 1 from public.bookings)
     or exists (select 1 from public.employer_leads)
     or exists (select 1 from public.contact_enquiries)
     or exists (select 1 from public.notification_attempts) then
    raise exception using errcode = '23514', message = 'recording the recovery handoff must not create operational submissions';
  end if;
end;
$$;

commit;
