begin;

-- Consent provenance is decided inside the same database transaction as the
-- operational record. The Edge Function sends a compatibility placeholder,
-- but it cannot choose or forge the policy version that is ultimately stored.
create or replace function private.assign_current_privacy_policy_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy_version text;
begin
  select nullif(btrim(settings.privacy_notice_version), '')
  into v_policy_version
  from public.practice_settings as settings
  where settings.id = 'primary';

  if v_policy_version is null then
    raise exception 'privacy notice version is not configured' using errcode = '55000';
  end if;

  new.policy_version := v_policy_version;
  return new;
end;
$$;

comment on function private.assign_current_privacy_policy_version() is
  'Forces every new consent record to use the current database-managed privacy notice version.';

revoke execute on function private.assign_current_privacy_policy_version()
  from public, anon, authenticated, service_role;

drop trigger if exists consent_records_current_policy_version
  on public.consent_records;
create trigger consent_records_current_policy_version
before insert on public.consent_records
for each row
execute function private.assign_current_privacy_policy_version();

-- Contract assertion: a caller-supplied value must never survive insertion.
do $$
declare
  v_entity_id uuid := extensions.gen_random_uuid();
  v_expected text;
  v_actual text;
begin
  select settings.privacy_notice_version
  into strict v_expected
  from public.practice_settings as settings
  where settings.id = 'primary';

  insert into public.consent_records(
    entity_type,
    entity_id,
    consent_type,
    policy_version,
    granted,
    source
  ) values (
    'contact_enquiry',
    v_entity_id,
    'privacy_notice',
    'caller-controlled-version-must-not-survive',
    true,
    'migration-contract'
  )
  returning policy_version into v_actual;

  if v_actual is distinct from v_expected then
    raise exception 'database-managed consent policy version assertion failed';
  end if;

  delete from public.consent_records
  where entity_type = 'contact_enquiry'
    and entity_id = v_entity_id
    and source = 'migration-contract';
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
  v_privacy_version text;
begin
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
    or p_payload->'privacy_accepted' is distinct from 'true'::jsonb then
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
  v_privacy_version text;
begin
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
    or p_payload->'privacy_accepted' is distinct from 'true'::jsonb then
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

comment on function public.create_employer_lead(jsonb) is
  'Creates an employer lead while deriving consent policy version from practice_settings.';
comment on function public.create_contact_enquiry(jsonb) is
  'Creates a contact enquiry while deriving consent policy version from practice_settings.';

commit;
