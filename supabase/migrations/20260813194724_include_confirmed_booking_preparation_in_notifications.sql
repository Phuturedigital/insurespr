begin;

-- The worker claims current operational context under a short lease. Keep the
-- public RPC signature unchanged and add only service-owned preparation copy.
-- A delayed acknowledgement/cancellation must not acquire preparation merely
-- because the booking later moved through a confirmed state, and unverified
-- service copy must never leave the database.
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
            'created_at', booking.created_at,
            'preparation_instructions', case
              when claimed.notification_kind = 'patient_booking_confirmed'
                and booking.status in ('confirmed', 'rescheduled')
                and service.verification_status = 'verified'
                and nullif(btrim(service.preparation_instructions), '') is not null
              then btrim(service.preparation_instructions)
              else null
            end
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

comment on function public.claim_notification_batch(uuid, integer) is
  'Atomically leases eligible notifications. Confirmed/rescheduled patient confirmations receive only nonblank, verified service preparation copy.';

revoke execute on function public.claim_notification_batch(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_batch(uuid, integer)
  to service_role;

-- Non-mutating migration assertions: preserve the private worker-only ACL and
-- make all four data-release predicates explicit in the installed definition.
do $$
declare
  v_definition text := pg_get_functiondef(
    'public.claim_notification_batch(uuid,integer)'::regprocedure
  );
begin
  if has_function_privilege('anon', 'public.claim_notification_batch(uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_notification_batch(uuid,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.claim_notification_batch(uuid,integer)', 'EXECUTE') then
    raise exception 'notification claim ACL contract failed';
  end if;

  if strpos(v_definition, 'claimed.notification_kind = ''patient_booking_confirmed''') = 0
    or strpos(v_definition, 'booking.status in (''confirmed'', ''rescheduled'')') = 0
    or strpos(v_definition, 'service.verification_status = ''verified''') = 0
    or strpos(v_definition, 'nullif(btrim(service.preparation_instructions), '''') is not null') = 0 then
    raise exception 'notification preparation-release contract failed';
  end if;
end;
$$;

commit;
