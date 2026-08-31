begin;

create table private.retention_legal_holds (
  id uuid primary key default extensions.gen_random_uuid(),
  record_class text not null check (record_class in (
    'spam_public_submissions',
    'unconverted_enquiries_and_leads',
    'booking_and_consent_records',
    'notification_delivery_metadata',
    'anonymous_analytics',
    'rate_limit_records',
    'management_credentials',
    'audit_security_evidence',
    'database_backups'
  )),
  record_identifier text not null
    check (record_identifier = '*' or char_length(record_identifier) between 1 and 1000),
  reason text not null check (char_length(reason) between 10 and 2000),
  opened_by text not null check (char_length(opened_by) between 1 and 160),
  opened_at timestamptz not null default now(),
  review_at timestamptz,
  released_by text check (released_by is null or char_length(released_by) between 1 and 160),
  released_at timestamptz,
  release_note text check (release_note is null or char_length(release_note) between 10 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((released_at is null) = (released_by is null)),
  check (released_at is null or released_at >= opened_at)
);

create unique index retention_legal_holds_active_record_idx
  on private.retention_legal_holds(record_class, record_identifier)
  where released_at is null;

create index retention_legal_holds_review_idx
  on private.retention_legal_holds(review_at)
  where released_at is null and review_at is not null;

create table private.retention_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  requested_at timestamptz not null default now(),
  requested_by text not null check (char_length(requested_by) between 1 and 160),
  policy_as_of timestamptz not null,
  execution_requested boolean not null,
  executed boolean not null,
  change_reference text check (change_reference is null or char_length(change_reference) between 8 and 160),
  inventory jsonb not null check (jsonb_typeof(inventory) = 'array'),
  deletion_counts jsonb not null check (jsonb_typeof(deletion_counts) = 'object'),
  status text not null check (status in ('dry_run', 'completed')),
  check (executed = execution_requested),
  check ((executed and change_reference is not null and status = 'completed')
    or (not executed and change_reference is null and status = 'dry_run'))
);

comment on table private.retention_legal_holds is
  'Private owner-operated holds. An active * identifier pauses disposal for an entire record class; a concrete identifier pauses one candidate.';
comment on table private.retention_runs is
  'Immutable metadata for dry runs and explicitly confirmed retention purges. It contains counts and policy cutoffs, not deleted payloads.';

create trigger retention_legal_holds_set_updated_at
before update on private.retention_legal_holds
for each row execute function public.set_updated_at();

alter table private.retention_legal_holds enable row level security;
alter table private.retention_runs enable row level security;

revoke all on private.retention_legal_holds from public, anon, authenticated, service_role;
revoke all on private.retention_runs from public, anon, authenticated, service_role;

create index analytics_events_anonymous_retention_idx
  on public.analytics_events(occurred_at)
  where booking_id is null;

create index api_rate_limits_retention_idx
  on private.api_rate_limits(window_started_at);

create index booking_management_tokens_retention_idx
  on public.booking_management_tokens(expires_at);

create index notification_attempts_terminal_retention_idx
  on public.notification_attempts((coalesce(sent_at, dead_at, updated_at)))
  where status in ('sent', 'skipped', 'dead');

create or replace function private.retention_inventory(
  p_as_of timestamptz default statement_timestamp()
)
returns table (
  record_class text,
  retention_rule text,
  cutoff_at timestamptz,
  eligible_count bigint,
  held_count bigint,
  guarded_purge_supported boolean,
  scheduled_automatically boolean,
  operator_note text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  active_holds as (
    select hold.record_class, hold.record_identifier
    from private.retention_legal_holds as hold
    where hold.released_at is null
  ),
  spam_candidates as (
    select 'contact_enquiry:' || enquiry.id::text as identifier
    from public.contact_enquiries as enquiry
    where enquiry.status = 'spam'
      and enquiry.updated_at < p_as_of - interval '90 days'
    union all
    select 'employer_lead:' || lead.id::text
    from public.employer_leads as lead
    where lead.status = 'spam'
      and lead.updated_at < p_as_of - interval '90 days'
  ),
  unconverted_candidates as (
    select 'contact_enquiry:' || enquiry.id::text as identifier
    from public.contact_enquiries as enquiry
    where enquiry.status <> 'spam'
      and enquiry.updated_at < p_as_of - interval '24 months'
    union all
    select 'employer_lead:' || lead.id::text
    from public.employer_leads as lead
    where lead.status not in ('won', 'spam')
      and lead.updated_at < p_as_of - interval '24 months'
  ),
  booking_candidates as (
    select 'booking:' || booking.id::text as identifier
    from public.bookings as booking
    where greatest(
      booking.updated_at,
      coalesce((select max(history.created_at) from public.booking_status_history as history where history.booking_id = booking.id), '-infinity'::timestamptz),
      coalesce((select max(action.created_at) from public.booking_actions as action where action.booking_id = booking.id), '-infinity'::timestamptz)
    ) < p_as_of - interval '6 years'
  ),
  notification_candidates as (
    select attempt.id::text as identifier
    from public.notification_attempts as attempt
    where attempt.status in ('sent', 'skipped', 'dead')
      and coalesce(attempt.sent_at, attempt.dead_at, attempt.updated_at) < p_as_of - interval '12 months'
  ),
  analytics_candidates as (
    select event.id::text as identifier
    from public.analytics_events as event
    where event.booking_id is null
      and event.occurred_at < p_as_of - interval '13 months'
  ),
  rate_limit_candidates as (
    select concat_ws(':', rate_limit.key_hash, rate_limit.endpoint, extract(epoch from rate_limit.window_started_at)::bigint::text) as identifier
    from private.api_rate_limits as rate_limit
    where rate_limit.window_started_at < p_as_of - interval '30 days'
  ),
  credential_candidates as (
    select token.id::text as identifier
    from public.booking_management_tokens as token
    where token.expires_at < p_as_of
  ),
  audit_candidates as (
    select audit.id::text as identifier
    from public.operational_audit_log as audit
    where audit.created_at < p_as_of - interval '6 years'
  ),
  inventory_rows as (
    select
      'spam_public_submissions'::text as record_class,
      'Up to 90 days after last activity'::text as retention_rule,
      p_as_of - interval '90 days' as cutoff_at,
      (select count(*) from spam_candidates as candidate where not exists (
        select 1 from active_holds as hold
        where hold.record_class = 'spam_public_submissions'
          and hold.record_identifier in ('*', candidate.identifier)
      ))::bigint as eligible_count,
      (select count(*) from spam_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'spam_public_submissions'
          and hold.record_identifier in ('*', candidate.identifier)
      ))::bigint as held_count,
      false as guarded_purge_supported,
      false as scheduled_automatically,
      'Inventory only. Review linked consent and notification evidence before manual disposal.'::text as operator_note
    union all
    select
      'unconverted_enquiries_and_leads',
      '24 months after last activity',
      p_as_of - interval '24 months',
      (select count(*) from unconverted_candidates as candidate where not exists (
        select 1 from active_holds as hold
        where hold.record_class = 'unconverted_enquiries_and_leads'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      (select count(*) from unconverted_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'unconverted_enquiries_and_leads'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      false,
      false,
      'Inventory only. Confirm that the record did not become an engagement and is not under a legal hold.'
    union all
    select
      'booking_and_consent_records',
      '6 years after the last booking activity',
      p_as_of - interval '6 years',
      (select count(*) from booking_candidates as candidate where not exists (
        select 1 from active_holds as hold
        where hold.record_class = 'booking_and_consent_records'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      (select count(*) from booking_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'booking_and_consent_records'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      false,
      false,
      'Inventory only. Bookings, history, actions, customers and consent are never purged by this function.'
    union all
    select
      'notification_delivery_metadata',
      '12 months after terminal delivery state',
      p_as_of - interval '12 months',
      (select count(*) from notification_candidates as candidate where not exists (
        select 1 from active_holds as hold
        where hold.record_class = 'notification_delivery_metadata'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      (select count(*) from notification_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'notification_delivery_metadata'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      true,
      false,
      'Only sent, skipped or dead attempts qualify. Pending, processing and retryable failed attempts are excluded.'
    union all
    select
      'anonymous_analytics',
      '13 months from event creation',
      p_as_of - interval '13 months',
      (select count(*) from analytics_candidates as candidate where not exists (
        select 1 from active_holds as hold
        where hold.record_class = 'anonymous_analytics'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      (select count(*) from analytics_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'anonymous_analytics'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      true,
      false,
      'Only events without a booking link qualify. Booking-linked events remain with the booking record class.'
    union all
    select
      'rate_limit_records',
      'No more than 30 days',
      p_as_of - interval '30 days',
      (select count(*) from rate_limit_candidates as candidate where not exists (
        select 1 from active_holds as hold
        where hold.record_class = 'rate_limit_records'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      (select count(*) from rate_limit_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'rate_limit_records'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      true,
      false,
      'Eligible for guarded purge. No schedule is installed until an accountable operations owner is assigned.'
    union all
    select
      'management_credentials',
      'Delete cryptographic hashes after their explicit expiry',
      p_as_of,
      (select count(*) from credential_candidates as candidate where not exists (
        select 1 from active_holds as hold
        where hold.record_class = 'management_credentials'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      (select count(*) from credential_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'management_credentials'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      true,
      false,
      'Only already-expired token hashes qualify; live credentials are excluded.'
    union all
    select
      'audit_security_evidence',
      '6 years after documented closure',
      p_as_of - interval '6 years',
      0::bigint,
      (select count(*) from audit_candidates as candidate where exists (
        select 1 from active_holds as hold
        where hold.record_class = 'audit_security_evidence'
          and hold.record_identifier in ('*', candidate.identifier)
      )),
      false,
      false,
      'Not automatically calculable: the current audit table has no closure date. Age alone never authorises disposal.'
    union all
    select
      'database_backups',
      'Rolling 35 days once backup ownership is confirmed',
      p_as_of - interval '35 days',
      0::bigint,
      (select count(*) from active_holds as hold where hold.record_class = 'database_backups'),
      false,
      false,
      'Provider-managed inventory only. No database function can delete provider backups.'
  )
  select * from inventory_rows
  order by record_class;
$$;

comment on function private.retention_inventory(timestamptz) is
  'Returns a private, non-mutating retention inventory. Business, consent and audit records are inventory-only.';

create or replace function private.apply_retention_policy(
  p_execute boolean default false,
  p_confirmation text default null,
  p_change_reference text default null,
  p_as_of timestamptz default statement_timestamp()
)
returns table (
  run_id uuid,
  record_class text,
  eligible_count bigint,
  held_count bigint,
  deleted_count bigint,
  executed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_inventory jsonb;
  v_deleted_notifications bigint := 0;
  v_deleted_analytics bigint := 0;
  v_deleted_rate_limits bigint := 0;
  v_deleted_credentials bigint := 0;
  v_confirmation constant text := 'PURGE APPROVED WEBSITE RETENTION RECORDS';
begin
  if p_as_of is null or p_as_of > statement_timestamp() then
    raise exception using errcode = '22023', message = 'policy as-of time must be present and cannot be in the future';
  end if;

  if p_execute and p_confirmation is distinct from v_confirmation then
    raise exception using errcode = '22023', message = 'exact retention purge confirmation is required';
  end if;

  if p_execute and (p_change_reference is null or char_length(btrim(p_change_reference)) < 8) then
    raise exception using errcode = '22023', message = 'an auditable change reference of at least 8 characters is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('insurespr:retention-policy', 0));

  select coalesce(jsonb_agg(to_jsonb(inventory) order by inventory.record_class), '[]'::jsonb)
  into v_inventory
  from private.retention_inventory(p_as_of) as inventory;

  if p_execute then
    delete from public.notification_attempts as attempt
    where attempt.status in ('sent', 'skipped', 'dead')
      and coalesce(attempt.sent_at, attempt.dead_at, attempt.updated_at) < p_as_of - interval '12 months'
      and not exists (
        select 1
        from private.retention_legal_holds as hold
        where hold.released_at is null
          and hold.record_class = 'notification_delivery_metadata'
          and hold.record_identifier in ('*', attempt.id::text)
      );
    get diagnostics v_deleted_notifications = row_count;

    delete from public.analytics_events as event
    where event.booking_id is null
      and event.occurred_at < p_as_of - interval '13 months'
      and not exists (
        select 1
        from private.retention_legal_holds as hold
        where hold.released_at is null
          and hold.record_class = 'anonymous_analytics'
          and hold.record_identifier in ('*', event.id::text)
      );
    get diagnostics v_deleted_analytics = row_count;

    delete from private.api_rate_limits as rate_limit
    where rate_limit.window_started_at < p_as_of - interval '30 days'
      and not exists (
        select 1
        from private.retention_legal_holds as hold
        where hold.released_at is null
          and hold.record_class = 'rate_limit_records'
          and hold.record_identifier in (
            '*',
            concat_ws(':', rate_limit.key_hash, rate_limit.endpoint, extract(epoch from rate_limit.window_started_at)::bigint::text)
          )
      );
    get diagnostics v_deleted_rate_limits = row_count;

    delete from public.booking_management_tokens as token
    where token.expires_at < p_as_of
      and not exists (
        select 1
        from private.retention_legal_holds as hold
        where hold.released_at is null
          and hold.record_class = 'management_credentials'
          and hold.record_identifier in ('*', token.id::text)
      );
    get diagnostics v_deleted_credentials = row_count;
  end if;

  insert into private.retention_runs (
    requested_by,
    policy_as_of,
    execution_requested,
    executed,
    change_reference,
    inventory,
    deletion_counts,
    status
  )
  values (
    current_user,
    p_as_of,
    p_execute,
    p_execute,
    case when p_execute then btrim(p_change_reference) else null end,
    v_inventory,
    jsonb_build_object(
      'notification_delivery_metadata', v_deleted_notifications,
      'anonymous_analytics', v_deleted_analytics,
      'rate_limit_records', v_deleted_rate_limits,
      'management_credentials', v_deleted_credentials
    ),
    case when p_execute then 'completed' else 'dry_run' end
  )
  returning id into v_run_id;

  return query
  select
    v_run_id,
    inventory.record_class,
    inventory.eligible_count,
    inventory.held_count,
    case inventory.record_class
      when 'notification_delivery_metadata' then v_deleted_notifications
      when 'anonymous_analytics' then v_deleted_analytics
      when 'rate_limit_records' then v_deleted_rate_limits
      when 'management_credentials' then v_deleted_credentials
      else 0::bigint
    end,
    p_execute
  from private.retention_inventory(p_as_of) as inventory
  order by inventory.record_class;
end;
$$;

comment on function private.apply_retention_policy(boolean, text, text, timestamptz) is
  'Dry-run by default. An exact confirmation and change reference are required to delete only terminal notification metadata, unlinked anonymous analytics, stale rate limits and expired management-token hashes.';

revoke all on function private.retention_inventory(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.apply_retention_policy(boolean, text, text, timestamptz)
  from public, anon, authenticated, service_role;

do $$
declare
  v_before_analytics bigint;
  v_before_rate_limits bigint;
  v_before_tokens bigint;
  v_before_notifications bigint;
  v_run_id uuid;
  v_private_rls integer;
begin
  select count(*) into v_before_analytics from public.analytics_events;
  select count(*) into v_before_rate_limits from private.api_rate_limits;
  select count(*) into v_before_tokens from public.booking_management_tokens;
  select count(*) into v_before_notifications from public.notification_attempts;

  select result.run_id
  into v_run_id
  from private.apply_retention_policy() as result
  limit 1;

  if v_run_id is null or not exists (
    select 1 from private.retention_runs as run
    where run.id = v_run_id and run.status = 'dry_run' and not run.executed
  ) then
    raise exception using errcode = '23514', message = 'default retention operation must record a dry run';
  end if;

  if v_before_analytics <> (select count(*) from public.analytics_events)
    or v_before_rate_limits <> (select count(*) from private.api_rate_limits)
    or v_before_tokens <> (select count(*) from public.booking_management_tokens)
    or v_before_notifications <> (select count(*) from public.notification_attempts)
  then
    raise exception using errcode = '23514', message = 'default retention dry run changed operational rows';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in ('retention_inventory', 'apply_retention_policy')
      and procedure.prosecdef
  ) then
    raise exception using errcode = '42501', message = 'retention functions must remain security invoker';
  end if;

  if has_function_privilege('anon', 'private.retention_inventory(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.retention_inventory(timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.retention_inventory(timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'private.apply_retention_policy(boolean,text,text,timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.apply_retention_policy(boolean,text,text,timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.apply_retention_policy(boolean,text,text,timestamptz)', 'EXECUTE')
  then
    raise exception using errcode = '42501', message = 'application roles must not execute private retention functions';
  end if;

  if exists (
    select 1
    from (
      values
        ('private.retention_legal_holds'::text),
        ('private.retention_runs'::text)
    ) as relation(name)
    cross join (
      values ('anon'::text), ('authenticated'::text), ('service_role'::text)
    ) as grantee(name)
    where has_table_privilege(grantee.name, relation.name, 'SELECT')
       or has_table_privilege(grantee.name, relation.name, 'INSERT')
       or has_table_privilege(grantee.name, relation.name, 'UPDATE')
       or has_table_privilege(grantee.name, relation.name, 'DELETE')
  ) then
    raise exception using errcode = '42501', message = 'application roles have unexpected retention-table privileges';
  end if;

  select count(*)
  into v_private_rls
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname in ('retention_legal_holds', 'retention_runs')
    and relation.relrowsecurity;

  if v_private_rls <> 2 then
    raise exception using errcode = '42501', message = 'private retention tables must retain RLS defense in depth';
  end if;

  delete from private.retention_runs where id = v_run_id;
end;
$$;

commit;
