begin;

create or replace function public.staff_confirm_booking(
  p_booking_id uuid,
  p_slot_id uuid,
  p_actor_identifier text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_slot public.booking_slots%rowtype;
  v_actor text := btrim(coalesce(p_actor_identifier, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_status text;
  v_audit_action text;
begin
  if p_booking_id is null
    or p_slot_id is null
    or char_length(v_actor) not between 3 and 200
    or (v_reason is not null and char_length(v_reason) not between 3 and 1000) then
    raise exception 'invalid staff booking parameters' using errcode = '22023';
  end if;

  begin
    select * into strict v_booking
    from public.bookings
    where id = p_booking_id
    for update;
  exception when no_data_found then
    raise exception 'booking not found' using errcode = 'P0002';
  end;

  if v_booking.status not in ('pending', 'reschedule_requested') then
    raise exception 'booking cannot be confirmed from its current status' using errcode = '22023';
  end if;

  begin
    select * into strict v_slot
    from public.booking_slots
    where id = p_slot_id
    for update;
  exception when no_data_found then
    raise exception 'slot not found' using errcode = 'P0002';
  end;

  if v_slot.service_id <> v_booking.service_id
    or v_slot.status <> 'open'
    or v_slot.starts_at <= now()
    or exists (
      select 1
      from public.bookings as other_booking
      where other_booking.slot_id = v_slot.id
        and other_booking.id <> v_booking.id
        and other_booking.status in ('pending', 'confirmed', 'reschedule_requested', 'rescheduled')
    ) then
    raise exception 'slot is unavailable for this booking' using errcode = 'P0002';
  end if;

  v_target_status := case
    when v_booking.status = 'reschedule_requested' then 'rescheduled'
    else 'confirmed'
  end;
  v_audit_action := case
    when v_target_status = 'rescheduled' then 'booking.reschedule'
    else 'booking.confirm'
  end;

  perform set_config('insurespr.actor', 'staff', true);

  update public.bookings
  set
    slot_id = v_slot.id,
    preferred_date = (v_slot.starts_at at time zone 'Africa/Johannesburg')::date,
    status = v_target_status,
    cancelled_at = null
  where id = v_booking.id;

  insert into public.operational_audit_log(
    actor_identifier,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    reason
  ) values (
    v_actor,
    v_audit_action,
    'booking',
    v_booking.id,
    jsonb_build_object('status', v_booking.status, 'slot_id', v_booking.slot_id),
    jsonb_build_object('status', v_target_status, 'slot_id', v_slot.id),
    v_reason
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'reference', v_booking.reference,
    'status', v_target_status,
    'slot_id', v_slot.id,
    'starts_at', v_slot.starts_at
  );
end;
$$;

comment on function public.staff_confirm_booking(uuid, uuid, text, text) is
  'Assigns an available service-matched slot, preserving rescheduled versus initial-confirmation state, with an audit event.';

do $$
declare
  v_service_id uuid;
  v_original_slot_id constant uuid := '25eaa6fa-aa05-45b7-a0cf-954e87cd8e43';
  v_new_slot_id constant uuid := 'd37f3470-ece7-4117-a354-de5221bf6a76';
  v_customer_id constant uuid := '945cc5e6-a34f-4739-a7ef-fee06f30ba75';
  v_booking_id constant uuid := 'f79e0933-46c0-43e7-a1b5-c04ec91a1cf3';
  v_result jsonb;
  v_count integer;
begin
  select service.id
  into strict v_service_id
  from public.services as service
  where service.slug = 'dxa-bone-density';

  insert into public.booking_slots(id, service_id, starts_at, ends_at, status, internal_note)
  values
    (
      v_original_slot_id,
      v_service_id,
      now() + interval '30 days',
      now() + interval '30 days 30 minutes',
      'open',
      'Synthetic reschedule assertion; removed before commit.'
    ),
    (
      v_new_slot_id,
      v_service_id,
      now() + interval '31 days',
      now() + interval '31 days 30 minutes',
      'open',
      'Synthetic reschedule assertion; removed before commit.'
    );

  insert into public.customers(id, first_name, surname, mobile_e164, email)
  values (
    v_customer_id,
    'Reschedule',
    'Contract Test',
    '+27110000003',
    'reschedule-contract@example.invalid'
  );

  insert into public.bookings(
    id,
    reference,
    idempotency_key,
    customer_id,
    service_id,
    slot_id,
    preferred_date,
    preferred_time_period,
    patient_status,
    status,
    confirmation_mode
  ) values (
    v_booking_id,
    'SPR-RESCHEDULE-CONTRACT',
    'c3cdd59b-c884-4a54-8ad2-a50334b4c049',
    v_customer_id,
    v_service_id,
    v_original_slot_id,
    (now() at time zone 'Africa/Johannesburg')::date + 30,
    'morning',
    'returning',
    'confirmed',
    'staff'
  );

  perform set_config('insurespr.actor', 'patient', true);
  update public.bookings
  set
    status = 'reschedule_requested',
    preferred_date = (now() at time zone 'Africa/Johannesburg')::date + 31,
    preferred_time_period = 'afternoon'
  where id = v_booking_id;

  v_result := public.staff_confirm_booking(
    v_booking_id,
    v_new_slot_id,
    'migration.staff@example.invalid',
    'Synthetic rescheduled-state contract assertion.'
  );

  if v_result->>'status' <> 'rescheduled'
    or v_result->>'slot_id' <> v_new_slot_id::text then
    raise exception 'staff rescheduled-state return assertion failed';
  end if;

  select count(*)::integer
  into v_count
  from public.bookings as booking
  where booking.id = v_booking_id
    and booking.status = 'rescheduled'
    and booking.slot_id = v_new_slot_id;
  if v_count <> 1 then
    raise exception 'staff rescheduled-state persistence assertion failed';
  end if;

  select count(*)::integer
  into v_count
  from public.booking_status_history as history
  where history.booking_id = v_booking_id;
  if v_count <> 3 then
    raise exception 'reschedule history assertion failed: % rows', v_count;
  end if;

  select count(*)::integer
  into v_count
  from public.notification_attempts as attempt
  where attempt.entity_type = 'booking'
    and attempt.entity_id = v_booking_id
    and attempt.notification_kind in (
      'patient_reschedule_acknowledgement',
      'practice_booking_action_alert',
      'patient_booking_confirmed'
    );
  if v_count <> 3 then
    raise exception 'reschedule notification assertion failed: % rows', v_count;
  end if;

  select count(*)::integer
  into v_count
  from public.operational_audit_log as audit
  where audit.entity_type = 'booking'
    and audit.entity_id = v_booking_id
    and audit.action = 'booking.reschedule'
    and audit.before_state->>'status' = 'reschedule_requested'
    and audit.after_state->>'status' = 'rescheduled';
  if v_count <> 1 then
    raise exception 'reschedule audit assertion failed';
  end if;

  delete from public.operational_audit_log
  where entity_type = 'booking' and entity_id = v_booking_id;
  delete from public.notification_attempts
  where entity_type = 'booking' and entity_id = v_booking_id;
  delete from public.booking_status_history where booking_id = v_booking_id;
  delete from public.bookings where id = v_booking_id;
  delete from public.booking_slots where id in (v_original_slot_id, v_new_slot_id);
  delete from public.customers where id = v_customer_id;
end;
$$;

commit;
