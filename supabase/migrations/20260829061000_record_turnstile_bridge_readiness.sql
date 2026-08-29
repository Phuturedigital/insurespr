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
  'insurespr-turnstile-bridge-20260829',
  'InsureSPR Turnstile verification bridge readiness',
  'vercel-supabase-turnstile-bridge-20260829',
  'internal_record',
  decode('7d4b948feb6d543d08319b1e69c49745d148f8a5f449626fdb49aa4e5629a6d4', 'hex'),
  date '2026-08-29',
  'Phuture Digital deployment',
  'Technical operator',
  'The canonical non-secret observation is stored in this migration. The Ed25519 private key and future Turnstile secret remain in provider secret stores and are not copied into the evidence register.',
  'accepted',
  'Phuture Digital deployment verification',
  timestamptz '2026-08-29 07:50:00+02',
  'Canonical observation: vercel:INSURESPR_PROXY_PRIVATE_KEY_B64:production+preview;supabase:insurespr-api:v16;replay_guard:20260829060000;turnstile_widget_keys:pending. Unit, Deno, browser and Vercel packaging tests passed before this record. This is partial technical readiness, not authorization to open intake.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-turnstile-bridge-20260829'
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
  'signed-bridge-ready',
  'Public-form protection architecture',
  1,
  jsonb_build_object(
    'vercel_private_key_environments', jsonb_build_array('production', 'preview'),
    'supabase_function', 'insurespr-api',
    'supabase_function_version', 16,
    'replay_guard_migration', '20260829060000',
    'turnstile_widget_keys', 'pending'
  ),
  'verified',
  true,
  'anti-spam-secrets',
  'The signing key boundary, exact-body verification and private single-use nonce guard are verified. The Cloudflare widget, both issued keys and controlled official-domain acceptance/rejection run are still missing, so the dependency remains open.',
  'Phuture Digital deployment verification',
  timestamptz '2026-08-29 07:50:00+02'
from evidence_document;

update public.launch_dependencies
set
  detail = 'The same-origin Vercel verification bridge, server-only Ed25519 private key, Supabase public-key verifier and private single-use nonce guard are deployed and tested. Intake remains blocked until Cloudflare issues an official-domain Turnstile site key and matching secret, both keys are stored together in Vercel, and controlled official-domain missing, invalid, expired, wrong-action, wrong-hostname, replay and valid-token tests pass without unintended writes.',
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
  where document_key = 'insurespr-turnstile-bridge-20260829'
    and source_kind = 'internal_record'
    and review_status = 'accepted'
    and content_sha256 = decode('7d4b948feb6d543d08319b1e69c49745d148f8a5f449626fdb49aa4e5629a6d4', 'hex');

  select *
  into strict v_claim
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and claim_key = 'signed-bridge-ready';

  if v_claim.review_status is distinct from 'verified'
     or not v_claim.public_use_allowed
     or v_claim.linked_dependency_key is distinct from 'anti-spam-secrets'
     or v_claim.supplied_value->>'turnstile_widget_keys' is distinct from 'pending'
     or v_claim.supplied_value->>'replay_guard_migration' is distinct from '20260829060000' then
    raise exception using errcode = '23514', message = 'Turnstile bridge evidence was not stored exactly';
  end if;

  select *
  into strict v_dependency
  from public.launch_dependencies
  where dependency_key = 'anti-spam-secrets';

  if v_dependency.status is distinct from 'open'
     or not v_dependency.blocks_launch
     or v_dependency.resolved_at is not null
     or v_dependency.detail not like '%official-domain Turnstile site key and matching secret%'
     or v_dependency.detail not like '%controlled official-domain%' then
    raise exception using errcode = '23514', message = 'Partial bridge readiness must not close the anti-spam launch gate';
  end if;

  select * into strict v_settings from public.practice_settings where id = 'primary';
  if v_settings.privacy_notice_version !~* '^pending' then
    raise exception using errcode = '23514', message = 'Bridge readiness must not open intake';
  end if;

  if exists (select 1 from public.customers)
     or exists (select 1 from public.bookings)
     or exists (select 1 from public.employer_leads)
     or exists (select 1 from public.contact_enquiries)
     or exists (select 1 from public.notification_attempts) then
    raise exception using errcode = '23514', message = 'Bridge readiness evidence must not create operational records';
  end if;
end;
$$;

commit;

