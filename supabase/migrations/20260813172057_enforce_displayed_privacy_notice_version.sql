begin;

-- A consent record must preserve the exact approved privacy-notice version
-- displayed to the person.  Locking the settings row closes the race where a
-- policy publication could otherwise occur between validation and insertion.
create or replace function private.assign_current_privacy_policy_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy_version text;
begin
  select settings.privacy_notice_version
  into v_policy_version
  from public.practice_settings as settings
  where settings.id = 'primary'
  for share;

  if char_length(coalesce(v_policy_version, '')) not between 1 and 80
    or v_policy_version is distinct from btrim(v_policy_version)
    or position('pending' in lower(v_policy_version)) > 0 then
    raise exception 'privacy notice version is not approved'
      using errcode = '55000';
  end if;

  if new.policy_version is distinct from v_policy_version then
    raise exception 'displayed privacy notice changed'
      using errcode = 'PVP01';
  end if;

  new.policy_version := v_policy_version;
  return new;
end;
$$;

comment on function private.assign_current_privacy_policy_version() is
  'Requires a new consent record to carry the exact approved privacy-notice version displayed to the person, with the settings row share-locked against concurrent publication.';

revoke execute on function private.assign_current_privacy_policy_version()
  from public, anon, authenticated, service_role;

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
  v_submitted_privacy_version text := coalesce(p_payload->>'privacy_version', '');
  v_current_privacy_version text;
  v_replay_privacy_version text;
  v_ip_hash text := nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), '');
  v_marketing_context jsonb;
  v_request_fingerprint bytea;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid booking payload' using errcode = '22023';
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
    or char_length(v_submitted_privacy_version) not between 1 and 80
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
    v_first_name, v_surname, v_mobile, v_email, v_service_id, v_slot_id,
    v_preferred_date, v_preferred_period, v_patient_status, v_notes,
    v_marketing_context, v_submitted_privacy_version
  );

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260812));

  select *
  into v_existing
  from public.bookings
  where idempotency_key = v_idempotency;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency key was reused with different booking details'
        using errcode = '22023';
    end if;

    select consent.policy_version
    into v_replay_privacy_version
    from public.consent_records as consent
    where consent.entity_type = 'booking'
      and consent.entity_id = v_existing.id
      and consent.consent_type = 'privacy_notice'
      and consent.granted
    order by consent.recorded_at desc, consent.id desc
    limit 1;

    if v_replay_privacy_version is null
      or v_submitted_privacy_version is distinct from v_replay_privacy_version then
      raise exception 'displayed privacy notice changed'
        using errcode = 'PVP01';
    end if;

    if v_existing.created_at + interval '90 days' <= now() then
      raise exception 'booking replay recovery window has expired'
        using errcode = '22023';
    end if;

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

  select settings.privacy_notice_version
  into v_current_privacy_version
  from public.practice_settings as settings
  where settings.id = 'primary'
  for share;

  if char_length(coalesce(v_current_privacy_version, '')) not between 1 and 80
    or v_current_privacy_version is distinct from btrim(v_current_privacy_version)
    or position('pending' in lower(v_current_privacy_version)) > 0 then
    raise exception 'privacy notice version is not approved'
      using errcode = '55000';
  end if;

  if v_submitted_privacy_version is distinct from v_current_privacy_version then
    raise exception 'displayed privacy notice changed'
      using errcode = 'PVP01';
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
    reference, idempotency_key, customer_id, service_id, slot_id,
    preferred_date, preferred_time_period, patient_status, notes, status,
    confirmation_mode, marketing_context, request_fingerprint
  ) values (
    v_reference, v_idempotency, v_customer_id, v_service.id, v_slot_id,
    coalesce(v_preferred_date, (v_slot.starts_at at time zone 'Africa/Johannesburg')::date),
    v_preferred_period, v_patient_status, v_notes, v_status,
    v_service.confirmation_mode, v_marketing_context, v_request_fingerprint
  ) returning id into v_booking_id;

  v_manage_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.booking_management_tokens(booking_id, token_hash, expires_at)
  values (v_booking_id, extensions.digest(v_manage_token, 'sha256'), now() + interval '90 days');

  insert into public.consent_records(
    entity_type, entity_id, consent_type, policy_version, granted, ip_hash
  ) values (
    'booking', v_booking_id, 'privacy_notice', v_submitted_privacy_version, true, v_ip_hash
  );

  insert into public.notification_attempts(
    entity_type, entity_id, notification_kind, recipient
  ) values
    ('booking', v_booking_id, 'patient_booking_acknowledgement', v_email),
    (
      'booking', v_booking_id, 'practice_booking_alert',
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
  'Atomically creates a booking only for the exact displayed approved privacy-notice version, or replays an existing matching request against its stored consent and safely rotates the management token.';

revoke execute on function public.create_booking(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to service_role;

create or replace function public.create_employer_lead(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_idempotency uuid;
  v_existing public.employer_leads%rowtype;
  v_id uuid;
  v_reference text;
  v_name text;
  v_company text;
  v_email text;
  v_phone text;
  v_employee_count_range text;
  v_services text[];
  v_preferred_timeframe text;
  v_delivery_mode text;
  v_location text;
  v_notes text;
  v_marketing_context jsonb;
  v_submitted_privacy_version text := coalesce(p_payload->>'privacy_version', '');
  v_current_privacy_version text;
  v_replay_privacy_version text;
  v_request_fingerprint bytea;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid employer enquiry payload' using errcode = '22023';
  end if;

  begin
    v_idempotency := (p_payload->>'idempotency_key')::uuid;
  exception when others then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end;

  if jsonb_typeof(coalesce(p_payload->'services_required', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid employer enquiry details' using errcode = '22023';
  end if;

  v_name := btrim(coalesce(p_payload->>'contact_name', ''));
  v_company := btrim(coalesce(p_payload->>'company_name', ''));
  v_email := lower(btrim(coalesce(p_payload->>'work_email', '')));
  v_phone := btrim(coalesce(p_payload->>'phone_e164', ''));
  v_employee_count_range := coalesce(
    nullif(left(btrim(coalesce(p_payload->>'employee_count_range', '')), 80), ''),
    'Not specified'
  );
  v_preferred_timeframe := left(
    nullif(btrim(coalesce(p_payload->>'preferred_timeframe', '')), ''), 200
  );
  v_delivery_mode := nullif(btrim(coalesce(p_payload->>'delivery_mode', '')), '');
  v_location := left(nullif(btrim(coalesce(p_payload->>'location', '')), ''), 300);
  v_notes := left(nullif(btrim(coalesce(p_payload->>'notes', '')), ''), 2000);

  select coalesce(array_agg(normalized.service order by normalized.service), array[]::text[])
  into v_services
  from (
    select distinct left(btrim(item.value), 120) as service
    from jsonb_array_elements_text(
      coalesce(p_payload->'services_required', '[]'::jsonb)
    ) as item(value)
    where nullif(btrim(item.value), '') is not null
  ) as normalized;

  if char_length(v_name) not between 1 and 160
    or char_length(v_company) not between 1 and 200
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or v_phone !~ '^\+[1-9][0-9]{7,14}$'
    or cardinality(v_services) not between 1 and 20
    or char_length(v_submitted_privacy_version) not between 1 and 80
    or (
      v_delivery_mode is not null
      and v_delivery_mode not in ('on_site', 'practice', 'either', 'needs_advice')
    )
    or p_payload->'privacy_accepted' is distinct from 'true'::jsonb then
    raise exception 'invalid employer enquiry details' using errcode = '22023';
  end if;

  v_marketing_context := private.safe_marketing_context(
    coalesce(p_payload->'marketing', '{}'::jsonb)
  );
  v_request_fingerprint := private.employer_lead_request_fingerprint(
    v_name, v_company, v_email, v_phone, v_employee_count_range, v_services,
    v_preferred_timeframe, v_delivery_mode, v_location, v_notes,
    v_marketing_context, v_submitted_privacy_version
  );

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260813));

  select *
  into v_existing
  from public.employer_leads
  where idempotency_key = v_idempotency;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency key was reused with different employer enquiry details'
        using errcode = '22023';
    end if;

    select consent.policy_version
    into v_replay_privacy_version
    from public.consent_records as consent
    where consent.entity_type = 'employer_lead'
      and consent.entity_id = v_existing.id
      and consent.consent_type = 'privacy_notice'
      and consent.granted
    order by consent.recorded_at desc, consent.id desc
    limit 1;

    if v_replay_privacy_version is null
      or v_submitted_privacy_version is distinct from v_replay_privacy_version then
      raise exception 'displayed privacy notice changed'
        using errcode = 'PVP01';
    end if;

    return jsonb_build_object(
      'lead_id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  select settings.privacy_notice_version
  into v_current_privacy_version
  from public.practice_settings as settings
  where settings.id = 'primary'
  for share;

  if char_length(coalesce(v_current_privacy_version, '')) not between 1 and 80
    or v_current_privacy_version is distinct from btrim(v_current_privacy_version)
    or position('pending' in lower(v_current_privacy_version)) > 0 then
    raise exception 'privacy notice version is not approved'
      using errcode = '55000';
  end if;

  if v_submitted_privacy_version is distinct from v_current_privacy_version then
    raise exception 'displayed privacy notice changed'
      using errcode = 'PVP01';
  end if;

  v_reference := private.generate_reference('B2B');
  insert into public.employer_leads(
    reference, idempotency_key, contact_name, company_name, work_email,
    phone_e164, employee_count_range, services_required, preferred_timeframe,
    delivery_mode, location, notes, marketing_context, request_fingerprint
  ) values (
    v_reference, v_idempotency, v_name, v_company, v_email,
    v_phone, v_employee_count_range, v_services, v_preferred_timeframe,
    v_delivery_mode, v_location, v_notes, v_marketing_context, v_request_fingerprint
  ) returning id into v_id;

  insert into public.consent_records(
    entity_type, entity_id, consent_type, policy_version, granted, ip_hash
  ) values (
    'employer_lead', v_id, 'privacy_notice', v_submitted_privacy_version, true,
    nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), '')
  );

  insert into public.notification_attempts(
    entity_type, entity_id, notification_kind, recipient
  ) values
    ('employer_lead', v_id, 'employer_acknowledgement', v_email),
    (
      'employer_lead', v_id, 'practice_employer_alert',
      (select public_email from public.practice_settings where id = 'primary')
    );

  return jsonb_build_object(
    'lead_id', v_id,
    'reference', v_reference,
    'status', 'new',
    'idempotent', false
  );
end;
$$;

comment on function public.create_employer_lead(jsonb) is
  'Creates an employer lead only for the exact displayed approved privacy-notice version; matching idempotent replays are bound to the stored consent version.';

revoke execute on function public.create_employer_lead(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_employer_lead(jsonb) to service_role;

create or replace function public.create_contact_enquiry(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_idempotency uuid;
  v_existing public.contact_enquiries%rowtype;
  v_id uuid;
  v_reference text;
  v_name text;
  v_email text;
  v_phone text;
  v_message text;
  v_type text;
  v_marketing_context jsonb;
  v_submitted_privacy_version text := coalesce(p_payload->>'privacy_version', '');
  v_current_privacy_version text;
  v_replay_privacy_version text;
  v_request_fingerprint bytea;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid contact enquiry payload' using errcode = '22023';
  end if;

  begin
    v_idempotency := (p_payload->>'idempotency_key')::uuid;
  exception when others then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end;

  v_name := btrim(coalesce(p_payload->>'name', ''));
  v_email := lower(btrim(coalesce(p_payload->>'email', '')));
  v_phone := nullif(btrim(coalesce(p_payload->>'phone_e164', '')), '');
  v_message := btrim(coalesce(p_payload->>'message', ''));
  v_type := coalesce(nullif(btrim(coalesce(p_payload->>'enquiry_type', '')), ''), 'general');

  if char_length(v_name) not between 1 and 160
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$')
    or char_length(v_message) not between 5 and 2000
    or v_type not in ('individual', 'scanning', 'referral', 'general')
    or char_length(v_submitted_privacy_version) not between 1 and 80
    or p_payload->'privacy_accepted' is distinct from 'true'::jsonb then
    raise exception 'invalid contact enquiry details' using errcode = '22023';
  end if;

  v_marketing_context := private.safe_marketing_context(
    coalesce(p_payload->'marketing', '{}'::jsonb)
  );
  v_request_fingerprint := private.contact_enquiry_request_fingerprint(
    v_name, v_email, v_phone, v_type, v_message, v_marketing_context,
    v_submitted_privacy_version
  );

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260814));

  select *
  into v_existing
  from public.contact_enquiries
  where idempotency_key = v_idempotency;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency key was reused with different contact enquiry details'
        using errcode = '22023';
    end if;

    select consent.policy_version
    into v_replay_privacy_version
    from public.consent_records as consent
    where consent.entity_type = 'contact_enquiry'
      and consent.entity_id = v_existing.id
      and consent.consent_type = 'privacy_notice'
      and consent.granted
    order by consent.recorded_at desc, consent.id desc
    limit 1;

    if v_replay_privacy_version is null
      or v_submitted_privacy_version is distinct from v_replay_privacy_version then
      raise exception 'displayed privacy notice changed'
        using errcode = 'PVP01';
    end if;

    return jsonb_build_object(
      'enquiry_id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  select settings.privacy_notice_version
  into v_current_privacy_version
  from public.practice_settings as settings
  where settings.id = 'primary'
  for share;

  if char_length(coalesce(v_current_privacy_version, '')) not between 1 and 80
    or v_current_privacy_version is distinct from btrim(v_current_privacy_version)
    or position('pending' in lower(v_current_privacy_version)) > 0 then
    raise exception 'privacy notice version is not approved'
      using errcode = '55000';
  end if;

  if v_submitted_privacy_version is distinct from v_current_privacy_version then
    raise exception 'displayed privacy notice changed'
      using errcode = 'PVP01';
  end if;

  v_reference := private.generate_reference('ENQ');
  insert into public.contact_enquiries(
    reference, idempotency_key, name, email, phone_e164, enquiry_type,
    message, marketing_context, request_fingerprint
  ) values (
    v_reference, v_idempotency, v_name, v_email, v_phone, v_type,
    v_message, v_marketing_context, v_request_fingerprint
  ) returning id into v_id;

  insert into public.consent_records(
    entity_type, entity_id, consent_type, policy_version, granted, ip_hash
  ) values (
    'contact_enquiry', v_id, 'privacy_notice', v_submitted_privacy_version,
    true, nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), '')
  );

  insert into public.notification_attempts(
    entity_type, entity_id, notification_kind, recipient
  ) values
    ('contact_enquiry', v_id, 'contact_acknowledgement', v_email),
    (
      'contact_enquiry', v_id, 'practice_contact_alert',
      (select public_email from public.practice_settings where id = 'primary')
    );

  return jsonb_build_object(
    'enquiry_id', v_id,
    'reference', v_reference,
    'status', 'new',
    'idempotent', false
  );
end;
$$;

comment on function public.create_contact_enquiry(jsonb) is
  'Creates a contact enquiry only for the exact displayed approved privacy-notice version; matching idempotent replays are bound to the stored consent version.';

revoke execute on function public.create_contact_enquiry(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_contact_enquiry(jsonb) to service_role;

-- Exercise all three RPC contracts inside a deliberately rolled-back
-- subtransaction. Any unexpected exception escapes and aborts the migration;
-- the success sentinel rolls back every synthetic row and settings change.
do $$
declare
  v_policy_a text := 'migration-contract-privacy-a';
  v_policy_b text := 'migration-contract-privacy-b';
  v_booking_key uuid := extensions.gen_random_uuid();
  v_lead_key uuid := extensions.gen_random_uuid();
  v_contact_key uuid := extensions.gen_random_uuid();
  v_service_id uuid;
  v_booking_payload jsonb;
  v_lead_payload jsonb;
  v_contact_payload jsonb;
  v_result jsonb;
  v_booking_id uuid;
  v_lead_id uuid;
  v_contact_id uuid;
  v_first_manage_token text;
  v_replay_manage_token text;
  v_before_count bigint;
  v_after_count bigint;
begin
  begin
    select service.id
    into strict v_service_id
    from public.services as service
    where service.is_published
      and service.booking_mode <> 'quote'
    order by service.display_order, service.id
    limit 1;

    update public.practice_settings
    set privacy_notice_version = v_policy_a
    where id = 'primary';

    v_booking_payload := jsonb_build_object(
      'idempotency_key', v_booking_key,
      'first_name', 'Privacy',
      'surname', 'Booking Contract',
      'mobile_e164', '+27820000101',
      'email', 'privacy-booking@example.invalid',
      'service_id', v_service_id,
      'preferred_date', (now() at time zone 'Africa/Johannesburg')::date + 7,
      'preferred_time_period', 'morning',
      'patient_status', 'new',
      'notes', 'Migration contract assertion.',
      'privacy_accepted', true,
      'privacy_version', v_policy_a,
      'marketing', '{}'::jsonb
    );
    v_lead_payload := jsonb_build_object(
      'idempotency_key', v_lead_key,
      'contact_name', 'Privacy Lead Contract',
      'company_name', 'Migration Contract Company',
      'work_email', 'privacy-lead@example.invalid',
      'phone_e164', '+27820000102',
      'employee_count_range', '11-50',
      'services_required', jsonb_build_array('Staff x-rays'),
      'preferred_timeframe', 'Within one month',
      'delivery_mode', 'practice',
      'location', 'Randburg',
      'notes', 'Migration contract assertion.',
      'privacy_accepted', true,
      'privacy_version', v_policy_a,
      'marketing', '{}'::jsonb
    );
    v_contact_payload := jsonb_build_object(
      'idempotency_key', v_contact_key,
      'name', 'Privacy Contact Contract',
      'email', 'privacy-contact@example.invalid',
      'phone_e164', '+27820000103',
      'enquiry_type', 'general',
      'message', 'Migration contract assertion message.',
      'privacy_accepted', true,
      'privacy_version', v_policy_a,
      'marketing', '{}'::jsonb
    );

    v_result := public.create_booking(v_booking_payload);
    v_booking_id := (v_result->>'booking_id')::uuid;
    v_first_manage_token := v_result->>'management_token';
    if coalesce((v_result->>'idempotent')::boolean, true) then
      raise exception 'booking new-write privacy contract failed';
    end if;

    v_result := public.create_employer_lead(v_lead_payload);
    v_lead_id := (v_result->>'lead_id')::uuid;
    if coalesce((v_result->>'idempotent')::boolean, true) then
      raise exception 'employer new-write privacy contract failed';
    end if;

    v_result := public.create_contact_enquiry(v_contact_payload);
    v_contact_id := (v_result->>'enquiry_id')::uuid;
    if coalesce((v_result->>'idempotent')::boolean, true) then
      raise exception 'contact new-write privacy contract failed';
    end if;

    if (
      select count(*)
      from public.consent_records
      where (entity_type, entity_id) in (
        ('booking', v_booking_id),
        ('employer_lead', v_lead_id),
        ('contact_enquiry', v_contact_id)
      )
        and consent_type = 'privacy_notice'
        and granted
        and policy_version = v_policy_a
    ) <> 3 then
      raise exception 'stored displayed privacy-version contract failed';
    end if;

    update public.practice_settings
    set privacy_notice_version = v_policy_b
    where id = 'primary';

    v_result := public.create_booking(v_booking_payload);
    v_replay_manage_token := v_result->>'management_token';
    if (v_result->>'booking_id')::uuid <> v_booking_id
      or not coalesce((v_result->>'idempotent')::boolean, false)
      or char_length(coalesce(v_first_manage_token, '')) <> 64
      or char_length(coalesce(v_replay_manage_token, '')) <> 64
      or v_replay_manage_token = v_first_manage_token then
      raise exception 'booking replay across policy publication failed';
    end if;

    if (
      select count(*)
      from public.booking_management_tokens
      where booking_id = v_booking_id
        and revoked_at is null
    ) <> 1 then
      raise exception 'booking replay token-rotation contract failed';
    end if;
    v_result := public.create_employer_lead(v_lead_payload);
    if (v_result->>'lead_id')::uuid <> v_lead_id
      or not coalesce((v_result->>'idempotent')::boolean, false) then
      raise exception 'employer replay across policy publication failed';
    end if;
    v_result := public.create_contact_enquiry(v_contact_payload);
    if (v_result->>'enquiry_id')::uuid <> v_contact_id
      or not coalesce((v_result->>'idempotent')::boolean, false) then
      raise exception 'contact replay across policy publication failed';
    end if;

    select count(*)
    into v_before_count
    from public.notification_attempts
    where (entity_type, entity_id) in (
      ('booking', v_booking_id),
      ('employer_lead', v_lead_id),
      ('contact_enquiry', v_contact_id)
    );

    if v_before_count <> 6
      or (
        select count(*)
        from public.consent_records
        where (entity_type, entity_id) in (
          ('booking', v_booking_id),
          ('employer_lead', v_lead_id),
          ('contact_enquiry', v_contact_id)
        )
          and consent_type = 'privacy_notice'
          and granted
      ) <> 3 then
      raise exception 'privacy replay duplicated consent or notification work';
    end if;

    begin
      perform public.create_booking(
        v_booking_payload || jsonb_build_object('privacy_version', v_policy_b)
      );
      raise exception 'booking replay accepted a different displayed privacy version';
    exception when sqlstate 'PVP01' then
      null;
    end;
    begin
      perform public.create_employer_lead(
        v_lead_payload || jsonb_build_object('privacy_version', v_policy_b)
      );
      raise exception 'employer replay accepted a different displayed privacy version';
    exception when sqlstate 'PVP01' then
      null;
    end;
    begin
      perform public.create_contact_enquiry(
        v_contact_payload || jsonb_build_object('privacy_version', v_policy_b)
      );
      raise exception 'contact replay accepted a different displayed privacy version';
    exception when sqlstate 'PVP01' then
      null;
    end;

    select count(*)
    into v_after_count
    from public.notification_attempts
    where (entity_type, entity_id) in (
      ('booking', v_booking_id),
      ('employer_lead', v_lead_id),
      ('contact_enquiry', v_contact_id)
    );
    if v_after_count <> v_before_count then
      raise exception 'privacy mismatch changed notification state';
    end if;

    begin
      perform public.create_booking(
        v_booking_payload || jsonb_build_object(
          'idempotency_key', extensions.gen_random_uuid(),
          'privacy_version', v_policy_a
        )
      );
      raise exception 'new booking accepted a stale displayed privacy version';
    exception when sqlstate 'PVP01' then
      null;
    end;
    begin
      perform public.create_employer_lead(
        v_lead_payload || jsonb_build_object(
          'idempotency_key', extensions.gen_random_uuid(),
          'privacy_version', v_policy_a
        )
      );
      raise exception 'new employer lead accepted a stale displayed privacy version';
    exception when sqlstate 'PVP01' then
      null;
    end;
    begin
      perform public.create_contact_enquiry(
        v_contact_payload || jsonb_build_object(
          'idempotency_key', extensions.gen_random_uuid(),
          'privacy_version', v_policy_a
        )
      );
      raise exception 'new contact enquiry accepted a stale displayed privacy version';
    exception when sqlstate 'PVP01' then
      null;
    end;

    update public.practice_settings
    set privacy_notice_version = 'pending-migration-contract'
    where id = 'primary';

    begin
      perform public.create_contact_enquiry(
        v_contact_payload || jsonb_build_object(
          'idempotency_key', extensions.gen_random_uuid(),
          'privacy_version', 'pending-migration-contract'
        )
      );
      raise exception 'new contact enquiry accepted a pending privacy notice';
    exception when sqlstate '55000' then
      null;
    end;

    -- A matching replay is bound to its stored consent, not to later settings.
    v_result := public.create_contact_enquiry(v_contact_payload);
    if (v_result->>'enquiry_id')::uuid <> v_contact_id
      or not coalesce((v_result->>'idempotent')::boolean, false) then
      raise exception 'contact replay failed while the current policy was pending';
    end if;

    raise exception 'rollback successful privacy migration assertions'
      using errcode = 'TST01';
  exception when sqlstate 'TST01' then
    null;
  end;

  if has_function_privilege('anon', 'public.create_booking(jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.create_booking(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.create_employer_lead(jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.create_employer_lead(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.create_contact_enquiry(jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.create_contact_enquiry(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'private.assign_current_privacy_policy_version()', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.assign_current_privacy_policy_version()', 'EXECUTE')
    or has_function_privilege('service_role', 'private.assign_current_privacy_policy_version()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.create_booking(jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.create_employer_lead(jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.create_contact_enquiry(jsonb)', 'EXECUTE') then
    raise exception 'strict privacy function ACL contract failed';
  end if;
end;
$$;

commit;
