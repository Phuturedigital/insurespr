begin;

create or replace function private.clean_marketing_value(
  p_value text,
  p_limit integer,
  p_kind text default 'utm'
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_value text := left(btrim(coalesce(p_value, '')), greatest(0, least(p_limit, 500)));
  v_digits text;
begin
  if v_value = '' then
    return null;
  end if;

  -- Marketing attribution is not a place for personal information. Reject
  -- controls, encoded controls, email-shaped values, phone/identity-number
  -- shaped values, and explicit PII key/value fragments.
  if v_value ~ '[[:cntrl:]]'
    or v_value ~* '%0(0|a|d)'
    or v_value ~* '[[:alnum:]._%+-]+(@|%40)[[:alnum:].-]+\.[[:alpha:]]{2,}'
    or v_value ~* '(^|[?&;|,[:space:]])(e-?mail|phone|mobile|telephone|contact|first[_ -]?name|last[_ -]?name|surname|full[_ -]?name|address|dob|date[_ -]?of[_ -]?birth|passport|id([_ -]?number)?)[[:space:]]*(:|=|%3[ad])'
    then
    return null;
  end if;

  v_digits := regexp_replace(v_value, '[^0-9]', '', 'g');
  if char_length(v_digits) between 8 and 15
    and v_value ~ '[+]?[0-9][0-9 ()-]{6,}[0-9]' then
    return null;
  end if;

  if p_kind = 'landing_path' then
    if v_value !~ '^/[[:alnum:]_./~%-]*$'
      or v_value ~ '^//'
      or v_value ~ '(^|/)\.\.(/|$)'
      or v_value ~* '%(2f|3f|23|40)' then
      return null;
    end if;
    return v_value;
  end if;

  if p_kind = 'referrer_host' then
    v_value := lower(v_value);
    if v_value !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' then
      return null;
    end if;
    return v_value;
  end if;

  return v_value;
end;
$$;

comment on function private.clean_marketing_value(text, integer, text) is
  'Bounds an attribution value and rejects control data and common email, phone, identity-number and explicit PII shapes.';

revoke execute on function private.clean_marketing_value(text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function private.clean_marketing_value(text, integer, text)
  to service_role;

create or replace function private.safe_marketing_context(p_payload jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    return '{}'::jsonb;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'utm_source', private.clean_marketing_value(p_payload->>'utm_source', 120, 'utm'),
    'utm_medium', private.clean_marketing_value(p_payload->>'utm_medium', 120, 'utm'),
    'utm_campaign', private.clean_marketing_value(p_payload->>'utm_campaign', 160, 'utm'),
    'utm_term', private.clean_marketing_value(p_payload->>'utm_term', 160, 'utm'),
    'utm_content', private.clean_marketing_value(p_payload->>'utm_content', 160, 'utm'),
    'landing_path', private.clean_marketing_value(p_payload->>'landing_path', 500, 'landing_path'),
    'referrer_host', private.clean_marketing_value(p_payload->>'referrer_host', 255, 'referrer_host')
  ));
end;
$$;

comment on function private.safe_marketing_context(jsonb) is
  'Returns only bounded, non-PII-shaped attribution fields; invalid paths, hosts, controls, emails, phone numbers and identity-number shapes are omitted.';

revoke execute on function private.safe_marketing_context(jsonb)
  from public, anon, authenticated;
grant execute on function private.safe_marketing_context(jsonb)
  to service_role;

-- Sanitize historical attribution in place, then recompute the fingerprints
-- that intentionally bind idempotency keys to normalized marketing context.
update public.bookings
set marketing_context = private.safe_marketing_context(marketing_context)
where marketing_context is distinct from private.safe_marketing_context(marketing_context);

update public.employer_leads
set marketing_context = private.safe_marketing_context(marketing_context)
where marketing_context is distinct from private.safe_marketing_context(marketing_context);

update public.contact_enquiries
set marketing_context = private.safe_marketing_context(marketing_context)
where marketing_context is distinct from private.safe_marketing_context(marketing_context);

update public.analytics_events
set marketing_context = private.safe_marketing_context(marketing_context)
where marketing_context is distinct from private.safe_marketing_context(marketing_context);

-- Earlier clients sent UUID session identifiers and pathnames, but the old
-- database contract only truncated them. Redact any historical value that
-- does not satisfy the now-authoritative non-PII shape before tightening
-- future writes. The page path is required, so an unsafe historical value is
-- replaced with a neutral path rather than retained or deleted.
update public.analytics_events
set anonymous_session_id = null
where anonymous_session_id is not null
  and lower(btrim(anonymous_session_id))
    !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

update public.analytics_events
set page_path = '/redacted-legacy-path'
where private.clean_marketing_value(page_path, 500, 'landing_path') is null;

update public.analytics_events
set
  anonymous_session_id = lower(btrim(anonymous_session_id)),
  page_path = private.clean_marketing_value(page_path, 500, 'landing_path')
where anonymous_session_id is not null
   or page_path is distinct from private.clean_marketing_value(
     page_path,
     500,
     'landing_path'
   );

alter table public.analytics_events
  add constraint analytics_events_anonymous_session_shape_check check (
    anonymous_session_id is null
    or (
      anonymous_session_id = lower(btrim(anonymous_session_id))
      and anonymous_session_id
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ),
  add constraint analytics_events_page_path_shape_check check (
    page_path is not distinct from private.clean_marketing_value(
      page_path,
      500,
      'landing_path'
    )
  );

update public.bookings as booking
set request_fingerprint = private.booking_request_fingerprint(
  customer.first_name,
  customer.surname,
  customer.mobile_e164,
  customer.email,
  booking.service_id,
  booking.slot_id,
  booking.preferred_date,
  booking.preferred_time_period,
  booking.patient_status,
  booking.notes,
  booking.marketing_context,
  null
)
from public.customers as customer
where customer.id = booking.customer_id;

update public.employer_leads as lead
set request_fingerprint = private.employer_lead_request_fingerprint(
  lead.contact_name,
  lead.company_name,
  lead.work_email,
  lead.phone_e164,
  lead.employee_count_range,
  lead.services_required,
  lead.preferred_timeframe,
  lead.delivery_mode,
  lead.location,
  lead.notes,
  lead.marketing_context,
  null
);

update public.contact_enquiries as enquiry
set request_fingerprint = private.contact_enquiry_request_fingerprint(
  enquiry.name,
  enquiry.email,
  enquiry.phone_e164,
  enquiry.enquiry_type,
  enquiry.message,
  enquiry.marketing_context,
  null
);

-- Historic public form submissions used booking_completed at request time.
-- Preserve booking_completed for a future trusted staff completion event and
-- relabel those web events before tightening the public RPC contract.
alter table public.analytics_events
  drop constraint analytics_events_event_name_check;

update public.analytics_events
set event_name = 'booking_request_submitted'
where event_name = 'booking_completed';

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (
    event_name in (
      'booking_started',
      'booking_request_submitted',
      'booking_completed',
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
  -- Backward compatibility for an already-shipped client: request-time
  -- "booking_completed" is stored with its truthful public-form meaning.
  -- The public RPC can never create the staff-reserved completion event.
  v_event := case
    when v_requested_event = 'booking_completed' then 'booking_request_submitted'
    else v_requested_event
  end;

  if v_event not in (
    'booking_started',
    'booking_request_submitted',
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
      and v_session_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
    raise exception 'invalid analytics event' using errcode = '22023';
  end if;

  begin
    v_service_id := nullif(p_payload->>'service_id', '')::uuid;
  exception when others then
    v_service_id := null;
  end;

  insert into public.analytics_events(
    event_name, anonymous_session_id, page_path, service_id, marketing_context
  ) values (
    v_event,
    v_session_id,
    v_page_path,
    v_service_id,
    private.safe_marketing_context(coalesce(p_payload->'marketing', '{}'::jsonb))
  );
end;
$$;

comment on function public.record_analytics_event(jsonb) is
  'Records allowlisted public-site events. Legacy booking_completed input is stored as booking_request_submitted; booking_completed is reserved for a future trusted staff workflow.';

revoke execute on function public.record_analytics_event(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_analytics_event(jsonb) to service_role;

-- Contract assertions are transaction-local and self-cleaning.
do $$
declare
  v_safe jsonb;
  v_bad jsonb;
  v_session text := extensions.gen_random_uuid()::text;
  v_event text;
  v_before_count bigint;
begin
  v_safe := private.safe_marketing_context(jsonb_build_object(
    'utm_source', 'Google',
    'utm_medium', 'cpc',
    'utm_campaign', 'winter-wellness',
    'landing_path', '/body-bone-scan',
    'referrer_host', 'WWW.Google.COM'
  ));

  if v_safe is distinct from jsonb_build_object(
    'utm_source', 'Google',
    'utm_medium', 'cpc',
    'utm_campaign', 'winter-wellness',
    'landing_path', '/body-bone-scan',
    'referrer_host', 'www.google.com'
  ) then
    raise exception 'safe marketing-context contract failed';
  end if;

  v_bad := private.safe_marketing_context(jsonb_build_object(
    'utm_source', 'person@example.com',
    'utm_medium', '+27 82 123 4567',
    'utm_campaign', E'campaign\ncontrol',
    'utm_term', 'email=person%40example.com',
    'utm_content', '8001015009087',
    'landing_path', '/scan?email=person@example.com',
    'referrer_host', '192.0.2.1'
  ));

  if v_bad <> '{}'::jsonb then
    raise exception 'PII-shaped marketing-context rejection contract failed: %', v_bad;
  end if;

  perform public.record_analytics_event(jsonb_build_object(
    'event_name', 'booking_completed',
    'anonymous_session_id', v_session,
    'page_path', '/migration-contract',
    'marketing', jsonb_build_object('utm_source', 'contract-test')
  ));

  select event_name
  into strict v_event
  from public.analytics_events
  where anonymous_session_id = v_session;

  if v_event <> 'booking_request_submitted' then
    raise exception 'booking request analytics semantic contract failed';
  end if;

  select count(*)
  into v_before_count
  from public.analytics_events;

  begin
    perform public.record_analytics_event(jsonb_build_object(
      'event_name', 'service_viewed',
      'anonymous_session_id', 'person@example.com',
      'page_path', '/scan',
      'marketing', '{}'::jsonb
    ));
    raise exception 'analytics accepted PII-shaped session identifier';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_analytics_event(jsonb_build_object(
      'event_name', 'service_viewed',
      'anonymous_session_id', extensions.gen_random_uuid()::text,
      'page_path', '/scan?phone=0821234567',
      'marketing', '{}'::jsonb
    ));
    raise exception 'analytics accepted an unsafe page path';
  exception when sqlstate '22023' then
    null;
  end;

  if (select count(*) from public.analytics_events) <> v_before_count then
    raise exception 'invalid analytics contract persisted an event';
  end if;

  delete from public.analytics_events
  where anonymous_session_id = v_session;

  if has_function_privilege('anon', 'private.clean_marketing_value(text,integer,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.clean_marketing_value(text,integer,text)', 'EXECUTE')
    or has_function_privilege('anon', 'private.safe_marketing_context(jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.safe_marketing_context(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.record_analytics_event(jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_analytics_event(jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'private.clean_marketing_value(text,integer,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'private.safe_marketing_context(jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.record_analytics_event(jsonb)', 'EXECUTE') then
    raise exception 'marketing/analytics function ACL contract failed';
  end if;
end;
$$;

commit;
