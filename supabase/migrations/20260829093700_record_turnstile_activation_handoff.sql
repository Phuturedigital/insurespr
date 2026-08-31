begin;

insert into private.readiness_evidence_documents (
  document_key,
  title,
  source_filename,
  source_kind,
  content_sha256,
  document_date,
  form_version,
  supplied_by,
  supplied_role,
  custody_note,
  review_status,
  reviewed_by,
  reviewed_at,
  notes
)
values (
  'insurespr-turnstile-activation-handoff-20260829',
  'InsureSPR Turnstile activation handoff',
  'TURNSTILE-ACTIVATION-HANDOFF.json',
  'internal_record',
  decode('a4c3ac7dd45d9ed3b28c7b109a53f187c468c96288a77e4b71f650628a8a0b77', 'hex'),
  date '2026-08-29',
  '1',
  'Phuture Digital deployment',
  'Technical operator',
  'The canonical prepared-not-created packet is committed to the private source repository. It contains environment-variable names, safe status observations and evidence requirements only. Issued Turnstile values must remain in provider secret stores and must never be written to this register.',
  'reviewed',
  'Phuture Digital activation review',
  timestamptz '2026-08-29 09:37:00+00',
  'The official bridge and single-use attestation path are active, but the production Turnstile widget and both Vercel variables are absent. The packet restricts future activation to www.insuresprhealth.co.za, managed mode, the book/contact/employer actions and a complete rejection/acceptance test matrix.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-turnstile-activation-handoff-20260829'
)
insert into private.readiness_evidence_claims (
  document_id,
  claim_key,
  section,
  source_page,
  supplied_value,
  review_status,
  public_use_allowed,
  linked_dependency_key,
  reviewer_note
)
select
  evidence_document.id,
  'turnstile-activation-packet',
  'Public-form anti-spam activation',
  1,
  jsonb_build_object(
    'packet_status', 'prepared-not-created',
    'activation_authorized', false,
    'canonical_hostname', 'www.insuresprhealth.co.za',
    'widget_mode', 'managed',
    'allowed_actions', jsonb_build_array('book', 'contact', 'employer'),
    'preview_hostnames_allowed', false,
    'localhost_allowed', false,
    'site_key_environment_name', 'TURNSTILE_SITE_KEY',
    'secret_key_environment_name', 'TURNSTILE_SECRET_KEY',
    'environment_target', 'vercel-production-only',
    'supabase_function_version', 18,
    'widget_inventory_verified', false,
    'site_key_published', false,
    'vercel_site_key_configured', false,
    'vercel_secret_key_configured', false,
    'bridge_protected_probe_code', 'BOT_CHECK_UNAVAILABLE',
    'intake_ready', false
  ),
  'needs_evidence',
  false,
  'anti-spam-secrets',
  'This packet is a controlled activation contract, not widget or credential evidence. Activation still requires one canonical-hostname widget, both Vercel Production variables, non-secret custody references, a different peer reviewer and the missing/invalid/expired/wrong-action/wrong-hostname/replay/valid-token matrix with zero unintended writes.'
from evidence_document;

update public.launch_dependencies
set
  detail = 'A hash-bound prepared-not-created Turnstile activation packet now constrains the future widget to managed mode, www.insuresprhealth.co.za only, the book/contact/employer actions and Vercel Production only. Current production verification still returns no site key and BOT_CHECK_UNAVAILABLE, and the Vercel environment inventory contains neither TURNSTILE_SITE_KEY nor TURNSTILE_SECRET_KEY. Keep this dependency open until an existing-widget check is completed in the authorized Cloudflare account, both issued values are stored without disclosure, the exact deployment is recorded, a different peer reviewer approves the packet, and missing, invalid, expired, wrong-action, wrong-hostname, replayed and valid-token tests prove zero unintended writes while the downstream intake gate remains closed.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'anti-spam-secrets';

do $$
declare
  v_document_id uuid;
  v_claim private.readiness_evidence_claims%rowtype;
  v_dependency public.launch_dependencies%rowtype;
  v_settings public.practice_settings%rowtype;
  v_published_services integer;
  v_needs_confirmation integer;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-turnstile-activation-handoff-20260829'
    and source_filename = 'TURNSTILE-ACTIVATION-HANDOFF.json'
    and source_kind = 'internal_record'
    and review_status = 'reviewed'
    and content_sha256 = decode('a4c3ac7dd45d9ed3b28c7b109a53f187c468c96288a77e4b71f650628a8a0b77', 'hex');

  select *
  into strict v_claim
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and claim_key = 'turnstile-activation-packet';

  if v_claim.review_status is distinct from 'needs_evidence'
    or v_claim.public_use_allowed
    or v_claim.linked_dependency_key is distinct from 'anti-spam-secrets'
    or v_claim.supplied_value->>'packet_status' is distinct from 'prepared-not-created'
    or v_claim.supplied_value->>'canonical_hostname' is distinct from 'www.insuresprhealth.co.za'
    or v_claim.supplied_value->>'widget_mode' is distinct from 'managed'
    or (v_claim.supplied_value->>'activation_authorized')::boolean
    or (v_claim.supplied_value->>'site_key_published')::boolean
    or (v_claim.supplied_value->>'vercel_site_key_configured')::boolean
    or (v_claim.supplied_value->>'vercel_secret_key_configured')::boolean
    or (v_claim.supplied_value->>'intake_ready')::boolean
  then
    raise exception using errcode = '23514', message = 'Turnstile activation packet was not stored fail-closed';
  end if;

  select *
  into strict v_dependency
  from public.launch_dependencies
  where dependency_key = 'anti-spam-secrets';

  if v_dependency.status is distinct from 'open'
    or not v_dependency.blocks_launch
    or v_dependency.resolved_at is not null
    or v_dependency.detail not like '%www.insuresprhealth.co.za only%'
    or v_dependency.detail not like '%BOT_CHECK_UNAVAILABLE%'
    or v_dependency.detail not like '%replayed and valid-token tests%'
  then
    raise exception using errcode = '23514', message = 'Turnstile handoff must not close or weaken the anti-spam dependency';
  end if;

  select *
  into strict v_settings
  from public.practice_settings
  where id = 'primary';

  if v_settings.privacy_notice_version !~* '^pending' then
    raise exception using errcode = '23514', message = 'Turnstile handoff must not open privacy-gated intake';
  end if;

  select count(*), count(*) filter (where verification_status = 'needs_confirmation')
  into v_published_services, v_needs_confirmation
  from public.services
  where is_published;

  if v_published_services is distinct from 16
    or v_needs_confirmation is distinct from 16
    or exists (select 1 from public.booking_slots)
  then
    raise exception using errcode = '23514', message = 'Turnstile handoff must not verify services or create availability';
  end if;

  if exists (select 1 from public.customers)
    or exists (select 1 from public.bookings)
    or exists (select 1 from public.employer_leads)
    or exists (select 1 from public.contact_enquiries)
    or exists (select 1 from public.notification_attempts)
  then
    raise exception using errcode = '23514', message = 'Turnstile handoff registration must not create operational records';
  end if;

  if has_table_privilege('anon', 'private.readiness_evidence_documents', 'SELECT')
    or has_table_privilege('authenticated', 'private.readiness_evidence_documents', 'SELECT')
    or has_table_privilege('service_role', 'private.readiness_evidence_documents', 'SELECT')
    or has_table_privilege('anon', 'private.readiness_evidence_claims', 'SELECT')
    or has_table_privilege('authenticated', 'private.readiness_evidence_claims', 'SELECT')
    or has_table_privilege('service_role', 'private.readiness_evidence_claims', 'SELECT')
  then
    raise exception using errcode = '42501', message = 'Turnstile evidence unexpectedly became API-readable';
  end if;
end;
$$;

commit;
