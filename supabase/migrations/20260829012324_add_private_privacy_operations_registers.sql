begin;

create table private.privacy_request_register (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null unique default private.generate_reference('DSR'),
  request_type text not null check (request_type in (
    'access',
    'correction',
    'deletion',
    'restriction',
    'objection',
    'other'
  )),
  received_channel text not null check (received_channel in (
    'email',
    'telephone',
    'post',
    'in_person',
    'other'
  )),
  requester_contact text not null
    check (char_length(btrim(requester_contact)) between 3 and 320),
  status text not null default 'received' check (status in (
    'received',
    'identity_check',
    'under_review',
    'actioning',
    'responded',
    'closed',
    'withdrawn'
  )),
  identity_status text not null default 'pending' check (identity_status in (
    'pending',
    'verified',
    'unable_to_verify',
    'not_required'
  )),
  identity_evidence_reference text check (
    identity_evidence_reference is null
    or char_length(btrim(identity_evidence_reference)) between 5 and 500
  ),
  response_outcome text not null default 'pending' check (response_outcome in (
    'pending',
    'fulfilled',
    'partially_fulfilled',
    'refused',
    'withdrawn'
  )),
  decision_basis text check (
    decision_basis is null
    or char_length(btrim(decision_basis)) between 10 and 2000
  ),
  assigned_to text not null check (char_length(btrim(assigned_to)) between 3 and 160),
  received_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  identity_verified_at timestamptz,
  responded_at timestamptz,
  closed_at timestamptz,
  last_changed_by text not null check (char_length(btrim(last_changed_by)) between 3 and 160),
  change_reason text not null check (char_length(btrim(change_reason)) between 10 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (acknowledged_at is null or acknowledged_at >= received_at),
  check (
    (identity_status = 'verified'
      and identity_verified_at is not null
      and identity_evidence_reference is not null)
    or (identity_status <> 'verified' and identity_verified_at is null)
  ),
  check (responded_at is null or responded_at >= received_at),
  check (closed_at is null or closed_at >= received_at),
  check (
    (status in ('received', 'identity_check', 'under_review', 'actioning')
      and response_outcome = 'pending'
      and responded_at is null
      and closed_at is null)
    or (status = 'responded'
      and response_outcome in ('fulfilled', 'partially_fulfilled', 'refused')
      and identity_status in ('verified', 'not_required')
      and responded_at is not null
      and closed_at is null)
    or (status = 'closed'
      and response_outcome in ('fulfilled', 'partially_fulfilled', 'refused')
      and identity_status in ('verified', 'not_required')
      and responded_at is not null
      and closed_at is not null
      and closed_at >= responded_at)
    or (status = 'withdrawn'
      and response_outcome = 'withdrawn'
      and responded_at is null
      and closed_at is not null)
  )
);

create table private.privacy_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references private.privacy_request_register(id) on delete restrict,
  event_kind text not null check (event_kind in ('opened', 'updated')),
  actor_identifier text not null check (char_length(actor_identifier) between 3 and 160),
  reason text not null check (char_length(reason) between 10 and 1000),
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  created_at timestamptz not null default now()
);

create table private.security_incident_register (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null unique default private.generate_reference('SEC'),
  source text not null check (source in (
    'internal',
    'processor',
    'data_subject',
    'third_party',
    'other'
  )),
  summary text not null check (char_length(btrim(summary)) between 20 and 2000),
  status text not null default 'detected' check (status in (
    'detected',
    'triage',
    'investigating',
    'contained',
    'notifications_in_progress',
    'closed',
    'false_positive'
  )),
  determination text not null default 'pending' check (determination in (
    'pending',
    'reasonably_believed',
    'not_established'
  )),
  affected_record_classes text[] not null default '{}'::text[],
  affected_data_subject_count integer check (
    affected_data_subject_count is null or affected_data_subject_count >= 0
  ),
  regulator_notification_status text not null default 'assessing' check (
    regulator_notification_status in ('assessing', 'pending', 'completed', 'delayed', 'not_required')
  ),
  data_subject_notification_status text not null default 'assessing' check (
    data_subject_notification_status in (
      'assessing',
      'pending',
      'completed',
      'delayed',
      'not_possible',
      'not_required'
    )
  ),
  regulator_notified_at timestamptz,
  data_subjects_notified_at timestamptz,
  regulator_reference text check (
    regulator_reference is null or char_length(btrim(regulator_reference)) between 3 and 500
  ),
  notification_delay_reason text check (
    notification_delay_reason is null
    or char_length(btrim(notification_delay_reason)) between 10 and 2000
  ),
  assigned_to text not null check (char_length(btrim(assigned_to)) between 3 and 160),
  discovered_at timestamptz not null default now(),
  contained_at timestamptz,
  closed_at timestamptz,
  last_changed_by text not null check (char_length(btrim(last_changed_by)) between 3 and 160),
  change_reason text not null check (char_length(btrim(change_reason)) between 10 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contained_at is null or contained_at >= discovered_at),
  check (closed_at is null or closed_at >= discovered_at),
  check (
    (regulator_notification_status = 'completed' and regulator_notified_at is not null)
    or (regulator_notification_status <> 'completed' and regulator_notified_at is null)
  ),
  check (
    (data_subject_notification_status = 'completed' and data_subjects_notified_at is not null)
    or (data_subject_notification_status <> 'completed' and data_subjects_notified_at is null)
  ),
  check (
    regulator_notification_status <> 'delayed'
    or notification_delay_reason is not null
  ),
  check (
    data_subject_notification_status not in ('delayed', 'not_possible')
    or notification_delay_reason is not null
  ),
  check (
    determination <> 'reasonably_believed'
    or regulator_notification_status <> 'not_required'
  ),
  check (
    (status not in ('closed', 'false_positive') and closed_at is null)
    or (status = 'closed'
      and closed_at is not null
      and determination <> 'pending'
      and (
        (determination = 'not_established'
          and regulator_notification_status = 'not_required'
          and data_subject_notification_status = 'not_required')
        or (determination = 'reasonably_believed'
          and regulator_notification_status = 'completed'
          and data_subject_notification_status in ('completed', 'not_possible'))
      ))
    or (status = 'false_positive'
      and closed_at is not null
      and determination = 'not_established'
      and regulator_notification_status = 'not_required'
      and data_subject_notification_status = 'not_required')
  )
);

create table private.security_incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references private.security_incident_register(id) on delete restrict,
  event_kind text not null check (event_kind in ('opened', 'updated')),
  actor_identifier text not null check (char_length(actor_identifier) between 3 and 160),
  reason text not null check (char_length(reason) between 10 and 1000),
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  created_at timestamptz not null default now()
);

comment on table private.privacy_request_register is
  'Owner-only POPIA/PAIA request register. Store the minimum contact locator needed to handle the request; never store identity-document images or clinical records here.';
comment on table private.privacy_request_events is
  'Immutable, data-minimised lifecycle history for private privacy requests. Contact details and decision text are deliberately excluded from event snapshots.';
comment on table private.security_incident_register is
  'Owner-only security compromise register aligned to the Information Regulator reporting workflow. Keep personal information and forensic payloads in controlled evidence custody, not the summary.';
comment on table private.security_incident_events is
  'Immutable, data-minimised lifecycle history for the security incident register. Incident narrative and affected-person data are deliberately excluded.';

create index privacy_request_register_active_idx
  on private.privacy_request_register(status, received_at)
  where status not in ('closed', 'withdrawn');
create index privacy_request_register_assigned_idx
  on private.privacy_request_register(assigned_to, status, received_at);
create index privacy_request_register_retention_idx
  on private.privacy_request_register(closed_at)
  where closed_at is not null;
create index privacy_request_events_request_idx
  on private.privacy_request_events(request_id, created_at);

create index security_incident_register_active_idx
  on private.security_incident_register(status, discovered_at)
  where status not in ('closed', 'false_positive');
create index security_incident_register_assigned_idx
  on private.security_incident_register(assigned_to, status, discovered_at);
create index security_incident_register_retention_idx
  on private.security_incident_register(closed_at)
  where closed_at is not null;
create index security_incident_events_incident_idx
  on private.security_incident_events(incident_id, created_at);

create or replace function private.guard_privacy_request_register()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.reference is distinct from old.reference
      or new.request_type is distinct from old.request_type
      or new.received_at is distinct from old.received_at
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '22023', message = 'privacy request identity and receipt evidence are immutable';
    end if;

    if (old.acknowledged_at is not null and new.acknowledged_at is distinct from old.acknowledged_at)
      or (old.identity_verified_at is not null and new.identity_verified_at is distinct from old.identity_verified_at)
      or (old.responded_at is not null and new.responded_at is distinct from old.responded_at)
      or (old.closed_at is not null and new.closed_at is distinct from old.closed_at) then
      raise exception using errcode = '22023', message = 'recorded privacy request milestones are immutable';
    end if;

    if new.status is distinct from old.status and not (
      (old.status = 'received' and new.status in ('identity_check', 'under_review', 'withdrawn'))
      or (old.status = 'identity_check' and new.status in ('received', 'under_review', 'withdrawn'))
      or (old.status = 'under_review' and new.status in ('identity_check', 'actioning', 'responded', 'withdrawn'))
      or (old.status = 'actioning' and new.status in ('under_review', 'responded', 'withdrawn'))
      or (old.status = 'responded' and new.status = 'closed')
    ) then
      raise exception using errcode = '22023', message = 'invalid privacy request status transition';
    end if;
  end if;

  new.requester_contact := btrim(new.requester_contact);
  new.assigned_to := btrim(new.assigned_to);
  new.last_changed_by := btrim(new.last_changed_by);
  new.change_reason := btrim(new.change_reason);
  new.identity_evidence_reference := nullif(btrim(coalesce(new.identity_evidence_reference, '')), '');
  new.decision_basis := nullif(btrim(coalesce(new.decision_basis, '')), '');
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create or replace function private.append_privacy_request_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into private.privacy_request_events(
    request_id,
    event_kind,
    actor_identifier,
    reason,
    before_state,
    after_state
  ) values (
    new.id,
    case when tg_op = 'INSERT' then 'opened' else 'updated' end,
    new.last_changed_by,
    new.change_reason,
    case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object(
      'status', old.status,
      'identity_status', old.identity_status,
      'response_outcome', old.response_outcome,
      'assigned_to', old.assigned_to,
      'acknowledged', old.acknowledged_at is not null,
      'responded', old.responded_at is not null,
      'closed', old.closed_at is not null
    ) end,
    jsonb_build_object(
      'status', new.status,
      'identity_status', new.identity_status,
      'response_outcome', new.response_outcome,
      'assigned_to', new.assigned_to,
      'acknowledged', new.acknowledged_at is not null,
      'responded', new.responded_at is not null,
      'closed', new.closed_at is not null
    )
  );
  return new;
end;
$$;

create or replace function private.guard_security_incident_register()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.reference is distinct from old.reference
      or new.source is distinct from old.source
      or new.discovered_at is distinct from old.discovered_at
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '22023', message = 'security incident identity and discovery evidence are immutable';
    end if;

    if (old.contained_at is not null and new.contained_at is distinct from old.contained_at)
      or (old.regulator_notified_at is not null and new.regulator_notified_at is distinct from old.regulator_notified_at)
      or (old.data_subjects_notified_at is not null and new.data_subjects_notified_at is distinct from old.data_subjects_notified_at)
      or (old.closed_at is not null and new.closed_at is distinct from old.closed_at) then
      raise exception using errcode = '22023', message = 'recorded security incident milestones are immutable';
    end if;

    if new.status is distinct from old.status and not (
      (old.status = 'detected' and new.status in ('triage', 'investigating', 'false_positive'))
      or (old.status = 'triage' and new.status in ('investigating', 'contained', 'false_positive'))
      or (old.status = 'investigating' and new.status in ('triage', 'contained', 'notifications_in_progress', 'closed', 'false_positive'))
      or (old.status = 'contained' and new.status in ('investigating', 'notifications_in_progress', 'closed'))
      or (old.status = 'notifications_in_progress' and new.status in ('investigating', 'contained', 'closed'))
    ) then
      raise exception using errcode = '22023', message = 'invalid security incident status transition';
    end if;
  end if;

  new.summary := btrim(new.summary);
  new.assigned_to := btrim(new.assigned_to);
  new.last_changed_by := btrim(new.last_changed_by);
  new.change_reason := btrim(new.change_reason);
  new.regulator_reference := nullif(btrim(coalesce(new.regulator_reference, '')), '');
  new.notification_delay_reason := nullif(btrim(coalesce(new.notification_delay_reason, '')), '');
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create or replace function private.append_security_incident_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into private.security_incident_events(
    incident_id,
    event_kind,
    actor_identifier,
    reason,
    before_state,
    after_state
  ) values (
    new.id,
    case when tg_op = 'INSERT' then 'opened' else 'updated' end,
    new.last_changed_by,
    new.change_reason,
    case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object(
      'status', old.status,
      'determination', old.determination,
      'regulator_notification_status', old.regulator_notification_status,
      'data_subject_notification_status', old.data_subject_notification_status,
      'assigned_to', old.assigned_to,
      'contained', old.contained_at is not null,
      'closed', old.closed_at is not null
    ) end,
    jsonb_build_object(
      'status', new.status,
      'determination', new.determination,
      'regulator_notification_status', new.regulator_notification_status,
      'data_subject_notification_status', new.data_subject_notification_status,
      'assigned_to', new.assigned_to,
      'contained', new.contained_at is not null,
      'closed', new.closed_at is not null
    )
  );
  return new;
end;
$$;

create or replace function private.prevent_compliance_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'privacy and security lifecycle events are immutable';
end;
$$;

create trigger privacy_request_register_guard
before insert or update on private.privacy_request_register
for each row execute function private.guard_privacy_request_register();

create trigger privacy_request_register_append_event
after insert or update on private.privacy_request_register
for each row execute function private.append_privacy_request_event();

create trigger privacy_request_events_immutable
before update or delete on private.privacy_request_events
for each row execute function private.prevent_compliance_event_mutation();

create trigger security_incident_register_guard
before insert or update on private.security_incident_register
for each row execute function private.guard_security_incident_register();

create trigger security_incident_register_append_event
after insert or update on private.security_incident_register
for each row execute function private.append_security_incident_event();

create trigger security_incident_events_immutable
before update or delete on private.security_incident_events
for each row execute function private.prevent_compliance_event_mutation();

create or replace function private.privacy_operations_inventory(
  p_as_of timestamptz default statement_timestamp()
)
returns table (
  record_type text,
  open_count bigint,
  closed_count bigint,
  retention_review_count bigint,
  held_count bigint,
  operator_note text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with active_holds as (
    select hold.record_identifier
    from private.retention_legal_holds as hold
    where hold.record_class = 'audit_security_evidence'
      and hold.released_at is null
  )
  select
    'privacy_request'::text,
    count(*) filter (where request.status not in ('closed', 'withdrawn')),
    count(*) filter (where request.status in ('closed', 'withdrawn')),
    count(*) filter (
      where request.closed_at < p_as_of - interval '6 years'
    ),
    count(*) filter (
      where exists (
        select 1 from active_holds as hold
        where hold.record_identifier in ('*', 'privacy_request:' || request.id::text)
      )
    ),
    'Six-year review begins at closure. Inventory does not authorise deletion; verify the approved request/PAIA retention basis and legal holds.'::text
  from private.privacy_request_register as request
  union all
  select
    'security_incident'::text,
    count(*) filter (where incident.status not in ('closed', 'false_positive')),
    count(*) filter (where incident.status in ('closed', 'false_positive')),
    count(*) filter (
      where incident.closed_at < p_as_of - interval '6 years'
    ),
    count(*) filter (
      where exists (
        select 1 from active_holds as hold
        where hold.record_identifier in ('*', 'security_incident:' || incident.id::text)
      )
    ),
    'Six-year review begins at closure. Inventory does not authorise deletion; preserve regulatory, complaint, litigation and forensic evidence.'::text
  from private.security_incident_register as incident
  order by 1;
$$;

comment on function private.privacy_operations_inventory(timestamptz) is
  'Non-mutating owner-only inventory for privacy requests and security incidents. It reports lifecycle and retention-review counts without returning request or incident payloads.';

alter table private.privacy_request_register enable row level security;
alter table private.privacy_request_events enable row level security;
alter table private.security_incident_register enable row level security;
alter table private.security_incident_events enable row level security;

create policy privacy_request_register_deny_all
on private.privacy_request_register
for all to public using (false) with check (false);

create policy privacy_request_events_deny_all
on private.privacy_request_events
for all to public using (false) with check (false);

create policy security_incident_register_deny_all
on private.security_incident_register
for all to public using (false) with check (false);

create policy security_incident_events_deny_all
on private.security_incident_events
for all to public using (false) with check (false);

revoke all on table private.privacy_request_register from public, anon, authenticated, service_role;
revoke all on table private.privacy_request_events from public, anon, authenticated, service_role;
revoke all on table private.security_incident_register from public, anon, authenticated, service_role;
revoke all on table private.security_incident_events from public, anon, authenticated, service_role;
revoke all on sequence private.privacy_request_events_id_seq from public, anon, authenticated, service_role;
revoke all on sequence private.security_incident_events_id_seq from public, anon, authenticated, service_role;
revoke all on function private.guard_privacy_request_register() from public, anon, authenticated, service_role;
revoke all on function private.append_privacy_request_event() from public, anon, authenticated, service_role;
revoke all on function private.guard_security_incident_register() from public, anon, authenticated, service_role;
revoke all on function private.append_security_incident_event() from public, anon, authenticated, service_role;
revoke all on function private.prevent_compliance_event_mutation() from public, anon, authenticated, service_role;
revoke all on function private.privacy_operations_inventory(timestamptz) from public, anon, authenticated, service_role;

do $$
declare
  v_request_id uuid;
  v_incident_id uuid;
  v_request_events integer;
  v_incident_events integer;
  v_inventory_rows integer;
begin
  begin
    insert into private.privacy_request_register(
      request_type,
      received_channel,
      requester_contact,
      assigned_to,
      last_changed_by,
      change_reason
    ) values (
      'access',
      'email',
      'migration-probe@example.invalid',
      'migration-probe',
      'migration-probe',
      'Open synthetic transaction-scoped contract probe'
    )
    returning id into v_request_id;

    update private.privacy_request_register
    set
      status = 'identity_check',
      acknowledged_at = statement_timestamp(),
      last_changed_by = 'migration-probe',
      change_reason = 'Record acknowledgement and begin identity check'
    where id = v_request_id;

    update private.privacy_request_register
    set
      status = 'under_review',
      identity_status = 'verified',
      identity_verified_at = statement_timestamp(),
      identity_evidence_reference = 'CONTROLLED-PROBE-ONLY',
      last_changed_by = 'migration-probe',
      change_reason = 'Record synthetic identity outcome and begin review'
    where id = v_request_id;

    update private.privacy_request_register
    set
      status = 'responded',
      response_outcome = 'fulfilled',
      decision_basis = 'Synthetic migration verification only',
      responded_at = statement_timestamp(),
      last_changed_by = 'migration-probe',
      change_reason = 'Record synthetic response lifecycle milestone'
    where id = v_request_id;

    update private.privacy_request_register
    set
      status = 'closed',
      closed_at = statement_timestamp(),
      last_changed_by = 'migration-probe',
      change_reason = 'Close synthetic transaction-scoped request probe'
    where id = v_request_id;

    select count(*) into v_request_events
    from private.privacy_request_events
    where request_id = v_request_id;

    if v_request_events <> 5 then
      raise exception using errcode = '23514', message = 'privacy request lifecycle did not append the expected immutable events';
    end if;

    insert into private.security_incident_register(
      source,
      summary,
      assigned_to,
      last_changed_by,
      change_reason
    ) values (
      'internal',
      'Synthetic migration contract probe with no production event or personal information.',
      'migration-probe',
      'migration-probe',
      'Open synthetic transaction-scoped incident probe'
    )
    returning id into v_incident_id;

    update private.security_incident_register
    set
      status = 'triage',
      last_changed_by = 'migration-probe',
      change_reason = 'Begin synthetic incident assessment workflow'
    where id = v_incident_id;

    update private.security_incident_register
    set
      status = 'false_positive',
      determination = 'not_established',
      regulator_notification_status = 'not_required',
      data_subject_notification_status = 'not_required',
      closed_at = statement_timestamp(),
      last_changed_by = 'migration-probe',
      change_reason = 'Close synthetic probe after no compromise was established'
    where id = v_incident_id;

    select count(*) into v_incident_events
    from private.security_incident_events
    where incident_id = v_incident_id;

    if v_incident_events <> 3 then
      raise exception using errcode = '23514', message = 'security incident lifecycle did not append the expected immutable events';
    end if;

    select count(*) into v_inventory_rows
    from private.privacy_operations_inventory();

    if v_inventory_rows <> 2 then
      raise exception using errcode = '23514', message = 'privacy operations inventory is incomplete';
    end if;

    raise exception using errcode = 'P0001', message = 'ROLLBACK_PRIVATE_COMPLIANCE_PROBE';
  exception when raise_exception then
    if sqlerrm <> 'ROLLBACK_PRIVATE_COMPLIANCE_PROBE' then
      raise;
    end if;
  end;

  if exists (select 1 from private.privacy_request_register)
    or exists (select 1 from private.privacy_request_events)
    or exists (select 1 from private.security_incident_register)
    or exists (select 1 from private.security_incident_events) then
    raise exception using errcode = '23514', message = 'synthetic privacy operations probe was not rolled back';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'private'
      and policy.tablename in (
        'privacy_request_register',
        'privacy_request_events',
        'security_incident_register',
        'security_incident_events'
      )
      and replace(policy.qual, ' ', '') in ('false', '(false)')
  ) <> 4 then
    raise exception using errcode = '42501', message = 'privacy operations RLS policies must remain deny-all';
  end if;
end;
$$;

commit;
