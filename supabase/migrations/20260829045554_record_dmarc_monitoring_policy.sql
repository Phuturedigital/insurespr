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
  'insurespr-dmarc-public-dns-20260829',
  'InsureSPR DMARC public DNS observation',
  '_dmarc.insuresprhealth.co.za TXT',
  'external_public_source',
  decode('0f0dd845d5be21169fc8d140a841ebc0a6aff639eae39971301d6ba1f2a371df', 'hex'),
  date '2026-08-29',
  'Phuture Digital deployment',
  'Technical operator',
  'The canonical observation is stored in this migration. It contains only the public hostname, public TXT value, resolver addresses and UTC observation time; no credential or mailbox content is stored.',
  'accepted',
  'Phuture Digital DNS verification',
  timestamptz '2026-08-29 04:52:18+00',
  'Cloudflare 1.1.1.1 and Google 8.8.8.8 both returned exactly v=DMARC1; p=none. RFC 9989 defines p=none as a non-enforcing monitoring policy. This observation does not verify SPF, DKIM, Return-Path MX, a mailbox, a sender identity, provider configuration or delivery.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-dmarc-public-dns-20260829'
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
  'dmarc-monitoring-policy',
  'Public DNS authentication observation',
  1,
  jsonb_build_object(
    'hostname', '_dmarc.insuresprhealth.co.za',
    'record', 'v=DMARC1; p=none',
    'resolvers', jsonb_build_array('1.1.1.1', '8.8.8.8'),
    'observed_at', '2026-08-29T04:52:18Z'
  ),
  'verified',
  true,
  'email-delivery',
  'The public monitoring policy is verified. It requests no enforcement and does not close the email-delivery dependency.',
  'Phuture Digital DNS verification',
  timestamptz '2026-08-29 04:52:18+00'
from evidence_document;

update public.launch_dependencies
set
  detail = 'A non-enforcing DMARC monitoring policy (v=DMARC1; p=none) was published at _dmarc.insuresprhealth.co.za and observed through Cloudflare and Google public resolvers on 2026-08-29. Email delivery remains blocked: the selected provider still requires its exact SPF, Return-Path MX and DKIM records, verified sender/reply-to configuration, provider and worker secrets, notification schedule ownership, failure alerts and controlled end-to-end delivery tests. info@insuresprhealth.co.za remains an unverified candidate; use the approved motselisi@bonevc.co.za Reply-To route.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'email-delivery';

do $$
declare
  v_document_id uuid;
  v_claim private.readiness_evidence_claims%rowtype;
  v_dependency public.launch_dependencies%rowtype;
  v_settings public.practice_settings%rowtype;
  v_service_count bigint;
  v_unverified_service_count bigint;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-dmarc-public-dns-20260829'
    and source_kind = 'external_public_source'
    and review_status = 'accepted'
    and content_sha256 = decode('0f0dd845d5be21169fc8d140a841ebc0a6aff639eae39971301d6ba1f2a371df', 'hex');

  select *
  into strict v_claim
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and claim_key = 'dmarc-monitoring-policy';

  if v_claim.review_status is distinct from 'verified'
    or not v_claim.public_use_allowed
    or v_claim.linked_dependency_key is distinct from 'email-delivery'
    or v_claim.supplied_value->>'record' is distinct from 'v=DMARC1; p=none'
    or v_claim.supplied_value->>'observed_at' is distinct from '2026-08-29T04:52:18Z'
  then
    raise exception using errcode = '23514', message = 'DMARC evidence claim was not stored exactly';
  end if;

  select *
  into strict v_dependency
  from public.launch_dependencies
  where dependency_key = 'email-delivery';

  if v_dependency.status is distinct from 'open'
    or not v_dependency.blocks_launch
    or v_dependency.resolved_at is not null
    or v_dependency.detail not like '%SPF, Return-Path MX and DKIM%'
    or v_dependency.detail not like '%motselisi@bonevc.co.za%'
  then
    raise exception using errcode = '23514', message = 'DMARC observation must not close or weaken the email launch gate';
  end if;

  select *
  into strict v_settings
  from public.practice_settings
  where id = 'primary';

  if v_settings.privacy_notice_version !~* '^pending'
    or v_settings.public_email is distinct from 'motselisi@bonevc.co.za'
  then
    raise exception using errcode = '23514', message = 'DNS evidence must not open intake or replace the approved receiving address';
  end if;

  select count(*), count(*) filter (where verification_status = 'needs_confirmation')
  into v_service_count, v_unverified_service_count
  from public.services
  where is_published;

  if v_service_count is distinct from 16::bigint
    or v_unverified_service_count is distinct from 16::bigint
    or exists (select 1 from public.booking_slots)
  then
    raise exception using errcode = '23514', message = 'DNS evidence must not verify services or create availability';
  end if;

  if exists (select 1 from public.customers)
    or exists (select 1 from public.bookings)
    or exists (select 1 from public.employer_leads)
    or exists (select 1 from public.contact_enquiries)
    or exists (select 1 from public.notification_attempts)
  then
    raise exception using errcode = '23514', message = 'DNS evidence registration must not create operational records';
  end if;
end;
$$;

commit;
