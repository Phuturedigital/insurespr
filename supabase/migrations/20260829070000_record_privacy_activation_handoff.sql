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
  'insurespr-privacy-activation-handoff-20260829',
  'InsureSPR privacy activation handoff',
  'PRIVACY-ACTIVATION-HANDOFF.json',
  'internal_record',
  decode('6778b1b810cce32d44394ddd4edbbe76076dff981cce6845b2e2e4abe6566b81', 'hex'),
  date '2026-08-29',
  'Phuture Digital production verification',
  'Technical operator',
  'The exact non-secret handoff is version-controlled and excluded from the public Vercel deployment. It separates previously owner-approved public wording from legal, regulator, processor, recovery and operating evidence that remains in controlled custody or is absent.',
  'accepted',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 09:05:00+02',
  'Prepared-not-approved handoff: the live notice and API match publication version 2026-08-21.1, the Motselisi R. Mosiana designation/contact, no registration claim and approved website retention schedule. The database privacy version remains pending-approval. Legal identity, Information Regulator evidence, processor reviews, provider activation, recovery approval, operating owners and final release approval remain incomplete.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-privacy-activation-handoff-20260829'
), claims (
  claim_key,
  section,
  supplied_value,
  linked_dependency_key,
  reviewer_note
) as (
  values
    (
      'privacy-identity-and-information-officer-approval-prepared',
      'Legal identity and Information Officer',
      jsonb_build_object(
        'publication_version', '2026-08-21.1',
        'database_privacy_version', 'pending-approval',
        'designated_information_officer', 'Motselisi R. Mosiana',
        'information_regulator_registration_claimed', false,
        'legal_registration_evidence_ref', null,
        'information_regulator_evidence_ref', null,
        'paia_manual_ref', null
      ),
      'privacy-popia',
      'Previously approved publication wording and designation are preserved. The conflicting legal registration year and absent regulator/PAIA evidence prevent operational privacy activation.'
    ),
    (
      'privacy-active-processor-review-prepared',
      'Active platform processors',
      jsonb_build_object(
        'processors', jsonb_build_array('Supabase', 'Vercel'),
        'contract_reviews_completed', 0,
        'location_and_subprocessor_reviews_completed', 0,
        'popia_section_72_reviews_completed', 0,
        'deletion_and_incident_routes_completed', 0
      ),
      'privacy-popia',
      'Supabase and Vercel are technically active, but the controlled contractual, subprocessor, transfer, deletion and incident-route evidence references remain null.'
    ),
    (
      'privacy-turnstile-processor-approval-prepared',
      'Cloudflare Turnstile processor activation',
      jsonb_build_object(
        'technical_state', 'not-active-keys-missing',
        'processor_approval_completed', false,
        'activation_evidence_ref', null
      ),
      'anti-spam-secrets',
      'Turnstile is described conditionally in the notice but is not an approved active intake processor until both keys, processor review and controlled token tests exist.'
    ),
    (
      'privacy-resend-processor-approval-prepared',
      'Resend processor activation',
      jsonb_build_object(
        'technical_state', 'not-active-account-and-domain-evidence-missing',
        'processor_approval_completed', false,
        'activation_evidence_ref', null
      ),
      'email-delivery',
      'Resend is the selected provider but cannot receive queued data until the account, domain, sender authentication, processor review and controlled delivery evidence exist.'
    ),
    (
      'privacy-operating-ownership-approval-prepared',
      'Privacy operations and incident response',
      jsonb_build_object(
        'privacy_request_owner', null,
        'privacy_request_deputy', null,
        'retention_enforcement_owner', null,
        'security_incident_owner', null,
        'operator_access_approval_ref', null,
        'notification_activation_evidence_ref', null
      ),
      'notification-operations',
      'The database has owner-only privacy and incident controls, but named operating owners, deputy cover, mailbox test, escalation routes, operator access and notification activation evidence remain incomplete.'
    ),
    (
      'privacy-backup-retention-approval-prepared',
      'Backup retention and recovery',
      jsonb_build_object(
        'approved_retention_target', 'rolling 35 days after controls are approved',
        'operational_backup_currently_verified', false,
        'backup_recovery_approval_ref', null
      ),
      'backup-recovery',
      'The 35-day backup row is a retention target, not proof that backups exist. Recovery ownership, off-site storage, key custody, RPO/RTO and a monitored drill remain required.'
    )
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
  claims.claim_key,
  claims.section,
  1,
  claims.supplied_value,
  'verified',
  true,
  claims.linked_dependency_key,
  claims.reviewer_note,
  'Phuture Digital production verification',
  timestamptz '2026-08-29 09:05:00+02'
from evidence_document
cross join claims;

update public.launch_dependencies
set
  detail = 'A hash-bound prepared-not-approved privacy handoff now reconciles the live 2026-08-21.1 notice, Motselisi R. Mosiana designation/contact, no-registration-claim wording and approved website retention schedule with the pending database gate. The conflicting legal registration year, Information Regulator evidence/reference, PAIA manual, Supabase/Vercel processor and section 72 reviews, privacy operators/deputy, mailbox and escalation tests, recovery approval and final named release decision remain incomplete. Do not change privacy_notice_version until the approved-mode packet passes, all linked processor/recovery gates close and a reviewed forward-only migration preserves fail-closed tests.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'privacy-popia';

do $$
declare
  v_document_id uuid;
  v_claim_count integer;
  v_open_dependencies integer;
  v_settings public.practice_settings%rowtype;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-privacy-activation-handoff-20260829'
    and review_status = 'accepted'
    and content_sha256 = decode('6778b1b810cce32d44394ddd4edbbe76076dff981cce6845b2e2e4abe6566b81', 'hex');

  select count(*)
  into v_claim_count
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and review_status = 'verified'
    and public_use_allowed
    and linked_dependency_key in (
      'privacy-popia',
      'anti-spam-secrets',
      'email-delivery',
      'notification-operations',
      'backup-recovery'
    );

  if v_claim_count is distinct from 6 then
    raise exception using errcode = '23514', message = 'Privacy activation handoff must create exactly six scoped evidence claims';
  end if;

  select count(*)
  into v_open_dependencies
  from public.launch_dependencies
  where dependency_key in (
      'privacy-popia',
      'anti-spam-secrets',
      'email-delivery',
      'notification-operations',
      'backup-recovery'
    )
    and status = 'open'
    and blocks_launch
    and resolved_at is null;

  if v_open_dependencies is distinct from 5 then
    raise exception using errcode = '23514', message = 'Prepared privacy handoff must leave all linked launch gates open';
  end if;

  select *
  into strict v_settings
  from public.practice_settings
  where id = 'primary';

  if v_settings.privacy_notice_version is distinct from 'pending-approval'
     or v_settings.public_email is distinct from 'motselisi@bonevc.co.za'
     or v_settings.phone_e164 is distinct from '+27834507861'
     or v_settings.data_retention_policy not like 'Website schedule approved 2026-08-21:%'
     or exists (select 1 from public.customers)
     or exists (select 1 from public.bookings)
     or exists (select 1 from public.employer_leads)
     or exists (select 1 from public.contact_enquiries)
     or exists (select 1 from public.notification_attempts) then
    raise exception using errcode = '23514', message = 'Prepared privacy handoff must preserve pending policy, approved contacts and empty intake';
  end if;
end;
$$;

commit;
