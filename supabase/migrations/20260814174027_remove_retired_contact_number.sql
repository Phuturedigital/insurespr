-- Remove the retired phone/WhatsApp contact route without erasing historical
-- analytics events. Public contact now uses the existing practice email.

alter table public.practice_settings
  alter column phone_display drop not null,
  alter column phone_e164 drop not null,
  alter column whatsapp_e164 drop not null;

update public.practice_settings
set
  phone_display = null,
  phone_e164 = null,
  whatsapp_e164 = null,
  updated_at = pg_catalog.now()
where id = 'primary';

alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (
    event_name in (
      'booking_started',
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

update public.service_categories
set primary_cta = 'book'
where slug = 'individuals'
  and primary_cta in ('call', 'whatsapp');

create or replace function public.record_analytics_event(p_payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event text := p_payload->>'event_name';
  v_service_id uuid;
begin
  if v_event not in (
    'booking_started', 'booking_completed', 'email_clicked',
    'whatsapp_clicked', 'call_clicked', 'directions_clicked',
    'quote_started', 'quote_submitted', 'service_viewed', 'price_viewed',
    'booking_abandoned'
  )
    or pg_catalog.char_length(pg_catalog.coalesce(p_payload->>'page_path', '')) not between 1 and 500 then
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
  )
  values (
    v_event,
    pg_catalog.left(nullif(p_payload->>'anonymous_session_id', ''), 128),
    pg_catalog.left(p_payload->>'page_path', 500),
    v_service_id,
    private.safe_marketing_context(pg_catalog.coalesce(p_payload->'marketing', '{}'::jsonb))
  );
end;
$$;
