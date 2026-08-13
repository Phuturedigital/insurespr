begin;

-- Idempotency replays must prove that the caller is replaying the same
-- effective booking request before a fresh management credential is issued.
-- The fingerprint deliberately models the values persisted by create_booking:
-- for a slot booking the slot UUID is canonical and free-form date/period
-- fields are ignored, exactly as they are on the original insert.
create or replace function private.booking_request_fingerprint(
  p_first_name text,
  p_surname text,
  p_mobile_e164 text,
  p_email text,
  p_service_id uuid,
  p_slot_id uuid,
  p_preferred_date date,
  p_preferred_time_period text,
  p_patient_status text,
  p_notes text,
  p_marketing_context jsonb,
  p_privacy_version text
)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $$
  select extensions.digest(
    jsonb_build_object(
      'first_name', p_first_name,
      'surname', p_surname,
      'mobile_e164', p_mobile_e164,
      'email', p_email,
      'service_id', p_service_id,
      'slot_id', p_slot_id,
      'preferred_date', case when p_slot_id is null then p_preferred_date else null end,
      'preferred_time_period', case when p_slot_id is null then p_preferred_time_period else null end,
      'patient_status', p_patient_status,
      'notes', p_notes,
      'marketing_context', coalesce(p_marketing_context, '{}'::jsonb),
      'privacy_version', p_privacy_version
    )::text,
    'sha256'
  );
$$;

comment on function private.booking_request_fingerprint(
  text, text, text, text, uuid, uuid, date, text, text, text, jsonb, text
) is
  'Builds the canonical SHA-256 fingerprint used to bind a booking idempotency key to one effective request.';

revoke execute on function private.booking_request_fingerprint(
  text, text, text, text, uuid, uuid, date, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function private.booking_request_fingerprint(
  text, text, text, text, uuid, uuid, date, text, text, text, jsonb, text
) to service_role;

alter table public.bookings
  add column request_fingerprint bytea;

-- Backfill defensively for installations that already have bookings. The live
-- production project is empty at this release, but the migration remains safe
-- for a populated preview or restored database.
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
  coalesce(
    (
      select consent.policy_version
      from public.consent_records as consent
      where consent.entity_type = 'booking'
        and consent.entity_id = booking.id
        and consent.consent_type = 'privacy_notice'
        and consent.granted
      order by consent.recorded_at desc, consent.id desc
      limit 1
    ),
    'legacy-unknown'
  )
)
from public.customers as customer
where customer.id = booking.customer_id;

alter table public.bookings
  alter column request_fingerprint set not null,
  add constraint bookings_request_fingerprint_sha256_check
    check (octet_length(request_fingerprint) = 32);

comment on column public.bookings.request_fingerprint is
  'Canonical SHA-256 of the effective booking request. Used only to validate an idempotent replay before rotating its management token.';

create or replace function public.list_available_slots(
  p_service_id uuid,
  p_from timestamptz,
  p_until timestamptz
)
returns table (
  slot_id uuid,
  service_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select slot.id, slot.service_id, slot.starts_at, slot.ends_at
  from public.booking_slots as slot
  where slot.service_id = p_service_id
    and slot.status = 'open'
    and slot.starts_at >= greatest(p_from, now())
    and slot.starts_at < p_until
    and not exists (
      select 1
      from public.bookings as booking
      where booking.slot_id = slot.id
        and booking.status in ('pending', 'confirmed', 'reschedule_requested', 'rescheduled')
    )
  order by slot.starts_at
  limit 200;
$$;

create or replace function public.create_booking(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_idempotency uuid;
  v_service_id uuid;
  v_existing public.bookings%rowtype;
  v_service public.services%rowtype;
  v_slot public.booking_slots%rowtype;
  v_customer_id uuid;
  v_booking_id uuid;
  v_reference text;
  v_status text;
  v_manage_token text;
  v_first_name text := btrim(coalesce(p_payload->>'first_name', ''));
  v_surname text := btrim(coalesce(p_payload->>'surname', ''));
  v_mobile text := btrim(coalesce(p_payload->>'mobile_e164', ''));
  v_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_patient_status text := p_payload->>'patient_status';
  v_notes text := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
  v_slot_id uuid;
  v_preferred_date date;
  v_preferred_period text;
  v_privacy_version text;
  v_ip_hash text := nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), '');
  v_marketing_context jsonb;
  v_request_fingerprint bytea;
  v_replay_privacy_version text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid booking payload' using errcode = '22023';
  end if;

  select nullif(btrim(settings.privacy_notice_version), '')
  into v_privacy_version
  from public.practice_settings as settings
  where settings.id = 'primary';

  if v_privacy_version is null then
    raise exception 'privacy notice version is not configured' using errcode = '55000';
  end if;

  begin
    v_idempotency := (p_payload->>'idempotency_key')::uuid;
  exception when others then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end;

  begin
    v_service_id := (p_payload->>'service_id')::uuid;
  exception when others then
    raise exception 'service is unavailable' using errcode = '22023';
  end;

  if nullif(p_payload->>'slot_id', '') is not null then
    begin
      v_slot_id := (p_payload->>'slot_id')::uuid;
    exception when others then
      raise exception 'selected slot is unavailable' using errcode = 'P0002';
    end;
  else
    begin
      v_preferred_date := (p_payload->>'preferred_date')::date;
    exception when others then
      raise exception 'preferred date is required' using errcode = '22023';
    end;
    v_preferred_period := coalesce(nullif(p_payload->>'preferred_time_period', ''), 'any');
  end if;

  if char_length(v_first_name) not between 1 and 80
    or char_length(v_surname) not between 1 and 80
    or v_mobile !~ '^\+[1-9][0-9]{7,14}$'
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or v_patient_status not in ('new', 'returning')
    or char_length(v_privacy_version) not between 1 and 80
    or p_payload->'privacy_accepted' is distinct from 'true'::jsonb
    or (v_notes is not null and char_length(v_notes) > 1000)
    or (
      v_slot_id is null
      and (
        v_preferred_date < (now() at time zone 'Africa/Johannesburg')::date
        or v_preferred_period not in ('morning', 'afternoon', 'any')
      )
    ) then
    raise exception 'invalid booking details' using errcode = '22023';
  end if;

  v_marketing_context := private.safe_marketing_context(
    coalesce(p_payload->'marketing', '{}'::jsonb)
  );
  v_request_fingerprint := private.booking_request_fingerprint(
    v_first_name,
    v_surname,
    v_mobile,
    v_email,
    v_service_id,
    v_slot_id,
    v_preferred_date,
    v_preferred_period,
    v_patient_status,
    v_notes,
    v_marketing_context,
    v_privacy_version
  );

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260812));

  select *
  into v_existing
  from public.bookings
  where idempotency_key = v_idempotency;

  if found then
    select consent.policy_version
    into v_replay_privacy_version
    from public.consent_records as consent
    where consent.entity_type = 'booking'
      and consent.entity_id = v_existing.id
      and consent.consent_type = 'privacy_notice'
      and consent.granted
    order by consent.recorded_at desc, consent.id desc
    limit 1;

    -- A policy update after the original request must not make an otherwise
    -- identical retry unrecoverable. Compare the replay against the policy
    -- version actually consented to on the existing booking.
    v_request_fingerprint := private.booking_request_fingerprint(
      v_first_name,
      v_surname,
      v_mobile,
      v_email,
      v_service_id,
      v_slot_id,
      v_preferred_date,
      v_preferred_period,
      v_patient_status,
      v_notes,
      v_marketing_context,
      coalesce(v_replay_privacy_version, v_privacy_version)
    );

    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency key was reused with different booking details'
        using errcode = '22023';
    end if;

    if v_existing.created_at + interval '90 days' <= now() then
      raise exception 'booking replay recovery window has expired'
        using errcode = '22023';
    end if;

    -- Only a hash is persisted, so the original credential cannot be replayed
    -- to the browser. Revoke every prior live credential and issue one fresh
    -- 256-bit token after the fingerprint comparison succeeds. Tokens are
    -- locked before the booking row, matching manage_booking's lock order and
    -- avoiding a replay-versus-management deadlock.
    update public.booking_management_tokens
    set revoked_at = coalesce(revoked_at, now())
    where booking_id = v_existing.id
      and revoked_at is null;

    v_manage_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.booking_management_tokens(booking_id, token_hash, expires_at)
    values (
      v_existing.id,
      extensions.digest(v_manage_token, 'sha256'),
      v_existing.created_at + interval '90 days'
    );

    select booking.* into strict v_existing
    from public.bookings as booking
    where booking.id = v_existing.id
    for update;

    select * into strict v_service
    from public.services
    where id = v_existing.service_id;

    if v_existing.slot_id is not null then
      select * into strict v_slot
      from public.booking_slots
      where id = v_existing.slot_id;
    end if;

    return jsonb_build_object(
      'booking_id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'confirmation_mode', v_existing.confirmation_mode,
      'service_name', v_service.name,
      'slot_start', v_slot.starts_at,
      'preferred_date', v_existing.preferred_date,
      'preferred_time_period', v_existing.preferred_time_period,
      'management_token', v_manage_token,
      'idempotent', true
    );
  end if;

  begin
    select * into strict v_service
    from public.services
    where id = v_service_id
      and is_published;
  exception when no_data_found then
    raise exception 'service is unavailable' using errcode = '22023';
  end;

  if v_service.booking_mode = 'quote' then
    raise exception 'service requires an employer quote' using errcode = '22023';
  end if;

  if v_slot_id is not null then
    begin
      select * into strict v_slot
      from public.booking_slots
      where id = v_slot_id
      for update;
    exception when no_data_found then
      raise exception 'selected slot is unavailable' using errcode = 'P0002';
    end;

    if v_slot.service_id <> v_service.id
      or v_slot.status <> 'open'
      or v_slot.starts_at <= now()
      or exists (
        select 1
        from public.bookings as booking
        where booking.slot_id = v_slot.id
          and booking.status in ('pending', 'confirmed', 'reschedule_requested', 'rescheduled')
      ) then
      raise exception 'selected slot is unavailable' using errcode = 'P0002';
    end if;
  end if;

  insert into public.customers(first_name, surname, mobile_e164, email)
  values (v_first_name, v_surname, v_mobile, v_email)
  returning id into v_customer_id;

  v_reference := private.generate_reference('SPR');
  v_status := case
    when v_slot_id is not null and v_service.confirmation_mode = 'instant' then 'confirmed'
    else 'pending'
  end;

  perform set_config('insurespr.actor', 'system', true);

  insert into public.bookings(
    reference,
    idempotency_key,
    customer_id,
    service_id,
    slot_id,
    preferred_date,
    preferred_time_period,
    patient_status,
    notes,
    status,
    confirmation_mode,
    marketing_context,
    request_fingerprint
  ) values (
    v_reference,
    v_idempotency,
    v_customer_id,
    v_service.id,
    v_slot_id,
    coalesce(v_preferred_date, (v_slot.starts_at at time zone 'Africa/Johannesburg')::date),
    v_preferred_period,
    v_patient_status,
    v_notes,
    v_status,
    v_service.confirmation_mode,
    v_marketing_context,
    v_request_fingerprint
  ) returning id into v_booking_id;

  v_manage_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.booking_management_tokens(booking_id, token_hash, expires_at)
  values (v_booking_id, extensions.digest(v_manage_token, 'sha256'), now() + interval '90 days');

  insert into public.consent_records(
    entity_type,
    entity_id,
    consent_type,
    policy_version,
    granted,
    ip_hash
  ) values (
    'booking',
    v_booking_id,
    'privacy_notice',
    v_privacy_version,
    true,
    v_ip_hash
  );

  insert into public.notification_attempts(
    entity_type,
    entity_id,
    notification_kind,
    recipient
  ) values
    ('booking', v_booking_id, 'patient_booking_acknowledgement', v_email),
    (
      'booking',
      v_booking_id,
      'practice_booking_alert',
      (select public_email from public.practice_settings where id = 'primary')
    );

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'reference', v_reference,
    'status', v_status,
    'confirmation_mode', v_service.confirmation_mode,
    'service_name', v_service.name,
    'slot_start', v_slot.starts_at,
    'preferred_date', coalesce(
      v_preferred_date,
      (v_slot.starts_at at time zone 'Africa/Johannesburg')::date
    ),
    'preferred_time_period', v_preferred_period,
    'management_token', v_manage_token,
    'idempotent', false
  );
end;
$$;

comment on function public.create_booking(jsonb) is
  'Atomically creates a booking or, for a matching idempotent replay, returns the complete current projection with a safely rotated management token.';

create or replace function public.manage_booking(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token public.booking_management_tokens%rowtype;
  v_booking public.bookings%rowtype;
  v_action text := p_payload->>'action';
  v_raw_token text := btrim(coalesce(p_payload->>'token', ''));
  v_preferred_date date;
  v_preferred_period text;
begin
  if char_length(v_raw_token) <> 64
    or v_action not in ('cancel', 'request_reschedule') then
    raise exception 'invalid booking action' using errcode = '22023';
  end if;

  select * into strict v_token
  from public.booking_management_tokens
  where token_hash = extensions.digest(v_raw_token, 'sha256')
    and revoked_at is null
    and expires_at > now()
  for update;

  select * into strict v_booking
  from public.bookings
  where id = v_token.booking_id
  for update;

  if v_booking.status not in ('pending', 'confirmed', 'reschedule_requested', 'rescheduled') then
    raise exception 'booking can no longer be changed online' using errcode = '22023';
  end if;

  perform set_config('insurespr.actor', 'patient', true);

  if v_action = 'cancel' then
    insert into public.booking_actions(booking_id, action, note)
    values (
      v_booking.id,
      'cancel',
      left(nullif(p_payload->>'note', ''), 500)
    );

    update public.bookings
    set status = 'cancelled', cancelled_at = now()
    where id = v_booking.id;
  else
    begin
      v_preferred_date := (p_payload->>'preferred_date')::date;
    exception when others then
      raise exception 'preferred date is required' using errcode = '22023';
    end;
    v_preferred_period := coalesce(
      nullif(p_payload->>'preferred_time_period', ''),
      'any'
    );
    if v_preferred_date < (now() at time zone 'Africa/Johannesburg')::date
      or v_preferred_period not in ('morning', 'afternoon', 'any') then
      raise exception 'invalid preferred appointment time' using errcode = '22023';
    end if;

    insert into public.booking_actions(
      booking_id,
      action,
      preferred_date,
      preferred_time_period,
      note
    ) values (
      v_booking.id,
      'request_reschedule',
      v_preferred_date,
      v_preferred_period,
      left(nullif(p_payload->>'note', ''), 500)
    );

    update public.bookings
    set status = 'reschedule_requested'
    where id = v_booking.id;
  end if;

  update public.booking_management_tokens
  set last_used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'reference', v_booking.reference,
    'status', case
      when v_action = 'cancel' then 'cancelled'
      else 'reschedule_requested'
    end
  );
exception when no_data_found then
  raise exception 'invalid or expired booking link' using errcode = '22023';
end;
$$;

comment on function public.manage_booking(jsonb) is
  'Allows a valid management token to cancel or request another time for pending, confirmed, reschedule-requested, or rescheduled bookings.';

-- Transactional contract assertions. Synthetic rows are removed before this
-- migration commits, so the checks exercise real constraints/triggers without
-- leaving customer, queue, analytics, or audit data behind.
do $$
declare
  v_category_id uuid := extensions.gen_random_uuid();
  v_service_id uuid := extensions.gen_random_uuid();
  v_slot_id uuid := extensions.gen_random_uuid();
  v_idempotency uuid := extensions.gen_random_uuid();
  v_conflict_idempotency uuid := extensions.gen_random_uuid();
  v_booking_id uuid;
  v_customer_id uuid;
  v_payload jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_managed jsonb;
  v_first_token text;
  v_replay_token text;
  v_count integer;
begin
  insert into public.service_categories(
    id,
    slug,
    name,
    audience,
    summary,
    primary_cta,
    display_order,
    is_published
  ) values (
    v_category_id,
    'booking-contract-category',
    'Booking contract category',
    'individual',
    'Synthetic migration assertion; removed before commit.',
    'book',
    9998,
    true
  );

  insert into public.services(
    id,
    category_id,
    slug,
    name,
    short_description,
    audience,
    booking_mode,
    confirmation_mode,
    appointment_duration_minutes,
    price_type,
    verification_status,
    display_order,
    is_published
  ) values (
    v_service_id,
    v_category_id,
    'booking-contract-service',
    'Booking contract service',
    'Synthetic migration assertion; removed before commit.',
    'individual',
    'appointment',
    'instant',
    30,
    'unpublished',
    'verified',
    9998,
    true
  );

  insert into public.booking_slots(
    id,
    service_id,
    starts_at,
    ends_at,
    status,
    internal_note
  ) values (
    v_slot_id,
    v_service_id,
    date_trunc('minute', now()) + interval '7 days',
    date_trunc('minute', now()) + interval '7 days 30 minutes',
    'open',
    'Synthetic migration assertion; removed before commit.'
  );

  v_payload := jsonb_build_object(
    'idempotency_key', v_idempotency,
    'first_name', 'Replay',
    'surname', 'Contract',
    'mobile_e164', '+27820000001',
    'email', 'booking-replay-contract@example.invalid',
    'service_id', v_service_id,
    'slot_id', v_slot_id,
    'patient_status', 'new',
    'notes', 'Canonical replay assertion.',
    'privacy_accepted', true,
    'privacy_version', 'caller-version-is-ignored',
    'ip_hash', repeat('a', 64),
    'marketing', jsonb_build_object(
      'utm_source', 'migration-contract',
      'landing_path', '/booking-contract'
    )
  );

  v_first := public.create_booking(v_payload);
  v_booking_id := (v_first->>'booking_id')::uuid;
  v_first_token := v_first->>'management_token';

  select booking.customer_id
  into strict v_customer_id
  from public.bookings as booking
  where booking.id = v_booking_id;

  perform set_config('insurespr.actor', 'staff', true);
  update public.bookings
  set status = 'rescheduled'
  where id = v_booking_id;

  v_replay := public.create_booking(v_payload);
  v_replay_token := v_replay->>'management_token';

  if coalesce((v_replay->>'idempotent')::boolean, false) is not true
    or v_replay->>'booking_id' <> v_booking_id::text
    or v_replay->>'reference' is null
    or v_replay->>'status' <> 'rescheduled'
    or v_replay->>'confirmation_mode' <> 'instant'
    or v_replay->>'service_name' <> 'Booking contract service'
    or v_replay->>'slot_start' is null
    or v_replay->>'preferred_date' is null
    or not (v_replay ? 'preferred_time_period')
    or char_length(coalesce(v_replay_token, '')) <> 64
    or v_replay_token = v_first_token then
    raise exception 'booking idempotent replay projection assertion failed';
  end if;

  select count(*)
  into v_count
  from public.booking_management_tokens as token
  where token.booking_id = v_booking_id
    and token.revoked_at is null
    and token.expires_at > now();

  if v_count <> 1
    or not exists (
      select 1
      from public.booking_management_tokens as token
      where token.booking_id = v_booking_id
        and token.token_hash = extensions.digest(v_first_token, 'sha256')
        and token.revoked_at is not null
    )
    or not exists (
      select 1
      from public.booking_management_tokens as token
      where token.booking_id = v_booking_id
        and token.token_hash = extensions.digest(v_replay_token, 'sha256')
        and token.revoked_at is null
    ) then
    raise exception 'booking management token rotation assertion failed';
  end if;

  begin
    perform public.create_booking(
      v_payload || jsonb_build_object('surname', 'Different')
    );
    raise exception 'idempotency payload mismatch assertion failed';
  exception when sqlstate '22023' then
    null;
  end;

  if not exists (
    select 1
    from public.booking_management_tokens as token
    where token.booking_id = v_booking_id
      and token.token_hash = extensions.digest(v_replay_token, 'sha256')
      and token.revoked_at is null
  ) then
    raise exception 'payload mismatch rotated a valid management token';
  end if;

  select count(*)
  into v_count
  from public.list_available_slots(
    v_service_id,
    now(),
    now() + interval '14 days'
  ) as available
  where available.slot_id = v_slot_id;

  if v_count <> 0 then
    raise exception 'rescheduled slot availability assertion failed';
  end if;

  begin
    perform public.create_booking(
      v_payload || jsonb_build_object(
        'idempotency_key', v_conflict_idempotency,
        'first_name', 'Conflict',
        'email', 'booking-conflict-contract@example.invalid'
      )
    );
    raise exception 'rescheduled slot create assertion failed';
  exception when sqlstate 'P0002' then
    null;
  end;

  v_managed := public.manage_booking(jsonb_build_object(
    'token', v_replay_token,
    'action', 'request_reschedule',
    'preferred_date', ((now() at time zone 'Africa/Johannesburg')::date + 14),
    'preferred_time_period', 'morning',
    'note', 'Synthetic reschedule management assertion.'
  ));

  if v_managed->>'status' <> 'reschedule_requested' then
    raise exception 'rescheduled booking change assertion failed';
  end if;

  perform set_config('insurespr.actor', 'staff', true);
  update public.bookings
  set status = 'rescheduled'
  where id = v_booking_id;

  v_managed := public.manage_booking(jsonb_build_object(
    'token', v_replay_token,
    'action', 'cancel',
    'note', 'Synthetic cancellation management assertion.'
  ));

  if v_managed->>'status' <> 'cancelled' then
    raise exception 'rescheduled booking cancellation assertion failed';
  end if;

  delete from public.operational_audit_log
  where entity_type = 'booking'
    and entity_id = v_booking_id;
  delete from public.notification_attempts
  where entity_type = 'booking'
    and entity_id = v_booking_id;
  delete from public.consent_records
  where entity_type = 'booking'
    and entity_id = v_booking_id;
  delete from public.booking_actions where booking_id = v_booking_id;
  delete from public.booking_status_history where booking_id = v_booking_id;
  delete from public.booking_management_tokens where booking_id = v_booking_id;
  delete from public.bookings where id = v_booking_id;
  delete from public.customers where id = v_customer_id;
  delete from public.booking_slots where id = v_slot_id;
  delete from public.services where id = v_service_id;
  delete from public.service_categories where id = v_category_id;
end;
$$;

commit;
