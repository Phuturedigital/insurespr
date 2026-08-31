begin;

-- This filename matches the migration version recorded by the live project.

-- Bind each public idempotency key to the normalized request that first used
-- it. Network retries may safely recover the original reference, while an
-- accidental key collision cannot silently discard different form contents.
create or replace function private.employer_lead_request_fingerprint(
  p_contact_name text,
  p_company_name text,
  p_work_email text,
  p_phone_e164 text,
  p_employee_count_range text,
  p_services_required text[],
  p_preferred_timeframe text,
  p_delivery_mode text,
  p_location text,
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
      'contact_name', btrim(coalesce(p_contact_name, '')),
      'company_name', btrim(coalesce(p_company_name, '')),
      'work_email', lower(btrim(coalesce(p_work_email, ''))),
      'phone_e164', btrim(coalesce(p_phone_e164, '')),
      'employee_count_range', coalesce(
        nullif(left(btrim(coalesce(p_employee_count_range, '')), 80), ''),
        'Not specified'
      ),
      'services_required', coalesce(
        (
          select jsonb_agg(normalized.service order by normalized.service)
          from (
            select distinct left(btrim(item.value), 120) as service
            from unnest(coalesce(p_services_required, array[]::text[])) as item(value)
            where nullif(btrim(item.value), '') is not null
          ) as normalized
        ),
        '[]'::jsonb
      ),
      'preferred_timeframe', left(nullif(btrim(coalesce(p_preferred_timeframe, '')), ''), 200),
      'delivery_mode', nullif(btrim(coalesce(p_delivery_mode, '')), ''),
      'location', left(nullif(btrim(coalesce(p_location, '')), ''), 300),
      'notes', left(nullif(btrim(coalesce(p_notes, '')), ''), 2000),
      'marketing_context', coalesce(p_marketing_context, '{}'::jsonb),
      'privacy_version', btrim(coalesce(p_privacy_version, ''))
    )::text,
    'sha256'
  );
$$;

create or replace function private.contact_enquiry_request_fingerprint(
  p_name text,
  p_email text,
  p_phone_e164 text,
  p_enquiry_type text,
  p_message text,
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
      'name', btrim(coalesce(p_name, '')),
      'email', lower(btrim(coalesce(p_email, ''))),
      'phone_e164', nullif(btrim(coalesce(p_phone_e164, '')), ''),
      'enquiry_type', coalesce(nullif(btrim(coalesce(p_enquiry_type, '')), ''), 'general'),
      'message', btrim(coalesce(p_message, '')),
      'marketing_context', coalesce(p_marketing_context, '{}'::jsonb),
      'privacy_version', btrim(coalesce(p_privacy_version, ''))
    )::text,
    'sha256'
  );
$$;

comment on function private.employer_lead_request_fingerprint(
  text, text, text, text, text, text[], text, text, text, text, jsonb, text
) is
  'Builds the canonical SHA-256 fingerprint that binds an employer-lead idempotency key to one effective request.';

comment on function private.contact_enquiry_request_fingerprint(
  text, text, text, text, text, jsonb, text
) is
  'Builds the canonical SHA-256 fingerprint that binds a contact-enquiry idempotency key to one effective request.';

revoke execute on function private.employer_lead_request_fingerprint(
  text, text, text, text, text, text[], text, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function private.employer_lead_request_fingerprint(
  text, text, text, text, text, text[], text, text, text, text, jsonb, text
) to service_role;

revoke execute on function private.contact_enquiry_request_fingerprint(
  text, text, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function private.contact_enquiry_request_fingerprint(
  text, text, text, text, text, jsonb, text
) to service_role;

-- These pre-existing helpers are implementation details of service-role-only
-- RPCs. Remove their default PUBLIC execute privilege explicitly while keeping
-- the service role able to call the invoker functions.
revoke execute on function private.generate_reference(text)
  from public, anon, authenticated;
grant execute on function private.generate_reference(text)
  to service_role;

revoke execute on function private.safe_marketing_context(jsonb)
  from public, anon, authenticated;
grant execute on function private.safe_marketing_context(jsonb)
  to service_role;

alter table public.employer_leads
  add column request_fingerprint bytea;

alter table public.contact_enquiries
  add column request_fingerprint bytea;

-- Backfill from the effective values already persisted. The consent version
-- belongs in the fingerprint, but a policy change after the original request
-- must not make an otherwise identical retry unrecoverable. A defensive
-- sentinel covers legacy rows without a consent record.
update public.employer_leads as lead
set request_fingerprint = private.employer_lead_request_fingerprint(
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
  lead.marketing_context,
  coalesce(
    (
      select consent.policy_version
      from public.consent_records as consent
      where consent.entity_type = 'employer_lead'
        and consent.entity_id = lead.id
        and consent.consent_type = 'privacy_notice'
        and consent.granted
      order by consent.recorded_at desc, consent.id desc
      limit 1
    ),
    'legacy-unknown'
  )
);

update public.contact_enquiries as enquiry
set request_fingerprint = private.contact_enquiry_request_fingerprint(
  enquiry.name,
  enquiry.email,
  enquiry.phone_e164,
  enquiry.enquiry_type,
  enquiry.message,
  enquiry.marketing_context,
  coalesce(
    (
      select consent.policy_version
      from public.consent_records as consent
      where consent.entity_type = 'contact_enquiry'
        and consent.entity_id = enquiry.id
        and consent.consent_type = 'privacy_notice'
        and consent.granted
      order by consent.recorded_at desc, consent.id desc
      limit 1
    ),
    'legacy-unknown'
  )
);

alter table public.employer_leads
  alter column request_fingerprint set not null,
  add constraint employer_leads_request_fingerprint_sha256_check
    check (octet_length(request_fingerprint) = 32);

alter table public.contact_enquiries
  alter column request_fingerprint set not null,
  add constraint contact_enquiries_request_fingerprint_sha256_check
    check (octet_length(request_fingerprint) = 32);

comment on column public.employer_leads.request_fingerprint is
  'Canonical SHA-256 of the effective employer-lead request, used to validate an idempotent replay.';

comment on column public.contact_enquiries.request_fingerprint is
  'Canonical SHA-256 of the effective contact-enquiry request, used to validate an idempotent replay.';

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
  v_privacy_version text;
  v_replay_privacy_version text;
  v_request_fingerprint bytea;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid employer enquiry payload' using errcode = '22023';
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
    nullif(btrim(coalesce(p_payload->>'preferred_timeframe', '')), ''),
    200
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
    v_name,
    v_company,
    v_email,
    v_phone,
    v_employee_count_range,
    v_services,
    v_preferred_timeframe,
    v_delivery_mode,
    v_location,
    v_notes,
    v_marketing_context,
    v_privacy_version
  );

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260813));

  select *
  into v_existing
  from public.employer_leads
  where idempotency_key = v_idempotency;

  if found then
    select consent.policy_version
    into v_replay_privacy_version
    from public.consent_records as consent
    where consent.entity_type = 'employer_lead'
      and consent.entity_id = v_existing.id
      and consent.consent_type = 'privacy_notice'
      and consent.granted
    order by consent.recorded_at desc, consent.id desc
    limit 1;

    v_request_fingerprint := private.employer_lead_request_fingerprint(
      v_name,
      v_company,
      v_email,
      v_phone,
      v_employee_count_range,
      v_services,
      v_preferred_timeframe,
      v_delivery_mode,
      v_location,
      v_notes,
      v_marketing_context,
      coalesce(v_replay_privacy_version, 'legacy-unknown')
    );

    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency key was reused with different employer enquiry details'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'lead_id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  v_reference := private.generate_reference('B2B');
  insert into public.employer_leads(
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
    marketing_context,
    request_fingerprint
  ) values (
    v_reference,
    v_idempotency,
    v_name,
    v_company,
    v_email,
    v_phone,
    v_employee_count_range,
    v_services,
    v_preferred_timeframe,
    v_delivery_mode,
    v_location,
    v_notes,
    v_marketing_context,
    v_request_fingerprint
  ) returning id into v_id;

  insert into public.consent_records(
    entity_type,
    entity_id,
    consent_type,
    policy_version,
    granted,
    ip_hash
  ) values (
    'employer_lead',
    v_id,
    'privacy_notice',
    v_privacy_version,
    true,
    nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), '')
  );

  insert into public.notification_attempts(
    entity_type,
    entity_id,
    notification_kind,
    recipient
  ) values
    ('employer_lead', v_id, 'employer_acknowledgement', v_email),
    (
      'employer_lead',
      v_id,
      'practice_employer_alert',
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
  v_privacy_version text;
  v_replay_privacy_version text;
  v_request_fingerprint bytea;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid contact enquiry payload' using errcode = '22023';
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
    or p_payload->'privacy_accepted' is distinct from 'true'::jsonb then
    raise exception 'invalid contact enquiry details' using errcode = '22023';
  end if;

  v_marketing_context := private.safe_marketing_context(
    coalesce(p_payload->'marketing', '{}'::jsonb)
  );
  v_request_fingerprint := private.contact_enquiry_request_fingerprint(
    v_name,
    v_email,
    v_phone,
    v_type,
    v_message,
    v_marketing_context,
    v_privacy_version
  );

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency::text, 20260814));

  select *
  into v_existing
  from public.contact_enquiries
  where idempotency_key = v_idempotency;

  if found then
    select consent.policy_version
    into v_replay_privacy_version
    from public.consent_records as consent
    where consent.entity_type = 'contact_enquiry'
      and consent.entity_id = v_existing.id
      and consent.consent_type = 'privacy_notice'
      and consent.granted
    order by consent.recorded_at desc, consent.id desc
    limit 1;

    v_request_fingerprint := private.contact_enquiry_request_fingerprint(
      v_name,
      v_email,
      v_phone,
      v_type,
      v_message,
      v_marketing_context,
      coalesce(v_replay_privacy_version, 'legacy-unknown')
    );

    if v_existing.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency key was reused with different contact enquiry details'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'enquiry_id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  v_reference := private.generate_reference('ENQ');
  insert into public.contact_enquiries(
    reference,
    idempotency_key,
    name,
    email,
    phone_e164,
    enquiry_type,
    message,
    marketing_context,
    request_fingerprint
  ) values (
    v_reference,
    v_idempotency,
    v_name,
    v_email,
    v_phone,
    v_type,
    v_message,
    v_marketing_context,
    v_request_fingerprint
  ) returning id into v_id;

  insert into public.consent_records(
    entity_type,
    entity_id,
    consent_type,
    policy_version,
    granted,
    ip_hash
  ) values (
    'contact_enquiry',
    v_id,
    'privacy_notice',
    v_privacy_version,
    true,
    nullif(left(coalesce(p_payload->>'ip_hash', ''), 128), '')
  );

  insert into public.notification_attempts(
    entity_type,
    entity_id,
    notification_kind,
    recipient
  ) values
    ('contact_enquiry', v_id, 'contact_acknowledgement', v_email),
    (
      'contact_enquiry',
      v_id,
      'practice_contact_alert',
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

comment on function public.create_employer_lead(jsonb) is
  'Atomically creates an employer lead or returns the current projection only when an idempotency replay has the same canonical request fingerprint.';

comment on function public.create_contact_enquiry(jsonb) is
  'Atomically creates a contact enquiry or returns the current projection only when an idempotency replay has the same canonical request fingerprint.';

-- Transactional contract assertions use the real RPCs, constraints, consent
-- trigger and queue writes. Every synthetic row is removed before commit.
do $$
declare
  v_employer_key uuid := extensions.gen_random_uuid();
  v_contact_key uuid := extensions.gen_random_uuid();
  v_employer_payload jsonb;
  v_employer_replay_payload jsonb;
  v_contact_payload jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_employer_id uuid;
  v_contact_id uuid;
  v_employer_snapshot jsonb;
  v_contact_snapshot jsonb;
  v_row_count integer;
  v_notification_count integer;
  v_consent_count integer;
  v_public_execute boolean;
begin
  v_employer_payload := jsonb_build_object(
    'idempotency_key', v_employer_key,
    'contact_name', '  Employer Contract  ',
    'company_name', '  Contract Company  ',
    'work_email', 'EMPLOYER-CONTRACT@EXAMPLE.INVALID',
    'phone_e164', '  +27820000021  ',
    'employee_count_range', '  11-50  ',
    'services_required', jsonb_build_array(
      ' Staff x-rays ',
      'Pre-employment medicals',
      'Staff x-rays'
    ),
    'preferred_timeframe', '  Within one month  ',
    'delivery_mode', 'practice',
    'location', '  Randburg  ',
    'notes', '  Synthetic replay contract.  ',
    'privacy_accepted', true,
    'privacy_version', 'caller-version-is-ignored',
    'ip_hash', repeat('b', 64),
    'marketing', jsonb_build_object(
      'utm_source', 'migration-contract',
      'landing_path', '/employer-replay-contract',
      'ignored_key', 'must-not-affect-the-fingerprint'
    )
  );

  v_first := public.create_employer_lead(v_employer_payload);
  v_employer_id := (v_first->>'lead_id')::uuid;

  if coalesce((v_first->>'idempotent')::boolean, true)
    or v_first->>'reference' is null
    or v_first->>'status' <> 'new' then
    raise exception 'employer initial response assertion failed';
  end if;

  -- A replay uses equivalent normalized values: service order, duplicate
  -- entries, surrounding whitespace, email case and ignored marketing keys do
  -- not create a different effective request.
  v_employer_replay_payload := jsonb_build_object(
    'idempotency_key', v_employer_key,
    'contact_name', 'Employer Contract',
    'company_name', 'Contract Company',
    'work_email', 'employer-contract@example.invalid',
    'phone_e164', '+27820000021',
    'employee_count_range', '11-50',
    'services_required', jsonb_build_array(
      'Pre-employment medicals',
      'Staff x-rays'
    ),
    'preferred_timeframe', 'Within one month',
    'delivery_mode', 'practice',
    'location', 'Randburg',
    'notes', 'Synthetic replay contract.',
    'privacy_accepted', true,
    'privacy_version', 'another-caller-version-is-ignored',
    'ip_hash', repeat('c', 64),
    'marketing', jsonb_build_object(
      'landing_path', '/employer-replay-contract',
      'utm_source', 'migration-contract'
    )
  );

  update public.employer_leads
  set status = 'qualified'
  where id = v_employer_id;

  select to_jsonb(lead)
  into strict v_employer_snapshot
  from public.employer_leads as lead
  where lead.id = v_employer_id;

  v_replay := public.create_employer_lead(v_employer_replay_payload);

  if coalesce((v_replay->>'idempotent')::boolean, false) is not true
    or v_replay->>'lead_id' <> v_employer_id::text
    or v_replay->>'reference' <> v_first->>'reference'
    or v_replay->>'status' <> 'qualified' then
    raise exception 'employer matching replay projection assertion failed';
  end if;

  select count(*) into v_row_count
  from public.employer_leads
  where idempotency_key = v_employer_key;
  select count(*) into v_notification_count
  from public.notification_attempts
  where entity_type = 'employer_lead' and entity_id = v_employer_id;
  select count(*) into v_consent_count
  from public.consent_records
  where entity_type = 'employer_lead' and entity_id = v_employer_id;

  if v_row_count <> 1 or v_notification_count <> 2 or v_consent_count <> 1
    or (select to_jsonb(lead) from public.employer_leads as lead where lead.id = v_employer_id)
      is distinct from v_employer_snapshot then
    raise exception 'employer matching replay side-effect assertion failed';
  end if;

  begin
    perform public.create_employer_lead(
      v_employer_replay_payload || jsonb_build_object('company_name', 'Different Company')
    );
    raise exception 'employer mismatched replay was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  select count(*) into v_row_count
  from public.employer_leads
  where idempotency_key = v_employer_key;
  select count(*) into v_notification_count
  from public.notification_attempts
  where entity_type = 'employer_lead' and entity_id = v_employer_id;
  select count(*) into v_consent_count
  from public.consent_records
  where entity_type = 'employer_lead' and entity_id = v_employer_id;

  if v_row_count <> 1 or v_notification_count <> 2 or v_consent_count <> 1
    or (select to_jsonb(lead) from public.employer_leads as lead where lead.id = v_employer_id)
      is distinct from v_employer_snapshot then
    raise exception 'employer mismatched replay changed persisted state';
  end if;

  v_contact_payload := jsonb_build_object(
    'idempotency_key', v_contact_key,
    'name', '  Contact Contract  ',
    'email', 'CONTACT-CONTRACT@EXAMPLE.INVALID',
    'phone_e164', '  +27820000022  ',
    'enquiry_type', 'general',
    'message', '  Synthetic contact replay contract.  ',
    'privacy_accepted', true,
    'privacy_version', 'caller-version-is-ignored',
    'ip_hash', repeat('d', 64),
    'marketing', jsonb_build_object(
      'utm_source', 'migration-contract',
      'landing_path', '/contact-replay-contract',
      'ignored_key', 'must-not-affect-the-fingerprint'
    )
  );

  v_first := public.create_contact_enquiry(v_contact_payload);
  v_contact_id := (v_first->>'enquiry_id')::uuid;

  if coalesce((v_first->>'idempotent')::boolean, true)
    or v_first->>'reference' is null
    or v_first->>'status' <> 'new' then
    raise exception 'contact initial response assertion failed';
  end if;

  update public.contact_enquiries
  set status = 'contacted'
  where id = v_contact_id;

  select to_jsonb(enquiry)
  into strict v_contact_snapshot
  from public.contact_enquiries as enquiry
  where enquiry.id = v_contact_id;

  v_replay := public.create_contact_enquiry(jsonb_build_object(
    'idempotency_key', v_contact_key,
    'name', 'Contact Contract',
    'email', 'contact-contract@example.invalid',
    'phone_e164', '+27820000022',
    'enquiry_type', 'general',
    'message', 'Synthetic contact replay contract.',
    'privacy_accepted', true,
    'privacy_version', 'another-caller-version-is-ignored',
    'ip_hash', repeat('e', 64),
    'marketing', jsonb_build_object(
      'landing_path', '/contact-replay-contract',
      'utm_source', 'migration-contract'
    )
  ));

  if coalesce((v_replay->>'idempotent')::boolean, false) is not true
    or v_replay->>'enquiry_id' <> v_contact_id::text
    or v_replay->>'reference' <> v_first->>'reference'
    or v_replay->>'status' <> 'contacted' then
    raise exception 'contact matching replay projection assertion failed';
  end if;

  select count(*) into v_row_count
  from public.contact_enquiries
  where idempotency_key = v_contact_key;
  select count(*) into v_notification_count
  from public.notification_attempts
  where entity_type = 'contact_enquiry' and entity_id = v_contact_id;
  select count(*) into v_consent_count
  from public.consent_records
  where entity_type = 'contact_enquiry' and entity_id = v_contact_id;

  if v_row_count <> 1 or v_notification_count <> 2 or v_consent_count <> 1
    or (select to_jsonb(enquiry) from public.contact_enquiries as enquiry where enquiry.id = v_contact_id)
      is distinct from v_contact_snapshot then
    raise exception 'contact matching replay side-effect assertion failed';
  end if;

  begin
    perform public.create_contact_enquiry(
      v_contact_payload || jsonb_build_object('message', 'A different contact request.')
    );
    raise exception 'contact mismatched replay was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  select count(*) into v_row_count
  from public.contact_enquiries
  where idempotency_key = v_contact_key;
  select count(*) into v_notification_count
  from public.notification_attempts
  where entity_type = 'contact_enquiry' and entity_id = v_contact_id;
  select count(*) into v_consent_count
  from public.consent_records
  where entity_type = 'contact_enquiry' and entity_id = v_contact_id;

  if v_row_count <> 1 or v_notification_count <> 2 or v_consent_count <> 1
    or (select to_jsonb(enquiry) from public.contact_enquiries as enquiry where enquiry.id = v_contact_id)
      is distinct from v_contact_snapshot then
    raise exception 'contact mismatched replay changed persisted state';
  end if;

  select exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as privilege
    where procedure.oid in (
      'private.generate_reference(text)'::regprocedure,
      'private.safe_marketing_context(jsonb)'::regprocedure
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) into v_public_execute;

  if v_public_execute
    or has_function_privilege('anon', 'private.generate_reference(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.generate_reference(text)', 'EXECUTE')
    or has_function_privilege('anon', 'private.safe_marketing_context(jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.safe_marketing_context(jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'private.generate_reference(text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'private.safe_marketing_context(jsonb)', 'EXECUTE') then
    raise exception 'private helper execute ACL assertion failed';
  end if;

  delete from public.notification_attempts
  where (entity_type = 'employer_lead' and entity_id = v_employer_id)
    or (entity_type = 'contact_enquiry' and entity_id = v_contact_id);
  delete from public.consent_records
  where (entity_type = 'employer_lead' and entity_id = v_employer_id)
    or (entity_type = 'contact_enquiry' and entity_id = v_contact_id);
  delete from public.employer_leads where id = v_employer_id;
  delete from public.contact_enquiries where id = v_contact_id;

  if exists (select 1 from public.employer_leads where id = v_employer_id)
    or exists (select 1 from public.contact_enquiries where id = v_contact_id)
    or exists (
      select 1
      from public.notification_attempts
      where entity_id in (v_employer_id, v_contact_id)
    )
    or exists (
      select 1
      from public.consent_records
      where entity_id in (v_employer_id, v_contact_id)
    ) then
    raise exception 'lead/enquiry replay contract cleanup assertion failed';
  end if;
end;
$$;

commit;
