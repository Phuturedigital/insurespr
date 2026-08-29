begin;

create or replace function private.acquisition_outcome_report(
  p_from timestamptz default (statement_timestamp() - interval '30 days'),
  p_to timestamptz default statement_timestamp()
)
returns table (
  journey_type text,
  service_slug text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_path text,
  referrer_host text,
  request_count bigint,
  progressed_count bigint,
  successful_outcome_count bigint,
  unsuccessful_outcome_count bigint,
  open_count bigint,
  attributed_value_cents bigint,
  value_status text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception using errcode = '22023', message = 'reporting window must have a start before its end';
  end if;
  if p_to - p_from > interval '366 days' then
    raise exception using errcode = '22023', message = 'reporting window cannot exceed 366 days';
  end if;

  return query
  with outcome_records as (
    select
      'booking'::text as journey_type,
      service.slug as service_slug,
      booking.marketing_context,
      booking.status,
      booking.status in ('confirmed', 'rescheduled', 'completed', 'no_show') as progressed,
      booking.status = 'completed' as successful,
      booking.status in ('cancelled', 'no_show') as unsuccessful,
      booking.status in ('pending', 'reschedule_requested', 'confirmed', 'rescheduled') as open_item
    from public.bookings as booking
    join public.services as service on service.id = booking.service_id
    where booking.created_at >= p_from and booking.created_at < p_to

    union all

    select
      'employer_quote'::text,
      'workforce-multiple-or-unspecified'::text,
      lead.marketing_context,
      lead.status,
      lead.status in ('contacted', 'qualified', 'won') as progressed,
      lead.status = 'won' as successful,
      lead.status in ('lost', 'spam') as unsuccessful,
      lead.status in ('new', 'contacted', 'qualified') as open_item
    from public.employer_leads as lead
    where lead.created_at >= p_from and lead.created_at < p_to

    union all

    select
      'contact_enquiry'::text,
      'general-or-unspecified'::text,
      enquiry.marketing_context,
      enquiry.status,
      enquiry.status in ('contacted', 'resolved') as progressed,
      enquiry.status = 'resolved' as successful,
      enquiry.status = 'spam' as unsuccessful,
      enquiry.status in ('new', 'contacted') as open_item
    from public.contact_enquiries as enquiry
    where enquiry.created_at >= p_from and enquiry.created_at < p_to
  ), normalized as (
    select
      record.journey_type,
      record.service_slug,
      coalesce(nullif(record.marketing_context->>'utm_source', ''), 'direct_or_unattributed') as utm_source,
      coalesce(nullif(record.marketing_context->>'utm_medium', ''), 'none') as utm_medium,
      coalesce(nullif(record.marketing_context->>'utm_campaign', ''), 'none') as utm_campaign,
      coalesce(nullif(record.marketing_context->>'landing_path', ''), 'unknown') as landing_path,
      coalesce(nullif(record.marketing_context->>'referrer_host', ''), 'none') as referrer_host,
      record.progressed,
      record.successful,
      record.unsuccessful,
      record.open_item
    from outcome_records as record
  )
  select
    normalized.journey_type,
    normalized.service_slug,
    normalized.utm_source,
    normalized.utm_medium,
    normalized.utm_campaign,
    normalized.landing_path,
    normalized.referrer_host,
    count(*) as request_count,
    count(*) filter (where normalized.progressed) as progressed_count,
    count(*) filter (where normalized.successful) as successful_outcome_count,
    count(*) filter (where normalized.unsuccessful) as unsuccessful_outcome_count,
    count(*) filter (where normalized.open_item) as open_count,
    null::bigint as attributed_value_cents,
    'unavailable_until_approved_pricing_and_payment_data_exists'::text as value_status
  from normalized
  group by
    normalized.journey_type,
    normalized.service_slug,
    normalized.utm_source,
    normalized.utm_medium,
    normalized.utm_campaign,
    normalized.landing_path,
    normalized.referrer_host
  order by request_count desc, normalized.journey_type, normalized.service_slug;
end;
$$;

comment on function private.acquisition_outcome_report(timestamptz, timestamptz) is
  'Owner-only aggregate acquisition outcomes by safe attribution and service dimensions. It returns no person, message, note, reference, booking, company or session identifiers and never estimates revenue.';

create or replace function private.acquisition_event_report(
  p_from timestamptz default (statement_timestamp() - interval '30 days'),
  p_to timestamptz default statement_timestamp()
)
returns table (
  event_name text,
  service_slug text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_path text,
  referrer_host text,
  event_count bigint,
  unique_anonymous_sessions bigint,
  first_event_at timestamptz,
  last_event_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception using errcode = '22023', message = 'reporting window must have a start before its end';
  end if;
  if p_to - p_from > interval '366 days' then
    raise exception using errcode = '22023', message = 'reporting window cannot exceed 366 days';
  end if;

  return query
  select
    event.event_name,
    coalesce(service.slug, 'none') as service_slug,
    coalesce(nullif(event.marketing_context->>'utm_source', ''), 'direct_or_unattributed') as utm_source,
    coalesce(nullif(event.marketing_context->>'utm_medium', ''), 'none') as utm_medium,
    coalesce(nullif(event.marketing_context->>'utm_campaign', ''), 'none') as utm_campaign,
    coalesce(nullif(event.marketing_context->>'landing_path', ''), 'unknown') as landing_path,
    coalesce(nullif(event.marketing_context->>'referrer_host', ''), 'none') as referrer_host,
    count(*) as event_count,
    count(distinct event.anonymous_session_id) filter (
      where event.anonymous_session_id is not null
    ) as unique_anonymous_sessions,
    min(event.occurred_at) as first_event_at,
    max(event.occurred_at) as last_event_at
  from public.analytics_events as event
  left join public.services as service on service.id = event.service_id
  where event.occurred_at >= p_from and event.occurred_at < p_to
  group by
    event.event_name,
    coalesce(service.slug, 'none'),
    coalesce(nullif(event.marketing_context->>'utm_source', ''), 'direct_or_unattributed'),
    coalesce(nullif(event.marketing_context->>'utm_medium', ''), 'none'),
    coalesce(nullif(event.marketing_context->>'utm_campaign', ''), 'none'),
    coalesce(nullif(event.marketing_context->>'landing_path', ''), 'unknown'),
    coalesce(nullif(event.marketing_context->>'referrer_host', ''), 'none')
  order by event_count desc, event.event_name, service_slug;
end;
$$;

comment on function private.acquisition_event_report(timestamptz, timestamptz) is
  'Owner-only aggregate conversion-event report. It returns counts and safe attribution dimensions without returning anonymous session identifiers, page-level personal data or form contents.';

revoke all on function private.acquisition_outcome_report(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.acquisition_event_report(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

do $$
declare
  v_campaign text := 'migration-acquisition-report-probe';
  v_service_id uuid;
begin
  begin
    select service.id into strict v_service_id
    from public.services as service
    where service.is_published
    order by service.display_order, service.id
    limit 1;

    insert into public.contact_enquiries (
      reference,
      idempotency_key,
      name,
      email,
      enquiry_type,
      message,
      status,
      marketing_context,
      request_fingerprint,
      created_at,
      updated_at
    ) values (
      private.generate_reference('ENQ'),
      extensions.gen_random_uuid(),
      'Migration report probe',
      'acquisition-report-probe@invalid.example',
      'general',
      'Synthetic transaction-scoped acquisition report verification',
      'resolved',
      jsonb_build_object(
        'utm_source', 'migration',
        'utm_medium', 'contract-test',
        'utm_campaign', v_campaign,
        'landing_path', '/migration-acquisition-report-probe',
        'referrer_host', 'invalid.example'
      ),
      extensions.digest('migration-acquisition-report-probe', 'sha256'),
      statement_timestamp(),
      statement_timestamp()
    );

    insert into public.analytics_events (
      event_name,
      anonymous_session_id,
      page_path,
      service_id,
      marketing_context,
      occurred_at
    ) values (
      'service_viewed',
      extensions.gen_random_uuid()::text,
      '/migration-acquisition-report-probe',
      v_service_id,
      jsonb_build_object(
        'utm_source', 'migration',
        'utm_medium', 'contract-test',
        'utm_campaign', v_campaign,
        'landing_path', '/migration-acquisition-report-probe',
        'referrer_host', 'invalid.example'
      ),
      statement_timestamp()
    );

    if not exists (
      select 1
      from private.acquisition_outcome_report(
        statement_timestamp() - interval '1 hour',
        statement_timestamp() + interval '1 hour'
      ) as report
      where report.journey_type = 'contact_enquiry'
        and report.utm_campaign = v_campaign
        and report.request_count = 1
        and report.progressed_count = 1
        and report.successful_outcome_count = 1
        and report.unsuccessful_outcome_count = 0
        and report.open_count = 0
        and report.attributed_value_cents is null
    ) then
      raise exception 'acquisition outcome report contract probe failed';
    end if;

    if not exists (
      select 1
      from private.acquisition_event_report(
        statement_timestamp() - interval '1 hour',
        statement_timestamp() + interval '1 hour'
      ) as report
      where report.event_name = 'service_viewed'
        and report.utm_campaign = v_campaign
        and report.event_count = 1
        and report.unique_anonymous_sessions = 1
    ) then
      raise exception 'acquisition event report contract probe failed';
    end if;

    begin
      perform *
      from private.acquisition_outcome_report(
        statement_timestamp() - interval '367 days',
        statement_timestamp()
      );
      raise exception 'oversized acquisition reporting window was accepted';
    exception when sqlstate '22023' then
      null;
    end;

    raise exception using errcode = 'P0001', message = 'acquisition_reporting_probe_rollback';
  exception when raise_exception then
    if sqlerrm <> 'acquisition_reporting_probe_rollback' then
      raise;
    end if;
  end;

  if exists (
    select 1 from public.contact_enquiries
    where marketing_context->>'utm_campaign' = v_campaign
  ) or exists (
    select 1 from public.analytics_events
    where marketing_context->>'utm_campaign' = v_campaign
  ) then
    raise exception 'acquisition reporting probe did not roll back synthetic records';
  end if;

  if has_function_privilege('anon', 'private.acquisition_outcome_report(timestamptz,timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.acquisition_outcome_report(timestamptz,timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.acquisition_outcome_report(timestamptz,timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'private.acquisition_event_report(timestamptz,timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.acquisition_event_report(timestamptz,timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.acquisition_event_report(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'application roles must not execute private acquisition reports';
  end if;
end;
$$;

commit;
