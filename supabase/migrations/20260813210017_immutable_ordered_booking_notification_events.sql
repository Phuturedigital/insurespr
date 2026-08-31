begin;

alter table public.notification_attempts
  add column transition_sequence bigint,
  add column transition_snapshot jsonb;

alter table public.notification_attempts
  add constraint notification_attempts_transition_pair_check
  check (
    (transition_sequence is null and transition_snapshot is null)
    or (
      transition_sequence is not null
      and transition_snapshot is not null
      and transition_sequence > 0
      and jsonb_typeof(transition_snapshot) = 'object'
      and octet_length(transition_snapshot::text) <= 12000
      and coalesce(jsonb_typeof(transition_snapshot->'_delivery') = 'object', false)
      and coalesce(jsonb_typeof(transition_snapshot->'practice') = 'object', false)
      and coalesce(jsonb_typeof(transition_snapshot->'booking') = 'object', false)
      and coalesce(
        transition_snapshot #>> '{_delivery,to_status}'
          = transition_snapshot #>> '{booking,status}',
        false
      )
      and not coalesce(
        (transition_snapshot->'booking') ?| array[
          'notes', 'management_token', 'reschedule_reason', 'action_metadata'
        ],
        false
      )
      and case
        when transition_snapshot #>> '{_delivery,transition_sequence}' ~ '^[1-9][0-9]*$'
        then (transition_snapshot #>> '{_delivery,transition_sequence}')::numeric = transition_sequence
        else false
      end
    )
  );

alter table public.notification_attempts
  add constraint notification_attempts_queued_status_snapshot_check
  check (
    entity_type <> 'booking'
    or notification_kind not in (
      'patient_booking_confirmed',
      'patient_booking_cancelled',
      'patient_reschedule_acknowledgement',
      'practice_booking_action_alert'
    )
    or transition_snapshot is not null
    or status in ('sent', 'skipped', 'dead')
  ) not valid;

alter table public.notification_attempts
  add constraint notification_attempts_transition_kind_status_check
  check (
    transition_snapshot is null
    or entity_type <> 'booking'
    or case notification_kind
      when 'patient_booking_confirmed' then coalesce(
        transition_snapshot #>> '{booking,status}' in ('confirmed', 'rescheduled'), false
      )
      when 'patient_booking_cancelled' then coalesce(
        transition_snapshot #>> '{booking,status}' = 'cancelled', false
      )
      when 'patient_reschedule_acknowledgement' then coalesce(
        transition_snapshot #>> '{booking,status}' = 'reschedule_requested', false
      )
      when 'practice_booking_action_alert' then coalesce(
        transition_snapshot #>> '{booking,status}' in ('cancelled', 'reschedule_requested'), false
      )
      else true
    end
  );

alter table public.notification_attempts
  add constraint notification_attempts_patient_transition_minimisation_check
  check (
    transition_snapshot is null
    or notification_kind not in (
      'patient_booking_confirmed',
      'patient_booking_cancelled',
      'patient_reschedule_acknowledgement'
    )
    or not coalesce(
      (transition_snapshot->'booking') ?| array['surname', 'email', 'mobile'],
      false
    )
  );

create unique index notification_attempts_booking_transition_sequence_idx
  on public.notification_attempts(entity_id, transition_sequence)
  where entity_type = 'booking' and transition_sequence is not null;

create index notification_attempts_booking_transition_head_idx
  on public.notification_attempts(entity_id, channel, recipient, transition_sequence, next_attempt_at)
  where entity_type = 'booking'
    and transition_sequence is not null
    and status in ('pending', 'failed', 'processing');

comment on column public.notification_attempts.transition_sequence is
  'Monotonic delivery order for immutable booking-status notification events.';
comment on column public.notification_attempts.transition_snapshot is
  'Minimal event-time delivery context. Patient notes and management credentials are forbidden.';

-- Old unsent status rows were built from mutable current booking state. They
-- cannot be reconstructed faithfully, so supersede them instead of risking a
-- stale confirmation after a later cancellation or reschedule.
update public.notification_attempts
set
  status = 'skipped',
  locked_at = null,
  lock_expires_at = null,
  locked_by = null,
  last_error_code = 'superseded_missing_transition_snapshot',
  last_error_message = 'Superseded during immutable booking-notification activation.'
where entity_type = 'booking'
  and notification_kind in (
    'patient_booking_confirmed',
    'patient_booking_cancelled',
    'patient_reschedule_acknowledgement',
    'practice_booking_action_alert'
  )
  and status in ('pending', 'failed', 'processing')
  and transition_snapshot is null;

alter table public.notification_attempts
  validate constraint notification_attempts_queued_status_snapshot_check;

create or replace function private.prevent_notification_transition_rewrite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.transition_sequence is distinct from new.transition_sequence
    or old.transition_snapshot is distinct from new.transition_snapshot then
    raise exception 'notification transition snapshots are immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger notification_attempts_prevent_transition_rewrite
before update of transition_sequence, transition_snapshot
on public.notification_attempts
for each row execute function private.prevent_notification_transition_rewrite();

revoke execute on function private.prevent_notification_transition_rewrite()
  from public, anon, authenticated, service_role;

create or replace function public.queue_booking_status_notification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
  v_service public.services%rowtype;
  v_slot public.booking_slots%rowtype;
  v_settings public.practice_settings%rowtype;
  v_practice_email text;
  v_patient_kind text;
  v_actor text := nullif(current_setting('insurespr.actor', true), '');
  v_patient_event_key text := 'status:' || new.status || ':patient:' || extensions.gen_random_uuid()::text;
  v_practice_event_key text := 'status:' || new.status || ':practice:' || extensions.gen_random_uuid()::text;
  v_sequence bigint;
  v_practice jsonb;
  v_patient_booking jsonb;
  v_practice_booking jsonb;
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
  if v_patient_kind is null
    and not (v_actor = 'patient' and new.status in ('cancelled', 'reschedule_requested')) then
    return new;
  end if;

  select * into strict v_customer
  from public.customers where id = new.customer_id;
  select * into strict v_service
  from public.services where id = new.service_id;
  if new.slot_id is not null then
    select * into strict v_slot
    from public.booking_slots where id = new.slot_id;
  end if;
  select * into strict v_settings
  from public.practice_settings where id = 'primary';

  select coalesce(max(attempt.transition_sequence), 0) + 1
  into v_sequence
  from public.notification_attempts as attempt
  where attempt.entity_type = 'booking'
    and attempt.entity_id = new.id;

  v_practice := jsonb_build_object(
    'name', v_settings.practice_name,
    'address', concat_ws(', ', v_settings.address_line, v_settings.locality, v_settings.region),
    'phone', v_settings.phone_display,
    'email', v_settings.public_email,
    'timezone', v_settings.timezone
  );
  v_patient_booking := jsonb_build_object(
    'reference', new.reference,
    'first_name', v_customer.first_name,
    'service_name', v_service.name,
    'preferred_date', new.preferred_date,
    'preferred_time_period', new.preferred_time_period,
    'slot_starts_at', case when new.slot_id is null then null else v_slot.starts_at end,
    'status', new.status,
    'confirmation_mode', new.confirmation_mode,
    'created_at', new.created_at,
    'preparation_instructions', case
      when v_patient_kind = 'patient_booking_confirmed'
        and new.status in ('confirmed', 'rescheduled')
        and v_service.verification_status = 'verified'
        and nullif(btrim(v_service.preparation_instructions), '') is not null
      then btrim(v_service.preparation_instructions)
      else null
    end
  );

  if v_patient_kind is not null and v_customer.email is not null then
    insert into public.notification_attempts(
      entity_type, entity_id, notification_kind, recipient,
      deduplication_key, transition_sequence, transition_snapshot
    ) values (
      'booking', new.id, v_patient_kind, v_customer.email,
      v_patient_event_key, v_sequence,
      jsonb_build_object(
        '_delivery', jsonb_build_object(
          'transition_sequence', v_sequence,
          'transitioned_at', now(),
          'from_status', old.status,
          'to_status', new.status
        ),
        'practice', v_practice,
        'booking', v_patient_booking
      )
    );
    v_sequence := v_sequence + 1;
  end if;

  if v_actor = 'patient' and new.status in ('cancelled', 'reschedule_requested') then
    v_practice_email := v_settings.public_email;
    v_practice_booking := v_patient_booking || jsonb_build_object(
      'surname', v_customer.surname,
      'email', v_customer.email,
      'mobile', v_customer.mobile_e164,
      'preparation_instructions', null
    );
    if v_practice_email is not null then
      insert into public.notification_attempts(
        entity_type, entity_id, notification_kind, recipient,
        deduplication_key, transition_sequence, transition_snapshot
      ) values (
        'booking', new.id, 'practice_booking_action_alert', v_practice_email,
        v_practice_event_key, v_sequence,
        jsonb_build_object(
          '_delivery', jsonb_build_object(
            'transition_sequence', v_sequence,
            'transitioned_at', now(),
            'from_status', old.status,
            'to_status', new.status
          ),
          'practice', v_practice,
          'booking', v_practice_booking
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.queue_booking_status_notification()
  from public, anon, authenticated, service_role;

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
        (queued.status in ('pending', 'failed') and queued.next_attempt_at <= now())
        or (
          queued.status = 'processing'
          and queued.lock_expires_at is not null
          and queued.lock_expires_at <= now()
        )
      )
      and not exists (
        select 1
        from public.notification_attempts as earlier
        where earlier.entity_type = queued.entity_type
          and earlier.entity_id = queued.entity_id
          and earlier.channel = queued.channel
          and lower(earlier.recipient) = lower(queued.recipient)
          and earlier.status in ('pending', 'failed', 'processing')
          and earlier.attempt_count < 6
          and (
            (
              queued.entity_type = 'booking'
              and queued.transition_sequence is not null
              and (
                earlier.transition_sequence is null
                or earlier.transition_sequence < queued.transition_sequence
              )
            )
            or (
              (queued.entity_type <> 'booking' or queued.transition_sequence is null)
              and earlier.transition_sequence is null
              and (earlier.created_at, earlier.id) < (queued.created_at, queued.id)
            )
          )
      )
    order by queued.next_attempt_at, queued.created_at, queued.id
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
    case
      when claimed.transition_snapshot is not null then claimed.transition_snapshot
      when claimed.entity_type = 'booking' then (
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
            'preparation_instructions', null
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
      when claimed.entity_type = 'employer_lead' then (
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
      when claimed.entity_type = 'contact_enquiry' then (
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
  'Leases at most the head unresolved delivery per entity, channel and recipient; immutable booking-transition snapshots preserve event-time meaning and patient/practice streams do not block each other.';

revoke execute on function public.claim_notification_batch(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_batch(uuid, integer)
  to service_role;

do $contract$
declare
  v_booking_id uuid := extensions.gen_random_uuid();
  v_other_entity_id uuid := extensions.gen_random_uuid();
  v_worker_id uuid := extensions.gen_random_uuid();
  v_second_worker_id uuid := extensions.gen_random_uuid();
  v_confirm_id uuid;
  v_cancel_id uuid;
  v_practice_id uuid;
  v_other_id uuid;
  v_claim record;
  v_claimed_ids uuid[] := '{}'::uuid[];
  v_payload jsonb;
begin
  begin
    insert into public.notification_attempts(
      entity_type, entity_id, notification_kind, recipient,
      deduplication_key, status, next_attempt_at
    ) values (
      'booking', v_booking_id, 'practice_booking_alert',
      'practice-contract@example.invalid', 'contract-practice-initial',
      'failed', now() + interval '1 hour'
    ) returning id into v_practice_id;

    insert into public.notification_attempts(
      entity_type, entity_id, notification_kind, recipient,
      deduplication_key, transition_sequence, transition_snapshot
    ) values (
      'booking', v_booking_id, 'patient_booking_confirmed',
      'patient-contract@example.invalid', 'contract-patient-confirmed', 1,
      jsonb_build_object(
        '_delivery', jsonb_build_object(
          'transition_sequence', 1,
          'transitioned_at', now(),
          'from_status', 'pending',
          'to_status', 'confirmed'
        ),
        'practice', jsonb_build_object(
          'name', 'Contract practice',
          'address', 'Contract address',
          'phone', '000',
          'email', 'practice-contract@example.invalid',
          'timezone', 'Africa/Johannesburg'
        ),
        'booking', jsonb_build_object(
          'reference', 'CONTRACT-CONFIRM',
          'first_name', 'Contract',
          'service_name', 'Contract service',
          'preferred_date', '2099-01-01',
          'preferred_time_period', 'morning',
          'slot_starts_at', '2099-01-01T08:00:00Z',
          'status', 'confirmed',
          'confirmation_mode', 'staff',
          'created_at', now(),
          'preparation_instructions', null
        )
      )
    ) returning id into v_confirm_id;

    insert into public.notification_attempts(
      entity_type, entity_id, notification_kind, recipient,
      deduplication_key, transition_sequence, transition_snapshot
    ) values (
      'booking', v_booking_id, 'patient_booking_cancelled',
      'patient-contract@example.invalid', 'contract-patient-cancelled', 2,
      jsonb_build_object(
        '_delivery', jsonb_build_object(
          'transition_sequence', 2,
          'transitioned_at', now(),
          'from_status', 'confirmed',
          'to_status', 'cancelled'
        ),
        'practice', jsonb_build_object(
          'name', 'Contract practice',
          'address', 'Contract address',
          'phone', '000',
          'email', 'practice-contract@example.invalid',
          'timezone', 'Africa/Johannesburg'
        ),
        'booking', jsonb_build_object(
          'reference', 'CONTRACT-CANCEL',
          'first_name', 'Contract',
          'service_name', 'Contract service',
          'preferred_date', '2099-01-01',
          'preferred_time_period', 'morning',
          'slot_starts_at', '2099-01-01T08:00:00Z',
          'status', 'cancelled',
          'confirmation_mode', 'staff',
          'created_at', now(),
          'preparation_instructions', null
        )
      )
    ) returning id into v_cancel_id;

    insert into public.notification_attempts(
      entity_type, entity_id, notification_kind, recipient, deduplication_key
    ) values (
      'contact_enquiry', v_other_entity_id, 'contact_acknowledgement',
      'other-contract@example.invalid', 'contract-unrelated'
    ) returning id into v_other_id;

    for v_claim in
      select * from public.claim_notification_batch(v_worker_id, 10)
    loop
      v_claimed_ids := array_append(v_claimed_ids, v_claim.attempt_id);
      if v_claim.attempt_id = v_confirm_id then
        v_payload := v_claim.payload;
      end if;
      if not public.complete_notification_attempt(
        v_claim.attempt_id,
        v_worker_id,
        'contract-provider',
        'contract-' || v_claim.attempt_id::text
      ) then
        raise exception 'contract claim could not be completed';
      end if;
    end loop;

    if not (v_confirm_id = any(v_claimed_ids))
      or not (v_other_id = any(v_claimed_ids))
      or v_cancel_id = any(v_claimed_ids)
      or v_practice_id = any(v_claimed_ids) then
      raise exception 'head-of-line claim did not isolate recipient streams correctly';
    end if;
    if v_payload #>> '{booking,status}' <> 'confirmed'
      or v_payload #>> '{_delivery,transition_sequence}' <> '1' then
      raise exception 'claimed confirmation did not retain its immutable snapshot';
    end if;

    v_claimed_ids := '{}'::uuid[];
    v_payload := null;
    for v_claim in
      select * from public.claim_notification_batch(v_second_worker_id, 10)
    loop
      v_claimed_ids := array_append(v_claimed_ids, v_claim.attempt_id);
      if v_claim.attempt_id = v_cancel_id then
        v_payload := v_claim.payload;
      end if;
    end loop;

    if not (v_cancel_id = any(v_claimed_ids))
      or v_practice_id = any(v_claimed_ids)
      or v_payload #>> '{booking,status}' <> 'cancelled'
      or v_payload #>> '{_delivery,transition_sequence}' <> '2' then
      raise exception 'later patient transition was not released in sequence';
    end if;

    begin
      update public.notification_attempts
      set transition_snapshot = jsonb_set(
        transition_snapshot,
        '{booking,status}',
        '"rescheduled"'::jsonb
      )
      where id = v_confirm_id;
      raise exception 'immutable transition snapshot update was accepted';
    exception
      when sqlstate '22023' then null;
    end;

    begin
      insert into public.notification_attempts(
        entity_type, entity_id, notification_kind, recipient,
        deduplication_key, transition_sequence, transition_snapshot
      ) values (
        'booking', extensions.gen_random_uuid(), 'patient_booking_confirmed',
        'invalid-contract@example.invalid', 'contract-invalid-private', 1,
        jsonb_build_object(
          '_delivery', jsonb_build_object(
            'transition_sequence', 1,
            'to_status', 'confirmed'
          ),
          'practice', '{}'::jsonb,
          'booking', jsonb_build_object(
            'status', 'confirmed',
            'notes', 'must not enter a delivery snapshot'
          )
        )
      );
      raise exception 'private booking notes were accepted in a transition snapshot';
    exception
      when check_violation then null;
    end;

    begin
      insert into public.notification_attempts(
        entity_type, entity_id, notification_kind, recipient,
        deduplication_key, transition_sequence, transition_snapshot
      ) values (
        'booking', extensions.gen_random_uuid(), 'patient_booking_confirmed',
        'invalid-pair@example.invalid', 'contract-invalid-pair', null,
        jsonb_build_object(
          '_delivery', jsonb_build_object(
            'transition_sequence', 1,
            'to_status', 'confirmed'
          ),
          'practice', '{}'::jsonb,
          'booking', jsonb_build_object('status', 'confirmed')
        )
      );
      raise exception 'a transition snapshot without a sequence was accepted';
    exception
      when check_violation then null;
    end;

    if has_function_privilege('anon', 'public.claim_notification_batch(uuid, integer)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.claim_notification_batch(uuid, integer)', 'EXECUTE')
      or not has_function_privilege('service_role', 'public.claim_notification_batch(uuid, integer)', 'EXECUTE')
      or has_function_privilege('service_role', 'public.queue_booking_status_notification()', 'EXECUTE')
      or has_function_privilege('service_role', 'private.prevent_notification_transition_rewrite()', 'EXECUTE') then
      raise exception 'notification function ACL contract is not least privilege';
    end if;

    raise exception 'rollback immutable notification contract' using errcode = 'TST01';
  exception
    when sqlstate 'TST01' then null;
  end;
end;
$contract$;

commit;
