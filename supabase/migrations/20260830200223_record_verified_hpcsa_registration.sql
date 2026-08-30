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
  'hpcsa-practitioner-20260830',
  'Private practitioner-register verification',
  'HPCSA-REGISTRATION-EVIDENCE.json',
  'internal_record',
  decode('6a1da8c3a790db148c9d7560ccf1c98e7833040330d5e0ce0f98d9fdfe7f6f7d', 'hex'),
  date '2026-08-30',
  'evidence-schema-v2',
  'Controlled regulator-register check',
  'Operational verification',
  'Detailed query and result are held only in controlled private storage. The public repository artifact records no registration number, register status, result or regulator source trail.',
  'accepted',
  'Phuture Digital regulator-register check',
  timestamptz '2026-08-30 22:04:08+02',
  'The owner declined public display of the professional registration details. This record verifies only that a controlled practitioner-register check exists.'
)
on conflict (document_key) do update
set
  title = excluded.title,
  source_filename = excluded.source_filename,
  source_kind = excluded.source_kind,
  content_sha256 = excluded.content_sha256,
  document_date = excluded.document_date,
  form_version = excluded.form_version,
  supplied_by = excluded.supplied_by,
  supplied_role = excluded.supplied_role,
  custody_note = excluded.custody_note,
  review_status = excluded.review_status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  notes = excluded.notes;

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'hpcsa-practitioner-20260830'
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
  'motselisi-hpcsa-registration-status',
  '4.3 Practitioners and current professional status',
  1,
  jsonb_build_object(
    'subject', 'Motselisi R. Mosiana',
    'verification_record', 'retained in private controlled storage',
    'details_withheld_from_public_repository', true
  ),
  'verified',
  false,
  'verified-credentials',
  'Verified for controlled operational use only. The registration number, regulator status, result and source trail must not be used in public HTML, structured metadata or search-facing content.',
  'Phuture Digital regulator-register check',
  timestamptz '2026-08-30 22:04:08+02'
from evidence_document
on conflict (document_id, claim_key) do update
set
  section = excluded.section,
  source_page = excluded.source_page,
  supplied_value = excluded.supplied_value,
  review_status = excluded.review_status,
  public_use_allowed = excluded.public_use_allowed,
  linked_dependency_key = excluded.linked_dependency_key,
  reviewer_note = excluded.reviewer_note,
  verified_by = excluded.verified_by,
  verified_at = excluded.verified_at;

update public.launch_dependencies
set
  detail = 'A regulator-register check is retained as private operational evidence. The public website and repository must not display the registration number, register status, result or regulator source trail. Broader equipment, licensing, appointment, billing, reporting and service-capability evidence remains unverified.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'verified-credentials';

do $$
declare
  v_operational_rows bigint;
begin
  if not exists (
    select 1
    from private.readiness_evidence_documents as document
    join private.readiness_evidence_claims as claim
      on claim.document_id = document.id
    where document.document_key = 'hpcsa-practitioner-20260830'
      and document.content_sha256 = decode('6a1da8c3a790db148c9d7560ccf1c98e7833040330d5e0ce0f98d9fdfe7f6f7d', 'hex')
      and claim.claim_key = 'motselisi-hpcsa-registration-status'
      and claim.review_status = 'verified'
      and not claim.public_use_allowed
      and claim.linked_dependency_key = 'verified-credentials'
  ) then
    raise exception using errcode = '23514', message = 'private practitioner verification record is incomplete';
  end if;

  if not exists (
    select 1 from public.launch_dependencies
    where dependency_key = 'verified-credentials'
      and status = 'open'
      and blocks_launch
      and resolved_at is null
  ) then
    raise exception using errcode = '23514', message = 'bounded evidence must not close the broader credential dependency';
  end if;

  if exists (select 1 from public.services where verification_status <> 'needs_confirmation') then
    raise exception using errcode = '23514', message = 'practitioner evidence must not verify service capability';
  end if;

  select
    (select count(*) from public.bookings)
    + (select count(*) from public.employer_leads)
    + (select count(*) from public.contact_enquiries)
    + (select count(*) from public.consent_records)
    + (select count(*) from public.notification_attempts)
  into v_operational_rows;

  if v_operational_rows <> 0 then
    raise exception using errcode = '23514', message = 'evidence registration must not create operational records';
  end if;
end
$$;

commit;
