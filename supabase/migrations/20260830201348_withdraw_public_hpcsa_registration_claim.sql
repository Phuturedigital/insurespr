begin;

update private.readiness_evidence_documents
set
  content_sha256 = decode('6a1da8c3a790db148c9d7560ccf1c98e7833040330d5e0ce0f98d9fdfe7f6f7d', 'hex'),
  custody_note = 'Controlled operational evidence only. The owner requested on 30 August 2026 that the public website not publish the registration number, regulator status, register result or regulator source trail.',
  notes = 'The regulator-register result remains verified internally. Publication permission was withdrawn by the owner; the repository artifact is excluded from every Vercel deployment.'
where document_key = 'hpcsa-practitioner-20260830';

update private.readiness_evidence_claims as claim
set
  public_use_allowed = false,
  reviewer_note = 'Verified for controlled operational use only. The owner requested on 30 August 2026 that the public website not publish the registration number, regulator status, register result or regulator source trail. This claim must not be used in public HTML, structured metadata or search-facing content.'
from private.readiness_evidence_documents as document
where claim.document_id = document.id
  and document.document_key = 'hpcsa-practitioner-20260830'
  and claim.claim_key = 'motselisi-hpcsa-registration-status';

update public.launch_dependencies
set
  detail = 'A regulator-register check is retained as private operational evidence. At the owner''s request, the public website must not display the registration number, register status, result or regulator source trail. Controlled equipment/use licence evidence, responsible-person appointment, any other practitioner registrations, BHF/entity and medical-aid evidence, reporting route and service-specific clinical capability remain unverified.',
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
    raise exception using errcode = '23514', message = 'private-only practitioner evidence state is incomplete';
  end if;

  if not exists (
    select 1
    from public.launch_dependencies
    where dependency_key = 'verified-credentials'
      and status = 'open'
      and blocks_launch
      and resolved_at is null
  ) then
    raise exception using errcode = '23514', message = 'publication withdrawal must not close the broader credential dependency';
  end if;

  if exists (
    select 1
    from public.services
    where verification_status <> 'needs_confirmation'
  ) then
    raise exception using errcode = '23514', message = 'publication withdrawal must not verify service capability';
  end if;

  select
    (select count(*) from public.bookings)
    + (select count(*) from public.employer_leads)
    + (select count(*) from public.contact_enquiries)
    + (select count(*) from public.consent_records)
    + (select count(*) from public.notification_attempts)
  into v_operational_rows;

  if v_operational_rows <> 0 then
    raise exception using errcode = '23514', message = 'publication withdrawal must not create operational records';
  end if;
end
$$;

commit;
