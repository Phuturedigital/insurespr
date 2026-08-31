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
  'insurespr-notification-activation-handoff-20260829',
  'InsureSPR notification activation handoff',
  'NOTIFICATION-ACTIVATION-HANDOFF.json',
  'internal_record',
  decode('bde0a6ecd538a0bd9be1af6cae2144fdabfbe25fc73f50a72d2c6d3e49725c6f', 'hex'),
  date '2026-08-29',
  'Phuture Digital production verification',
  'Technical operator',
  'The exact non-secret handoff is version-controlled and excluded from the public Vercel deployment. It records the live fail-closed worker/DNS/database baseline and the evidence contract for provider, sender, secrets, scheduler, controlled delivery, alerts and rollback.',
  'accepted',
  'Phuture Digital production verification',
  timestamptz '2026-08-29 09:42:00+02',
  'Prepared-not-approved handoff. The Resend adapter and Motselisi booking/Reply-To inbox are approved directions; provider account, sender-domain verification, SPF, Return-Path MX, DKIM, provider/worker secrets, Vault names, Cron, alerting and controlled delivery evidence remain absent. No mail, secret, queue row or scheduler was created.'
);

with evidence_document as (
  select id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-notification-activation-handoff-20260829'
), claims (
  claim_key,
  section,
  linked_dependency_key,
  supplied_value,
  reviewer_note
) as (
  values
    (
      'notification-zero-state-verified',
      'Live notification and scheduler baseline',
      'email-delivery',
      jsonb_build_object(
        'worker_readiness', 'not_ready',
        'deployed_function_version', 9,
        'repository_worker_source_sha256', '8946702d93327f8130ed108dba96952e9a06c3a9bda6d139bdf2e6988b01e8dd',
        'notification_attempt_count', 0,
        'notification_configuration_count', 0,
        'pg_cron_installed', false,
        'pg_net_installed', false,
        'notification_cron_job_count', 0,
        'notification_vault_secret_name_count', 0
      ),
      'The live worker is deployed but not ready. The production database contains no notification work or active delivery configuration and has no notification scheduler extensions or Vault secret names.'
    ),
    (
      'notification-dns-baseline-verified',
      'Public DNS evidence',
      'email-delivery',
      jsonb_build_object(
        'dmarc', jsonb_build_object(
          'hostname', '_dmarc.insuresprhealth.co.za',
          'record', 'v=DMARC1; p=none',
          'resolvers', jsonb_build_array('1.1.1.1', '8.8.8.8'),
          'verified', true
        ),
        'approved_reply_to', 'motselisi@bonevc.co.za',
        'approved_reply_domain_mx', true,
        'resend_spf', null,
        'return_path_mx', null,
        'resend_dkim', null,
        'official_inbound_mx', null
      ),
      'DMARC monitoring and the approved bonevc.co.za Reply-To MX are verified. This does not prove an outbound sender: Resend-compatible SPF, Return-Path MX and DKIM remain absent, and no official-domain inbound mailbox is claimed.'
    ),
    (
      'notification-activation-provenance-prepared',
      'Immutable database and worker activation gate',
      'email-delivery',
      jsonb_build_object(
        'configuration_table', 'private.notification_delivery_configurations',
        'activation_gate', 'public.notification_delivery_activation_ready',
        'configuration_count', 0,
        'exact_config_hash_required', true,
        'worker_source_hash_required', true,
        'secret_generation_fingerprints_required', true,
        'different_peer_reviewer_required', true,
        'plaintext_secrets_forbidden', true,
        'active_configuration_immutable', true
      ),
      'A complete later activation record must bind exact non-secret controls and secret-generation fingerprints to controlled evidence, an approver and different peer reviewer. The worker gate exposes only a boolean and is executable only by service_role.'
    ),
    (
      'notification-operations-activation-prepared',
      'Scheduler, monitoring, delivery proof and rollback',
      'notification-operations',
      jsonb_build_object(
        'scheduler_authorized', false,
        'schedule_name', null,
        'schedule_expression', null,
        'schedule_owner', null,
        'failure_alert_owner', null,
        'failure_alert_recipient', null,
        'rollback_authority', null,
        'controlled_delivery_test_completed', false,
        'duplicate_suppression_verified', false,
        'retry_verified', false,
        'failure_path_verified', false
      ),
      'Cron, Vault-backed invocation, failure alerts and end-to-end delivery remain explicitly unauthorized until their owners, exact configuration and controlled evidence are supplied. Activation rollback is an immutable active-to-revoked transition plus Cron unscheduling and secret rotation.'
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
  timestamptz '2026-08-29 09:42:00+02'
from evidence_document
cross join claims;

update public.launch_dependencies
set
  detail = 'A hash-bound prepared-not-approved notification activation handoff now verifies the exact fail-closed worker, DNS, queue, extension, Cron, Vault-name and configuration baseline. Resend and motselisi@bonevc.co.za remain approved directions, while provider account/domain proof, verified sender, SPF, Return-Path MX, DKIM, provider and worker secret fingerprints/custody, exact configuration hash, controlled delivery and failure-path evidence remain absent. A private immutable activation table and service-role-only boolean worker gate are installed, but no active configuration exists and delivery remains blocked.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'email-delivery';

update public.launch_dependencies
set
  detail = 'A hash-bound prepared-not-approved notification operations handoff defines the exact Cron name/expression/timezone, Vault secret names, schedule owner, failure-alert owner and recipient, rollback authority, controlled delivery, duplicate suppression, retry and failure-path evidence required for activation. pg_cron and pg_net remain absent, no notification Cron or Vault secret exists, no notification row exists and scheduler activation remains explicitly unauthorized.',
  status = 'open',
  blocks_launch = true,
  resolved_at = null
where dependency_key = 'notification-operations';

do $$
declare
  v_document_id uuid;
  v_claim_count integer;
  v_email_claim_count integer;
  v_operations_claim_count integer;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-notification-activation-handoff-20260829'
    and review_status = 'accepted'
    and content_sha256 = decode('bde0a6ecd538a0bd9be1af6cae2144fdabfbe25fc73f50a72d2c6d3e49725c6f', 'hex');

  select
    count(*),
    count(*) filter (where linked_dependency_key = 'email-delivery'),
    count(*) filter (where linked_dependency_key = 'notification-operations')
  into v_claim_count, v_email_claim_count, v_operations_claim_count
  from private.readiness_evidence_claims
  where document_id = v_document_id
    and review_status = 'verified'
    and public_use_allowed;

  if v_claim_count is distinct from 4
     or v_email_claim_count is distinct from 3
     or v_operations_claim_count is distinct from 1 then
    raise exception using errcode = '23514', message = 'Notification handoff must create exactly four correctly linked evidence claims';
  end if;

  if 2 <> (
       select count(*)
       from public.launch_dependencies
       where dependency_key in ('email-delivery', 'notification-operations')
         and status = 'open'
         and blocks_launch
         and resolved_at is null
     )
     or exists (select 1 from private.notification_delivery_configurations)
     or exists (select 1 from public.notification_attempts)
     or exists (select 1 from pg_extension where extname in ('pg_cron', 'pg_net'))
     or exists (
       select 1
       from vault.secrets
       where name ilike '%notification%' or name ilike '%resend%'
     )
     or (select privacy_notice_version from public.practice_settings where id = 'primary') !~* '^pending' then
    raise exception using errcode = '23514', message = 'Notification handoff must preserve the empty fail-closed delivery and intake state';
  end if;

  if has_function_privilege('anon', 'public.notification_delivery_activation_ready(text,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.notification_delivery_activation_ready(text,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.notification_delivery_activation_ready(text,text,text,text,text)', 'EXECUTE') then
    raise exception using errcode = '23514', message = 'Notification worker activation gate ACL differs from service-role-only contract';
  end if;
end;
$$;

commit;
