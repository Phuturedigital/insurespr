begin;

alter table private.booking_availability_policies
  add column approved_config_revision bigint,
  add column approval_evidence_document_id uuid
    references private.readiness_evidence_documents(id) on delete restrict,
  add column approved_by text,
  add column peer_reviewed_by text,
  add column approved_at timestamptz,
  add column approval_change_reference text,
  add column schedule_owner text,
  add column rollback_authority text,
  add column rehearsal_evidence_ref text;

alter table private.booking_availability_policies
  add constraint booking_availability_policy_approval_provenance_check check (
    (
      not is_approved
      and approved_config_revision is null
      and approval_evidence_document_id is null
      and approved_by is null
      and peer_reviewed_by is null
      and approved_at is null
      and approval_change_reference is null
      and schedule_owner is null
      and rollback_authority is null
      and rehearsal_evidence_ref is null
    )
    or (
      is_approved
      and approved_config_revision = config_revision
      and approval_evidence_document_id is not null
      and nullif(btrim(approved_by), '') is not null
      and nullif(btrim(peer_reviewed_by), '') is not null
      and approved_by <> peer_reviewed_by
      and approved_at is not null
      and length(btrim(approval_change_reference)) >= 8
      and nullif(btrim(schedule_owner), '') is not null
      and nullif(btrim(rollback_authority), '') is not null
      and nullif(btrim(rehearsal_evidence_ref), '') is not null
    )
  );

create index booking_availability_policies_evidence_idx
  on private.booking_availability_policies(approval_evidence_document_id)
  where approval_evidence_document_id is not null;

comment on column private.booking_availability_policies.approved_config_revision is
  'Exact policy revision covered by the named approval. It must equal config_revision while the policy is approved.';
comment on column private.booking_availability_policies.approval_evidence_document_id is
  'Controlled readiness-evidence document supporting the approved policy; the document payload remains outside this table.';
comment on column private.booking_availability_policies.rehearsal_evidence_ref is
  'Controlled reference to the bounded synthetic rehearsal. It must not contain patient information or credentials.';

create or replace function private.initialize_booking_availability_policy_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_approved then
    raise exception 'availability policies must be inserted unapproved and approved only after rules and evidence exist'
      using errcode = '55000';
  end if;
  new.config_revision := 1;
  new.approved_config_revision := null;
  new.approval_evidence_document_id := null;
  new.approved_by := null;
  new.peer_reviewed_by := null;
  new.approved_at := null;
  new.approval_change_reference := null;
  new.schedule_owner := null;
  new.rollback_authority := null;
  new.rehearsal_evidence_ref := null;
  return new;
end;
$$;

revoke execute on function private.initialize_booking_availability_policy_revision()
  from public, anon, authenticated, service_role;

create or replace function private.guard_booking_availability_policy_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_internal_bump boolean :=
    coalesce(current_setting('insurespr.availability_revision_bump', true), '') = '1';
  v_controls_changed boolean;
  v_approval_metadata_changed boolean;
  v_approving boolean := new.is_approved and not old.is_approved;
begin
  if new.service_id is distinct from old.service_id then
    raise exception 'availability policy service cannot be reassigned'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.service_id::text, 20260813161454)
  );

  v_controls_changed :=
    new.horizon_days is distinct from old.horizon_days
    or new.minimum_notice_minutes is distinct from old.minimum_notice_minutes
    or new.buffer_minutes is distinct from old.buffer_minutes
    or new.slot_capacity is distinct from old.slot_capacity;

  v_approval_metadata_changed :=
    new.approved_config_revision is distinct from old.approved_config_revision
    or new.approval_evidence_document_id is distinct from old.approval_evidence_document_id
    or new.approved_by is distinct from old.approved_by
    or new.peer_reviewed_by is distinct from old.peer_reviewed_by
    or new.approved_at is distinct from old.approved_at
    or new.approval_change_reference is distinct from old.approval_change_reference
    or new.schedule_owner is distinct from old.schedule_owner
    or new.rollback_authority is distinct from old.rollback_authority
    or new.rehearsal_evidence_ref is distinct from old.rehearsal_evidence_ref;

  if old.is_approved and new.is_approved and v_controls_changed then
    raise exception 'unapprove the availability policy before changing approved controls'
      using errcode = '55000';
  end if;

  if old.is_approved and new.is_approved and v_approval_metadata_changed then
    raise exception 'unapprove the availability policy before replacing approval evidence'
      using errcode = '55000';
  end if;

  if v_internal_bump then
    if new.config_revision <> old.config_revision + 1 then
      raise exception 'availability revision must advance by exactly one'
        using errcode = '22023';
    end if;
  elsif v_controls_changed or new.is_approved is distinct from old.is_approved then
    new.config_revision := old.config_revision + 1;
  elsif new.config_revision is distinct from old.config_revision then
    raise exception 'availability revision is database-managed'
      using errcode = '22023';
  end if;

  if not new.is_approved then
    new.approved_config_revision := null;
    new.approval_evidence_document_id := null;
    new.approved_by := null;
    new.peer_reviewed_by := null;
    new.approved_at := null;
    new.approval_change_reference := null;
    new.schedule_owner := null;
    new.rollback_authority := null;
    new.rehearsal_evidence_ref := null;
  elsif v_approving then
    new.approved_config_revision := new.config_revision;
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_booking_availability_policy_revision()
  from public, anon, authenticated, service_role;

create or replace function private.bump_booking_availability_revision(
  p_service_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform set_config('insurespr.availability_revision_bump', '1', true);
  update private.booking_availability_policies
  set
    config_revision = config_revision + 1,
    is_approved = false,
    approved_config_revision = null,
    approval_evidence_document_id = null,
    approved_by = null,
    peer_reviewed_by = null,
    approved_at = null,
    approval_change_reference = null,
    schedule_owner = null,
    rollback_authority = null,
    rehearsal_evidence_ref = null
  where service_id = p_service_id;
  perform set_config('insurespr.availability_revision_bump', '', true);
end;
$$;

revoke execute on function private.bump_booking_availability_revision(uuid)
  from public, anon, authenticated, service_role;

do $$
declare
  v_service_id uuid;
  v_evidence_document_id uuid;
  v_policy private.booking_availability_policies%rowtype;
begin
  select id
  into strict v_service_id
  from public.services
  where slug = 'dxa-bone-density';

  select id
  into strict v_evidence_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-readiness-20260825-01';

  begin
    insert into private.booking_availability_policies (
      service_id,
      horizon_days,
      minimum_notice_minutes,
      buffer_minutes,
      slot_capacity,
      is_approved
    ) values (
      v_service_id,
      14,
      1440,
      15,
      1,
      false
    );

    update private.booking_availability_policies
    set
      is_approved = true,
      approval_evidence_document_id = v_evidence_document_id,
      approved_by = 'availability_provenance_probe_approver',
      peer_reviewed_by = 'availability_provenance_probe_peer',
      approved_at = timestamptz '2026-08-29 09:15:00+02',
      approval_change_reference = 'AVAIL-PROBE-ROLLBACK',
      schedule_owner = 'availability_provenance_probe_owner',
      rollback_authority = 'availability_provenance_probe_rollback',
      rehearsal_evidence_ref = 'availability_provenance_probe_rehearsal'
    where service_id = v_service_id;

    select *
    into strict v_policy
    from private.booking_availability_policies
    where service_id = v_service_id;

    if not v_policy.is_approved
       or v_policy.approved_config_revision is distinct from v_policy.config_revision
       or v_policy.approved_by is distinct from 'availability_provenance_probe_approver'
       or v_policy.approved_by = v_policy.peer_reviewed_by then
      raise exception using errcode = '23514', message = 'Availability approval provenance did not bind to the current revision';
    end if;

    begin
      update private.booking_availability_policies
      set horizon_days = 21
      where service_id = v_service_id;
      raise exception using errcode = '23514', message = 'Approved availability controls changed without explicit unapproval';
    exception
      when sqlstate '55000' then null;
    end;

    insert into public.availability_rules (
      service_id,
      weekday,
      starts_at,
      ends_at,
      timezone,
      slot_duration_minutes,
      is_active
    ) values (
      v_service_id,
      1,
      time '08:00',
      time '12:00',
      'Africa/Johannesburg',
      45,
      true
    );

    select *
    into strict v_policy
    from private.booking_availability_policies
    where service_id = v_service_id;

    if v_policy.is_approved
       or v_policy.approved_config_revision is not null
       or v_policy.approval_evidence_document_id is not null
       or v_policy.approved_by is not null
       or v_policy.rehearsal_evidence_ref is not null then
      raise exception using errcode = '23514', message = 'Availability rule change did not invalidate approval provenance';
    end if;

    raise exception 'ROLLBACK_AVAILABILITY_APPROVAL_PROVENANCE_PROBE';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_AVAILABILITY_APPROVAL_PROVENANCE_PROBE' then
        raise;
      end if;
  end;

  if exists (
       select 1
       from private.booking_availability_policies
       where service_id = v_service_id
     )
     or exists (
       select 1
       from public.availability_rules
       where service_id = v_service_id
     ) then
    raise exception using errcode = '23514', message = 'Availability approval provenance probe did not roll back';
  end if;
end;
$$;

commit;
