begin;

create or replace function public.record_booking_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor text;
begin
  v_actor := nullif(current_setting('insurespr.actor', true), '');
  if v_actor is null or v_actor not in ('system', 'patient', 'staff') then
    v_actor := case when tg_op = 'INSERT' then 'system' else 'staff' end;
  end if;

  if tg_op = 'INSERT' then
    insert into public.booking_status_history(booking_id, old_status, new_status, actor_type)
    values (new.id, null, new.status, v_actor);
  elsif old.status is distinct from new.status then
    insert into public.booking_status_history(booking_id, old_status, new_status, actor_type)
    values (new.id, old.status, new.status, v_actor);
  end if;

  return new;
end;
$$;

comment on function public.record_booking_status_transition() is
  'Records booking status changes and safely defaults a missing actor context.';

do $$
declare
  v_service_id uuid;
  v_slot_id constant uuid := '47129731-f7fb-4439-885c-f340e30e3a36';
  v_customer_id constant uuid := '1feea0fb-73b1-451c-a2cd-f7719a22817b';
  v_booking_id constant uuid := '2764b9e4-02ac-4741-997e-06019cd20a12';
  v_lead_id constant uuid := '72230456-7a40-484a-9b0a-192048321a73';
  v_enquiry_id constant uuid := 'ff18abfd-7f97-489f-b588-1fcf653021cb';
  v_notification_id uuid;
  v_result jsonb;
  v_count integer;
begin
  select service.id
  into strict v_service_id
  from public.services as service
  where service.slug = 'dxa-bone-density';

  insert into public.booking_slots(id, service_id, starts_at, ends_at, status, internal_note)
  values (
    v_slot_id,
    v_service_id,
    now() + interval '30 days',
    now() + interval '30 days 30 minutes',
    'open',
    'Synthetic migration assertion; removed before commit.'
  );

  insert into public.customers(id, first_name, surname, mobile_e164, email)
  values (
    v_customer_id,
    'Staff',
    'Contract Test',
    '+27110000001',
    'staff-contract@example.invalid'
  );

  insert into public.bookings(
    id,
    reference,
    idempotency_key,
    customer_id,
    service_id,
    preferred_date,
    preferred_time_period,
    patient_status,
    status,
    confirmation_mode
  ) values (
    v_booking_id,
    'SPR-STAFF-CONTRACT',
    '56bdc9bf-99b2-44e5-abcf-414954b66da1',
    v_customer_id,
    v_service_id,
    (now() at time zone 'Africa/Johannesburg')::date + 30,
    'morning',
    'new',
    'pending',
    'staff'
  );

  v_result := public.staff_confirm_booking(
    v_booking_id,
    v_slot_id,
    'migration.staff@example.invalid',
    'Synthetic confirmation contract assertion.'
  );
  if v_result->>'status' <> 'confirmed' then
    raise exception 'staff booking confirmation assertion failed';
  end if;

  select attempt.id
  into strict v_notification_id
  from public.notification_attempts as attempt
  where attempt.entity_type = 'booking'
    and attempt.entity_id = v_booking_id
    and attempt.notification_kind = 'patient_booking_confirmed'
    and attempt.status = 'pending';

  update public.notification_attempts
  set
    status = 'dead',
    attempt_count = 6,
    dead_at = now(),
    last_error_code = 'synthetic_terminal_failure',
    last_error_message = 'Synthetic terminal state for requeue assertion.'
  where id = v_notification_id;

  v_result := public.staff_requeue_notification(
    v_notification_id,
    'migration.staff@example.invalid',
    'Synthetic requeue contract assertion.'
  );
  if v_result->>'status' <> 'pending' then
    raise exception 'staff notification requeue assertion failed';
  end if;

  v_result := public.staff_close_booking(
    v_booking_id,
    'completed',
    'migration.staff@example.invalid',
    'Synthetic completion contract assertion.'
  );
  if v_result->>'status' <> 'completed' then
    raise exception 'staff booking completion assertion failed';
  end if;

  insert into public.employer_leads(
    id,
    reference,
    idempotency_key,
    contact_name,
    company_name,
    work_email,
    phone_e164,
    employee_count_range,
    services_required,
    status
  ) values (
    v_lead_id,
    'B2B-STAFF-CONTRACT',
    '6f6b1489-cd6f-4284-9946-95b5dbe87998',
    'Employer Contract Test',
    'Example Invalid Employer',
    'employer-contract@example.invalid',
    '+27110000002',
    '1-10',
    array['Workplace Medicals'],
    'new'
  );

  perform public.staff_update_employer_lead_status(
    v_lead_id,
    'contacted',
    'migration.staff@example.invalid',
    'Synthetic contacted assertion.'
  );
  perform public.staff_update_employer_lead_status(
    v_lead_id,
    'qualified',
    'migration.staff@example.invalid',
    'Synthetic qualified assertion.'
  );
  v_result := public.staff_update_employer_lead_status(
    v_lead_id,
    'won',
    'migration.staff@example.invalid',
    'Synthetic won assertion.'
  );
  if v_result->>'status' <> 'won' then
    raise exception 'staff employer lead assertion failed';
  end if;

  insert into public.contact_enquiries(
    id,
    reference,
    idempotency_key,
    name,
    email,
    enquiry_type,
    message,
    status
  ) values (
    v_enquiry_id,
    'ENQ-STAFF-CONTRACT',
    '1ddaf201-b4a4-416d-bba6-238de64886a9',
    'Contact Contract Test',
    'contact-contract@example.invalid',
    'general',
    'Synthetic staff procedure contract assertion.',
    'new'
  );

  perform public.staff_update_contact_enquiry_status(
    v_enquiry_id,
    'contacted',
    'migration.staff@example.invalid',
    'Synthetic contacted assertion.'
  );
  v_result := public.staff_update_contact_enquiry_status(
    v_enquiry_id,
    'resolved',
    'migration.staff@example.invalid',
    'Synthetic resolved assertion.'
  );
  if v_result->>'status' <> 'resolved' then
    raise exception 'staff contact enquiry assertion failed';
  end if;

  select count(*)::integer
  into v_count
  from public.booking_status_history as history
  where history.booking_id = v_booking_id;
  if v_count <> 3 then
    raise exception 'booking status history assertion failed: % rows', v_count;
  end if;

  select count(*)::integer
  into v_count
  from public.operational_audit_log as audit
  where (audit.entity_type = 'booking' and audit.entity_id = v_booking_id)
     or (audit.entity_type = 'employer_lead' and audit.entity_id = v_lead_id)
     or (audit.entity_type = 'contact_enquiry' and audit.entity_id = v_enquiry_id)
     or (audit.entity_type = 'notification_attempt' and audit.entity_id = v_notification_id);
  if v_count <> 8 then
    raise exception 'operational audit assertion failed: % rows', v_count;
  end if;

  select count(*)::integer
  into v_count
  from public.notification_attempts as attempt
  where attempt.id = v_notification_id
    and attempt.status = 'pending'
    and attempt.attempt_count = 0
    and attempt.dead_at is null
    and attempt.last_error_code is null;
  if v_count <> 1 then
    raise exception 'notification reset assertion failed';
  end if;

  delete from public.operational_audit_log
  where (entity_type = 'booking' and entity_id = v_booking_id)
     or (entity_type = 'employer_lead' and entity_id = v_lead_id)
     or (entity_type = 'contact_enquiry' and entity_id = v_enquiry_id)
     or (entity_type = 'notification_attempt' and entity_id = v_notification_id);
  delete from public.notification_attempts where entity_id in (v_booking_id, v_lead_id, v_enquiry_id);
  delete from public.booking_status_history where booking_id = v_booking_id;
  delete from public.bookings where id = v_booking_id;
  delete from public.booking_slots where id = v_slot_id;
  delete from public.customers where id = v_customer_id;
  delete from public.employer_leads where id = v_lead_id;
  delete from public.contact_enquiries where id = v_enquiry_id;
end;
$$;

commit;
