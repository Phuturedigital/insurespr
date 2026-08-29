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
  'insurespr-turnstile-provider-inventory-20260829',
  'InsureSPR Turnstile provider inventory observation',
  'TURNSTILE-PROVIDER-INVENTORY.json',
  'internal_record',
  decode('d32c70c93dd10c685fd474105d6a4cddd3044be07a05e00c97858638df48c580', 'hex'),
  date '2026-08-29',
  '1',
  'Phuture Digital deployment',
  'Technical operator',
  'The authenticated Cloudflare dashboard was inspected read-only. Only the unrelated widget name, last six public site-key characters, mode, public hostnames and prepared non-submitted InsureSPR form state are retained. No account identifier, login, full site key, secret key, screenshot or credential value is stored.',
  'reviewed',
  'Phuture Digital provider inventory review',
  timestamptz '2026-08-29 10:40:49+00',
  'One existing managed widget serves www.phuturedigital.co.za and www.phuturesync.co.za and is not reusable for InsureSPR. No equivalent InsureSPR widget exists. A separate canonical managed widget form is prepared for www.insuresprhealth.co.za with pre-clearance disabled, but creation remains unsubmitted pending immediate user confirmation.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-turnstile-provider-inventory-20260829'
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
  'turnstile-provider-inventory',
  'Authenticated provider inventory and prepared form',
  1,
  jsonb_build_object(
    'status', 'verified-prepared-awaiting-confirmation',
    'existing_widget_count', 1,
    'equivalent_insurespr_widget_found', false,
    'existing_widget_name', 'Phuture Digital',
    'existing_widget_site_key_last_six', 'OOfGU',
    'existing_widget_mode', 'managed',
    'existing_widget_hostnames', jsonb_build_array('www.phuturedigital.co.za', 'www.phuturesync.co.za'),
    'existing_widget_reusable_for_insurespr', false,
    'prepared_widget_name', 'InsureSPR Production Forms',
    'prepared_hostname', 'www.insuresprhealth.co.za',
    'prepared_mode', 'managed',
    'prepared_preclearance_enabled', false,
    'create_control_enabled', true,
    'widget_created', false,
    'creation_awaiting_action_time_confirmation', true,
    'credential_values_recorded', false,
    'vercel_keys_configured', false,
    'intake_ready', false,
    'operational_record_count', 0
  ),
  'needs_evidence',
  false,
  'anti-spam-secrets',
  'This observation closes only the provider-inventory question. It does not authorize or claim widget creation, key custody, Vercel configuration, deployment, controlled verification, peer review or public intake.'
from evidence_document;

update public.launch_dependencies
set
  detail = 'The authorized Cloudflare Turnstile inventory is now verified: one existing managed Phuture Digital widget serves www.phuturedigital.co.za and www.phuturesync.co.za and is not reusable for InsureSPR; no equivalent InsureSPR widget exists. A separate managed InsureSPR Production Forms widget is prepared for www.insuresprhealth.co.za only with pre-clearance disabled, but its Create action remains unsubmitted pending immediate user confirmation. Current production still has neither Vercel Turnstile variable, publishes no site key, returns BOT_CHECK_UNAVAILABLE and keeps intake closed. Keep this dependency open until the prepared widget is created, both issued values are stored only in Vercel Production, the exact deployment is recorded, missing/invalid/expired/wrong-action/wrong-hostname/replayed/valid-token tests prove zero unintended writes, and a different peer reviewer approves the evidence and rollback path.',
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
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-turnstile-provider-inventory-20260829'
    and source_filename = 'TURNSTILE-PROVIDER-INVENTORY.json'
    and source_kind = 'internal_record'
    and review_status = 'reviewed'
    and content_sha256 = decode('d32c70c93dd10c685fd474105d6a4cddd3044be07a05e00c97858638df48c580', 'hex');

  select *
  into strict v_claim
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and claim_key = 'turnstile-provider-inventory';

  if v_claim.review_status is distinct from 'needs_evidence'
    or v_claim.public_use_allowed
    or v_claim.linked_dependency_key is distinct from 'anti-spam-secrets'
    or v_claim.supplied_value->>'status' is distinct from 'verified-prepared-awaiting-confirmation'
    or (v_claim.supplied_value->>'equivalent_insurespr_widget_found')::boolean
    or (v_claim.supplied_value->>'existing_widget_reusable_for_insurespr')::boolean
    or (v_claim.supplied_value->>'widget_created')::boolean
    or not (v_claim.supplied_value->>'creation_awaiting_action_time_confirmation')::boolean
    or (v_claim.supplied_value->>'credential_values_recorded')::boolean
    or (v_claim.supplied_value->>'vercel_keys_configured')::boolean
    or (v_claim.supplied_value->>'intake_ready')::boolean
  then
    raise exception using errcode = '23514', message = 'Turnstile provider inventory was not stored fail-closed';
  end if;

  select *
  into strict v_dependency
  from public.launch_dependencies
  where dependency_key = 'anti-spam-secrets';

  if v_dependency.status is distinct from 'open'
    or not v_dependency.blocks_launch
    or v_dependency.resolved_at is not null
    or v_dependency.detail not like '%not reusable for InsureSPR%'
    or v_dependency.detail not like '%pending immediate user confirmation%'
    or v_dependency.detail not like '%BOT_CHECK_UNAVAILABLE%'
  then
    raise exception using errcode = '23514', message = 'Provider inventory must not close or weaken the anti-spam dependency';
  end if;

  select *
  into strict v_settings
  from public.practice_settings
  where id = 'primary';

  if v_settings.privacy_notice_version !~* '^pending'
    or exists (select 1 from public.booking_slots)
    or exists (select 1 from public.customers)
    or exists (select 1 from public.bookings)
    or exists (select 1 from public.employer_leads)
    or exists (select 1 from public.contact_enquiries)
    or exists (select 1 from public.notification_attempts)
  then
    raise exception using errcode = '23514', message = 'Provider inventory registration must not open intake or create operational records';
  end if;

  if has_table_privilege('anon', 'private.readiness_evidence_documents', 'SELECT')
    or has_table_privilege('authenticated', 'private.readiness_evidence_documents', 'SELECT')
    or has_table_privilege('service_role', 'private.readiness_evidence_documents', 'SELECT')
    or has_table_privilege('anon', 'private.readiness_evidence_claims', 'SELECT')
    or has_table_privilege('authenticated', 'private.readiness_evidence_claims', 'SELECT')
    or has_table_privilege('service_role', 'private.readiness_evidence_claims', 'SELECT')
  then
    raise exception using errcode = '42501', message = 'Turnstile provider inventory unexpectedly became API-readable';
  end if;
end;
$$;

commit;
