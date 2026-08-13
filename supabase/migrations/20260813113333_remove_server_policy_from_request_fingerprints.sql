begin;

-- This filename matches the migration version recorded by the live project.

-- Privacy policy version is database-managed consent provenance, not caller
-- payload. Excluding it from idempotency fingerprints removes a narrow race in
-- which a concurrent policy update could occur between request hashing and the
-- consent trigger's independent read. The compatibility parameters remain in
-- place so the existing RPCs do not need a signature or call-site change.
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
      'marketing_context', coalesce(p_marketing_context, '{}'::jsonb)
    )::text,
    'sha256'
  );
$$;

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
      'marketing_context', coalesce(p_marketing_context, '{}'::jsonb)
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
      'marketing_context', coalesce(p_marketing_context, '{}'::jsonb)
    )::text,
    'sha256'
  );
$$;

comment on function private.booking_request_fingerprint(
  text, text, text, text, uuid, uuid, date, text, text, text, jsonb, text
) is
  'Builds the canonical SHA-256 fingerprint used to bind a booking idempotency key to caller-controlled effective request values; the final privacy-version parameter is retained only for call compatibility.';

comment on function private.employer_lead_request_fingerprint(
  text, text, text, text, text, text[], text, text, text, text, jsonb, text
) is
  'Builds the canonical SHA-256 fingerprint used to bind an employer-lead idempotency key to caller-controlled effective request values; the final privacy-version parameter is retained only for call compatibility.';

comment on function private.contact_enquiry_request_fingerprint(
  text, text, text, text, text, jsonb, text
) is
  'Builds the canonical SHA-256 fingerprint used to bind a contact-enquiry idempotency key to caller-controlled effective request values; the final privacy-version parameter is retained only for call compatibility.';

-- Existing rows were hashed by the superseded definition, so recompute them
-- from the effective persisted values. No consent lookup is required because
-- database-managed policy provenance is intentionally no longer part of the
-- idempotency contract.
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
  null
)
from public.customers as customer
where customer.id = booking.customer_id;

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
  null
);

update public.contact_enquiries as enquiry
set request_fingerprint = private.contact_enquiry_request_fingerprint(
  enquiry.name,
  enquiry.email,
  enquiry.phone_e164,
  enquiry.enquiry_type,
  enquiry.message,
  enquiry.marketing_context,
  null
);

-- The same normalized caller payload must hash identically regardless of a
-- database policy-version change. This assertion catches accidental future
-- reintroduction of server-managed provenance into any request fingerprint.
do $$
declare
  v_booking_a bytea;
  v_booking_b bytea;
  v_employer_a bytea;
  v_employer_b bytea;
  v_contact_a bytea;
  v_contact_b bytea;
begin
  -- The service UUID is caller payload and therefore shared by the pair.
  declare
    v_service_id uuid := extensions.gen_random_uuid();
  begin
    v_booking_a := private.booking_request_fingerprint(
      'Replay', 'Contract', '+27820000031', 'booking-policy@example.invalid',
      v_service_id, null, current_date + 7, 'morning', 'new',
      'Same caller payload.', '{}'::jsonb, 'policy-a'
    );
    v_booking_b := private.booking_request_fingerprint(
      'Replay', 'Contract', '+27820000031', 'booking-policy@example.invalid',
      v_service_id, null, current_date + 7, 'morning', 'new',
      'Same caller payload.', '{}'::jsonb, 'policy-b'
    );
  end;

  v_employer_a := private.employer_lead_request_fingerprint(
    'Employer Contract', 'Contract Company', 'employer-policy@example.invalid',
    '+27820000032', '11-50', array['Staff x-rays'], 'Within one month',
    'practice', 'Randburg', 'Same caller payload.', '{}'::jsonb, 'policy-a'
  );
  v_employer_b := private.employer_lead_request_fingerprint(
    'Employer Contract', 'Contract Company', 'employer-policy@example.invalid',
    '+27820000032', '11-50', array['Staff x-rays'], 'Within one month',
    'practice', 'Randburg', 'Same caller payload.', '{}'::jsonb, 'policy-b'
  );

  v_contact_a := private.contact_enquiry_request_fingerprint(
    'Contact Contract', 'contact-policy@example.invalid', '+27820000033',
    'general', 'Same caller payload.', '{}'::jsonb, 'policy-a'
  );
  v_contact_b := private.contact_enquiry_request_fingerprint(
    'Contact Contract', 'contact-policy@example.invalid', '+27820000033',
    'general', 'Same caller payload.', '{}'::jsonb, 'policy-b'
  );

  if v_booking_a is distinct from v_booking_b
    or v_employer_a is distinct from v_employer_b
    or v_contact_a is distinct from v_contact_b then
    raise exception 'server-managed privacy policy affected a request fingerprint';
  end if;
end;
$$;

commit;
