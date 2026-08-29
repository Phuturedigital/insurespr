begin;

create table private.recovery_activation_configurations (
  id uuid primary key default extensions.gen_random_uuid(),
  config_revision bigint generated always as identity unique check (config_revision > 0),
  config_sha256 text not null unique check (config_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'rehearsal' check (state in ('rehearsal', 'active', 'revoked')),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  recovery_route text not null
    check (recovery_route in ('offsite_logical', 'supabase_managed_daily', 'supabase_pitr')),
  repository_tool_source_sha256 text
    check (repository_tool_source_sha256 is null or repository_tool_source_sha256 ~ '^[a-f0-9]{64}$'),
  schedule_platform text not null check (char_length(btrim(schedule_platform)) between 2 and 120),
  schedule_reference text not null check (char_length(btrim(schedule_reference)) between 4 and 500),
  schedule_expression text not null check (char_length(btrim(schedule_expression)) between 5 and 160),
  schedule_timezone text not null check (schedule_timezone = 'Africa/Johannesburg'),
  maximum_recovery_point_age_minutes integer not null
    check (maximum_recovery_point_age_minutes between 1 and 10080),
  recovery_time_objective_minutes integer not null
    check (recovery_time_objective_minutes between 1 and 10080),
  retention_days integer not null check (retention_days between 1 and 3650),
  restore_drill_interval_days integer not null check (restore_drill_interval_days between 1 and 365),
  backup_runner_reference text not null check (char_length(btrim(backup_runner_reference)) between 4 and 500),
  offsite_storage_reference text
    check (offsite_storage_reference is null or char_length(btrim(offsite_storage_reference)) between 4 and 500),
  encryption_key_name text
    check (encryption_key_name is null or encryption_key_name ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  encryption_key_fingerprint_sha256 text
    check (encryption_key_fingerprint_sha256 is null or encryption_key_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  recovery_owner text not null check (char_length(btrim(recovery_owner)) between 2 and 160),
  recovery_deputy text not null check (char_length(btrim(recovery_deputy)) between 2 and 160),
  backup_custodian text not null check (char_length(btrim(backup_custodian)) between 2 and 160),
  key_custodian text
    check (key_custodian is null or char_length(btrim(key_custodian)) between 2 and 160),
  schedule_owner text not null check (char_length(btrim(schedule_owner)) between 2 and 160),
  failure_alert_owner text not null check (char_length(btrim(failure_alert_owner)) between 2 and 160),
  failure_alert_recipient text not null
    check (failure_alert_recipient = lower(failure_alert_recipient) and failure_alert_recipient like '%@%'),
  rollback_authority text not null check (char_length(btrim(rollback_authority)) between 2 and 160),
  evidence_document_id uuid not null
    references private.readiness_evidence_documents(id) on delete restrict,
  approved_by text not null check (char_length(btrim(approved_by)) between 2 and 160),
  peer_reviewed_by text not null check (char_length(btrim(peer_reviewed_by)) between 2 and 160),
  approved_at timestamptz not null,
  approval_change_reference text not null
    check (char_length(btrim(approval_change_reference)) between 4 and 160),
  rehearsal_authorized_at timestamptz not null,
  rehearsal_expires_at timestamptz not null,
  rehearsal_target_reference text not null
    check (char_length(btrim(rehearsal_target_reference)) between 4 and 500),
  rehearsal_authorization_evidence_ref text not null
    check (char_length(btrim(rehearsal_authorization_evidence_ref)) between 8 and 500),
  activation_evidence_ref text
    check (activation_evidence_ref is null or char_length(btrim(activation_evidence_ref)) between 8 and 500),
  activated_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text
    check (revocation_reason is null or char_length(btrim(revocation_reason)) between 8 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_by <> peer_reviewed_by),
  check (recovery_owner <> recovery_deputy),
  check (
    (recovery_route = 'offsite_logical'
      and repository_tool_source_sha256 is not null
      and offsite_storage_reference is not null
      and encryption_key_name is not null
      and encryption_key_fingerprint_sha256 is not null
      and key_custodian is not null)
    or
    (recovery_route in ('supabase_managed_daily', 'supabase_pitr')
      and offsite_storage_reference is null
      and encryption_key_name is null
      and encryption_key_fingerprint_sha256 is null
      and key_custodian is null)
  ),
  check (
    rehearsal_expires_at > rehearsal_authorized_at
    and rehearsal_expires_at <= rehearsal_authorized_at + interval '72 hours'
  ),
  check (
    (state = 'rehearsal'
      and activation_evidence_ref is null
      and activated_at is null
      and revoked_at is null
      and revocation_reason is null)
    or
    (state = 'active'
      and activation_evidence_ref is not null
      and activated_at is not null
      and revoked_at is null
      and revocation_reason is null)
    or
    (state = 'revoked'
      and revoked_at is not null
      and revocation_reason is not null)
  )
);

create unique index recovery_activation_configurations_single_live_idx
  on private.recovery_activation_configurations ((true))
  where state in ('rehearsal', 'active');

create index recovery_activation_configurations_evidence_idx
  on private.recovery_activation_configurations (evidence_document_id);

create table private.recovery_execution_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  configuration_id uuid not null
    references private.recovery_activation_configurations(id) on delete restrict,
  execution_kind text not null
    check (execution_kind in ('backup', 'artifact_verification', 'restore_drill', 'failure_alert_test', 'schedule_health_check')),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  started_at timestamptz not null,
  completed_at timestamptz not null check (completed_at >= started_at),
  recovery_point_at timestamptz,
  artifact_sha256 text check (artifact_sha256 is null or artifact_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_reference text not null check (char_length(btrim(evidence_reference)) between 8 and 500),
  target_reference text check (target_reference is null or char_length(btrim(target_reference)) between 4 and 500),
  external_delivery_disabled boolean,
  isolated_target_deleted_at timestamptz,
  recorded_by text not null check (char_length(btrim(recorded_by)) between 2 and 160),
  created_at timestamptz not null default now(),
  unique (configuration_id, execution_kind, completed_at, evidence_sha256),
  check (recovery_point_at is null or recovery_point_at <= completed_at),
  check (isolated_target_deleted_at is null or isolated_target_deleted_at >= completed_at),
  check (
    (execution_kind = 'backup'
      and recovery_point_at is not null
      and artifact_sha256 is not null
      and manifest_sha256 is not null
      and target_reference is null
      and external_delivery_disabled is null
      and isolated_target_deleted_at is null)
    or
    (execution_kind = 'artifact_verification'
      and recovery_point_at is null
      and artifact_sha256 is not null
      and manifest_sha256 is not null
      and target_reference is null
      and external_delivery_disabled is null
      and isolated_target_deleted_at is null)
    or
    (execution_kind = 'restore_drill'
      and recovery_point_at is null
      and artifact_sha256 is not null
      and manifest_sha256 is not null
      and target_reference is not null
      and external_delivery_disabled is not null
      and (outcome = 'failed' or isolated_target_deleted_at is not null))
    or
    (execution_kind in ('failure_alert_test', 'schedule_health_check')
      and recovery_point_at is null
      and artifact_sha256 is null
      and manifest_sha256 is null
      and target_reference is null
      and external_delivery_disabled is null
      and isolated_target_deleted_at is null)
  )
);

create index recovery_execution_evidence_configuration_kind_completed_idx
  on private.recovery_execution_evidence (configuration_id, execution_kind, completed_at desc);

comment on table private.recovery_activation_configurations is
  'Private, non-secret, hash-bound recovery configuration. Every route enters through a short rehearsal and can become active only after current backup, verification, isolated restore, alert and schedule evidence exists.';
comment on table private.recovery_execution_evidence is
  'Append-only, non-patient operational evidence for recovery backup, verification, isolated restore, alert and schedule checks. It stores hashes and controlled references, never a backup payload or credential.';

alter table private.recovery_activation_configurations enable row level security;
alter table private.recovery_execution_evidence enable row level security;

create policy recovery_activation_configurations_deny_api
on private.recovery_activation_configurations
as restrictive
for all
to anon, authenticated, service_role
using (false)
with check (false);

create policy recovery_execution_evidence_deny_api
on private.recovery_execution_evidence
as restrictive
for all
to anon, authenticated, service_role
using (false)
with check (false);

revoke all on private.recovery_activation_configurations from public, anon, authenticated, service_role;
revoke all on private.recovery_execution_evidence from public, anon, authenticated, service_role;

create or replace function private.recovery_config_sha256(
  p_project_ref text,
  p_recovery_route text,
  p_repository_tool_source_sha256 text,
  p_schedule_platform text,
  p_schedule_reference text,
  p_schedule_expression text,
  p_schedule_timezone text,
  p_maximum_recovery_point_age_minutes integer,
  p_recovery_time_objective_minutes integer,
  p_retention_days integer,
  p_restore_drill_interval_days integer,
  p_backup_runner_reference text,
  p_offsite_storage_reference text,
  p_encryption_key_name text,
  p_encryption_key_fingerprint_sha256 text
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          chr(31),
          p_project_ref,
          p_recovery_route,
          coalesce(p_repository_tool_source_sha256, ''),
          p_schedule_platform,
          p_schedule_reference,
          p_schedule_expression,
          p_schedule_timezone,
          p_maximum_recovery_point_age_minutes::text,
          p_recovery_time_objective_minutes::text,
          p_retention_days::text,
          p_restore_drill_interval_days::text,
          p_backup_runner_reference,
          coalesce(p_offsite_storage_reference, ''),
          coalesce(p_encryption_key_name, ''),
          coalesce(p_encryption_key_fingerprint_sha256, '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.recovery_config_sha256(
  text, text, text, text, text, text, text, integer, integer, integer, integer, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.recovery_configuration_evidence_ready(p_configuration_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_config private.recovery_activation_configurations%rowtype;
  v_backup private.recovery_execution_evidence%rowtype;
begin
  select configuration.*
  into v_config
  from private.recovery_activation_configurations as configuration
  where configuration.id = p_configuration_id;

  if not found then
    return false;
  end if;

  select execution.*
  into v_backup
  from private.recovery_execution_evidence as execution
  where execution.configuration_id = v_config.id
    and execution.execution_kind = 'backup'
    and execution.outcome = 'succeeded'
    and execution.completed_at >= v_config.rehearsal_authorized_at
    and execution.recovery_point_at >= now() - make_interval(mins => v_config.maximum_recovery_point_age_minutes)
  order by execution.completed_at desc
  limit 1;

  if not found then
    return false;
  end if;

  return exists (
    select 1
    from private.recovery_execution_evidence as verification
    where verification.configuration_id = v_config.id
      and verification.execution_kind = 'artifact_verification'
      and verification.outcome = 'succeeded'
      and verification.artifact_sha256 = v_backup.artifact_sha256
      and verification.manifest_sha256 = v_backup.manifest_sha256
      and verification.completed_at >= v_backup.completed_at
  )
  and exists (
    select 1
    from private.recovery_execution_evidence as drill
    where drill.configuration_id = v_config.id
      and drill.execution_kind = 'restore_drill'
      and drill.outcome = 'succeeded'
      and drill.artifact_sha256 = v_backup.artifact_sha256
      and drill.manifest_sha256 = v_backup.manifest_sha256
      and drill.external_delivery_disabled
      and drill.isolated_target_deleted_at is not null
      and drill.completed_at >= greatest(
        v_config.rehearsal_authorized_at,
        now() - make_interval(days => v_config.restore_drill_interval_days)
      )
  )
  and exists (
    select 1
    from private.recovery_execution_evidence as alert_test
    where alert_test.configuration_id = v_config.id
      and alert_test.execution_kind = 'failure_alert_test'
      and alert_test.outcome = 'succeeded'
      and alert_test.completed_at >= greatest(
        v_config.rehearsal_authorized_at,
        now() - make_interval(days => v_config.restore_drill_interval_days)
      )
  )
  and exists (
    select 1
    from private.recovery_execution_evidence as schedule_check
    where schedule_check.configuration_id = v_config.id
      and schedule_check.execution_kind = 'schedule_health_check'
      and schedule_check.outcome = 'succeeded'
      and schedule_check.completed_at >= now() - make_interval(mins => v_config.maximum_recovery_point_age_minutes)
  )
  and not exists (
    select 1
    from private.recovery_execution_evidence as later_failure
    where later_failure.configuration_id = v_config.id
      and later_failure.outcome = 'failed'
      and later_failure.execution_kind in ('backup', 'artifact_verification', 'schedule_health_check')
      and later_failure.completed_at > v_backup.completed_at
  );
exception
  when others then
    return false;
end;
$$;

revoke all on function private.recovery_configuration_evidence_ready(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.guard_recovery_execution_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config private.recovery_activation_configurations%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'recovery execution evidence is append-only'
      using errcode = '55000';
  end if;

  select configuration.*
  into strict v_config
  from private.recovery_activation_configurations as configuration
  where configuration.id = new.configuration_id;

  if v_config.state = 'revoked' then
    raise exception 'recovery execution evidence cannot be appended to a revoked configuration'
      using errcode = '55000';
  end if;

  if new.started_at < v_config.rehearsal_authorized_at
     or new.completed_at > now() + interval '5 minutes' then
    raise exception 'recovery execution timestamps fall outside the approved evidence window'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger recovery_execution_evidence_guard
before insert or update or delete on private.recovery_execution_evidence
for each row execute function private.guard_recovery_execution_evidence();

create or replace function private.guard_recovery_activation_configuration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_hash text;
  v_document_status text;
begin
  v_expected_hash := private.recovery_config_sha256(
    new.project_ref,
    new.recovery_route,
    coalesce(new.repository_tool_source_sha256, ''),
    new.schedule_platform,
    new.schedule_reference,
    new.schedule_expression,
    new.schedule_timezone,
    new.maximum_recovery_point_age_minutes,
    new.recovery_time_objective_minutes,
    new.retention_days,
    new.restore_drill_interval_days,
    new.backup_runner_reference,
    coalesce(new.offsite_storage_reference, ''),
    coalesce(new.encryption_key_name, ''),
    coalesce(new.encryption_key_fingerprint_sha256, '')
  );

  select evidence.review_status
  into strict v_document_status
  from private.readiness_evidence_documents as evidence
  where evidence.id = new.evidence_document_id;

  if v_document_status <> 'accepted' then
    raise exception 'recovery activation requires an accepted controlled evidence document'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
       from private.readiness_evidence_claims as claim
       where claim.document_id = new.evidence_document_id
         and claim.claim_key = 'recovery-route-approved'
         and claim.review_status in ('owner_approved', 'verified')
     )
     or not exists (
       select 1
       from private.readiness_evidence_claims as claim
       where claim.document_id = new.evidence_document_id
         and claim.claim_key = 'recovery-objectives-approved'
         and claim.review_status in ('owner_approved', 'verified')
     )
     or not exists (
       select 1
       from private.readiness_evidence_claims as claim
       where claim.document_id = new.evidence_document_id
         and claim.claim_key = 'recovery-ownership-approved'
         and claim.review_status in ('owner_approved', 'verified')
     )
     or not exists (
       select 1
       from private.readiness_evidence_claims as claim
       where claim.document_id = new.evidence_document_id
         and claim.claim_key = 'recovery-secret-custody-verified'
         and claim.review_status = 'verified'
     )
     or not exists (
       select 1
       from private.readiness_evidence_claims as claim
       where claim.document_id = new.evidence_document_id
         and claim.claim_key = 'recovery-schedule-verified'
         and claim.review_status = 'verified'
     ) then
    raise exception 'recovery activation evidence lacks the approved route, objectives, ownership, verified secret custody or verified schedule claims'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'rehearsal' then
      raise exception 'recovery configurations must enter through rehearsal, never directly as active'
        using errcode = '55000';
    end if;
    new.config_sha256 := v_expected_hash;
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.config_revision is distinct from old.config_revision
     or new.config_sha256 is distinct from old.config_sha256
     or v_expected_hash is distinct from old.config_sha256
     or new.evidence_document_id is distinct from old.evidence_document_id
     or new.approved_by is distinct from old.approved_by
     or new.peer_reviewed_by is distinct from old.peer_reviewed_by
     or new.approved_at is distinct from old.approved_at
     or new.approval_change_reference is distinct from old.approval_change_reference
     or new.recovery_owner is distinct from old.recovery_owner
     or new.recovery_deputy is distinct from old.recovery_deputy
     or new.backup_custodian is distinct from old.backup_custodian
     or new.key_custodian is distinct from old.key_custodian
     or new.schedule_owner is distinct from old.schedule_owner
     or new.failure_alert_owner is distinct from old.failure_alert_owner
     or new.failure_alert_recipient is distinct from old.failure_alert_recipient
     or new.rollback_authority is distinct from old.rollback_authority
     or new.rehearsal_authorized_at is distinct from old.rehearsal_authorized_at
     or new.rehearsal_expires_at is distinct from old.rehearsal_expires_at
     or new.rehearsal_target_reference is distinct from old.rehearsal_target_reference
     or new.rehearsal_authorization_evidence_ref is distinct from old.rehearsal_authorization_evidence_ref then
    raise exception 'recovery configuration, approval and rehearsal evidence are immutable; revoke it and insert a new revision'
      using errcode = '55000';
  end if;

  if old.state = 'rehearsal' and new.state = 'active' then
    if now() < old.rehearsal_authorized_at
       or now() >= old.rehearsal_expires_at
       or new.activation_evidence_ref is null
       or new.activated_at is null
       or new.activated_at < old.rehearsal_authorized_at
       or not private.recovery_configuration_evidence_ready(old.id) then
      raise exception 'current backup, verification, isolated restore, alert and schedule evidence is required before recovery activation'
        using errcode = '55000';
    end if;

    update public.launch_dependencies
    set
      status = 'resolved',
      blocks_launch = false,
      resolved_at = new.activated_at,
      detail = 'An accepted, hash-bound recovery configuration completed a short-lived rehearsal with current backup, artifact verification, isolated restore-and-delete, failure-alert and schedule-health evidence. Dynamic freshness remains enforced by public_intake_activation_ready().',
      updated_at = now()
    where dependency_key = 'backup-recovery';

    new.updated_at := now();
    return new;
  end if;

  if old.state in ('rehearsal', 'active') and new.state = 'revoked' then
    if new.revoked_at is null or new.revocation_reason is null then
      raise exception 'recovery revocation timestamp and reason are required'
        using errcode = '22023';
    end if;

    update public.launch_dependencies
    set
      status = 'open',
      blocks_launch = true,
      resolved_at = null,
      detail = 'The previously rehearsed recovery configuration was revoked. Public intake remains blocked until a new accepted configuration completes backup, verification, isolated restore, alert and schedule evidence.',
      updated_at = now()
    where dependency_key = 'backup-recovery';

    new.updated_at := now();
    return new;
  end if;

  raise exception 'recovery activation records permit only rehearsal-to-active or rehearsal/active-to-revoked transitions'
    using errcode = '55000';
end;
$$;

create trigger recovery_activation_configuration_guard
before insert or update on private.recovery_activation_configurations
for each row execute function private.guard_recovery_activation_configuration();

create or replace function private.recovery_activation_ready()
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_config_id uuid;
begin
  select configuration.id
  into v_config_id
  from private.recovery_activation_configurations as configuration
  where configuration.state = 'active'
    and configuration.project_ref = 'ffdmmxffzewqiacsuvhr'
  order by configuration.config_revision desc
  limit 1;

  if v_config_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.launch_dependencies as dependency
    where dependency.dependency_key = 'backup-recovery'
      and dependency.status = 'resolved'
      and not dependency.blocks_launch
      and dependency.resolved_at is not null
  ) and private.recovery_configuration_evidence_ready(v_config_id);
exception
  when others then
    return false;
end;
$$;

revoke all on function private.recovery_activation_ready()
  from public, anon, authenticated, service_role;

create or replace function public.public_intake_activation_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.practice_settings as settings
    where settings.id = 'primary'
      and nullif(btrim(settings.privacy_notice_version), '') is not null
      and settings.privacy_notice_version !~* 'pending'
  )
  and not exists (
    select 1
    from public.launch_dependencies as dependency
    where dependency.blocks_launch
       or dependency.status = 'open'
  )
  and private.recovery_activation_ready();
exception
  when others then
    return false;
end;
$$;

revoke all on function public.public_intake_activation_ready()
  from public, anon, authenticated;
grant execute on function public.public_intake_activation_ready()
  to service_role;

comment on function public.public_intake_activation_ready() is
  'Fail-closed service-role runtime gate for public mutations. It requires an approved privacy version, no open/blocking launch dependency and dynamically current recovery evidence.';

do $$
declare
  v_document_id uuid;
  v_config_id uuid;
  v_artifact_hash text := repeat('a', 64);
  v_manifest_hash text := repeat('b', 64);
begin
  if public.public_intake_activation_ready() then
    raise exception using errcode = '23514', message = 'public intake unexpectedly ready before recovery activation';
  end if;

  begin
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
    ) values (
      'recovery-activation-probe-20260829',
      'Rollback-only recovery activation evidence probe',
      'recovery-activation-probe.json',
      'internal_record',
      decode(repeat('d', 64), 'hex'),
      date '2026-08-29',
      'probe-1',
      'migration contract',
      'technical probe',
      'Rollback-only synthetic evidence. No backup payload, credential or patient data exists.',
      'accepted',
      'migration contract reviewer',
      clock_timestamp(),
      'Validates lifecycle and fail-closed behavior, then rolls back.'
    ) returning id into v_document_id;

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
    ) values
      (
        v_document_id, 'recovery-route-approved', 'Rollback probe', 1,
        jsonb_build_object('route', 'offsite_logical'), 'owner_approved', false,
        'backup-recovery', 'Rollback-only owner-decision probe.', null, null
      ),
      (
        v_document_id, 'recovery-objectives-approved', 'Rollback probe', 1,
        jsonb_build_object('rpo_minutes', 1440, 'rto_minutes', 240), 'owner_approved', false,
        'backup-recovery', 'Rollback-only owner-decision probe.', null, null
      ),
      (
        v_document_id, 'recovery-ownership-approved', 'Rollback probe', 1,
        jsonb_build_object('owners_named', true), 'owner_approved', false,
        'backup-recovery', 'Rollback-only owner-decision probe.', null, null
      ),
      (
        v_document_id, 'recovery-secret-custody-verified', 'Rollback probe', 1,
        jsonb_build_object('fingerprints_only', true), 'verified', false,
        'backup-recovery', 'Rollback-only secret-custody probe.',
        'migration contract reviewer', clock_timestamp()
      ),
      (
        v_document_id, 'recovery-schedule-verified', 'Rollback probe', 1,
        jsonb_build_object('schedule_verified', true), 'verified', false,
        'backup-recovery', 'Rollback-only schedule probe.',
        'migration contract reviewer', clock_timestamp()
      );

    insert into private.recovery_activation_configurations (
      config_sha256,
      project_ref,
      recovery_route,
      repository_tool_source_sha256,
      schedule_platform,
      schedule_reference,
      schedule_expression,
      schedule_timezone,
      maximum_recovery_point_age_minutes,
      recovery_time_objective_minutes,
      retention_days,
      restore_drill_interval_days,
      backup_runner_reference,
      offsite_storage_reference,
      encryption_key_name,
      encryption_key_fingerprint_sha256,
      recovery_owner,
      recovery_deputy,
      backup_custodian,
      key_custodian,
      schedule_owner,
      failure_alert_owner,
      failure_alert_recipient,
      rollback_authority,
      evidence_document_id,
      approved_by,
      peer_reviewed_by,
      approved_at,
      approval_change_reference,
      rehearsal_authorized_at,
      rehearsal_expires_at,
      rehearsal_target_reference,
      rehearsal_authorization_evidence_ref
    ) values (
      repeat('0', 64),
      'ffdmmxffzewqiacsuvhr',
      'offsite_logical',
      repeat('c', 64),
      'probe scheduler',
      'controlled:probe-schedule',
      '0 2 * * *',
      'Africa/Johannesburg',
      1440,
      240,
      30,
      90,
      'controlled:probe-runner',
      'controlled:probe-offsite',
      'INSURESPR_BACKUP_KEY_B64',
      repeat('e', 64),
      'recovery probe owner',
      'recovery probe deputy',
      'backup probe custodian',
      'key probe custodian',
      'schedule probe owner',
      'alert probe owner',
      'motselisi@bonevc.co.za',
      'rollback probe authority',
      v_document_id,
      'recovery probe approver',
      'recovery probe peer reviewer',
      clock_timestamp(),
      'RECOVERY-PROBE-1',
      clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '1 hour',
      'controlled:isolated-probe-target',
      'controlled:probe-authorization'
    ) returning id into v_config_id;

    insert into private.recovery_execution_evidence (
      configuration_id,
      execution_kind,
      outcome,
      started_at,
      completed_at,
      recovery_point_at,
      artifact_sha256,
      manifest_sha256,
      evidence_sha256,
      evidence_reference,
      recorded_by
    ) values (
      v_config_id,
      'backup',
      'succeeded',
      clock_timestamp() - interval '40 seconds',
      clock_timestamp() - interval '30 seconds',
      clock_timestamp() - interval '45 seconds',
      v_artifact_hash,
      v_manifest_hash,
      repeat('1', 64),
      'controlled:probe-backup',
      'recovery probe recorder'
    );

    insert into private.recovery_execution_evidence (
      configuration_id, execution_kind, outcome, started_at, completed_at,
      artifact_sha256, manifest_sha256, evidence_sha256, evidence_reference, recorded_by
    ) values (
      v_config_id, 'artifact_verification', 'succeeded',
      clock_timestamp() - interval '29 seconds', clock_timestamp() - interval '25 seconds',
      v_artifact_hash, v_manifest_hash, repeat('2', 64),
      'controlled:probe-verification', 'recovery probe recorder'
    );

    insert into private.recovery_execution_evidence (
      configuration_id, execution_kind, outcome, started_at, completed_at,
      artifact_sha256, manifest_sha256, evidence_sha256, evidence_reference,
      target_reference, external_delivery_disabled, isolated_target_deleted_at, recorded_by
    ) values (
      v_config_id, 'restore_drill', 'succeeded',
      clock_timestamp() - interval '24 seconds', clock_timestamp() - interval '10 seconds',
      v_artifact_hash, v_manifest_hash, repeat('3', 64),
      'controlled:probe-restore', 'controlled:isolated-probe-target', true,
      clock_timestamp() - interval '5 seconds', 'recovery probe recorder'
    );

    insert into private.recovery_execution_evidence (
      configuration_id, execution_kind, outcome, started_at, completed_at,
      evidence_sha256, evidence_reference, recorded_by
    ) values
      (
        v_config_id, 'failure_alert_test', 'succeeded',
        clock_timestamp() - interval '9 seconds', clock_timestamp() - interval '7 seconds',
        repeat('4', 64), 'controlled:probe-alert', 'recovery probe recorder'
      ),
      (
        v_config_id, 'schedule_health_check', 'succeeded',
        clock_timestamp() - interval '6 seconds', clock_timestamp() - interval '4 seconds',
        repeat('5', 64), 'controlled:probe-schedule-health', 'recovery probe recorder'
      );

    if not private.recovery_configuration_evidence_ready(v_config_id) then
      raise exception using errcode = '23514', message = 'complete recovery rehearsal evidence did not become ready';
    end if;

    update private.recovery_activation_configurations
    set
      state = 'active',
      activation_evidence_ref = 'controlled:probe-activation',
      activated_at = clock_timestamp()
    where id = v_config_id;

    if not private.recovery_activation_ready() then
      raise exception using errcode = '23514', message = 'active recovery configuration did not satisfy its dedicated readiness gate';
    end if;

    if public.public_intake_activation_ready() then
      raise exception using errcode = '23514', message = 'recovery probe ignored other launch dependencies or pending privacy';
    end if;

    begin
      update private.recovery_activation_configurations
      set retention_days = 31
      where id = v_config_id;
      raise exception using errcode = '23514', message = 'immutable recovery configuration changed in place';
    exception
      when sqlstate '55000' then null;
    end;

    begin
      update private.recovery_execution_evidence
      set evidence_reference = 'controlled:changed'
      where configuration_id = v_config_id
        and execution_kind = 'backup';
      raise exception using errcode = '23514', message = 'append-only recovery execution evidence changed in place';
    exception
      when sqlstate '55000' then null;
    end;

    update private.recovery_activation_configurations
    set
      state = 'revoked',
      revoked_at = clock_timestamp(),
      revocation_reason = 'Rollback-only recovery activation probe'
    where id = v_config_id;

    if private.recovery_activation_ready() then
      raise exception using errcode = '23514', message = 'revoked recovery configuration remained ready';
    end if;

    raise exception 'ROLLBACK_RECOVERY_ACTIVATION_PROVENANCE_PROBE';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_RECOVERY_ACTIVATION_PROVENANCE_PROBE' then
        raise;
      end if;
  end;

  if exists (select 1 from private.recovery_activation_configurations)
     or exists (select 1 from private.recovery_execution_evidence)
     or exists (
       select 1 from private.readiness_evidence_documents
       where document_key = 'recovery-activation-probe-20260829'
     ) then
    raise exception using errcode = '23514', message = 'recovery activation probe did not roll back';
  end if;

  if not exists (
    select 1
    from public.launch_dependencies as dependency
    where dependency.dependency_key = 'backup-recovery'
      and dependency.status = 'open'
      and dependency.blocks_launch
      and dependency.resolved_at is null
  ) then
    raise exception using errcode = '23514', message = 'recovery probe changed the production launch dependency';
  end if;

  if (select privacy_notice_version from public.practice_settings where id = 'primary') !~* '^pending' then
    raise exception using errcode = '23514', message = 'recovery provenance migration must not open public intake';
  end if;

  if has_table_privilege('anon', 'private.recovery_activation_configurations', 'SELECT')
     or has_table_privilege('authenticated', 'private.recovery_activation_configurations', 'SELECT')
     or has_table_privilege('service_role', 'private.recovery_activation_configurations', 'SELECT')
     or has_table_privilege('anon', 'private.recovery_execution_evidence', 'SELECT')
     or has_table_privilege('authenticated', 'private.recovery_execution_evidence', 'SELECT')
     or has_table_privilege('service_role', 'private.recovery_execution_evidence', 'SELECT')
     or has_function_privilege('anon', 'public.public_intake_activation_ready()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.public_intake_activation_ready()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.public_intake_activation_ready()', 'EXECUTE') then
    raise exception using errcode = '42501', message = 'recovery activation access boundary differs from the owner/service-role design';
  end if;
end;
$$;

commit;
