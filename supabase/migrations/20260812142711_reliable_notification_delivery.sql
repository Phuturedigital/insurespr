begin;

alter table public.notification_attempts
  add column locked_at timestamptz,
  add column lock_expires_at timestamptz,
  add column locked_by uuid,
  add column sent_at timestamptz,
  add column dead_at timestamptz,
  add column last_http_status integer check (
    last_http_status is null or last_http_status between 100 and 599
  );

alter table public.notification_attempts
  drop constraint if exists notification_attempts_status_check;

alter table public.notification_attempts
  add constraint notification_attempts_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'skipped', 'dead'));

create index notification_attempts_processing_lease_idx
  on public.notification_attempts(lock_expires_at)
  where status = 'processing';

comment on column public.notification_attempts.lock_expires_at is
  'Short worker lease. An expired processing row can be atomically reclaimed.';
comment on column public.notification_attempts.dead_at is
  'Terminal failure timestamp after a non-retryable error or six delivery attempts.';

create or replace function public.claim_notification_batch(
  p_worker_id uuid,
  p_limit integer default 10
)
returns table (
  attempt_id uuid,
  entity_type text,
  entity_id uuid,
  notification_kind text,
  recipient text,
  attempt_count integer,
  payload jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or p_limit not between 1 and 25 then
    raise exception 'invalid notification claim parameters' using errcode = '22023';
  end if;

  update public.notification_attempts as exhausted
  set
    status = 'dead',
    dead_at = coalesce(exhausted.dead_at, now()),
    locked_at = null,
    lock_expires_at = null,
    locked_by = null,
    last_error_code = coalesce(exhausted.last_error_code, 'attempt_limit_reached'),
    last_error_message = coalesce(exhausted.last_error_message, 'Delivery attempt limit reached.')
  where exhausted.attempt_count >= 6
    and (
      exhausted.status in ('pending', 'failed')
      or (
        exhausted.status = 'processing'
        and exhausted.lock_expires_at is not null
        and exhausted.lock_expires_at <= now()
      )
    );

  return query
  with candidates as (
    select queued.id
    from public.notification_attempts as queued
    where queued.attempt_count < 6
      and (
        (
          queued.status in ('pending', 'failed')
          and queued.next_attempt_at <= now()
        )
        or (
          queued.status = 'processing'
          and queued.lock_expires_at is not null
          and queued.lock_expires_at <= now()
        )
      )
    order by queued.next_attempt_at, queued.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_attempts as queued
    set
      status = 'processing',
      attempt_count = queued.attempt_count + 1,
      locked_at = now(),
      lock_expires_at = now() + interval '5 minutes',
      locked_by = p_worker_id,
      last_attempt_at = now(),
      last_error_code = null,
      last_error_message = null,
      last_http_status = null
    from candidates
    where queued.id = candidates.id
    returning queued.*
  )
  select
    claimed.id,
    claimed.entity_type,
    claimed.entity_id,
    claimed.notification_kind,
    claimed.recipient,
    claimed.attempt_count,
    case claimed.entity_type
      when 'booking' then (
        select jsonb_build_object(
          'practice', jsonb_build_object(
            'name', settings.practice_name,
            'address', concat_ws(', ', settings.address_line, settings.locality, settings.region),
            'phone', settings.phone_display,
            'email', settings.public_email,
            'timezone', settings.timezone
          ),
          'booking', jsonb_build_object(
            'reference', booking.reference,
            'first_name', customer.first_name,
            'surname', customer.surname,
            'email', customer.email,
            'mobile', customer.mobile_e164,
            'service_name', service.name,
            'preferred_date', booking.preferred_date,
            'preferred_time_period', booking.preferred_time_period,
            'slot_starts_at', slot.starts_at,
            'status', booking.status,
            'confirmation_mode', booking.confirmation_mode,
            'created_at', booking.created_at
          )
        )
        from public.bookings as booking
        join public.customers as customer on customer.id = booking.customer_id
        join public.services as service on service.id = booking.service_id
        left join public.booking_slots as slot on slot.id = booking.slot_id
        cross join public.practice_settings as settings
        where booking.id = claimed.entity_id
          and settings.id = 'primary'
      )
      when 'employer_lead' then (
        select jsonb_build_object(
          'practice', jsonb_build_object(
            'name', settings.practice_name,
            'address', concat_ws(', ', settings.address_line, settings.locality, settings.region),
            'phone', settings.phone_display,
            'email', settings.public_email,
            'timezone', settings.timezone
          ),
          'lead', jsonb_build_object(
            'reference', lead.reference,
            'contact_name', lead.contact_name,
            'company_name', lead.company_name,
            'work_email', lead.work_email,
            'phone', lead.phone_e164,
            'employee_count_range', lead.employee_count_range,
            'services_required', lead.services_required,
            'preferred_timeframe', lead.preferred_timeframe,
            'delivery_mode', lead.delivery_mode,
            'location', lead.location,
            'status', lead.status,
            'created_at', lead.created_at
          )
        )
        from public.employer_leads as lead
        cross join public.practice_settings as settings
        where lead.id = claimed.entity_id
          and settings.id = 'primary'
      )
      when 'contact_enquiry' then (
        select jsonb_build_object(
          'practice', jsonb_build_object(
            'name', settings.practice_name,
            'address', concat_ws(', ', settings.address_line, settings.locality, settings.region),
            'phone', settings.phone_display,
            'email', settings.public_email,
            'timezone', settings.timezone
          ),
          'enquiry', jsonb_build_object(
            'reference', enquiry.reference,
            'name', enquiry.name,
            'email', enquiry.email,
            'phone', enquiry.phone_e164,
            'enquiry_type', enquiry.enquiry_type,
            'status', enquiry.status,
            'created_at', enquiry.created_at
          )
        )
        from public.contact_enquiries as enquiry
        cross join public.practice_settings as settings
        where enquiry.id = claimed.entity_id
          and settings.id = 'primary'
      )
      else null
    end
  from claimed;
end;
$$;

create or replace function public.complete_notification_attempt(
  p_attempt_id uuid,
  p_worker_id uuid,
  p_provider text,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_attempt_id is null
    or p_worker_id is null
    or char_length(btrim(coalesce(p_provider, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_provider_message_id, ''))) not between 1 and 255 then
    raise exception 'invalid notification completion parameters' using errcode = '22023';
  end if;

  update public.notification_attempts as delivery
  set
    status = 'sent',
    provider = left(btrim(p_provider), 80),
    provider_message_id = left(btrim(p_provider_message_id), 255),
    sent_at = now(),
    locked_at = null,
    lock_expires_at = null,
    locked_by = null,
    last_error_code = null,
    last_error_message = null,
    last_http_status = 200
  where delivery.id = p_attempt_id
    and delivery.status = 'processing'
    and delivery.locked_by = p_worker_id
    and delivery.lock_expires_at > now();

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.fail_notification_attempt(
  p_attempt_id uuid,
  p_worker_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
  p_provider text default null,
  p_http_status integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_attempt_id is null
    or p_worker_id is null
    or char_length(btrim(coalesce(p_error_code, ''))) not between 1 and 120
    or char_length(btrim(coalesce(p_error_message, ''))) not between 1 and 1000
    or p_retryable is null
    or (p_provider is not null and char_length(btrim(p_provider)) not between 1 and 80)
    or (p_http_status is not null and p_http_status not between 100 and 599) then
    raise exception 'invalid notification failure parameters' using errcode = '22023';
  end if;

  update public.notification_attempts as delivery
  set
    status = case
      when not p_retryable or delivery.attempt_count >= 6 then 'dead'
      else 'failed'
    end,
    provider = coalesce(left(btrim(p_provider), 80), delivery.provider),
    next_attempt_at = case delivery.attempt_count
      when 1 then now() + interval '1 minute'
      when 2 then now() + interval '5 minutes'
      when 3 then now() + interval '15 minutes'
      when 4 then now() + interval '1 hour'
      when 5 then now() + interval '3 hours'
      else now()
    end,
    dead_at = case
      when not p_retryable or delivery.attempt_count >= 6 then now()
      else null
    end,
    locked_at = null,
    lock_expires_at = null,
    locked_by = null,
    last_error_code = left(btrim(p_error_code), 120),
    last_error_message = left(btrim(p_error_message), 1000),
    last_http_status = p_http_status
  where delivery.id = p_attempt_id
    and delivery.status = 'processing'
    and delivery.locked_by = p_worker_id;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function public.claim_notification_batch(uuid, integer) is
  'Atomically leases a small batch of eligible notification intents to one trusted worker.';
comment on function public.complete_notification_attempt(uuid, uuid, text, text) is
  'Marks a worker-owned notification lease as sent.';
comment on function public.fail_notification_attempt(uuid, uuid, text, text, boolean, text, integer) is
  'Records a safe delivery failure and schedules bounded retry or dead-letter handling.';

revoke execute on function public.claim_notification_batch(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_notification_attempt(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.fail_notification_attempt(uuid, uuid, text, text, boolean, text, integer)
  from public, anon, authenticated;

grant execute on function public.claim_notification_batch(uuid, integer) to service_role;
grant execute on function public.complete_notification_attempt(uuid, uuid, text, text) to service_role;
grant execute on function public.fail_notification_attempt(uuid, uuid, text, text, boolean, text, integer) to service_role;

commit;
