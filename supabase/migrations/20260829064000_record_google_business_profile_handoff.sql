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
  'insurespr-google-business-profile-handoff-20260829',
  'InsureSPR Google Business Profile alignment handoff',
  'GOOGLE-BUSINESS-PROFILE-ALIGNMENT.json',
  'internal_record',
  decode('b4f371f46ebe4af1ffe2a8e1773a618ed29fc9381785d2d073f498e2fea2737c', 'hex'),
  date '2026-08-29',
  'Phuture Digital production verification',
  'Technical operator',
  'The exact non-secret handoff is version-controlled and excluded from the public Vercel deployment. It contains website-published identity, hours and destinations, plus explicit nulls for every missing account-side fact.',
  'accepted',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 08:40:00+02',
  'Prepared-not-applied handoff: 16 service destinations match the production sitemap and local pages. Profile resource, authorised editor, categories, special hours and account-review evidence remain absent. No Google account mutation or service verification is claimed.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-google-business-profile-handoff-20260829'
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
  'google-business-profile-handoff-prepared',
  'Search and maps alignment',
  1,
  jsonb_build_object(
    'status', 'prepared-not-applied',
    'activation_authorized', false,
    'account_side_verified', false,
    'canonical_website', 'https://www.insuresprhealth.co.za/',
    'canonical_phone_e164', '+27834507861',
    'service_destination_count', 16,
    'profile_resource_name', null,
    'authorized_editor', null,
    'primary_category', null
  ),
  'verified',
  true,
  'google-business-profile',
  'This verifies the handoff contract and website-side alignment only. It does not verify, authorize or change any Google Business Profile field.',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 08:40:00+02'
from evidence_document;

update public.launch_dependencies
set
  detail = 'A hash-bound prepared-not-applied handoff now fixes the canonical website name, Randburg address, 083 450 7861 phone, website-published weekday hours and all 16 production service destinations. The profile resource name, authorised editor, primary and additional categories, special hours, live account values and account-side review evidence remain absent. No profile mutation or service publication is authorised; reconcile those fields in the controlled Google account and retain before/after evidence before closing this gate.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'google-business-profile';

do $$
declare
  v_document_id uuid;
  v_claim private.readiness_evidence_claims%rowtype;
  v_dependency public.launch_dependencies%rowtype;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-google-business-profile-handoff-20260829'
    and review_status = 'accepted'
    and content_sha256 = decode('b4f371f46ebe4af1ffe2a8e1773a618ed29fc9381785d2d073f498e2fea2737c', 'hex');

  select *
  into strict v_claim
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and claim_key = 'google-business-profile-handoff-prepared';

  if v_claim.review_status is distinct from 'verified'
     or not v_claim.public_use_allowed
     or v_claim.linked_dependency_key is distinct from 'google-business-profile'
     or v_claim.supplied_value->>'status' is distinct from 'prepared-not-applied'
     or (v_claim.supplied_value->>'activation_authorized')::boolean is distinct from false
     or (v_claim.supplied_value->>'account_side_verified')::boolean is distinct from false
     or (v_claim.supplied_value->>'service_destination_count')::integer is distinct from 16
     or v_claim.supplied_value->>'profile_resource_name' is not null
     or v_claim.supplied_value->>'authorized_editor' is not null
     or v_claim.supplied_value->>'primary_category' is not null then
    raise exception using errcode = '23514', message = 'Google Business Profile handoff evidence was not stored exactly';
  end if;

  select *
  into strict v_dependency
  from public.launch_dependencies
  where dependency_key = 'google-business-profile';

  if v_dependency.status is distinct from 'open'
     or not v_dependency.blocks_launch
     or v_dependency.resolved_at is not null
     or v_dependency.detail not like '%No profile mutation or service publication is authorised%'
     or v_dependency.detail not like '%before closing this gate%' then
    raise exception using errcode = '23514', message = 'Prepared profile handoff must not close the account-side launch gate';
  end if;

  if (select privacy_notice_version from public.practice_settings where id = 'primary') !~* '^pending'
     or exists (select 1 from public.customers)
     or exists (select 1 from public.bookings)
     or exists (select 1 from public.employer_leads)
     or exists (select 1 from public.contact_enquiries)
     or exists (select 1 from public.notification_attempts) then
    raise exception using errcode = '23514', message = 'Profile handoff evidence must not open intake or create operational rows';
  end if;
end;
$$;

commit;
