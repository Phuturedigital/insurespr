begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create extension if not exists pgcrypto with schema extensions;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create table public.practice_settings (
  id text primary key default 'primary' check (id = 'primary'),
  practice_name text not null,
  descriptor text not null,
  address_line text not null,
  locality text not null,
  region text not null,
  country_code text not null default 'ZA' check (country_code ~ '^[A-Z]{2}$'),
  phone_display text not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_e164 text not null check (whatsapp_e164 ~ '^[1-9][0-9]{7,14}$'),
  public_email text not null check (public_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  timezone text not null default 'Africa/Johannesburg',
  opening_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(opening_hours) = 'object'),
  maps_url text not null,
  privacy_notice_version text not null default 'pending-approval',
  data_retention_policy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  audience text not null check (audience in ('individual', 'workforce', 'scanning')),
  summary text not null,
  primary_cta text not null check (primary_cta in ('book', 'walk_in', 'whatsapp', 'call', 'request_quote')),
  display_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default extensions.gen_random_uuid(),
  category_id uuid not null references public.service_categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  short_description text not null,
  audience text not null check (audience in ('individual', 'workforce', 'scanning')),
  booking_mode text not null check (booking_mode in ('walk_in', 'appointment', 'request', 'quote')),
  confirmation_mode text not null default 'staff' check (confirmation_mode in ('instant', 'staff')),
  appointment_duration_minutes integer check (appointment_duration_minutes between 5 and 480),
  price_type text not null default 'unpublished' check (price_type in ('fixed', 'from', 'range', 'quote', 'unpublished')),
  cash_price_cents integer check (cash_price_cents >= 0),
  cash_price_max_cents integer check (cash_price_max_cents >= cash_price_cents),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  price_note text,
  medical_aid_status text,
  referral_requirement text,
  appointment_requirement text,
  what_to_bring text,
  expected_duration text,
  results_process text,
  preparation_instructions text,
  source_url text,
  verification_status text not null default 'needs_confirmation'
    check (verification_status in ('verified', 'needs_confirmation', 'unverified')),
  display_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (price_type in ('fixed', 'from', 'range') and cash_price_cents is not null)
    or (price_type in ('quote', 'unpublished') and cash_price_cents is null)
  ),
  check (booking_mode <> 'appointment' or confirmation_mode in ('instant', 'staff'))
);

create table public.availability_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  timezone text not null default 'Africa/Johannesburg',
  slot_duration_minutes integer not null check (slot_duration_minutes between 5 and 480),
  is_active boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, weekday, starts_at, ends_at),
  check (ends_at > starts_at),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table public.availability_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  service_id uuid references public.services(id) on delete cascade,
  exception_date date not null,
  starts_at time,
  ends_at time,
  is_available boolean not null default false,
  internal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and ends_at > starts_at))
);

create table public.booking_slots (
  id uuid primary key default extensions.gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'blocked', 'cancelled')),
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, starts_at),
  check (ends_at > starts_at)
);

create index booking_slots_service_starts_at_idx
  on public.booking_slots(service_id, starts_at)
  where status = 'open';

create table public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 80),
  surname text not null check (char_length(surname) between 1 and 80),
  mobile_e164 text not null check (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text not null check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.bookings (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null unique,
  idempotency_key uuid not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  slot_id uuid references public.booking_slots(id) on delete restrict,
  preferred_date date,
  preferred_time_period text check (preferred_time_period in ('morning', 'afternoon', 'any')),
  patient_status text not null check (patient_status in ('new', 'returning')),
  notes text check (char_length(notes) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'reschedule_requested', 'rescheduled')),
  confirmation_mode text not null check (confirmation_mode in ('instant', 'staff')),
  marketing_context jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_context) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  check (slot_id is not null or preferred_date is not null)
);

create unique index bookings_one_active_booking_per_slot_idx
  on public.bookings(slot_id)
  where slot_id is not null and status in ('pending', 'confirmed', 'reschedule_requested');

create index bookings_status_created_at_idx on public.bookings(status, created_at desc);
create index bookings_service_created_at_idx on public.bookings(service_id, created_at desc);
create index bookings_customer_idx on public.bookings(customer_id);

create table public.booking_status_history (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  old_status text,
  new_status text not null,
  actor_type text not null check (actor_type in ('system', 'patient', 'staff')),
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index booking_status_history_booking_idx
  on public.booking_status_history(booking_id, created_at desc);

create table public.booking_management_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.booking_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  action text not null check (action in ('cancel', 'request_reschedule')),
  preferred_date date,
  preferred_time_period text check (preferred_time_period in ('morning', 'afternoon', 'any')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create table public.employer_leads (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null unique,
  idempotency_key uuid not null unique,
  contact_name text not null check (char_length(contact_name) between 1 and 160),
  company_name text not null check (char_length(company_name) between 1 and 200),
  work_email text not null check (work_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  employee_count_range text not null,
  services_required text[] not null check (cardinality(services_required) between 1 and 20),
  preferred_timeframe text,
  delivery_mode text check (delivery_mode in ('on_site', 'practice', 'either', 'needs_advice')),
  location text,
  notes text check (char_length(notes) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'won', 'lost', 'spam')),
  marketing_context jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_context) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employer_leads_status_created_at_idx
  on public.employer_leads(status, created_at desc);

create table public.contact_enquiries (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null unique,
  idempotency_key uuid not null unique,
  name text not null check (char_length(name) between 1 and 160),
  email text not null check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  enquiry_type text not null check (enquiry_type in ('individual', 'scanning', 'referral', 'general')),
  message text not null check (char_length(message) between 5 and 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'resolved', 'spam')),
  marketing_context jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_context) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contact_enquiries_status_created_at_idx
  on public.contact_enquiries(status, created_at desc);

create table public.consent_records (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('booking', 'employer_lead', 'contact_enquiry')),
  entity_id uuid not null,
  consent_type text not null check (consent_type in ('privacy_notice', 'contact_permission')),
  policy_version text not null,
  granted boolean not null,
  source text not null default 'website',
  ip_hash text,
  recorded_at timestamptz not null default now()
);

create index consent_records_entity_idx on public.consent_records(entity_type, entity_id);

create table public.notification_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  entity_type text not null check (entity_type in ('booking', 'employer_lead', 'contact_enquiry')),
  entity_id uuid not null,
  notification_kind text not null check (
    notification_kind in ('patient_booking_acknowledgement', 'practice_booking_alert', 'employer_acknowledgement', 'practice_employer_alert', 'contact_acknowledgement', 'practice_contact_alert')
  ),
  channel text not null default 'email' check (channel in ('email', 'sms', 'whatsapp')),
  recipient text not null,
  provider text,
  provider_message_id text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text check (char_length(last_error_message) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, notification_kind, channel)
);

create index notification_attempts_pending_idx
  on public.notification_attempts(next_attempt_at, created_at)
  where status in ('pending', 'failed');

create table public.analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null check (
    event_name in ('booking_started', 'booking_completed', 'whatsapp_clicked', 'call_clicked', 'directions_clicked', 'quote_started', 'quote_submitted', 'service_viewed', 'price_viewed', 'booking_abandoned')
  ),
  anonymous_session_id text,
  page_path text not null,
  service_id uuid references public.services(id) on delete set null,
  marketing_context jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_context) = 'object'),
  occurred_at timestamptz not null default now()
);

create index analytics_events_name_occurred_at_idx
  on public.analytics_events(event_name, occurred_at desc);

create table public.launch_dependencies (
  id uuid primary key default extensions.gen_random_uuid(),
  dependency_key text not null unique,
  category text not null check (category in ('clinical', 'commercial', 'operations', 'compliance', 'technical', 'seo')),
  title text not null,
  detail text not null,
  owner text not null default 'practice',
  status text not null default 'open' check (status in ('open', 'confirmed', 'resolved', 'not_applicable')),
  blocks_launch boolean not null default true,
  evidence_url text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.api_rate_limits (
  key_hash text not null,
  endpoint text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (key_hash, endpoint, window_started_at)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
  if v_actor not in ('system', 'patient', 'staff') then
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

create trigger practice_settings_set_updated_at before update on public.practice_settings
for each row execute function public.set_updated_at();
create trigger service_categories_set_updated_at before update on public.service_categories
for each row execute function public.set_updated_at();
create trigger services_set_updated_at before update on public.services
for each row execute function public.set_updated_at();
create trigger availability_rules_set_updated_at before update on public.availability_rules
for each row execute function public.set_updated_at();
create trigger availability_exceptions_set_updated_at before update on public.availability_exceptions
for each row execute function public.set_updated_at();
create trigger booking_slots_set_updated_at before update on public.booking_slots
for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();
create trigger bookings_set_updated_at before update on public.bookings
for each row execute function public.set_updated_at();
create trigger bookings_record_status after insert or update of status on public.bookings
for each row execute function public.record_booking_status_transition();
create trigger employer_leads_set_updated_at before update on public.employer_leads
for each row execute function public.set_updated_at();
create trigger contact_enquiries_set_updated_at before update on public.contact_enquiries
for each row execute function public.set_updated_at();
create trigger notification_attempts_set_updated_at before update on public.notification_attempts
for each row execute function public.set_updated_at();
create trigger launch_dependencies_set_updated_at before update on public.launch_dependencies
for each row execute function public.set_updated_at();

create or replace function private.generate_reference(p_prefix text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select upper(
    p_prefix || '-' || to_char(clock_timestamp() at time zone 'Africa/Johannesburg', 'YYYYMMDD') || '-' ||
    substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 8)
  );
$$;

create or replace function private.safe_marketing_context(p_payload jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'utm_source', left(nullif(p_payload->>'utm_source', ''), 120),
    'utm_medium', left(nullif(p_payload->>'utm_medium', ''), 120),
    'utm_campaign', left(nullif(p_payload->>'utm_campaign', ''), 160),
    'utm_term', left(nullif(p_payload->>'utm_term', ''), 160),
    'utm_content', left(nullif(p_payload->>'utm_content', ''), 160),
    'landing_path', left(nullif(p_payload->>'landing_path', ''), 500),
    'referrer_host', left(nullif(p_payload->>'referrer_host', ''), 255)
  ));
$$;

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
  select s.id, s.service_id, s.starts_at, s.ends_at
  from public.booking_slots s
  where s.service_id = p_service_id
    and s.status = 'open'
    and s.starts_at >= greatest(p_from, now())
    and s.starts_at < p_until
    and not exists (
      select 1
      from public.bookings b
      where b.slot_id = s.id
        and b.status in ('pending', 'confirmed', 'reschedule_requested')
    )
  order by s.starts_at
  limit 200;
$$;

create or replace function public.check_rate_limit(
  p_key_hash text,
  p_endpoint text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if coalesce(char_length(p_key_hash), 0) < 16
    or coalesce(char_length(p_endpoint), 0) < 1
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.api_rate_limits(key_hash, endpoint, window_started_at, request_count)
  values (p_key_hash, left(p_endpoint, 120), v_window, 1)
  on conflict (key_hash, endpoint, window_started_at)
  do update set request_count = private.api_rate_limits.request_count + 1
  returning request_count into v_count;

  delete from private.api_rate_limits
  where window_started_at < now() - interval '2 days';

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    greatest(ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - clock_timestamp())))::integer, 0);
end;
$$;

create or replace function public.create_booking(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_idempotency uuid;
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
  v_privacy_version text := btrim(coalesce(p_payload->>'privacy_version', ''));
  v_ip_hash text := nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), '');
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid booking payload' using errcode = '22023';
  end if;

  begin
    v_idempotency := (p_payload->>'idempotency_key')::uuid;
  exception when others then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260812));

  select * into v_existing from public.bookings where idempotency_key = v_idempotency;
  if found then
    return jsonb_build_object(
      'booking_id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'confirmation_mode', v_existing.confirmation_mode,
      'management_token', null,
      'idempotent', true
    );
  end if;

  if char_length(v_first_name) not between 1 and 80
    or char_length(v_surname) not between 1 and 80
    or v_mobile !~ '^\+[1-9][0-9]{7,14}$'
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or v_patient_status not in ('new', 'returning')
    or char_length(v_privacy_version) not between 1 and 80
    or coalesce((p_payload->>'privacy_accepted')::boolean, false) is not true
    or (v_notes is not null and char_length(v_notes) > 1000) then
    raise exception 'invalid booking details' using errcode = '22023';
  end if;

  begin
    select * into strict v_service
    from public.services
    where id = (p_payload->>'service_id')::uuid and is_published;
  exception when no_data_found or invalid_text_representation then
    raise exception 'service is unavailable' using errcode = '22023';
  end;

  if v_service.booking_mode = 'quote' then
    raise exception 'service requires an employer quote' using errcode = '22023';
  end if;

  if nullif(p_payload->>'slot_id', '') is not null then
    begin
      v_slot_id := (p_payload->>'slot_id')::uuid;
      select * into strict v_slot
      from public.booking_slots
      where id = v_slot_id
      for update;
    exception when no_data_found or invalid_text_representation then
      raise exception 'selected slot is unavailable' using errcode = 'P0002';
    end;

    if v_slot.service_id <> v_service.id
      or v_slot.status <> 'open'
      or v_slot.starts_at <= now()
      or exists (
        select 1 from public.bookings b
        where b.slot_id = v_slot.id
          and b.status in ('pending', 'confirmed', 'reschedule_requested')
      ) then
      raise exception 'selected slot is unavailable' using errcode = 'P0002';
    end if;
  else
    begin
      v_preferred_date := (p_payload->>'preferred_date')::date;
    exception when others then
      raise exception 'preferred date is required' using errcode = '22023';
    end;
    v_preferred_period := coalesce(nullif(p_payload->>'preferred_time_period', ''), 'any');
    if v_preferred_date < (now() at time zone 'Africa/Johannesburg')::date
      or v_preferred_period not in ('morning', 'afternoon', 'any') then
      raise exception 'invalid preferred appointment time' using errcode = '22023';
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
    marketing_context
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
    private.safe_marketing_context(coalesce(p_payload->'marketing', '{}'::jsonb))
  ) returning id into v_booking_id;

  v_manage_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.booking_management_tokens(booking_id, token_hash, expires_at)
  values (v_booking_id, extensions.digest(v_manage_token, 'sha256'), now() + interval '90 days');

  insert into public.consent_records(entity_type, entity_id, consent_type, policy_version, granted, ip_hash)
  values ('booking', v_booking_id, 'privacy_notice', v_privacy_version, true, v_ip_hash);

  insert into public.notification_attempts(entity_type, entity_id, notification_kind, recipient)
  values
    ('booking', v_booking_id, 'patient_booking_acknowledgement', v_email),
    ('booking', v_booking_id, 'practice_booking_alert', (select public_email from public.practice_settings where id = 'primary'));

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'reference', v_reference,
    'status', v_status,
    'confirmation_mode', v_service.confirmation_mode,
    'service_name', v_service.name,
    'slot_start', v_slot.starts_at,
    'preferred_date', coalesce(v_preferred_date, (v_slot.starts_at at time zone 'Africa/Johannesburg')::date),
    'preferred_time_period', v_preferred_period,
    'management_token', v_manage_token,
    'idempotent', false
  );
end;
$$;

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
  v_name text := btrim(coalesce(p_payload->>'contact_name', ''));
  v_company text := btrim(coalesce(p_payload->>'company_name', ''));
  v_email text := lower(btrim(coalesce(p_payload->>'work_email', '')));
  v_phone text := btrim(coalesce(p_payload->>'phone_e164', ''));
  v_services text[];
  v_privacy_version text := btrim(coalesce(p_payload->>'privacy_version', ''));
begin
  begin
    v_idempotency := (p_payload->>'idempotency_key')::uuid;
  exception when others then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260813));
  select * into v_existing from public.employer_leads where idempotency_key = v_idempotency;
  if found then
    return jsonb_build_object('lead_id', v_existing.id, 'reference', v_existing.reference, 'status', v_existing.status, 'idempotent', true);
  end if;

  select coalesce(array_agg(left(value, 120)), array[]::text[])
  into v_services
  from jsonb_array_elements_text(coalesce(p_payload->'services_required', '[]'::jsonb));

  if char_length(v_name) not between 1 and 160
    or char_length(v_company) not between 1 and 200
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or v_phone !~ '^\+[1-9][0-9]{7,14}$'
    or cardinality(v_services) not between 1 and 20
    or char_length(v_privacy_version) not between 1 and 80
    or coalesce((p_payload->>'privacy_accepted')::boolean, false) is not true then
    raise exception 'invalid employer enquiry details' using errcode = '22023';
  end if;

  v_reference := private.generate_reference('B2B');
  insert into public.employer_leads(
    reference, idempotency_key, contact_name, company_name, work_email, phone_e164,
    employee_count_range, services_required, preferred_timeframe, delivery_mode,
    location, notes, marketing_context
  ) values (
    v_reference, v_idempotency, v_name, v_company, v_email, v_phone,
    left(coalesce(p_payload->>'employee_count_range', 'Not specified'), 80), v_services,
    left(nullif(p_payload->>'preferred_timeframe', ''), 200),
    case when p_payload->>'delivery_mode' in ('on_site', 'practice', 'either', 'needs_advice') then p_payload->>'delivery_mode' else null end,
    left(nullif(p_payload->>'location', ''), 300),
    left(nullif(p_payload->>'notes', ''), 2000),
    private.safe_marketing_context(coalesce(p_payload->'marketing', '{}'::jsonb))
  ) returning id into v_id;

  insert into public.consent_records(entity_type, entity_id, consent_type, policy_version, granted, ip_hash)
  values ('employer_lead', v_id, 'privacy_notice', v_privacy_version, true, nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), ''));

  insert into public.notification_attempts(entity_type, entity_id, notification_kind, recipient)
  values
    ('employer_lead', v_id, 'employer_acknowledgement', v_email),
    ('employer_lead', v_id, 'practice_employer_alert', (select public_email from public.practice_settings where id = 'primary'));

  return jsonb_build_object('lead_id', v_id, 'reference', v_reference, 'status', 'new', 'idempotent', false);
end;
$$;

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
  v_name text := btrim(coalesce(p_payload->>'name', ''));
  v_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_phone text := nullif(btrim(coalesce(p_payload->>'phone_e164', '')), '');
  v_message text := btrim(coalesce(p_payload->>'message', ''));
  v_type text := coalesce(p_payload->>'enquiry_type', 'general');
  v_privacy_version text := btrim(coalesce(p_payload->>'privacy_version', ''));
begin
  begin
    v_idempotency := (p_payload->>'idempotency_key')::uuid;
  exception when others then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260814));
  select * into v_existing from public.contact_enquiries where idempotency_key = v_idempotency;
  if found then
    return jsonb_build_object('enquiry_id', v_existing.id, 'reference', v_existing.reference, 'status', v_existing.status, 'idempotent', true);
  end if;

  if char_length(v_name) not between 1 and 160
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$')
    or char_length(v_message) not between 5 and 2000
    or v_type not in ('individual', 'scanning', 'referral', 'general')
    or char_length(v_privacy_version) not between 1 and 80
    or coalesce((p_payload->>'privacy_accepted')::boolean, false) is not true then
    raise exception 'invalid contact enquiry details' using errcode = '22023';
  end if;

  v_reference := private.generate_reference('ENQ');
  insert into public.contact_enquiries(
    reference, idempotency_key, name, email, phone_e164, enquiry_type, message, marketing_context
  ) values (
    v_reference, v_idempotency, v_name, v_email, v_phone, v_type, v_message,
    private.safe_marketing_context(coalesce(p_payload->'marketing', '{}'::jsonb))
  ) returning id into v_id;

  insert into public.consent_records(entity_type, entity_id, consent_type, policy_version, granted, ip_hash)
  values ('contact_enquiry', v_id, 'privacy_notice', v_privacy_version, true, nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), ''));

  insert into public.notification_attempts(entity_type, entity_id, notification_kind, recipient)
  values
    ('contact_enquiry', v_id, 'contact_acknowledgement', v_email),
    ('contact_enquiry', v_id, 'practice_contact_alert', (select public_email from public.practice_settings where id = 'primary'));

  return jsonb_build_object('enquiry_id', v_id, 'reference', v_reference, 'status', 'new', 'idempotent', false);
end;
$$;

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
  if char_length(v_raw_token) <> 64 or v_action not in ('cancel', 'request_reschedule') then
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

  if v_booking.status not in ('pending', 'confirmed', 'reschedule_requested') then
    raise exception 'booking can no longer be changed online' using errcode = '22023';
  end if;

  perform set_config('insurespr.actor', 'patient', true);

  if v_action = 'cancel' then
    insert into public.booking_actions(booking_id, action, note)
    values (v_booking.id, 'cancel', left(nullif(p_payload->>'note', ''), 500));

    update public.bookings
    set status = 'cancelled', cancelled_at = now()
    where id = v_booking.id;
  else
    begin
      v_preferred_date := (p_payload->>'preferred_date')::date;
    exception when others then
      raise exception 'preferred date is required' using errcode = '22023';
    end;
    v_preferred_period := coalesce(nullif(p_payload->>'preferred_time_period', ''), 'any');
    if v_preferred_date < (now() at time zone 'Africa/Johannesburg')::date
      or v_preferred_period not in ('morning', 'afternoon', 'any') then
      raise exception 'invalid preferred appointment time' using errcode = '22023';
    end if;

    insert into public.booking_actions(booking_id, action, preferred_date, preferred_time_period, note)
    values (v_booking.id, 'request_reschedule', v_preferred_date, v_preferred_period, left(nullif(p_payload->>'note', ''), 500));

    update public.bookings
    set status = 'reschedule_requested'
    where id = v_booking.id;
  end if;

  update public.booking_management_tokens set last_used_at = now() where id = v_token.id;

  return jsonb_build_object(
    'reference', v_booking.reference,
    'status', case when v_action = 'cancel' then 'cancelled' else 'reschedule_requested' end
  );
exception when no_data_found then
  raise exception 'invalid or expired booking link' using errcode = '22023';
end;
$$;

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
  if v_event not in ('booking_started', 'booking_completed', 'whatsapp_clicked', 'call_clicked', 'directions_clicked', 'quote_started', 'quote_submitted', 'service_viewed', 'price_viewed', 'booking_abandoned')
    or char_length(coalesce(p_payload->>'page_path', '')) not between 1 and 500 then
    raise exception 'invalid analytics event' using errcode = '22023';
  end if;

  begin
    v_service_id := nullif(p_payload->>'service_id', '')::uuid;
  exception when others then
    v_service_id := null;
  end;

  insert into public.analytics_events(event_name, anonymous_session_id, page_path, service_id, marketing_context)
  values (
    v_event,
    left(nullif(p_payload->>'anonymous_session_id', ''), 128),
    left(p_payload->>'page_path', 500),
    v_service_id,
    private.safe_marketing_context(coalesce(p_payload->'marketing', '{}'::jsonb))
  );
end;
$$;

insert into public.practice_settings(
  id, practice_name, descriptor, address_line, locality, region, phone_display,
  phone_e164, whatsapp_e164, public_email, opening_hours, maps_url
) values (
  'primary',
  'InsureSPR Precision Healthcare',
  'X-Ray, Medicals and Bone Density, Malibongwe Drive, Randburg',
  '7 Malibongwe Drive, EmedCentre',
  'Randburg',
  'Gauteng',
  '083 450 7861',
  '+27834507861',
  '27834507861',
  'health@insuresprhealth.co.za',
  '{"monday":"08:00-17:00","tuesday":"08:00-17:00","wednesday":"08:00-17:00","thursday":"08:00-17:00","friday":"08:00-17:00"}'::jsonb,
  'https://maps.google.com/?q=7+Malibongwe+Drive+EmedCentre+Randburg'
)
on conflict (id) do update set
  practice_name = excluded.practice_name,
  descriptor = excluded.descriptor,
  address_line = excluded.address_line,
  locality = excluded.locality,
  region = excluded.region,
  phone_display = excluded.phone_display,
  phone_e164 = excluded.phone_e164,
  whatsapp_e164 = excluded.whatsapp_e164,
  public_email = excluded.public_email,
  opening_hours = excluded.opening_hours,
  maps_url = excluded.maps_url;

insert into public.service_categories(slug, name, audience, summary, primary_cta, display_order, is_published)
values
  ('individuals', 'X-rays and individual medical services', 'individual', 'Diagnostic and certificate services for individuals in Randburg.', 'call', 10, true),
  ('workforce', 'Workforce health', 'workforce', 'Occupational-health and employer services handled through a dedicated quote journey.', 'request_quote', 20, true),
  ('scanning', 'Bone density and body composition', 'scanning', 'DXA scanning and related bone-and-muscle health services.', 'book', 30, true)
on conflict (slug) do update set
  name = excluded.name,
  audience = excluded.audience,
  summary = excluded.summary,
  primary_cta = excluded.primary_cta,
  display_order = excluded.display_order,
  is_published = excluded.is_published;

insert into public.services(
  category_id, slug, name, short_description, audience, booking_mode, confirmation_mode,
  price_type, appointment_requirement, source_url, verification_status, display_order, is_published
)
values
  ((select id from public.service_categories where slug = 'scanning'), 'dxa-bone-density', 'DXA Bone Density', 'A DXA scan that measures bone mineral density.', 'scanning', 'appointment', 'staff', 'unpublished', 'An appointment is required; the practice must confirm the available time.', 'https://insuresprhealth.co.za', 'needs_confirmation', 10, true),
  ((select id from public.service_categories where slug = 'scanning'), 'dxa-body-composition', 'DXA Body Composition', 'A DXA scan measuring fat, lean tissue and bone by body area.', 'scanning', 'appointment', 'staff', 'unpublished', 'An appointment is required; the practice must confirm the available time.', 'https://insuresprhealth.co.za/2024/02/15/www-insuresprhealth-co-za-dxa-body-composition/', 'needs_confirmation', 20, true),
  ((select id from public.service_categories where slug = 'scanning'), 'osteoporosis-care', 'Nurse-led Osteoporosis Care', 'Assessment and ongoing support focused on osteoporosis and bone health.', 'scanning', 'request', 'staff', 'unpublished', 'Submit a request so the practice can confirm the appropriate next step.', 'https://insuresprhealth.co.za/2024/07/11/insurespr-health-nurse-led-comprehensive-osteoporosis-management/', 'needs_confirmation', 30, true),
  ((select id from public.service_categories where slug = 'individuals'), 'primary-healthcare-x-ray', 'Primary Healthcare X-Ray', 'X-ray imaging supporting diagnosis and treatment by healthcare professionals.', 'individual', 'walk_in', 'staff', 'unpublished', 'The legacy X-Ray on Malebongwe site states that walk-ins are welcome. Referral and per-examination requirements still require practice confirmation.', 'https://xrayonmalebongwe.co.za/', 'needs_confirmation', 10, true),
  ((select id from public.service_categories where slug = 'individuals'), 'visa-chest-x-ray', 'Visa Application Chest X-Ray', 'Chest x-ray imaging for supported visa application requirements.', 'individual', 'request', 'staff', 'unpublished', 'Contact the practice to confirm the destination-country requirements and whether an appointment is needed.', 'https://xrayonmalebongwe.co.za/', 'needs_confirmation', 20, true),
  ((select id from public.service_categories where slug = 'workforce'), 'workplace-medicals', 'Workplace Medicals', 'Occupational-health medical services for employers, from pre-employment to exit medicals.', 'workforce', 'quote', 'staff', 'quote', 'Employers should request a quote with workforce size, services, timing and location.', 'https://xrayonmalebongwe.co.za/', 'needs_confirmation', 10, true)
on conflict (slug) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  short_description = excluded.short_description,
  audience = excluded.audience,
  booking_mode = excluded.booking_mode,
  confirmation_mode = excluded.confirmation_mode,
  price_type = excluded.price_type,
  appointment_requirement = excluded.appointment_requirement,
  source_url = excluded.source_url,
  verification_status = excluded.verification_status,
  display_order = excluded.display_order,
  is_published = excluded.is_published;

insert into public.launch_dependencies(dependency_key, category, title, detail, owner, blocks_launch, evidence_url)
values
  ('approved-prices', 'commercial', 'Approve prices and payment wording', 'Provide the cash/self-pay price, package price, medical-aid status and inclusions for every published individual and scanning service.', 'practice', true, null),
  ('booking-rules', 'operations', 'Confirm appointment and walk-in rules', 'Confirm which services require appointments, slot durations, capacity, operating days, staff-confirmation rules, cancellation windows and rescheduling rules.', 'practice', true, null),
  ('clinical-requirements', 'clinical', 'Approve service requirements', 'For every service, confirm referral requirements, what to bring, preparation, expected duration and how/when results are delivered.', 'practice', true, null),
  ('verified-credentials', 'compliance', 'Provide practitioner and practice credentials', 'Provide the responsible practitioner, qualifications, HPCSA registration, BHF practice number, responsible radiographer, nurse and OMP details, plus applicable radiation-control information.', 'practice', true, null),
  ('service-catalogue', 'clinical', 'Confirm the production service catalogue', 'Approve the exact x-ray, certificate, occupational-health, mobile/on-site and scanning services that may be advertised.', 'practice', true, null),
  ('privacy-popia', 'compliance', 'Approve POPIA privacy and retention rules', 'Nominate the responsible party/information officer and approve privacy wording, processor list, retention periods, access controls and data-subject request process.', 'practice', true, null),
  ('email-delivery', 'technical', 'Configure and verify transactional email', 'Choose the production provider, verify the sending domain, configure SPF/DKIM/DMARC, set secrets, approve templates and test delivery/failure/retry handling.', 'phuture', true, null),
  ('anti-spam-secrets', 'technical', 'Configure public-endpoint protection', 'Set a strong IP hashing pepper and, if approved, Cloudflare Turnstile site/secret keys before enabling production forms.', 'phuture', true, null),
  ('domain-redirects', 'seo', 'Approve domains and URL redirect map', 'Confirm the production domain and map every existing InsureSPR and xrayonmalebongwe.co.za URL to the matching production page with a permanent redirect.', 'phuture', true, null),
  ('blog-migration', 'seo', 'Preserve and migrate the existing blog', 'Inventory every existing article, image, URL, title and metadata item; obtain content approval; migrate or preserve the URL; and test explicit redirects where a URL changes.', 'phuture', true, 'https://insuresprhealth.co.za/insuresprhealth-blog/'),
  ('google-business-profile', 'seo', 'Align Google Business Profile', 'Confirm name, address, phone, hours, services and destination URLs match the production website.', 'practice', true, null),
  ('notification-operations', 'operations', 'Approve notification recipients and escalation', 'Confirm the monitored practice inbox, staff recipients, acknowledgement wording, retry escalation and who handles failed notifications.', 'practice', true, null)
on conflict (dependency_key) do update set
  category = excluded.category,
  title = excluded.title,
  detail = excluded.detail,
  owner = excluded.owner,
  blocks_launch = excluded.blocks_launch,
  evidence_url = excluded.evidence_url;

alter table public.practice_settings enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.booking_slots enable row level security;
alter table public.customers enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_status_history enable row level security;
alter table public.booking_management_tokens enable row level security;
alter table public.booking_actions enable row level security;
alter table public.employer_leads enable row level security;
alter table public.contact_enquiries enable row level security;
alter table public.consent_records enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.analytics_events enable row level security;
alter table public.launch_dependencies enable row level security;
alter table private.api_rate_limits enable row level security;

revoke all on schema public from anon, authenticated;
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on private.api_rate_limits from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant select, insert, update, delete on private.api_rate_limits to service_role;

commit;
