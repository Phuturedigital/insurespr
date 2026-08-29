begin;

insert into private.readiness_evidence_documents (
  document_key,
  title,
  source_filename,
  source_kind,
  content_sha256,
  document_date,
  supplied_by,
  supplied_role,
  custody_note,
  review_status,
  reviewed_by,
  reviewed_at,
  notes
)
values (
  'insurespr-live-bridge-verification-20260829',
  'InsureSPR official-domain verification bridge observation',
  'release-audit-20260829T061325Z',
  'internal_record',
  decode('c8a40b7e45ba2fc62b175b5d0ba8ce48df2bd745e3f6b64967ce044779bb88c3', 'hex'),
  date '2026-08-29',
  'Phuture Digital production verification',
  'Technical operator',
  'The canonical non-secret production observation is stored in this migration. The full read-only audit is reproducible from the public origin and repository tooling; no Turnstile token, signing key, raw IP, form value or patient data is retained.',
  'accepted',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 08:18:00+02',
  'Canonical observation: deployment:dpl_DWV8fQjravFSbCN7NLbhAb21SzR6;origin:https://www.insuresprhealth.co.za;bridge:200;region:fra1;cache:no-store;secrets:false;protected:bookings|employer-leads|contact-enquiries=BOT_CHECK_UNAVAILABLE;audit:11pass-1warn-10fail;ci:33238030337. This verifies the deployed bridge boundary while preserving every unresolved readiness failure.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-live-bridge-verification-20260829'
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
  reviewer_note,
  verified_by,
  verified_at
)
select
  evidence_document.id,
  'official-domain-bridge-live',
  'Production verification bridge',
  1,
  jsonb_build_object(
    'deployment_id', 'dpl_DWV8fQjravFSbCN7NLbhAb21SzR6',
    'origin', 'https://www.insuresprhealth.co.za',
    'services_status', 200,
    'function_region', 'fra1',
    'cache_control', 'no-store',
    'secret_marker_present', false,
    'protected_probe_result', 'BOT_CHECK_UNAVAILABLE',
    'protected_routes', jsonb_build_array('bookings', 'employer-leads', 'contact-enquiries'),
    'release_audit', jsonb_build_object('pass', 11, 'warn', 1, 'fail', 10),
    'github_quality_run', '33238030337'
  ),
  'verified',
  true,
  'anti-spam-secrets',
  'The official-domain bridge is live, same-origin, no-store, Frankfurt-routed, contract-equivalent to Supabase and fail-closed while provider keys are absent. Cloudflare widget issuance and the full valid-token test matrix remain required.',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 08:18:00+02'
from evidence_document;

update public.launch_dependencies
set
  detail = 'The official-domain same-origin Vercel bridge is live in fra1, matches the authoritative Supabase service response, exposes no secret marker and rejects empty booking, employer and contact probes. The Ed25519 signature verifier and private single-use nonce guard are deployed. Intake remains blocked until Cloudflare issues an official-domain Turnstile site key and matching secret, both keys are stored together in Vercel, and controlled missing, invalid, expired, wrong-action, wrong-hostname, replay and valid-token tests pass without unintended writes.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'anti-spam-secrets';

do $$
declare
  v_document_id uuid;
  v_claim private.readiness_evidence_claims%rowtype;
  v_dependency public.launch_dependencies%rowtype;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-live-bridge-verification-20260829'
    and review_status = 'accepted'
    and content_sha256 = decode('c8a40b7e45ba2fc62b175b5d0ba8ce48df2bd745e3f6b64967ce044779bb88c3', 'hex');

  select *
  into strict v_claim
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and claim_key = 'official-domain-bridge-live';

  if v_claim.review_status is distinct from 'verified'
     or not v_claim.public_use_allowed
     or v_claim.linked_dependency_key is distinct from 'anti-spam-secrets'
     or v_claim.supplied_value->>'deployment_id' is distinct from 'dpl_DWV8fQjravFSbCN7NLbhAb21SzR6'
     or v_claim.supplied_value->>'function_region' is distinct from 'fra1'
     or (v_claim.supplied_value->>'secret_marker_present')::boolean is distinct from false
     or v_claim.supplied_value->'release_audit'->>'pass' is distinct from '11' then
    raise exception using errcode = '23514', message = 'Live bridge evidence was not stored exactly';
  end if;

  select *
  into strict v_dependency
  from public.launch_dependencies
  where dependency_key = 'anti-spam-secrets';

  if v_dependency.status is distinct from 'open'
     or not v_dependency.blocks_launch
     or v_dependency.resolved_at is not null
     or v_dependency.detail not like '%Cloudflare issues an official-domain Turnstile site key and matching secret%'
     or v_dependency.detail not like '%valid-token tests pass without unintended writes%' then
    raise exception using errcode = '23514', message = 'Live bridge verification must not close the provider launch gate';
  end if;

  if (select privacy_notice_version from public.practice_settings where id = 'primary') !~* '^pending'
     or exists (select 1 from public.customers)
     or exists (select 1 from public.bookings)
     or exists (select 1 from public.employer_leads)
     or exists (select 1 from public.contact_enquiries)
     or exists (select 1 from public.notification_attempts) then
    raise exception using errcode = '23514', message = 'Live bridge evidence must not open intake or create operational rows';
  end if;
end;
$$;

commit;

