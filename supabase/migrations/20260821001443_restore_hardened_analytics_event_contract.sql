begin;

-- The retired-contact migration added email_clicked, but inadvertently
-- replaced the hardened public analytics RPC with its earlier implementation
-- and removed booking_request_submitted from the table taxonomy. Restore the
-- privacy and semantic boundary forward-only while retaining email_clicked.
alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (
    event_name in (
      'booking_started',
      'booking_request_submitted',
      'booking_completed',
      'email_clicked',
      'whatsapp_clicked',
      'call_clicked',
      'directions_clicked',
      'quote_started',
      'quote_submitted',
      'service_viewed',
      'price_viewed',
      'booking_abandoned'
    )
  );

create or replace function public.record_analytics_event(p_payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requested_event text := p_payload->>'event_name';
  v_event text;
  v_service_id uuid;
  v_session_id text := lower(nullif(btrim(coalesce(
    p_payload->>'anonymous_session_id',
    ''
  )), ''));
  v_page_path text := private.clean_marketing_value(
    p_payload->>'page_path',
    500,
    'landing_path'
  );
begin
  -- Backward compatibility for a previously shipped browser event. A public
  -- request is never allowed to manufacture the staff-reserved completion
  -- event emitted by staff_close_booking().
  v_event := case
    when v_requested_event = 'booking_completed' then 'booking_request_submitted'
    else v_requested_event
  end;

  if jsonb_typeof(p_payload) is distinct from 'object'
    or v_event is null
    or v_event not in (
      'booking_started',
      'booking_request_submitted',
      'email_clicked',
      'whatsapp_clicked',
      'call_clicked',
      'directions_clicked',
      'quote_started',
      'quote_submitted',
      'service_viewed',
      'price_viewed',
      'booking_abandoned'
    )
    or v_page_path is null
    or (
      v_session_id is not null
      and v_session_id
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
    raise exception 'invalid analytics event' using errcode = '22023';
  end if;

  begin
    v_service_id := nullif(p_payload->>'service_id', '')::uuid;
  exception when others then
    v_service_id := null;
  end;

  insert into public.analytics_events(
    event_name,
    anonymous_session_id,
    page_path,
    service_id,
    marketing_context
  ) values (
    v_event,
    v_session_id,
    v_page_path,
    v_service_id,
    private.safe_marketing_context(
      coalesce(p_payload->'marketing', '{}'::jsonb)
    )
  );
end;
$$;

alter function public.record_analytics_event(jsonb) owner to postgres;

comment on function public.record_analytics_event(jsonb) is
  'Records allowlisted public-site events with canonical UUID sessions, safe paths and sanitized attribution. Legacy booking_completed input is stored as booking_request_submitted; booking_completed remains staff-reserved.';

revoke execute on function public.record_analytics_event(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_analytics_event(jsonb)
  to service_role;

-- Contract assertions are transaction-local and leave no synthetic rows.
do $$
declare
  v_legacy_session text := extensions.gen_random_uuid()::text;
  v_direct_session text := extensions.gen_random_uuid()::text;
  v_email_session text := extensions.gen_random_uuid()::text;
  v_event text;
  v_marketing jsonb;
  v_before_count bigint;
begin
  select count(*) into v_before_count from public.analytics_events;

  begin
    perform public.record_analytics_event(jsonb_build_object(
      'event_name', 'booking_completed',
      'anonymous_session_id', upper(v_legacy_session),
      'page_path', '/booking-confirmation',
      'marketing', jsonb_build_object(
        'utm_source', 'contract-source',
        'referrer_host', 'WWW.EXAMPLE.COM'
      )
    ));

    select event_name, marketing_context
    into strict v_event, v_marketing
    from public.analytics_events
    where anonymous_session_id = v_legacy_session;

    if v_event <> 'booking_request_submitted'
      or v_marketing is distinct from jsonb_build_object(
        'utm_source', 'contract-source',
        'referrer_host', 'www.example.com'
      ) then
      raise exception 'legacy booking analytics mapping contract failed';
    end if;

    perform public.record_analytics_event(jsonb_build_object(
      'event_name', 'booking_request_submitted',
      'anonymous_session_id', v_direct_session,
      'page_path', '/book',
      'marketing', '{}'::jsonb
    ));

    select event_name
    into strict v_event
    from public.analytics_events
    where anonymous_session_id = v_direct_session;

    if v_event <> 'booking_request_submitted' then
      raise exception 'direct booking-request analytics contract failed';
    end if;

    perform public.record_analytics_event(jsonb_build_object(
      'event_name', 'email_clicked',
      'anonymous_session_id', v_email_session,
      'page_path', '/contact',
      'marketing', jsonb_build_object(
        'utm_source', 'person@example.com',
        'utm_medium', '+27 82 123 4567',
        'landing_path', '/contact?email=person@example.com'
      )
    ));

    select event_name, marketing_context
    into strict v_event, v_marketing
    from public.analytics_events
    where anonymous_session_id = v_email_session;

    if v_event <> 'email_clicked' or v_marketing <> '{}'::jsonb then
      raise exception 'email analytics or marketing sanitizer contract failed';
    end if;

    begin
      perform public.record_analytics_event(jsonb_build_object(
        'event_name', 'service_viewed',
        'anonymous_session_id', 'person@example.com',
        'page_path', '/xray',
        'marketing', '{}'::jsonb
      ));
      raise exception 'analytics accepted a non-UUID session identifier';
    exception when sqlstate '22023' then
      null;
    end;

    begin
      perform public.record_analytics_event(jsonb_build_object(
        'event_name', 'service_viewed',
        'anonymous_session_id', extensions.gen_random_uuid()::text,
        'page_path', '/xray?phone=0821234567',
        'marketing', '{}'::jsonb
      ));
      raise exception 'analytics accepted an unsafe page path';
    exception when sqlstate '22023' then
      null;
    end;

    begin
      perform public.record_analytics_event(jsonb_build_object(
        'anonymous_session_id', extensions.gen_random_uuid()::text,
        'page_path', '/xray',
        'marketing', '{}'::jsonb
      ));
      raise exception 'analytics accepted a missing event name';
    exception when sqlstate '22023' then
      null;
    end;

    raise exception 'rollback restored analytics contract' using errcode = 'TST01';
  exception when sqlstate 'TST01' then
    null;
  end;

  if (select count(*) from public.analytics_events) <> v_before_count then
    raise exception 'restored analytics contract left synthetic rows';
  end if;

  if has_function_privilege(
      'public',
      'public.record_analytics_event(jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.record_analytics_event(jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.record_analytics_event(jsonb)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.record_analytics_event(jsonb)',
      'EXECUTE'
    ) then
    raise exception 'restored analytics function ACL contract failed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.record_analytics_event(jsonb)'::regprocedure
      and (
        prosecdef
        or not coalesce(
          proconfig @> array['search_path=""']::text[],
          false
        )
      )
  ) then
    raise exception 'restored analytics function security contract failed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.analytics_events'::regclass
      and conname = 'analytics_events_event_name_check'
      and pg_catalog.pg_get_constraintdef(oid, true)
        like '%booking_request_submitted%'
      and pg_catalog.pg_get_constraintdef(oid, true)
        like '%booking_completed%'
      and pg_catalog.pg_get_constraintdef(oid, true)
        like '%email_clicked%'
  ) then
    raise exception 'analytics event taxonomy constraint contract failed';
  end if;
end;
$$;

commit;
