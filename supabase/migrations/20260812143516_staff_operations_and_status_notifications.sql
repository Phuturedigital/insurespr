begin;

alter table public.notification_attempts
  add column deduplication_key text not null default 'initial'
  check (char_length(deduplication_key) between 1 and 160);

alter table public.notification_attempts
  drop constraint if exists notification_attempts_entity_type_entity_id_notification_ki_key;

alter table public.notification_attempts
  add constraint notification_attempts_delivery_dedupe_key
  unique (entity_type, entity_id, notification_kind, channel, deduplication_key);

alter table public.notification_attempts
  drop constraint if exists notification_attempts_notification_kind_check;

alter table public.notification_attempts
  add constraint notification_attempts_notification_kind_check
  check (
    notification_kind in (
      'patient_booking_acknowledgement',
      'practice_booking_alert',
      'patient_booking_confirmed',
      'patient_booking_cancelled',
      'patient_reschedule_acknowledgement',
      'practice_booking_action_alert',
      'employer_acknowledgement',
      'practice_employer_alert',
      'contact_acknowledgement',
      'practice_contact_alert'
    )
  );

drop index if exists public.bookings_one_active_booking_per_slot_idx;
create unique index bookings_one_active_booking_per_slot_idx
  on public.bookings(slot_id)
  where slot_id is not null
    and status in ('pending', 'confirmed', 'reschedule_requested', 'rescheduled');

create table public.operational_audit_log (
  id bigint generated always as identity primary key,
  actor_identifier text not null check (char_length(actor_identifier) between 3 and 200),
  action text not null check (char_length(action) between 3 and 120),
  entity_type text not null check (
    entity_type in ('booking', 'employer_lead', 'contact_enquiry', 'notification_attempt')
  ),
  entity_id uuid not null,
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb check (jsonb_typeof(after_state) = 'object'),
  reason text check (reason is null or char_length(reason) between 3 and 1000),
  created_at timestamptz not null default now()
);

create index operational_audit_log_entity_created_idx
  on public.operational_audit_log(entity_type, entity_id, created_at desc);
create index operational_audit_log_actor_created_idx
  on public.operational_audit_log(actor_identifier, created_at desc);

alter table public.operational_audit_log enable row level security;

create policy operational_audit_log_deny_browser_access
on public.operational_audit_log
for all
to anon, authenticated
using (false)
with check (false);

revoke all on public.operational_audit_log from public, anon, authenticated;
grant select, insert on public.operational_audit_log to service_role;
grant usage, select on sequence public.operational_audit_log_id_seq to service_role;

create or replace function public.queue_booking_status_notification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_email text;
  v_practice_email text;
  v_patient_kind text;
  v_actor text := nullif(current_setting('insurespr.actor', true), '');
  v_event_key text := 'status:' || new.status || ':' || extensions.gen_random_uuid()::text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_patient_kind := case
    when new.status in ('confirmed', 'rescheduled') then 'patient_booking_confirmed'
    when new.status = 'cancelled' then 'patient_booking_cancelled'
    when new.status = 'reschedule_requested' then 'patient_reschedule_acknowledgement'
    else null
  end;

  if v_patient_kind is not null then
    select customer.email
    into v_customer_email
    from public.customers as customer
    where customer.id = new.customer_id;

    if v_customer_email is not null then
      insert into public.notification_attempts(
        entity_type,
        entity_id,
        notification_kind,
        recipient,
        deduplication_key
      ) values (
        'booking',
        new.id,
        v_patient_kind,
        v_customer_email,
        v_event_key
      );
    end if;
  end if;

  if v_actor = 'patient' and new.status in ('cancelled', 'reschedule_requested') then
    select settings.public_email
    into v_practice_email
    from public.practice_settings as settings
    where settings.id = 'primary';

    if v_practice_email is not null then
      insert into public.notification_attempts(
        entity_type,
        entity_id,
        notification_kind,
        recipient,
        deduplication_key
      ) values (
        'booking',
        new.id,
        'practice_booking_action_alert',
        v_practice_email,
        v_event_key
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger bookings_queue_status_notification
after update of status on public.bookings
for each row execute function public.queue_booking_status_notification();

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

  if v_booking.status not in ('pending', 'reschedule_requested', 'rescheduled') then
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

  perform set_config('insurespr.actor', 'staff', true);

  update public.bookings
  set
    slot_id = v_slot.id,
    preferred_date = (v_slot.starts_at at time zone 'Africa/Johannesburg')::date,
    status = 'confirmed',
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
    'booking.confirm',
    'booking',
    v_booking.id,
    jsonb_build_object('status', v_booking.status, 'slot_id', v_booking.slot_id),
    jsonb_build_object('status', 'confirmed', 'slot_id', v_slot.id),
    v_reason
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'reference', v_booking.reference,
    'status', 'confirmed',
    'slot_id', v_slot.id,
    'starts_at', v_slot.starts_at
  );
end;
$$;

create or replace function public.staff_close_booking(
  p_booking_id uuid,
  p_new_status text,
  p_actor_identifier text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_actor text := btrim(coalesce(p_actor_identifier, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_booking_id is null
    or p_new_status is null
    or p_new_status not in ('completed', 'cancelled', 'no_show')
    or char_length(v_actor) not between 3 and 200
    or char_length(v_reason) not between 3 and 1000 then
    raise exception 'invalid staff booking closure parameters' using errcode = '22023';
  end if;

  begin
    select * into strict v_booking
    from public.bookings
    where id = p_booking_id
    for update;
  exception when no_data_found then
    raise exception 'booking not found' using errcode = 'P0002';
  end;

  if not (
    (v_booking.status = 'pending' and p_new_status = 'cancelled')
    or (v_booking.status in ('confirmed', 'rescheduled') and p_new_status in ('completed', 'cancelled', 'no_show'))
    or (v_booking.status = 'reschedule_requested' and p_new_status = 'cancelled')
  ) then
    raise exception 'invalid booking status transition' using errcode = '22023';
  end if;

  perform set_config('insurespr.actor', 'staff', true);

  update public.bookings
  set
    status = p_new_status,
    cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
    completed_at = case when p_new_status = 'completed' then now() else completed_at end
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
    'booking.' || p_new_status,
    'booking',
    v_booking.id,
    jsonb_build_object('status', v_booking.status, 'slot_id', v_booking.slot_id),
    jsonb_build_object('status', p_new_status, 'slot_id', v_booking.slot_id),
    v_reason
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'reference', v_booking.reference,
    'status', p_new_status
  );
end;
$$;

create or replace function public.staff_update_employer_lead_status(
  p_lead_id uuid,
  p_new_status text,
  p_actor_identifier text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.employer_leads%rowtype;
  v_actor text := btrim(coalesce(p_actor_identifier, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_lead_id is null
    or p_new_status is null
    or p_new_status not in ('contacted', 'qualified', 'won', 'lost', 'spam')
    or char_length(v_actor) not between 3 and 200
    or (v_reason is not null and char_length(v_reason) not between 3 and 1000)
    or (p_new_status in ('lost', 'spam') and v_reason is null) then
    raise exception 'invalid employer lead update parameters' using errcode = '22023';
  end if;

  begin
    select * into strict v_lead
    from public.employer_leads
    where id = p_lead_id
    for update;
  exception when no_data_found then
    raise exception 'employer lead not found' using errcode = 'P0002';
  end;

  if p_new_status = v_lead.status or not (
    (v_lead.status = 'new' and p_new_status in ('contacted', 'qualified', 'lost', 'spam'))
    or (v_lead.status = 'contacted' and p_new_status in ('qualified', 'won', 'lost', 'spam'))
    or (v_lead.status = 'qualified' and p_new_status in ('contacted', 'won', 'lost'))
  ) then
    raise exception 'invalid employer lead status transition' using errcode = '22023';
  end if;

  update public.employer_leads set status = p_new_status where id = v_lead.id;

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
    'employer_lead.' || p_new_status,
    'employer_lead',
    v_lead.id,
    jsonb_build_object('status', v_lead.status),
    jsonb_build_object('status', p_new_status),
    v_reason
  );

  return jsonb_build_object(
    'lead_id', v_lead.id,
    'reference', v_lead.reference,
    'status', p_new_status
  );
end;
$$;

create or replace function public.staff_update_contact_enquiry_status(
  p_enquiry_id uuid,
  p_new_status text,
  p_actor_identifier text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enquiry public.contact_enquiries%rowtype;
  v_actor text := btrim(coalesce(p_actor_identifier, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_enquiry_id is null
    or p_new_status is null
    or p_new_status not in ('contacted', 'resolved', 'spam')
    or char_length(v_actor) not between 3 and 200
    or (v_reason is not null and char_length(v_reason) not between 3 and 1000)
    or (p_new_status = 'spam' and v_reason is null) then
    raise exception 'invalid contact enquiry update parameters' using errcode = '22023';
  end if;

  begin
    select * into strict v_enquiry
    from public.contact_enquiries
    where id = p_enquiry_id
    for update;
  exception when no_data_found then
    raise exception 'contact enquiry not found' using errcode = 'P0002';
  end;

  if p_new_status = v_enquiry.status or not (
    (v_enquiry.status = 'new' and p_new_status in ('contacted', 'resolved', 'spam'))
    or (v_enquiry.status = 'contacted' and p_new_status in ('resolved', 'spam'))
  ) then
    raise exception 'invalid contact enquiry status transition' using errcode = '22023';
  end if;

  update public.contact_enquiries set status = p_new_status where id = v_enquiry.id;

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
    'contact_enquiry.' || p_new_status,
    'contact_enquiry',
    v_enquiry.id,
    jsonb_build_object('status', v_enquiry.status),
    jsonb_build_object('status', p_new_status),
    v_reason
  );

  return jsonb_build_object(
    'enquiry_id', v_enquiry.id,
    'reference', v_enquiry.reference,
    'status', p_new_status
  );
end;
$$;

create or replace function public.staff_requeue_notification(
  p_attempt_id uuid,
  p_actor_identifier text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.notification_attempts%rowtype;
  v_actor text := btrim(coalesce(p_actor_identifier, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_attempt_id is null
    or char_length(v_actor) not between 3 and 200
    or char_length(v_reason) not between 3 and 1000 then
    raise exception 'invalid notification requeue parameters' using errcode = '22023';
  end if;

  begin
    select * into strict v_attempt
    from public.notification_attempts
    where id = p_attempt_id
    for update;
  exception when no_data_found then
    raise exception 'notification attempt not found' using errcode = 'P0002';
  end;

  if v_attempt.status not in ('failed', 'dead', 'skipped') then
    raise exception 'notification cannot be requeued from its current status' using errcode = '22023';
  end if;

  update public.notification_attempts
  set
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = now(),
    locked_at = null,
    lock_expires_at = null,
    locked_by = null,
    provider = null,
    provider_message_id = null,
    sent_at = null,
    dead_at = null,
    last_error_code = null,
    last_error_message = null,
    last_http_status = null
  where id = v_attempt.id;

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
    'notification.requeue',
    'notification_attempt',
    v_attempt.id,
    jsonb_build_object(
      'status', v_attempt.status,
      'attempt_count', v_attempt.attempt_count,
      'error_code', v_attempt.last_error_code
    ),
    jsonb_build_object('status', 'pending', 'attempt_count', 0),
    v_reason
  );

  return jsonb_build_object('attempt_id', v_attempt.id, 'status', 'pending');
end;
$$;

comment on table public.operational_audit_log is
  'Append-only staff-operation audit events. States intentionally contain workflow metadata, not full PII records.';
comment on function public.staff_confirm_booking(uuid, uuid, text, text) is
  'Assigns an available service-matched slot and confirms a pending booking with an audit event.';
comment on function public.staff_close_booking(uuid, text, text, text) is
  'Completes, cancels, or marks a confirmed booking as no-show using validated transitions.';
comment on function public.staff_requeue_notification(uuid, text, text) is
  'Requeues a terminal or failed notification after an explicit staff review and audit reason.';

revoke execute on function public.staff_confirm_booking(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.staff_close_booking(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.staff_update_employer_lead_status(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.staff_update_contact_enquiry_status(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.staff_requeue_notification(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.queue_booking_status_notification()
  from public, anon, authenticated;

grant execute on function public.staff_confirm_booking(uuid, uuid, text, text) to service_role;
grant execute on function public.staff_close_booking(uuid, text, text, text) to service_role;
grant execute on function public.staff_update_employer_lead_status(uuid, text, text, text) to service_role;
grant execute on function public.staff_update_contact_enquiry_status(uuid, text, text, text) to service_role;
grant execute on function public.staff_requeue_notification(uuid, text, text) to service_role;

do $$
declare
  v_contact_id constant uuid := '1e806adc-124b-41ed-b4f2-38457fbc5ceb';
  v_attempt_id constant uuid := 'f6b832c1-3456-42ce-96ec-4028589f19ef';
  v_worker_id constant uuid := '9929b86e-41b2-4f94-95cf-165990d4d4f7';
  v_claimed_id uuid;
  v_attempt_count integer;
  v_payload jsonb;
  v_ok boolean;
  v_status text;
begin
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
    v_contact_id,
    'ENQ-QUEUE-MIGRATION-TEST',
    '33837217-8f83-475d-906c-01b2ee8f6e75',
    'Migration Queue Test',
    'queue-migration@example.invalid',
    'general',
    'Synthetic transactional queue assertion.',
    'new'
  );

  insert into public.notification_attempts(
    id,
    entity_type,
    entity_id,
    notification_kind,
    recipient,
    next_attempt_at,
    deduplication_key
  ) values (
    v_attempt_id,
    'contact_enquiry',
    v_contact_id,
    'contact_acknowledgement',
    'queue-migration@example.invalid',
    '-infinity',
    'migration-verification'
  );

  select claim.attempt_id, claim.attempt_count, claim.payload
  into v_claimed_id, v_attempt_count, v_payload
  from public.claim_notification_batch(v_worker_id, 1) as claim;

  if v_claimed_id <> v_attempt_id
    or v_attempt_count <> 1
    or v_payload->'enquiry'->>'reference' <> 'ENQ-QUEUE-MIGRATION-TEST' then
    raise exception 'notification claim assertion failed';
  end if;

  v_ok := public.fail_notification_attempt(
    v_attempt_id,
    v_worker_id,
    'migration_retry',
    'Synthetic retry assertion.',
    true,
    'test-provider',
    503
  );
  if not v_ok then
    raise exception 'notification retry assertion failed';
  end if;

  update public.notification_attempts
  set next_attempt_at = '-infinity'
  where id = v_attempt_id;

  select claim.attempt_id, claim.attempt_count
  into v_claimed_id, v_attempt_count
  from public.claim_notification_batch(v_worker_id, 1) as claim;

  if v_claimed_id <> v_attempt_id or v_attempt_count <> 2 then
    raise exception 'notification reclaim assertion failed';
  end if;

  v_ok := public.complete_notification_attempt(
    v_attempt_id,
    v_worker_id,
    'test-provider',
    'migration-message-id'
  );
  if not v_ok then
    raise exception 'notification completion assertion failed';
  end if;

  select attempt.status
  into v_status
  from public.notification_attempts as attempt
  where attempt.id = v_attempt_id
    and attempt.attempt_count = 2
    and attempt.sent_at is not null
    and attempt.locked_by is null;

  if v_status <> 'sent' then
    raise exception 'notification sent-state assertion failed';
  end if;

  delete from public.notification_attempts where id = v_attempt_id;
  delete from public.contact_enquiries where id = v_contact_id;
end;
$$;

commit;
