begin;

create extension if not exists btree_gist with schema extensions;
set local search_path = pg_catalog, public, extensions;

-- Availability is deliberately opt-in.  No operating hours, notice period or
-- booking horizon is inferred from marketing copy: every appointment service
-- needs one approved policy and at least one explicit rule before generated
-- slots can exist.
create table private.booking_availability_policies (
  service_id uuid primary key references public.services(id) on delete cascade,
  horizon_days smallint check (horizon_days between 1 and 90),
  minimum_notice_minutes integer check (minimum_notice_minutes between 0 and 129600),
  buffer_minutes smallint check (buffer_minutes between 0 and 1440),
  slot_capacity smallint check (slot_capacity = 1),
  is_approved boolean not null default false,
  config_revision bigint not null default 1 check (config_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_availability_policy_notice_within_horizon_check check (
    horizon_days is null
    or minimum_notice_minutes is null
    or minimum_notice_minutes <= horizon_days * 1440
  ),
  constraint booking_availability_policy_approval_complete_check check (
    not is_approved
    or (
      horizon_days is not null
      and minimum_notice_minutes is not null
      and buffer_minutes is not null
      and slot_capacity = 1
    )
  )
);

comment on table private.booking_availability_policies is
  'Service-scoped, staff-approved controls for deterministic appointment-slot generation. Null controls keep a policy safely unapproved.';
comment on column private.booking_availability_policies.slot_capacity is
  'Reserved for future capacity modelling. Version 1 deliberately supports exactly one booking per slot.';
comment on column private.booking_availability_policies.config_revision is
  'Monotonic materialization revision. Generated slots are public-bookable only when this matches the current policy revision.';

create table private.booking_availability_conflicts (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.services(id) on delete cascade,
  slot_id uuid references public.booking_slots(id) on delete cascade,
  candidate_starts_at timestamptz not null,
  candidate_ends_at timestamptz not null,
  conflict_kind text not null check (
    conflict_kind in (
      'manual_slot_collision',
      'booked_generated_collision',
      'booked_stale_generated_slot'
    )
  ),
  config_revision bigint not null check (config_revision > 0),
  source_rule_id uuid,
  source_exception_id uuid,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  resolved_at timestamptz,
  constraint booking_availability_conflict_candidate_range_check
    check (candidate_ends_at > candidate_starts_at),
  constraint booking_availability_conflict_source_check check (
    not (source_rule_id is not null and source_exception_id is not null)
  ),
  unique (service_id, candidate_starts_at, conflict_kind, config_revision)
);

comment on table private.booking_availability_conflicts is
  'Operational, non-PII record of generated-slot collisions which require staff review or are intentionally preserved because a booking exists.';

alter table private.booking_availability_policies enable row level security;
alter table private.booking_availability_conflicts enable row level security;

revoke all on private.booking_availability_policies
  from public, anon, authenticated;
revoke all on private.booking_availability_conflicts
  from public, anon, authenticated;
revoke usage, select on sequence private.booking_availability_conflicts_id_seq
  from public, anon, authenticated;

grant select, insert, update, delete on private.booking_availability_policies
  to service_role;
grant select, insert, update, delete on private.booking_availability_conflicts
  to service_role;
grant usage, select on sequence private.booking_availability_conflicts_id_seq
  to service_role;

create policy deny_direct_client_access
on private.booking_availability_policies
for all
to anon, authenticated
using (false)
with check (false);

create policy deny_direct_client_access
on private.booking_availability_conflicts
for all
to anon, authenticated
using (false)
with check (false);

create trigger booking_availability_policies_set_updated_at
before update on private.booking_availability_policies
for each row execute function public.set_updated_at();

-- Existing slot rows are explicit staff-curated rows.  The default preserves
-- that contract for future direct inserts; generated rows must always carry a
-- revision, timestamp and exactly one source.
alter table public.booking_slots
  add column origin_kind text not null default 'manual',
  add column source_rule_id uuid,
  add column source_exception_id uuid,
  add column materialized_at timestamptz,
  add column config_revision bigint,
  add column retired_by_materializer_at timestamptz,
  add constraint booking_slots_origin_kind_check
    check (origin_kind in ('manual', 'rule', 'exception')),
  add constraint booking_slots_config_revision_check
    check (config_revision is null or config_revision > 0),
  add constraint booking_slots_materializer_retirement_check check (
    retired_by_materializer_at is null
    or (origin_kind in ('rule', 'exception') and status = 'cancelled')
  ),
  add constraint booking_slots_provenance_check check (
    (
      origin_kind = 'manual'
      and source_rule_id is null
      and source_exception_id is null
      and materialized_at is null
      and config_revision is null
      and retired_by_materializer_at is null
    )
    or (
      origin_kind = 'rule'
      and source_rule_id is not null
      and source_exception_id is null
      and materialized_at is not null
      and config_revision is not null
    )
    or (
      origin_kind = 'exception'
      and source_rule_id is null
      and source_exception_id is not null
      and materialized_at is not null
      and config_revision is not null
    )
  );

comment on column public.booking_slots.origin_kind is
  'manual for an explicit staff slot, rule for a weekly-rule slot, or exception for a positive dated availability window.';
comment on column public.booking_slots.source_rule_id is
  'Immutable provenance UUID. It intentionally remains an audit value if the source rule is later deleted.';
comment on column public.booking_slots.source_exception_id is
  'Immutable provenance UUID. It intentionally remains an audit value if the source exception is later deleted.';
comment on column public.booking_slots.retired_by_materializer_at is
  'Non-null only when reconciliation cancelled a stale generated row. Such a row may be reopened if the exact candidate returns; staff-blocked rows may not.';

create index booking_slots_generated_reconcile_idx
  on public.booking_slots(service_id, starts_at, config_revision)
  where origin_kind in ('rule', 'exception');

-- Positive exceptions are additional, service-specific timed windows.
-- Closures may be global or service-specific and may cover a whole day or a
-- timed interval.  This removes the previously ambiguous global/full-day
-- positive forms without inventing any opening hours.
alter table public.availability_exceptions
  add constraint availability_exceptions_deterministic_semantics_check check (
    (
      is_available
      and service_id is not null
      and starts_at is not null
      and ends_at is not null
    )
    or (
      not is_available
      and (
        (starts_at is null and ends_at is null)
        or (starts_at is not null and ends_at is not null)
      )
    )
  );

create index availability_exceptions_date_service_idx
  on public.availability_exceptions(exception_date, service_id);

alter table public.availability_rules
  add constraint availability_rules_no_active_overlap
  exclude using gist (
    service_id with =,
    weekday with =,
    (int8range(
      extract(epoch from starts_at)::bigint,
      extract(epoch from ends_at)::bigint,
      '[)'
    )) with &&,
    (daterange(
      valid_from,
      valid_until,
      '[]'
    )) with &&
  )
  where (is_active)
  deferrable initially immediate;

alter table public.booking_slots
  add constraint booking_slots_no_active_overlap
  exclude using gist (
    service_id with =,
    (tstzrange(starts_at, ends_at, '[)')) with &&
  )
  where (status <> 'cancelled')
  deferrable initially immediate;

-- Policy revisions are internal monotonic state.  Staff change only the
-- controls; rule/exception/service triggers use the guarded bump path.
create or replace function private.initialize_booking_availability_policy_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.config_revision := 1;
  return new;
end;
$$;

revoke execute on function private.initialize_booking_availability_policy_revision()
  from public, anon, authenticated, service_role;

create trigger booking_availability_policies_initialize_revision
before insert on private.booking_availability_policies
for each row execute function private.initialize_booking_availability_policy_revision();

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
    or new.slot_capacity is distinct from old.slot_capacity
    or new.is_approved is distinct from old.is_approved;

  if v_internal_bump then
    if new.config_revision <> old.config_revision + 1 then
      raise exception 'availability revision must advance by exactly one'
        using errcode = '22023';
    end if;
  elsif v_controls_changed then
    new.config_revision := old.config_revision + 1;
  elsif new.config_revision is distinct from old.config_revision then
    raise exception 'availability revision is database-managed'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_booking_availability_policy_revision()
  from public, anon, authenticated, service_role;

create trigger booking_availability_policies_guard_revision
before update on private.booking_availability_policies
for each row execute function private.guard_booking_availability_policy_revision();

create or replace function private.guard_booking_availability_policy_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(old.service_id::text, 20260813161454)
  );

  if exists (
    select 1
    from public.booking_slots as slot
    where slot.service_id = old.service_id
      and slot.origin_kind in ('rule', 'exception')
  ) then
    raise exception 'generated booking slots must be retired before deleting their availability policy'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

revoke execute on function private.guard_booking_availability_policy_delete()
  from public, anon, authenticated, service_role;

create trigger booking_availability_policies_guard_delete
before delete on private.booking_availability_policies
for each row execute function private.guard_booking_availability_policy_delete();

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
  set config_revision = config_revision + 1
  where service_id = p_service_id;
  perform set_config('insurespr.availability_revision_bump', '', true);
end;
$$;

revoke execute on function private.bump_booking_availability_revision(uuid)
  from public, anon, authenticated, service_role;

-- Active weekly windows for one service may not overlap on a weekday while
-- their effective date ranges intersect.  The same advisory lock is used by
-- materialization, so concurrent edits cannot pass a read-then-write race.
create or replace function private.reject_overlapping_availability_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.service_id is distinct from old.service_id then
    raise exception 'availability rule service cannot be reassigned'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.service_id::text, 20260813161454)
  );

  if new.is_active and exists (
    select 1
    from public.availability_rules as existing
    where existing.service_id = new.service_id
      and existing.id <> new.id
      and existing.is_active
      and existing.weekday = new.weekday
      and existing.starts_at < new.ends_at
      and existing.ends_at > new.starts_at
      and daterange(
        coalesce(existing.valid_from, '-infinity'::date),
        coalesce(existing.valid_until, 'infinity'::date),
        '[]'
      ) && daterange(
        coalesce(new.valid_from, '-infinity'::date),
        coalesce(new.valid_until, 'infinity'::date),
        '[]'
      )
  ) then
    raise exception 'active availability rules overlap'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke execute on function private.reject_overlapping_availability_rule()
  from public, anon, authenticated, service_role;

create trigger availability_rules_reject_overlap
before insert or update on public.availability_rules
for each row execute function private.reject_overlapping_availability_rule();

create or replace function private.bump_availability_revision_for_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_id uuid := case when tg_op = 'DELETE' then old.service_id else new.service_id end;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_service_id::text, 20260813161454));
  perform private.bump_booking_availability_revision(v_service_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function private.bump_availability_revision_for_rule()
  owner to postgres;

revoke execute on function private.bump_availability_revision_for_rule()
  from public, anon, authenticated, service_role;

create trigger availability_rules_bump_revision
after insert or update or delete on public.availability_rules
for each row execute function private.bump_availability_revision_for_rule();

create or replace function private.bump_availability_revisions_for_exception()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_id uuid;
  v_global boolean :=
    (case when tg_op <> 'INSERT' then old.service_id is null else false end)
    or (case when tg_op <> 'DELETE' then new.service_id is null else false end);
begin
  if v_global then
    for v_service_id in
      select policy.service_id
      from private.booking_availability_policies as policy
      join public.services as service on service.id = policy.service_id
      where service.booking_mode = 'appointment'
      order by policy.service_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(v_service_id::text, 20260813161454)
      );
      perform private.bump_booking_availability_revision(v_service_id);
    end loop;
  else
    for v_service_id in
      select distinct scope.service_id
      from (
        select case when tg_op <> 'INSERT' then old.service_id end as service_id
        union all
        select case when tg_op <> 'DELETE' then new.service_id end as service_id
      ) as scope
      where scope.service_id is not null
      order by scope.service_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(v_service_id::text, 20260813161454)
      );
      perform private.bump_booking_availability_revision(v_service_id);
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function private.bump_availability_revisions_for_exception()
  owner to postgres;

revoke execute on function private.bump_availability_revisions_for_exception()
  from public, anon, authenticated, service_role;

create trigger availability_exceptions_bump_revision
after insert or update or delete on public.availability_exceptions
for each row execute function private.bump_availability_revisions_for_exception();

create or replace function private.bump_availability_revision_for_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_mode is distinct from old.booking_mode
    or new.appointment_duration_minutes is distinct from old.appointment_duration_minutes
    or new.verification_status is distinct from old.verification_status
    or new.is_published is distinct from old.is_published then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 20260813161454));
    perform private.bump_booking_availability_revision(new.id);
  end if;
  return new;
end;
$$;

alter function private.bump_availability_revision_for_service()
  owner to postgres;

revoke execute on function private.bump_availability_revision_for_service()
  from public, anon, authenticated, service_role;

create trigger services_bump_availability_revision
after update of booking_mode, appointment_duration_minutes, verification_status, is_published
on public.services
for each row execute function private.bump_availability_revision_for_service();

create or replace function private.materialize_booking_slots(
  p_from date,
  p_until date,
  p_service_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_service_id uuid;
  v_service public.services%rowtype;
  v_policy private.booking_availability_policies%rowtype;
  v_timezone text;
  v_timezone_count integer;
  v_rule_count integer;
  v_effective_from date;
  v_effective_until date;
  v_reconcile_start timestamptz;
  v_reconcile_end timestamptz;
  v_processed integer := 0;
  v_candidates integer := 0;
  v_reconciled integer := 0;
  v_cancelled integer := 0;
  v_conflicts integer := 0;
  v_rows integer;
begin
  if current_user <> 'postgres' then
    raise exception 'availability materialization requires the migration owner'
      using errcode = '42501';
  end if;

  if p_from is null or p_until is null or p_until < p_from then
    raise exception 'a valid materialization date range is required'
      using errcode = '22023';
  end if;

  if (p_until - p_from + 1) > 90 then
    raise exception 'materialization range cannot exceed 90 days'
      using errcode = '22023';
  end if;

  execute $temp$
    create temporary table if not exists booking_materialization_candidates (
      service_id uuid not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      origin_kind text not null,
      source_rule_id uuid,
      source_exception_id uuid,
      config_revision bigint not null,
      primary key (service_id, starts_at)
    ) on commit drop
  $temp$;

  for v_service_id in
    select policy.service_id
    from private.booking_availability_policies as policy
    where (
      p_service_id is not null
      and policy.service_id = p_service_id
    ) or (
      p_service_id is null
      and policy.is_approved
    )
    order by policy.service_id
  loop
    v_processed := v_processed + 1;

    -- Slot rows are always locked before the service advisory lock. Booking
    -- writers and staff assignment follow the same slot -> advisory -> policy
    -- order through bookings_enforce_current_slot, preventing lock inversion.
    perform slot.id
    from public.booking_slots as slot
    where slot.service_id = v_service_id
    order by slot.id
    for update;

    perform pg_advisory_xact_lock(
      hashtextextended(v_service_id::text, 20260813161454)
    );

    select policy.*
    into strict v_policy
    from private.booking_availability_policies as policy
    where policy.service_id = v_service_id;

    select service.*
    into strict v_service
    from public.services as service
    where service.id = v_service_id;

    if not v_policy.is_approved
      or v_policy.horizon_days is null
      or v_policy.minimum_notice_minutes is null
      or v_policy.buffer_minutes is null
      or v_policy.slot_capacity <> 1 then
      raise exception 'availability policy is not approved and complete for service %',
        v_service_id using errcode = '55000';
    end if;

    if v_service.booking_mode <> 'appointment'
      or not v_service.is_published
      or v_service.verification_status <> 'verified'
      or v_service.appointment_duration_minutes is null then
      raise exception 'service % is not a published, verified appointment service',
        v_service_id using errcode = '55000';
    end if;

    select count(*), count(distinct rule.timezone), min(rule.timezone)
    into v_rule_count, v_timezone_count, v_timezone
    from public.availability_rules as rule
    where rule.service_id = v_service_id
      and rule.is_active;

    if v_rule_count = 0 then
      raise exception 'service % has no active availability rules',
        v_service_id using errcode = '55000';
    end if;

    if v_timezone_count <> 1
      or not exists (
        select 1
        from pg_catalog.pg_timezone_names as timezone_name
        where timezone_name.name = v_timezone
      ) then
      raise exception 'service % must use one valid IANA timezone',
        v_service_id using errcode = '55000';
    end if;

    if exists (
      select 1
      from public.availability_rules as rule
      where rule.service_id = v_service_id
        and rule.is_active
        and rule.slot_duration_minutes <> v_service.appointment_duration_minutes
    ) then
      raise exception 'service % rule duration does not match its appointment duration',
        v_service_id using errcode = '55000';
    end if;

    truncate table pg_temp.booking_materialization_candidates;

    v_effective_from := greatest(
      p_from,
      (now() at time zone v_timezone)::date
    );
    v_effective_until := least(
      p_until,
      ((now() + make_interval(days => v_policy.horizon_days))
        at time zone v_timezone)::date
    );
    v_reconcile_start := p_from::timestamp at time zone v_timezone;
    v_reconcile_end := (p_until + 1)::timestamp at time zone v_timezone;

    if v_effective_until >= v_effective_from then
      insert into pg_temp.booking_materialization_candidates(
        service_id,
        starts_at,
        ends_at,
        origin_kind,
        source_rule_id,
        source_exception_id,
        config_revision
      )
      with date_series as (
        select generated.local_timestamp::date as local_date
        from generate_series(
          v_effective_from::timestamp,
          v_effective_until::timestamp,
          interval '1 day'
        ) as generated(local_timestamp)
      ),
      rule_windows as (
        select
          day.local_date,
          rule.starts_at,
          rule.ends_at,
          rule.id as source_rule_id,
          null::uuid as source_exception_id,
          'rule'::text as origin_kind
        from date_series as day
        join public.availability_rules as rule
          on rule.service_id = v_service_id
         and rule.is_active
         and rule.weekday = extract(dow from day.local_date)::smallint
         and (rule.valid_from is null or rule.valid_from <= day.local_date)
         and (rule.valid_until is null or rule.valid_until >= day.local_date)
      ),
      positive_exception_windows as (
        select
          exception.exception_date as local_date,
          exception.starts_at,
          exception.ends_at,
          null::uuid as source_rule_id,
          exception.id as source_exception_id,
          'exception'::text as origin_kind
        from public.availability_exceptions as exception
        where exception.service_id = v_service_id
          and exception.is_available
          and exception.exception_date between v_effective_from and v_effective_until
      ),
      windows as (
        select * from rule_windows
        union all
        select * from positive_exception_windows
      ),
      local_candidates as (
        select
          availability_window.local_date,
          generated.local_start,
          generated.local_start
            + make_interval(mins => v_service.appointment_duration_minutes)
            as local_end,
          availability_window.origin_kind,
          availability_window.source_rule_id,
          availability_window.source_exception_id
        from windows as availability_window
        cross join lateral generate_series(
          availability_window.local_date + availability_window.starts_at,
          availability_window.local_date + availability_window.ends_at
            - make_interval(mins => v_service.appointment_duration_minutes),
          make_interval(
            mins => v_service.appointment_duration_minutes + v_policy.buffer_minutes
          )
        ) as generated(local_start)
        where availability_window.ends_at - availability_window.starts_at
          >= make_interval(mins => v_service.appointment_duration_minutes)
      ),
      closure_filtered as (
        select candidate.*
        from local_candidates as candidate
        where not exists (
          select 1
          from public.availability_exceptions as closure
          where not closure.is_available
            and closure.exception_date = candidate.local_date
            and (closure.service_id is null or closure.service_id = v_service_id)
            and (
              closure.starts_at is null
              or (
                closure.starts_at < candidate.local_end::time
                and closure.ends_at > candidate.local_start::time
              )
            )
        )
      ),
      deterministic as (
        select distinct on (candidate.local_start)
          candidate.*
        from closure_filtered as candidate
        order by
          candidate.local_start,
          case when candidate.origin_kind = 'exception' then 0 else 1 end,
          coalesce(candidate.source_exception_id, candidate.source_rule_id)
      ),
      zoned as (
        select
          candidate.*,
          candidate.local_start at time zone v_timezone as starts_at,
          candidate.local_end at time zone v_timezone as ends_at
        from deterministic as candidate
      )
      select
        v_service_id,
        candidate.starts_at,
        candidate.ends_at,
        candidate.origin_kind,
        candidate.source_rule_id,
        candidate.source_exception_id,
        v_policy.config_revision
      from zoned as candidate
      where candidate.ends_at > candidate.starts_at
        -- A round trip rejects nonexistent local wall-clock times at a DST
        -- transition instead of silently shifting the appointment.
        and candidate.starts_at at time zone v_timezone = candidate.local_start
        and candidate.ends_at at time zone v_timezone = candidate.local_end
        and candidate.starts_at
          >= now() + make_interval(mins => v_policy.minimum_notice_minutes)
        and candidate.starts_at
          < now() + make_interval(days => v_policy.horizon_days)
      on conflict (service_id, starts_at) do update
      set
        ends_at = excluded.ends_at,
        origin_kind = excluded.origin_kind,
        source_rule_id = excluded.source_rule_id,
        source_exception_id = excluded.source_exception_id,
        config_revision = excluded.config_revision;
    end if;

    select count(*)
    into v_rows
    from pg_temp.booking_materialization_candidates;
    v_candidates := v_candidates + v_rows;

    if exists (
      select 1
      from pg_temp.booking_materialization_candidates as first_candidate
      join pg_temp.booking_materialization_candidates as second_candidate
        on second_candidate.service_id = first_candidate.service_id
       and second_candidate.starts_at > first_candidate.starts_at
       and second_candidate.starts_at < first_candidate.ends_at
    ) then
      raise exception 'availability windows produce overlapping appointment slots for service %',
        v_service_id using errcode = '23P01';
    end if;

    update private.booking_availability_conflicts as conflict
    set resolved_at = now()
    where conflict.service_id = v_service_id
      and conflict.candidate_starts_at >= v_reconcile_start
      and conflict.candidate_starts_at < v_reconcile_end
      and conflict.resolved_at is null;

    insert into private.booking_availability_conflicts as existing_conflict(
      service_id,
      slot_id,
      candidate_starts_at,
      candidate_ends_at,
      conflict_kind,
      config_revision,
      source_rule_id,
      source_exception_id
    )
    select
      v_service_id,
      slot.id,
      candidate.starts_at,
      candidate.ends_at,
      case
        when slot.origin_kind = 'manual'
          or (
            slot.origin_kind in ('rule', 'exception')
            and not exists (
              select 1
              from public.bookings as booking
              where booking.slot_id = slot.id
            )
            and slot.status in ('blocked', 'cancelled')
            and slot.retired_by_materializer_at is null
          )
          then 'manual_slot_collision'
        else 'booked_generated_collision'
      end,
      v_policy.config_revision,
      candidate.source_rule_id,
      candidate.source_exception_id
    from pg_temp.booking_materialization_candidates as candidate
    cross join lateral (
      select protected_slot.*
      from public.booking_slots as protected_slot
      where protected_slot.service_id = candidate.service_id
        and protected_slot.starts_at < candidate.ends_at
        and protected_slot.ends_at > candidate.starts_at
        and (
          protected_slot.origin_kind = 'manual'
          or (
            protected_slot.origin_kind in ('rule', 'exception')
            and protected_slot.status in ('blocked', 'cancelled')
            and protected_slot.retired_by_materializer_at is null
          )
          or exists (
            select 1
            from public.bookings as booking
            where booking.slot_id = protected_slot.id
          )
        )
        and not (
          protected_slot.starts_at = candidate.starts_at
          and protected_slot.ends_at = candidate.ends_at
          and protected_slot.origin_kind is not distinct from candidate.origin_kind
          and protected_slot.source_rule_id is not distinct from candidate.source_rule_id
          and protected_slot.source_exception_id is not distinct from candidate.source_exception_id
          and protected_slot.config_revision = candidate.config_revision
          and protected_slot.status = 'open'
        )
      order by
        case when protected_slot.origin_kind = 'manual' then 0 else 1 end,
        protected_slot.id
      limit 1
    ) as slot
    on conflict (service_id, candidate_starts_at, conflict_kind, config_revision)
    do update set
      slot_id = excluded.slot_id,
      candidate_ends_at = excluded.candidate_ends_at,
      source_rule_id = excluded.source_rule_id,
      source_exception_id = excluded.source_exception_id,
      last_detected_at = now(),
      occurrence_count = existing_conflict.occurrence_count + 1,
      resolved_at = null;

    -- A changed duration or offset can make the new grid transiently overlap
    -- stale generated rows.  Defer only this named constraint while new rows
    -- are upserted; stale unbooked rows are cancelled below, then IMMEDIATE
    -- forces validation before reconciliation can report success.
    set constraints public.booking_slots_no_active_overlap deferred;

    insert into public.booking_slots(
      service_id,
      starts_at,
      ends_at,
      status,
      origin_kind,
      source_rule_id,
      source_exception_id,
      materialized_at,
      config_revision,
      retired_by_materializer_at
    )
    select
      candidate.service_id,
      candidate.starts_at,
      candidate.ends_at,
      'open',
      candidate.origin_kind,
      candidate.source_rule_id,
      candidate.source_exception_id,
      now(),
      candidate.config_revision,
      null
    from pg_temp.booking_materialization_candidates as candidate
    where not exists (
      select 1
      from public.booking_slots as protected_slot
      where protected_slot.service_id = candidate.service_id
        and protected_slot.starts_at < candidate.ends_at
        and protected_slot.ends_at > candidate.starts_at
        and (
          protected_slot.origin_kind = 'manual'
          or (
            protected_slot.origin_kind in ('rule', 'exception')
            and protected_slot.status in ('blocked', 'cancelled')
            and protected_slot.retired_by_materializer_at is null
          )
          or exists (
            select 1
            from public.bookings as booking
            where booking.slot_id = protected_slot.id
          )
        )
        and not (
          protected_slot.starts_at = candidate.starts_at
          and protected_slot.ends_at = candidate.ends_at
          and protected_slot.origin_kind is not distinct from candidate.origin_kind
          and protected_slot.source_rule_id is not distinct from candidate.source_rule_id
          and protected_slot.source_exception_id is not distinct from candidate.source_exception_id
          and protected_slot.config_revision = candidate.config_revision
          and protected_slot.status = 'open'
        )
    )
    on conflict (service_id, starts_at) do update
    set
      ends_at = excluded.ends_at,
      status = 'open',
      origin_kind = excluded.origin_kind,
      source_rule_id = excluded.source_rule_id,
      source_exception_id = excluded.source_exception_id,
      materialized_at = excluded.materialized_at,
      config_revision = excluded.config_revision,
      retired_by_materializer_at = null
    where public.booking_slots.origin_kind <> 'manual'
      and (
        public.booking_slots.status = 'open'
        or public.booking_slots.retired_by_materializer_at is not null
      )
      and not exists (
        select 1
        from public.bookings as booking
        where booking.slot_id = public.booking_slots.id
      );

    get diagnostics v_rows = row_count;
    v_reconciled := v_reconciled + v_rows;

    insert into private.booking_availability_conflicts as existing_conflict(
      service_id,
      slot_id,
      candidate_starts_at,
      candidate_ends_at,
      conflict_kind,
      config_revision,
      source_rule_id,
      source_exception_id
    )
    select
      v_service_id,
      slot.id,
      slot.starts_at,
      slot.ends_at,
      'booked_stale_generated_slot',
      v_policy.config_revision,
      slot.source_rule_id,
      slot.source_exception_id
    from public.booking_slots as slot
    where slot.service_id = v_service_id
      and slot.origin_kind in ('rule', 'exception')
      and slot.starts_at >= v_reconcile_start
      and slot.starts_at < v_reconcile_end
      and exists (
        select 1
        from public.bookings as booking
        where booking.slot_id = slot.id
      )
      and not exists (
        select 1
        from pg_temp.booking_materialization_candidates as candidate
        where candidate.service_id = slot.service_id
          and candidate.starts_at = slot.starts_at
          and candidate.ends_at = slot.ends_at
          and candidate.origin_kind = slot.origin_kind
          and candidate.source_rule_id is not distinct from slot.source_rule_id
          and candidate.source_exception_id is not distinct from slot.source_exception_id
          and candidate.config_revision = slot.config_revision
      )
    on conflict (service_id, candidate_starts_at, conflict_kind, config_revision)
    do update set
      slot_id = excluded.slot_id,
      candidate_ends_at = excluded.candidate_ends_at,
      source_rule_id = excluded.source_rule_id,
      source_exception_id = excluded.source_exception_id,
      last_detected_at = now(),
      occurrence_count = existing_conflict.occurrence_count + 1,
      resolved_at = null;

    update public.booking_slots as slot
    set
      status = 'cancelled',
      materialized_at = now(),
      retired_by_materializer_at = now()
    where slot.service_id = v_service_id
      and slot.origin_kind in ('rule', 'exception')
      and slot.starts_at >= v_reconcile_start
      and slot.starts_at < v_reconcile_end
      and slot.status <> 'cancelled'
      and not exists (
        select 1
        from public.bookings as booking
        where booking.slot_id = slot.id
      )
      and not exists (
        select 1
        from pg_temp.booking_materialization_candidates as candidate
        where candidate.service_id = slot.service_id
          and candidate.starts_at = slot.starts_at
          and candidate.ends_at = slot.ends_at
          and candidate.origin_kind = slot.origin_kind
          and candidate.source_rule_id is not distinct from slot.source_rule_id
          and candidate.source_exception_id is not distinct from slot.source_exception_id
          and candidate.config_revision = slot.config_revision
      );

    get diagnostics v_rows = row_count;
    v_cancelled := v_cancelled + v_rows;

    set constraints public.booking_slots_no_active_overlap immediate;

    select count(*)
    into v_rows
    from private.booking_availability_conflicts as conflict
    where conflict.service_id = v_service_id
      and conflict.candidate_starts_at >= v_reconcile_start
      and conflict.candidate_starts_at < v_reconcile_end
      and conflict.resolved_at is null;
    v_conflicts := v_conflicts + v_rows;
  end loop;

  if p_service_id is not null and v_processed = 0 then
    raise exception 'availability policy does not exist for service %',
      p_service_id using errcode = '55000';
  end if;

  return jsonb_build_object(
    'services_processed', v_processed,
    'candidates', v_candidates,
    'slots_reconciled', v_reconciled,
    'slots_cancelled', v_cancelled,
    'unresolved_conflicts', v_conflicts
  );
end;
$$;

alter function private.materialize_booking_slots(date, date, uuid)
  owner to postgres;
revoke execute on function private.materialize_booking_slots(date, date, uuid)
  from public, anon, authenticated, service_role;

comment on function private.materialize_booking_slots(date, date, uuid) is
  'Materializes at most 90 days of approved weekly and positive-exception availability. It never invents rules, deletes slots, overwrites manual slots, or changes any slot referenced by a booking.';

create or replace function private.booking_slot_is_current(
  p_slot_id uuid,
  p_service_id uuid,
  p_at timestamptz default now(),
  p_exclude_booking_id uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
    select
      slot.service_id = p_service_id
      and slot.status = 'open'
      and service.booking_mode = 'appointment'
      and service.is_published
      and service.verification_status = 'verified'
      and service.appointment_duration_minutes is not null
      and slot.ends_at > slot.starts_at
      and (
        (
          slot.origin_kind = 'manual'
          and slot.starts_at >= case
            when policy.is_approved
              then p_at + make_interval(mins => policy.minimum_notice_minutes)
            else p_at
          end
          and (
            not coalesce(policy.is_approved, false)
            or slot.starts_at < p_at + make_interval(days => policy.horizon_days)
          )
        )
        or (
          slot.origin_kind in ('rule', 'exception')
          and policy.is_approved
          and policy.horizon_days is not null
          and policy.minimum_notice_minutes is not null
          and policy.buffer_minutes is not null
          and policy.slot_capacity = 1
          and slot.config_revision = policy.config_revision
          and slot.materialized_at is not null
          and slot.starts_at
            >= p_at + make_interval(mins => policy.minimum_notice_minutes)
          and slot.starts_at
            < p_at + make_interval(days => policy.horizon_days)
        )
      )
      and not exists (
        select 1
        from public.bookings as booking
        where booking.slot_id = slot.id
          and booking.id is distinct from p_exclude_booking_id
          and booking.status in (
            'pending',
            'confirmed',
            'reschedule_requested',
            'rescheduled'
          )
      )
    from public.booking_slots as slot
    join public.services as service on service.id = slot.service_id
    left join private.booking_availability_policies as policy
      on policy.service_id = slot.service_id
    where slot.id = p_slot_id
  ), false);
$$;

revoke execute on function private.booking_slot_is_current(uuid, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function private.booking_slot_is_current(uuid, uuid, timestamptz, uuid)
  to service_role;

comment on function private.booking_slot_is_current(uuid, uuid, timestamptz, uuid) is
  'Central slot-bookability predicate. Generated rows require the current approved revision; explicit manual rows remain separate and inherit notice/horizon controls only when an approved policy exists.';

create or replace function private.enforce_current_booking_slot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot_service_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.slot_id is not distinct from old.slot_id
    and new.service_id is not distinct from old.service_id then
    return new;
  end if;

  if new.slot_id is null then
    return new;
  end if;

  begin
    select slot.service_id
    into strict v_slot_service_id
    from public.booking_slots as slot
    where slot.id = new.slot_id
    for update;
  exception when no_data_found then
    raise exception 'selected slot is unavailable' using errcode = 'P0002';
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(v_slot_service_id::text, 20260813161454)
  );

  if v_slot_service_id <> new.service_id
    or not private.booking_slot_is_current(
      new.slot_id,
      new.service_id,
      now(),
      new.id
    ) then
    raise exception 'selected slot is unavailable' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_current_booking_slot()
  from public, anon, authenticated, service_role;

create trigger bookings_enforce_current_slot
before insert or update of slot_id, service_id on public.bookings
for each row
execute function private.enforce_current_booking_slot();

create or replace function public.list_available_slots(
  p_service_id uuid,
  p_from timestamptz,
  p_until timestamptz
)
returns table (
  slot_id uuid,
  service_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select slot.id, slot.service_id, slot.starts_at, slot.ends_at
  from public.booking_slots as slot
  where slot.service_id = p_service_id
    and p_until > p_from
    and slot.starts_at >= p_from
    and slot.starts_at < p_until
    and private.booking_slot_is_current(slot.id, p_service_id, now(), null)
  order by slot.starts_at
  limit 200;
$$;

revoke execute on function public.list_available_slots(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_available_slots(uuid, timestamptz, timestamptz)
  to service_role;

comment on function public.list_available_slots(uuid, timestamptz, timestamptz) is
  'Lists current, unbooked appointment slots. Generated slots must match the approved policy revision and its live notice/horizon window.';

-- Transactional contract assertions use only synthetic, deterministic rows
-- and remove every row before commit. No opening hours or policy values become
-- operational configuration.
do $$
declare
  v_category_id uuid := extensions.gen_random_uuid();
  v_service_id uuid := extensions.gen_random_uuid();
  v_rule_one_id uuid := extensions.gen_random_uuid();
  v_rule_two_id uuid := extensions.gen_random_uuid();
  v_positive_exception_id uuid := extensions.gen_random_uuid();
  v_timed_closure_id uuid := extensions.gen_random_uuid();
  v_global_closure_id uuid := extensions.gen_random_uuid();
  v_manual_slot_id uuid := extensions.gen_random_uuid();
  v_far_manual_slot_id uuid := extensions.gen_random_uuid();
  v_booked_slot_id uuid;
  v_customer_id uuid := extensions.gen_random_uuid();
  v_booking_id uuid := extensions.gen_random_uuid();
  v_base_date date := (now() at time zone 'Africa/Johannesburg')::date + 7;
  v_second_date date := (now() at time zone 'Africa/Johannesburg')::date + 8;
  v_before_count integer;
  v_after_count integer;
  v_current_count integer;
  v_revision_before bigint;
  v_revision_after bigint;
  v_result jsonb;
begin
  insert into public.service_categories(
    id, slug, name, audience, summary, primary_cta, display_order, is_published
  ) values (
    v_category_id,
    'availability-materialization-contract-category',
    'Availability materialization contract category',
    'individual',
    'Synthetic migration assertion; removed before commit.',
    'book',
    9995,
    true
  );

  insert into public.services(
    id,
    category_id,
    slug,
    name,
    short_description,
    audience,
    booking_mode,
    confirmation_mode,
    appointment_duration_minutes,
    price_type,
    verification_status,
    display_order,
    is_published
  ) values (
    v_service_id,
    v_category_id,
    'availability-materialization-contract-service',
    'Availability materialization contract service',
    'Synthetic migration assertion; removed before commit.',
    'individual',
    'appointment',
    'instant',
    30,
    'unpublished',
    'verified',
    9995,
    true
  );

  insert into private.booking_availability_policies(
    service_id,
    horizon_days,
    minimum_notice_minutes,
    buffer_minutes,
    slot_capacity,
    is_approved
  ) values (
    v_service_id,
    30,
    0,
    0,
    1,
    true
  );

  insert into public.availability_rules(
    id,
    service_id,
    weekday,
    starts_at,
    ends_at,
    timezone,
    slot_duration_minutes,
    is_active,
    valid_from,
    valid_until
  ) values
    (
      v_rule_one_id,
      v_service_id,
      extract(dow from v_base_date)::smallint,
      time '09:00',
      time '12:00',
      'Africa/Johannesburg',
      30,
      true,
      v_base_date,
      v_base_date
    ),
    (
      v_rule_two_id,
      v_service_id,
      extract(dow from v_second_date)::smallint,
      time '09:00',
      time '10:00',
      'Africa/Johannesburg',
      30,
      true,
      v_second_date,
      v_second_date
    );

  insert into public.availability_exceptions(
    id,
    service_id,
    exception_date,
    starts_at,
    ends_at,
    is_available,
    internal_reason
  ) values
    (
      v_positive_exception_id,
      v_service_id,
      v_base_date,
      time '14:00',
      time '15:00',
      true,
      'Synthetic positive availability assertion.'
    ),
    (
      v_timed_closure_id,
      v_service_id,
      v_base_date,
      time '10:00',
      time '10:30',
      false,
      'Synthetic timed closure assertion.'
    );

  insert into public.availability_exceptions(
    id,
    service_id,
    exception_date,
    starts_at,
    ends_at,
    is_available,
    internal_reason
  ) values (
    v_global_closure_id,
    null,
    v_second_date,
    null,
    null,
    false,
    'Synthetic global whole-day closure assertion.'
  );

  begin
    insert into public.availability_exceptions(
      service_id,
      exception_date,
      starts_at,
      ends_at,
      is_available
    ) values (
      null,
      v_base_date,
      time '16:00',
      time '17:00',
      true
    );
    raise exception 'ambiguous positive exception assertion failed';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.availability_rules(
      service_id,
      weekday,
      starts_at,
      ends_at,
      timezone,
      slot_duration_minutes,
      valid_from,
      valid_until
    ) values (
      v_service_id,
      extract(dow from v_base_date)::smallint,
      time '09:15',
      time '09:45',
      'Africa/Johannesburg',
      30,
      v_base_date,
      v_base_date
    );
    raise exception 'overlapping active rule assertion failed';
  exception when exclusion_violation then
    null;
  end;

  insert into public.booking_slots(
    id, service_id, starts_at, ends_at, status, internal_note
  ) values
    (
      v_manual_slot_id,
      v_service_id,
      (v_base_date + time '16:00') at time zone 'Africa/Johannesburg',
      (v_base_date + time '16:30') at time zone 'Africa/Johannesburg',
      'open',
      'Synthetic manual-slot preservation assertion.'
    ),
    (
      v_far_manual_slot_id,
      v_service_id,
      ((v_base_date + 40) + time '09:00') at time zone 'Africa/Johannesburg',
      ((v_base_date + 40) + time '09:30') at time zone 'Africa/Johannesburg',
      'open',
      'Synthetic horizon assertion.'
    );

  v_result := private.materialize_booking_slots(
    v_base_date,
    v_second_date,
    v_service_id
  );

  if (v_result->>'services_processed')::integer <> 1
    or (v_result->>'candidates')::integer <> 7 then
    raise exception 'base weekly/closure/positive generation assertion failed: %',
      v_result;
  end if;

  select count(*)
  into v_before_count
  from public.booking_slots as slot
  where slot.service_id = v_service_id
    and slot.origin_kind in ('rule', 'exception')
    and slot.status = 'open';

  if v_before_count <> 7
    or exists (
      select 1
      from public.booking_slots as slot
      where slot.service_id = v_service_id
        and slot.origin_kind in ('rule', 'exception')
        and slot.starts_at at time zone 'Africa/Johannesburg' = v_base_date + time '10:00'
    )
    or exists (
      select 1
      from public.booking_slots as slot
      where slot.service_id = v_service_id
        and slot.origin_kind in ('rule', 'exception')
        and (slot.starts_at at time zone 'Africa/Johannesburg')::date = v_second_date
    )
    or not exists (
      select 1
      from public.booking_slots as slot
      where slot.service_id = v_service_id
        and slot.origin_kind = 'rule'
        and slot.starts_at at time zone 'Africa/Johannesburg' = v_base_date + time '09:00'
        and slot.starts_at = (v_base_date + time '09:00') at time zone 'Africa/Johannesburg'
    ) then
    raise exception 'closure precedence or timezone assertion failed';
  end if;

  perform private.materialize_booking_slots(v_base_date, v_second_date, v_service_id);

  select count(*)
  into v_after_count
  from public.booking_slots as slot
  where slot.service_id = v_service_id
    and slot.origin_kind in ('rule', 'exception')
    and slot.status = 'open';

  if v_after_count <> v_before_count then
    raise exception 'idempotent materialization assertion failed';
  end if;

  if not exists (
    select 1
    from public.booking_slots as slot
    where slot.id = v_manual_slot_id
      and slot.origin_kind = 'manual'
      and slot.status = 'open'
      and slot.config_revision is null
      and slot.materialized_at is null
  ) then
    raise exception 'manual slot preservation assertion failed';
  end if;

  if exists (
    select 1
    from public.list_available_slots(
      v_service_id,
      now(),
      now() + interval '60 days'
    ) as available
    where available.slot_id = v_far_manual_slot_id
  ) then
    raise exception 'booking horizon assertion failed';
  end if;

  select slot.id
  into strict v_booked_slot_id
  from public.booking_slots as slot
  where slot.service_id = v_service_id
    and slot.origin_kind = 'rule'
    and slot.starts_at at time zone 'Africa/Johannesburg' = v_base_date + time '11:00';

  insert into public.customers(
    id, first_name, surname, mobile_e164, email
  ) values (
    v_customer_id,
    'Availability',
    'Contract',
    '+27820000041',
    'availability-contract@example.invalid'
  );

  insert into public.bookings(
    id,
    reference,
    idempotency_key,
    customer_id,
    service_id,
    slot_id,
    preferred_date,
    patient_status,
    status,
    confirmation_mode,
    marketing_context,
    request_fingerprint
  ) values (
    v_booking_id,
    'SPR-AVAILABILITY-CONTRACT',
    extensions.gen_random_uuid(),
    v_customer_id,
    v_service_id,
    v_booked_slot_id,
    v_base_date,
    'new',
    'pending',
    'instant',
    '{}'::jsonb,
    extensions.digest('availability-contract', 'sha256')
  );

  select policy.config_revision
  into strict v_revision_before
  from private.booking_availability_policies as policy
  where policy.service_id = v_service_id;

  -- Shift both the grid offset and appointment duration. The new 09:10/20m
  -- grid overlaps the still-open 09:00/30m rows until reconciliation retires
  -- them; this is the regression for deferred overlap validation.
  update public.services
  set appointment_duration_minutes = 20
  where id = v_service_id;

  update public.availability_rules
  set
    starts_at = case
      when id = v_rule_one_id then time '09:10'
      else starts_at
    end,
    ends_at = case
      when id = v_rule_one_id then time '10:10'
      else ends_at
    end,
    slot_duration_minutes = 20
  where id in (v_rule_one_id, v_rule_two_id);

  select policy.config_revision
  into strict v_revision_after
  from private.booking_availability_policies as policy
  where policy.service_id = v_service_id;

  if v_revision_after <> v_revision_before + 3 then
    raise exception 'service/rule revision invalidation assertion failed';
  end if;

  select count(*)
  into v_current_count
  from public.list_available_slots(
    v_service_id,
    now(),
    now() + interval '30 days'
  ) as available
  join public.booking_slots as slot on slot.id = available.slot_id
  where slot.origin_kind in ('rule', 'exception');

  if v_current_count <> 0
    or not exists (
      select 1
      from public.list_available_slots(
        v_service_id,
        now(),
        now() + interval '30 days'
      ) as available
      where available.slot_id = v_manual_slot_id
    ) then
    raise exception 'revision gate or manual-slot separation assertion failed';
  end if;

  perform private.materialize_booking_slots(v_base_date, v_second_date, v_service_id);

  if not exists (
    select 1
    from public.booking_slots as slot
    where slot.id = v_booked_slot_id
      and slot.status = 'open'
      and slot.config_revision = v_revision_before
  ) or not exists (
    select 1
    from private.booking_availability_conflicts as conflict
    where conflict.service_id = v_service_id
      and conflict.slot_id = v_booked_slot_id
      and conflict.conflict_kind = 'booked_stale_generated_slot'
      and conflict.resolved_at is null
  ) or not exists (
    select 1
    from public.booking_slots as slot
    where slot.service_id = v_service_id
      and slot.origin_kind = 'rule'
      and slot.retired_by_materializer_at is not null
      and slot.status = 'cancelled'
  ) or not exists (
    select 1
    from public.booking_slots as slot
    where slot.service_id = v_service_id
      and slot.origin_kind = 'rule'
      and slot.starts_at at time zone 'Africa/Johannesburg'
        = v_base_date + time '09:10'
      and slot.ends_at at time zone 'Africa/Johannesburg'
        = v_base_date + time '09:30'
      and slot.config_revision = v_revision_after
      and slot.status = 'open'
  ) or not exists (
    select 1
    from public.booking_slots as slot
    where slot.service_id = v_service_id
      and slot.origin_kind = 'rule'
      and slot.starts_at at time zone 'Africa/Johannesburg'
        = v_base_date + time '09:00'
      and slot.retired_by_materializer_at is not null
      and slot.status = 'cancelled'
  ) then
    raise exception 'booked preservation or shifted-grid reconciliation assertion failed';
  end if;

  if exists (
    select 1
    from public.list_available_slots(
      v_service_id,
      now(),
      now() + interval '30 days'
    ) as available
    where available.slot_id = v_booked_slot_id
  ) then
    raise exception 'booked slot remained available assertion failed';
  end if;

  update private.booking_availability_policies
  set minimum_notice_minutes = 11520
  where service_id = v_service_id;

  if private.booking_slot_is_current(
    v_manual_slot_id,
    v_service_id,
    now(),
    null
  ) then
    raise exception 'minimum-notice assertion failed';
  end if;

  if has_function_privilege(
      'service_role',
      'private.materialize_booking_slots(date,date,uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'private.materialize_booking_slots(date,date,uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'private.materialize_booking_slots(date,date,uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.list_available_slots(uuid,timestamp with time zone,timestamp with time zone)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'private.booking_slot_is_current(uuid,uuid,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    or has_table_privilege(
      'anon',
      'private.booking_availability_policies',
      'SELECT'
    ) then
    raise exception 'availability ACL assertion failed';
  end if;

  delete from public.notification_attempts
  where entity_type = 'booking' and entity_id = v_booking_id;
  delete from public.consent_records
  where entity_type = 'booking' and entity_id = v_booking_id;
  delete from public.booking_actions where booking_id = v_booking_id;
  delete from public.booking_status_history where booking_id = v_booking_id;
  delete from public.booking_management_tokens where booking_id = v_booking_id;
  delete from public.bookings where id = v_booking_id;
  delete from public.customers where id = v_customer_id;
  delete from private.booking_availability_conflicts
  where service_id = v_service_id;
  delete from public.booking_slots where service_id = v_service_id;
  delete from public.availability_exceptions
  where id in (
    v_positive_exception_id,
    v_timed_closure_id,
    v_global_closure_id
  );
  delete from public.availability_rules
  where id in (v_rule_one_id, v_rule_two_id);
  delete from private.booking_availability_policies
  where service_id = v_service_id;
  delete from public.services where id = v_service_id;
  delete from public.service_categories where id = v_category_id;

  if exists (
    select 1
    from public.services
    where slug = 'availability-materialization-contract-service'
  ) or exists (
    select 1
    from public.service_categories
    where slug = 'availability-materialization-contract-category'
  ) or exists (
    select 1
    from public.booking_slots
    where service_id = v_service_id
  ) or exists (
    select 1
    from private.booking_availability_policies
    where service_id = v_service_id
  ) or exists (
    select 1
    from private.booking_availability_conflicts
    where service_id = v_service_id
  ) then
    raise exception 'availability migration left synthetic residue';
  end if;
end;
$$;

commit;
