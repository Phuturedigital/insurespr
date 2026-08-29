begin;

create or replace function private.staff_operations_summary()
returns table (
  generated_at timestamptz,
  active_booking_count bigint,
  pending_booking_count bigint,
  reschedule_request_count bigint,
  oldest_booking_request_at timestamptz,
  active_employer_lead_count bigint,
  new_employer_lead_count bigint,
  active_contact_enquiry_count bigint,
  new_contact_enquiry_count bigint,
  notification_exception_count bigint,
  stale_notification_lease_count bigint,
  blocking_launch_dependency_count bigint,
  future_open_slot_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    statement_timestamp(),
    (select count(*) from public.bookings where status in ('pending', 'reschedule_requested', 'confirmed', 'rescheduled')),
    (select count(*) from public.bookings where status = 'pending'),
    (select count(*) from public.bookings where status = 'reschedule_requested'),
    (select min(created_at) from public.bookings where status in ('pending', 'reschedule_requested')),
    (select count(*) from public.employer_leads where status in ('new', 'contacted', 'qualified')),
    (select count(*) from public.employer_leads where status = 'new'),
    (select count(*) from public.contact_enquiries where status in ('new', 'contacted')),
    (select count(*) from public.contact_enquiries where status = 'new'),
    (
      select count(*)
      from public.notification_attempts
      where status in ('failed', 'dead')
        or (status = 'processing' and lock_expires_at <= statement_timestamp())
    ),
    (
      select count(*)
      from public.notification_attempts
      where status = 'processing'
        and lock_expires_at <= statement_timestamp()
    ),
    (
      select count(*)
      from public.launch_dependencies
      where blocks_launch
        and status not in ('resolved', 'not_applicable')
    ),
    (
      select count(*)
      from public.booking_slots
      where status = 'open'
        and starts_at >= statement_timestamp()
        and retired_by_materializer_at is null
    );
$$;

create or replace function private.staff_booking_work_queue(p_limit integer default 100)
returns table (
  booking_id uuid,
  reference text,
  status text,
  action_required text,
  submitted_at timestamptz,
  updated_at timestamptz,
  service_slug text,
  service_name text,
  appointment_starts_at timestamptz,
  appointment_ends_at timestamptz,
  preferred_date date,
  preferred_time_period text,
  confirmation_mode text,
  patient_status text,
  customer_name text,
  mobile_e164 text,
  email text,
  booking_notes text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_path text,
  referrer_host text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit not between 1 and 200 then
    raise exception 'staff booking queue limit must be between 1 and 200'
      using errcode = '22023';
  end if;

  return query
  select
    booking.id,
    booking.reference,
    booking.status,
    case
      when booking.status = 'reschedule_requested' then 'Assign a replacement slot or cancel'
      when booking.status = 'pending' and booking.slot_id is null then 'Contact patient and assign an approved slot'
      when booking.status = 'pending' then 'Confirm the selected slot'
      when slot.starts_at < statement_timestamp() then 'Complete, mark no-show, reschedule, or cancel'
      else 'Prepare for the appointment'
    end,
    booking.created_at,
    booking.updated_at,
    service.slug,
    service.name,
    slot.starts_at,
    slot.ends_at,
    booking.preferred_date,
    booking.preferred_time_period,
    booking.confirmation_mode,
    booking.patient_status,
    concat_ws(' ', customer.first_name, customer.surname),
    customer.mobile_e164,
    customer.email,
    booking.notes,
    nullif(booking.marketing_context->>'utm_source', ''),
    nullif(booking.marketing_context->>'utm_medium', ''),
    nullif(booking.marketing_context->>'utm_campaign', ''),
    nullif(booking.marketing_context->>'landing_path', ''),
    nullif(booking.marketing_context->>'referrer_host', '')
  from public.bookings as booking
  join public.customers as customer on customer.id = booking.customer_id
  join public.services as service on service.id = booking.service_id
  left join public.booking_slots as slot on slot.id = booking.slot_id
  where booking.status in ('pending', 'reschedule_requested', 'confirmed', 'rescheduled')
    and customer.deleted_at is null
  order by
    case booking.status
      when 'reschedule_requested' then 0
      when 'pending' then 1
      else 2
    end,
    case when booking.status in ('confirmed', 'rescheduled') then slot.starts_at end nulls last,
    booking.created_at,
    booking.id
  limit p_limit;
end;
$$;

create or replace function private.staff_employer_lead_work_queue(p_limit integer default 100)
returns table (
  lead_id uuid,
  reference text,
  status text,
  action_required text,
  submitted_at timestamptz,
  updated_at timestamptz,
  contact_name text,
  company_name text,
  work_email text,
  phone_e164 text,
  employee_count_range text,
  services_required text[],
  preferred_timeframe text,
  delivery_mode text,
  service_location text,
  lead_notes text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_path text,
  referrer_host text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit not between 1 and 200 then
    raise exception 'staff employer queue limit must be between 1 and 200'
      using errcode = '22023';
  end if;

  return query
  select
    lead.id,
    lead.reference,
    lead.status,
    case lead.status
      when 'new' then 'Send the approved initial response'
      when 'contacted' then 'Qualify the requirement or close the lead'
      else 'Follow up and record won or lost'
    end,
    lead.created_at,
    lead.updated_at,
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
    nullif(lead.marketing_context->>'utm_source', ''),
    nullif(lead.marketing_context->>'utm_medium', ''),
    nullif(lead.marketing_context->>'utm_campaign', ''),
    nullif(lead.marketing_context->>'landing_path', ''),
    nullif(lead.marketing_context->>'referrer_host', '')
  from public.employer_leads as lead
  where lead.status in ('new', 'contacted', 'qualified')
  order by
    case lead.status when 'new' then 0 when 'contacted' then 1 else 2 end,
    lead.created_at,
    lead.id
  limit p_limit;
end;
$$;

create or replace function private.staff_contact_enquiry_work_queue(p_limit integer default 100)
returns table (
  enquiry_id uuid,
  reference text,
  status text,
  action_required text,
  submitted_at timestamptz,
  updated_at timestamptz,
  enquiry_type text,
  contact_name text,
  email text,
  phone_e164 text,
  enquiry_message text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_path text,
  referrer_host text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit not between 1 and 200 then
    raise exception 'staff enquiry queue limit must be between 1 and 200'
      using errcode = '22023';
  end if;

  return query
  select
    enquiry.id,
    enquiry.reference,
    enquiry.status,
    case enquiry.status
      when 'new' then 'Review and contact the person'
      else 'Resolve the enquiry or mark it as spam'
    end,
    enquiry.created_at,
    enquiry.updated_at,
    enquiry.enquiry_type,
    enquiry.name,
    enquiry.email,
    enquiry.phone_e164,
    enquiry.message,
    nullif(enquiry.marketing_context->>'utm_source', ''),
    nullif(enquiry.marketing_context->>'utm_medium', ''),
    nullif(enquiry.marketing_context->>'utm_campaign', ''),
    nullif(enquiry.marketing_context->>'landing_path', ''),
    nullif(enquiry.marketing_context->>'referrer_host', '')
  from public.contact_enquiries as enquiry
  where enquiry.status in ('new', 'contacted')
  order by
    case enquiry.status when 'new' then 0 else 1 end,
    enquiry.created_at,
    enquiry.id
  limit p_limit;
end;
$$;

create or replace function private.staff_notification_exception_queue(p_limit integer default 100)
returns table (
  notification_id uuid,
  entity_type text,
  entity_id uuid,
  notification_kind text,
  channel text,
  recipient text,
  status text,
  action_required text,
  attempt_count integer,
  next_attempt_at timestamptz,
  lock_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_http_status integer,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit not between 1 and 200 then
    raise exception 'staff notification queue limit must be between 1 and 200'
      using errcode = '22023';
  end if;

  return query
  select
    attempt.id,
    attempt.entity_type,
    attempt.entity_id,
    attempt.notification_kind,
    attempt.channel,
    attempt.recipient,
    attempt.status,
    case
      when attempt.status = 'dead' then 'Correct the cause, verify the recipient, then requeue after review'
      when attempt.status = 'failed' then 'Review the provider error and retry schedule'
      else 'The worker lease expired; inspect worker health before requeueing'
    end,
    attempt.attempt_count,
    attempt.next_attempt_at,
    attempt.lock_expires_at,
    attempt.last_error_code,
    attempt.last_error_message,
    attempt.last_http_status,
    attempt.updated_at
  from public.notification_attempts as attempt
  where attempt.status in ('failed', 'dead')
    or (
      attempt.status = 'processing'
      and attempt.lock_expires_at <= statement_timestamp()
    )
  order by
    case attempt.status when 'dead' then 0 when 'processing' then 1 else 2 end,
    attempt.updated_at,
    attempt.id
  limit p_limit;
end;
$$;

comment on function private.staff_operations_summary() is
  'Owner-only operational counts for daily triage. It returns no patient or prospect identifiers.';
comment on function private.staff_booking_work_queue(integer) is
  'Owner-only bounded active-booking queue. Results contain patient contact information and must remain inside approved operations systems.';
comment on function private.staff_employer_lead_work_queue(integer) is
  'Owner-only bounded workforce-lead queue. Results contain prospect contact information and must remain inside approved operations systems.';
comment on function private.staff_contact_enquiry_work_queue(integer) is
  'Owner-only bounded enquiry queue. Results contain contact information and messages and must remain inside approved operations systems.';
comment on function private.staff_notification_exception_queue(integer) is
  'Owner-only bounded notification exception queue for reviewed recovery. Results can include recipient addresses.';

revoke execute on function private.staff_operations_summary()
  from public, anon, authenticated, service_role;
revoke execute on function private.staff_booking_work_queue(integer)
  from public, anon, authenticated, service_role;
revoke execute on function private.staff_employer_lead_work_queue(integer)
  from public, anon, authenticated, service_role;
revoke execute on function private.staff_contact_enquiry_work_queue(integer)
  from public, anon, authenticated, service_role;
revoke execute on function private.staff_notification_exception_queue(integer)
  from public, anon, authenticated, service_role;

do $$
declare
  v_campaign text := 'migration-staff-work-queue-probe';
  v_service_id uuid;
  v_customer_id uuid;
  v_booking_id uuid;
  v_lead_id uuid;
  v_enquiry_id uuid;
  v_notification_id uuid;
begin
  begin
    select service.id into strict v_service_id
    from public.services as service
    where service.is_published
    order by service.display_order, service.id
    limit 1;

    insert into public.customers (
      first_name,
      surname,
      mobile_e164,
      email
    ) values (
      'Migration',
      'Work Queue Probe',
      '+27830000001',
      'staff-work-queue-booking@invalid.example'
    ) returning id into v_customer_id;

    insert into public.bookings (
      reference,
      idempotency_key,
      customer_id,
      service_id,
      preferred_date,
      preferred_time_period,
      patient_status,
      notes,
      status,
      confirmation_mode,
      marketing_context,
      request_fingerprint
    ) values (
      private.generate_reference('SPR'),
      extensions.gen_random_uuid(),
      v_customer_id,
      v_service_id,
      current_date + 7,
      'morning',
      'new',
      'Synthetic transaction-scoped staff queue verification',
      'pending',
      'staff',
      jsonb_build_object('utm_source', 'migration', 'utm_campaign', v_campaign),
      extensions.digest(v_campaign || '-booking', 'sha256')
    ) returning id into v_booking_id;

    insert into public.employer_leads (
      reference,
      idempotency_key,
      contact_name,
      company_name,
      work_email,
      phone_e164,
      employee_count_range,
      services_required,
      preferred_timeframe,
      delivery_mode,
      location,
      notes,
      status,
      marketing_context,
      request_fingerprint
    ) values (
      private.generate_reference('EMP'),
      extensions.gen_random_uuid(),
      'Migration Work Queue Probe',
      'Invalid Example Company',
      'staff-work-queue-employer@invalid.example',
      '+27830000002',
      '1-10',
      array['workplace-medicals'],
      'Synthetic test only',
      'practice',
      'Invalid example location',
      'Synthetic transaction-scoped staff queue verification',
      'new',
      jsonb_build_object('utm_source', 'migration', 'utm_campaign', v_campaign),
      extensions.digest(v_campaign || '-employer', 'sha256')
    ) returning id into v_lead_id;

    insert into public.contact_enquiries (
      reference,
      idempotency_key,
      name,
      email,
      phone_e164,
      enquiry_type,
      message,
      status,
      marketing_context,
      request_fingerprint
    ) values (
      private.generate_reference('ENQ'),
      extensions.gen_random_uuid(),
      'Migration Work Queue Probe',
      'staff-work-queue-enquiry@invalid.example',
      '+27830000003',
      'general',
      'Synthetic transaction-scoped staff queue verification',
      'new',
      jsonb_build_object('utm_source', 'migration', 'utm_campaign', v_campaign),
      extensions.digest(v_campaign || '-enquiry', 'sha256')
    ) returning id into v_enquiry_id;

    insert into public.notification_attempts (
      entity_type,
      entity_id,
      notification_kind,
      channel,
      recipient,
      status,
      attempt_count,
      next_attempt_at,
      last_attempt_at,
      last_error_code,
      last_error_message,
      last_http_status,
      deduplication_key
    ) values (
      'contact_enquiry',
      v_enquiry_id,
      'practice_contact_alert',
      'email',
      'staff-work-queue-notification@invalid.example',
      'failed',
      1,
      statement_timestamp() + interval '15 minutes',
      statement_timestamp(),
      'synthetic_probe',
      'Synthetic transaction-scoped staff queue verification',
      503,
      v_campaign
    ) returning id into v_notification_id;

    if not exists (
      select 1 from private.staff_booking_work_queue(200) as queue
      where queue.booking_id = v_booking_id
        and queue.utm_campaign = v_campaign
        and queue.action_required = 'Contact patient and assign an approved slot'
    ) then
      raise exception 'staff booking work queue contract probe failed';
    end if;

    if not exists (
      select 1 from private.staff_employer_lead_work_queue(200) as queue
      where queue.lead_id = v_lead_id
        and queue.utm_campaign = v_campaign
        and queue.action_required = 'Send the approved initial response'
    ) then
      raise exception 'staff employer lead work queue contract probe failed';
    end if;

    if not exists (
      select 1 from private.staff_contact_enquiry_work_queue(200) as queue
      where queue.enquiry_id = v_enquiry_id
        and queue.utm_campaign = v_campaign
        and queue.action_required = 'Review and contact the person'
    ) then
      raise exception 'staff contact enquiry work queue contract probe failed';
    end if;

    if not exists (
      select 1 from private.staff_notification_exception_queue(200) as queue
      where queue.notification_id = v_notification_id
        and queue.action_required = 'Review the provider error and retry schedule'
    ) then
      raise exception 'staff notification exception queue contract probe failed';
    end if;

    if not exists (
      select 1 from private.staff_operations_summary() as summary
      where summary.active_booking_count >= 1
        and summary.active_employer_lead_count >= 1
        and summary.active_contact_enquiry_count >= 1
        and summary.notification_exception_count >= 1
    ) then
      raise exception 'staff operations summary contract probe failed';
    end if;

    begin
      perform * from private.staff_booking_work_queue(0);
      raise exception 'zero staff work queue limit was accepted';
    exception when sqlstate '22023' then
      null;
    end;

    begin
      perform * from private.staff_booking_work_queue(201);
      raise exception 'oversized staff work queue limit was accepted';
    exception when sqlstate '22023' then
      null;
    end;

    raise exception using errcode = 'P0001', message = 'staff_work_queue_probe_rollback';
  exception when raise_exception then
    if sqlerrm <> 'staff_work_queue_probe_rollback' then
      raise;
    end if;
  end;

  if exists (
    select 1 from public.bookings
    where marketing_context->>'utm_campaign' = v_campaign
  ) or exists (
    select 1 from public.employer_leads
    where marketing_context->>'utm_campaign' = v_campaign
  ) or exists (
    select 1 from public.contact_enquiries
    where marketing_context->>'utm_campaign' = v_campaign
  ) or exists (
    select 1 from public.customers
    where email = 'staff-work-queue-booking@invalid.example'
  ) or exists (
    select 1 from public.notification_attempts
    where deduplication_key = v_campaign
  ) then
    raise exception 'staff work queue probe did not roll back synthetic records';
  end if;

  if has_function_privilege('anon', 'private.staff_operations_summary()', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.staff_operations_summary()', 'EXECUTE')
    or has_function_privilege('service_role', 'private.staff_operations_summary()', 'EXECUTE')
    or has_function_privilege('anon', 'private.staff_booking_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.staff_booking_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.staff_booking_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('anon', 'private.staff_employer_lead_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.staff_employer_lead_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.staff_employer_lead_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('anon', 'private.staff_contact_enquiry_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.staff_contact_enquiry_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.staff_contact_enquiry_work_queue(integer)', 'EXECUTE')
    or has_function_privilege('anon', 'private.staff_notification_exception_queue(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.staff_notification_exception_queue(integer)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.staff_notification_exception_queue(integer)', 'EXECUTE') then
    raise exception 'application roles must not execute private staff work queues';
  end if;

  if exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'staff_operations_summary',
        'staff_booking_work_queue',
        'staff_employer_lead_work_queue',
        'staff_contact_enquiry_work_queue',
        'staff_notification_exception_queue'
      )
      and procedure.prosecdef
  ) then
    raise exception 'private staff work queues must remain security invoker';
  end if;
end;
$$;

commit;
