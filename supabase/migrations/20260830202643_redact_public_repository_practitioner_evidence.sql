begin;

update private.readiness_evidence_documents
set
  content_sha256 = decode('6a1da8c3a790db148c9d7560ccf1c98e7833040330d5e0ce0f98d9fdfe7f6f7d', 'hex'),
  form_version = 'evidence-schema-v2',
  custody_note = 'Detailed query and result are retained only in controlled private storage. The public repository artifact records the custody and publication boundary without reproducing the credential value.',
  notes = 'The owner declined public display of the registration number, regulator status, register result and regulator source trail. The Vercel deployment and public repository source carry no credential value.'
where document_key = 'hpcsa-practitioner-20260830';

update private.readiness_evidence_claims as claim
set
  public_use_allowed = false,
  reviewer_note = 'Verified for controlled operational use only. Public HTML, structured metadata, search-facing content and repository evidence must not reproduce the registration number, regulator status, result or source trail.'
from private.readiness_evidence_documents as document
where claim.document_id = document.id
  and document.document_key = 'hpcsa-practitioner-20260830'
  and claim.claim_key = 'motselisi-hpcsa-registration-status';

do $$
begin
  if not exists (
    select 1
    from private.readiness_evidence_documents as document
    join private.readiness_evidence_claims as claim
      on claim.document_id = document.id
    where document.document_key = 'hpcsa-practitioner-20260830'
      and document.content_sha256 = decode('6a1da8c3a790db148c9d7560ccf1c98e7833040330d5e0ce0f98d9fdfe7f6f7d', 'hex')
      and document.form_version = 'evidence-schema-v2'
      and claim.claim_key = 'motselisi-hpcsa-registration-status'
      and claim.review_status = 'verified'
      and not claim.public_use_allowed
  ) then
    raise exception using errcode = '23514', message = 'redacted repository evidence boundary is incomplete';
  end if;
end
$$;

commit;
