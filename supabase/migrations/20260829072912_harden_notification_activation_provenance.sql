begin;

create table private.notification_delivery_configurations (
  id uuid primary key default gen_random_uuid(),
  config_revision bigint generated always as identity unique check (config_revision > 0),
  config_sha256 text not null unique check (config_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'active' check (state in ('active', 'revoked')),
  provider text not null check (provider = 'resend'),
  provider_account_reference text not null check (length(btrim(provider_account_reference)) >= 8),
  provider_domain_reference text not null check (length(btrim(provider_domain_reference)) >= 8),
  sender_domain text not null check (
    sender_domain = lower(sender_domain)
    and (sender_domain = 'insuresprhealth.co.za' or sender_domain like '%.insuresprhealth.co.za')
  ),
  return_path_hostname text not null check (return_path_hostname = lower(return_path_hostname)),
  dkim_hostname text not null check (dkim_hostname = lower(dkim_hostname)),
  email_from text not null check (position('@' || sender_domain in lower(email_from)) > 0),
  email_reply_to text not null check (email_reply_to = lower(email_reply_to) and email_reply_to like '%@%'),
  practice_recipient text not null check (practice_recipient = lower(practice_recipient) and practice_recipient like '%@%'),
  worker_source_sha256 text not null check (worker_source_sha256 ~ '^[a-f0-9]{64}$'),
  provider_api_key_fingerprint text not null check (provider_api_key_fingerprint ~ '^[a-f0-9]{64}$'),
  worker_secret_fingerprint text not null check (worker_secret_fingerprint ~ '^[a-f0-9]{64}$'),
  provider_secret_name text not null default 'RESEND_API_KEY' check (provider_secret_name = 'RESEND_API_KEY'),
  worker_secret_name text not null default 'NOTIFICATION_WORKER_SECRET' check (worker_secret_name = 'NOTIFICATION_WORKER_SECRET'),
  config_hash_secret_name text not null default 'NOTIFICATION_CONFIG_SHA256' check (config_hash_secret_name = 'NOTIFICATION_CONFIG_SHA256'),
  worker_hash_secret_name text not null default 'NOTIFICATION_WORKER_SOURCE_SHA256' check (worker_hash_secret_name = 'NOTIFICATION_WORKER_SOURCE_SHA256'),
  vault_project_url_secret_name text not null check (length(btrim(vault_project_url_secret_name)) >= 8),
  vault_publishable_key_secret_name text not null check (length(btrim(vault_publishable_key_secret_name)) >= 8),
  vault_worker_secret_name text not null check (length(btrim(vault_worker_secret_name)) >= 8),
  schedule_name text not null unique check (length(btrim(schedule_name)) >= 8),
  schedule_expression text not null check (length(btrim(schedule_expression)) between 5 and 64),
  schedule_timezone text not null default 'Africa/Johannesburg' check (schedule_timezone = 'Africa/Johannesburg'),
  batch_size integer not null default 8 check (batch_size between 1 and 25),
  evidence_document_id uuid not null references private.readiness_evidence_documents(id) on delete restrict,
  approved_by text not null check (nullif(btrim(approved_by), '') is not null),
  peer_reviewed_by text not null check (nullif(btrim(peer_reviewed_by), '') is not null and approved_by <> peer_reviewed_by),
  approved_at timestamptz not null,
  approval_change_reference text not null check (length(btrim(approval_change_reference)) >= 8),
  schedule_owner text not null check (nullif(btrim(schedule_owner), '') is not null),
  failure_alert_owner text not null check (nullif(btrim(failure_alert_owner), '') is not null),
  rollback_authority text not null check (nullif(btrim(rollback_authority), '') is not null),
  spf_evidence_ref text not null check (length(btrim(spf_evidence_ref)) >= 8),
  return_path_mx_evidence_ref text not null check (length(btrim(return_path_mx_evidence_ref)) >= 8),
  dkim_evidence_ref text not null check (length(btrim(dkim_evidence_ref)) >= 8),
  dmarc_evidence_ref text not null check (length(btrim(dmarc_evidence_ref)) >= 8),
  sender_verification_evidence_ref text not null check (length(btrim(sender_verification_evidence_ref)) >= 8),
  provider_secret_evidence_ref text not null check (length(btrim(provider_secret_evidence_ref)) >= 8),
  worker_secret_evidence_ref text not null check (length(btrim(worker_secret_evidence_ref)) >= 8),
  controlled_delivery_evidence_ref text not null check (length(btrim(controlled_delivery_evidence_ref)) >= 8),
  failure_alert_test_evidence_ref text not null check (length(btrim(failure_alert_test_evidence_ref)) >= 8),
  activated_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'active' and revoked_at is null and revocation_reason is null)
    or (state = 'revoked' and revoked_at is not null and length(btrim(revocation_reason)) >= 8)
  )
);

alter table private.notification_delivery_configurations enable row level security;
revoke all on table private.notification_delivery_configurations from public, anon, authenticated, service_role;

comment on table private.notification_delivery_configurations is
  'Private, immutable activation records for outbound transactional email. Values are non-secret configuration, SHA-256 fingerprints and controlled evidence references; API keys and worker secrets never belong in this table.';
comment on column private.notification_delivery_configurations.config_sha256 is
  'Database-computed SHA-256 of the exact non-secret provider, sender, recipient, schedule, worker-source and secret-generation fingerprint configuration.';
comment on column private.notification_delivery_configurations.provider_api_key_fingerprint is
  'SHA-256 fingerprint used to bind an approval to one secret generation. It is not an API key and cannot be used to send email.';
comment on column private.notification_delivery_configurations.worker_secret_fingerprint is
  'SHA-256 fingerprint used to bind an approval to one scheduler-secret generation. It is not the worker secret.';

create or replace function private.notification_delivery_config_sha256(
  p_provider text,
  p_provider_account_reference text,
  p_provider_domain_reference text,
  p_sender_domain text,
  p_return_path_hostname text,
  p_dkim_hostname text,
  p_email_from text,
  p_email_reply_to text,
  p_practice_recipient text,
  p_worker_source_sha256 text,
  p_provider_api_key_fingerprint text,
  p_worker_secret_fingerprint text,
  p_vault_project_url_secret_name text,
  p_vault_publishable_key_secret_name text,
  p_vault_worker_secret_name text,
  p_schedule_name text,
  p_schedule_expression text,
  p_schedule_timezone text,
  p_batch_size integer
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'provider', p_provider,
          'provider_account_reference', p_provider_account_reference,
          'provider_domain_reference', p_provider_domain_reference,
          'sender_domain', p_sender_domain,
          'return_path_hostname', p_return_path_hostname,
          'dkim_hostname', p_dkim_hostname,
          'email_from', p_email_from,
          'email_reply_to', p_email_reply_to,
          'practice_recipient', p_practice_recipient,
          'worker_source_sha256', p_worker_source_sha256,
          'provider_api_key_fingerprint', p_provider_api_key_fingerprint,
          'worker_secret_fingerprint', p_worker_secret_fingerprint,
          'vault_project_url_secret_name', p_vault_project_url_secret_name,
          'vault_publishable_key_secret_name', p_vault_publishable_key_secret_name,
          'vault_worker_secret_name', p_vault_worker_secret_name,
          'schedule_name', p_schedule_name,
          'schedule_expression', p_schedule_expression,
          'schedule_timezone', p_schedule_timezone,
          'batch_size', p_batch_size
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke execute on function private.notification_delivery_config_sha256(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, integer
) from public, anon, authenticated, service_role;

create or replace function private.guard_notification_delivery_configuration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_hash text;
begin
  v_expected_hash := private.notification_delivery_config_sha256(
    new.provider,
    new.provider_account_reference,
    new.provider_domain_reference,
    new.sender_domain,
    new.return_path_hostname,
    new.dkim_hostname,
    new.email_from,
    new.email_reply_to,
    new.practice_recipient,
    new.worker_source_sha256,
    new.provider_api_key_fingerprint,
    new.worker_secret_fingerprint,
    new.vault_project_url_secret_name,
    new.vault_publishable_key_secret_name,
    new.vault_worker_secret_name,
    new.schedule_name,
    new.schedule_expression,
    new.schedule_timezone,
    new.batch_size
  );

  if tg_op = 'INSERT' then
    if new.state <> 'active' then
      raise exception 'notification configurations must be inserted only by a complete activation migration'
        using errcode = '55000';
    end if;
    new.config_sha256 := v_expected_hash;
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.config_revision is distinct from old.config_revision
     or new.config_sha256 is distinct from old.config_sha256
     or v_expected_hash is distinct from old.config_sha256
     or new.evidence_document_id is distinct from old.evidence_document_id
     or new.approved_by is distinct from old.approved_by
     or new.peer_reviewed_by is distinct from old.peer_reviewed_by
     or new.approved_at is distinct from old.approved_at
     or new.approval_change_reference is distinct from old.approval_change_reference
     or new.schedule_owner is distinct from old.schedule_owner
     or new.failure_alert_owner is distinct from old.failure_alert_owner
     or new.rollback_authority is distinct from old.rollback_authority
     or new.spf_evidence_ref is distinct from old.spf_evidence_ref
     or new.return_path_mx_evidence_ref is distinct from old.return_path_mx_evidence_ref
     or new.dkim_evidence_ref is distinct from old.dkim_evidence_ref
     or new.dmarc_evidence_ref is distinct from old.dmarc_evidence_ref
     or new.sender_verification_evidence_ref is distinct from old.sender_verification_evidence_ref
     or new.provider_secret_evidence_ref is distinct from old.provider_secret_evidence_ref
     or new.worker_secret_evidence_ref is distinct from old.worker_secret_evidence_ref
     or new.controlled_delivery_evidence_ref is distinct from old.controlled_delivery_evidence_ref
     or new.failure_alert_test_evidence_ref is distinct from old.failure_alert_test_evidence_ref
     or new.activated_at is distinct from old.activated_at then
    raise exception 'notification activation configuration and evidence are immutable; revoke it and insert a new revision'
      using errcode = '55000';
  end if;

  if old.state = 'active' and new.state = 'revoked' then
    if new.revoked_at is null or length(btrim(new.revocation_reason)) < 8 then
      raise exception 'revocation timestamp and reason are required'
        using errcode = '22023';
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'notification activation records permit only active-to-revoked transition'
    using errcode = '55000';
end;
$$;

revoke execute on function private.guard_notification_delivery_configuration()
  from public, anon, authenticated, service_role;

create trigger notification_delivery_configuration_guard
before insert or update on private.notification_delivery_configurations
for each row execute function private.guard_notification_delivery_configuration();

create or replace function public.notification_delivery_activation_ready(
  p_config_sha256 text,
  p_worker_source_sha256 text,
  p_provider text,
  p_email_from text,
  p_email_reply_to text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config private.notification_delivery_configurations%rowtype;
  v_cron_matches boolean := false;
begin
  if p_config_sha256 !~ '^[a-f0-9]{64}$'
     or p_worker_source_sha256 !~ '^[a-f0-9]{64}$'
     or nullif(btrim(p_provider), '') is null
     or nullif(btrim(p_email_from), '') is null
     or nullif(btrim(p_email_reply_to), '') is null then
    return false;
  end if;

  select configuration.*
  into v_config
  from private.notification_delivery_configurations as configuration
  where configuration.state = 'active'
    and configuration.config_sha256 = p_config_sha256
    and configuration.worker_source_sha256 = p_worker_source_sha256
    and configuration.provider = p_provider
    and configuration.email_from = p_email_from
    and configuration.email_reply_to = lower(p_email_reply_to)
    and configuration.practice_recipient = (
      select settings.public_email
      from public.practice_settings as settings
      where settings.id = 'primary'
    )
  limit 1;

  if not found
     or 2 <> (
       select count(*)
       from public.launch_dependencies as dependency
       where dependency.dependency_key in ('email-delivery', 'notification-operations')
         and dependency.status = 'resolved'
         and not dependency.blocks_launch
         and dependency.resolved_at is not null
     )
     or not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net')
     or to_regclass('cron.job') is null then
    return false;
  end if;

  execute $cron$
    select exists (
      select 1
      from cron.job
      where jobname = $1
        and schedule = $2
        and active
        and command ilike '%insurespr-notifications%'
        and command ilike '%' || $3 || '%'
    )
  $cron$
  into v_cron_matches
  using v_config.schedule_name, v_config.schedule_expression, v_config.vault_worker_secret_name;

  return coalesce(v_cron_matches, false);
exception
  when others then
    return false;
end;
$$;

revoke all on function public.notification_delivery_activation_ready(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.notification_delivery_activation_ready(text, text, text, text, text)
  to service_role;

comment on function public.notification_delivery_activation_ready(text, text, text, text, text) is
  'Fail-closed service-role worker gate. It returns true only for an exact immutable active configuration whose launch dependencies are resolved and whose matching pg_cron/pg_net scheduler is active. It never returns secret material.';

do $$
declare
  v_document_id uuid;
  v_config private.notification_delivery_configurations%rowtype;
begin
  select id
  into strict v_document_id
  from private.readiness_evidence_documents
  where document_key = 'insurespr-dmarc-public-dns-20260829';

  begin
    insert into private.notification_delivery_configurations (
      config_sha256,
      provider,
      provider_account_reference,
      provider_domain_reference,
      sender_domain,
      return_path_hostname,
      dkim_hostname,
      email_from,
      email_reply_to,
      practice_recipient,
      worker_source_sha256,
      provider_api_key_fingerprint,
      worker_secret_fingerprint,
      vault_project_url_secret_name,
      vault_publishable_key_secret_name,
      vault_worker_secret_name,
      schedule_name,
      schedule_expression,
      schedule_timezone,
      batch_size,
      evidence_document_id,
      approved_by,
      peer_reviewed_by,
      approved_at,
      approval_change_reference,
      schedule_owner,
      failure_alert_owner,
      rollback_authority,
      spf_evidence_ref,
      return_path_mx_evidence_ref,
      dkim_evidence_ref,
      dmarc_evidence_ref,
      sender_verification_evidence_ref,
      provider_secret_evidence_ref,
      worker_secret_evidence_ref,
      controlled_delivery_evidence_ref,
      failure_alert_test_evidence_ref,
      activated_at
    ) values (
      repeat('0', 64),
      'resend',
      'notification-provenance-probe-account',
      'notification-provenance-probe-domain',
      'send.insuresprhealth.co.za',
      'bounce.send.insuresprhealth.co.za',
      'resend._domainkey.send.insuresprhealth.co.za',
      'InsureSPR <bookings@send.insuresprhealth.co.za>',
      'motselisi@bonevc.co.za',
      'motselisi@bonevc.co.za',
      repeat('a', 64),
      repeat('b', 64),
      repeat('c', 64),
      'notification_probe_project_url',
      'notification_probe_publishable_key',
      'notification_probe_worker_secret',
      'insurespr-notification-probe',
      '*/5 * * * *',
      'Africa/Johannesburg',
      8,
      v_document_id,
      'notification_provenance_probe_approver',
      'notification_provenance_probe_peer',
      timestamptz '2026-08-29 09:45:00+02',
      'NOTIFY-PROVENANCE-PROBE',
      'notification_provenance_probe_schedule_owner',
      'notification_provenance_probe_alert_owner',
      'notification_provenance_probe_rollback',
      'controlled:probe-spf',
      'controlled:probe-return-path-mx',
      'controlled:probe-dkim',
      'controlled:probe-dmarc',
      'controlled:probe-sender',
      'controlled:probe-provider-secret',
      'controlled:probe-worker-secret',
      'controlled:probe-delivery',
      'controlled:probe-alert',
      timestamptz '2026-08-29 09:46:00+02'
    );

    select *
    into strict v_config
    from private.notification_delivery_configurations
    where schedule_name = 'insurespr-notification-probe';

    if v_config.config_sha256 = repeat('0', 64)
       or v_config.config_sha256 <> private.notification_delivery_config_sha256(
         v_config.provider,
         v_config.provider_account_reference,
         v_config.provider_domain_reference,
         v_config.sender_domain,
         v_config.return_path_hostname,
         v_config.dkim_hostname,
         v_config.email_from,
         v_config.email_reply_to,
         v_config.practice_recipient,
         v_config.worker_source_sha256,
         v_config.provider_api_key_fingerprint,
         v_config.worker_secret_fingerprint,
         v_config.vault_project_url_secret_name,
         v_config.vault_publishable_key_secret_name,
         v_config.vault_worker_secret_name,
         v_config.schedule_name,
         v_config.schedule_expression,
         v_config.schedule_timezone,
         v_config.batch_size
       ) then
      raise exception using errcode = '23514', message = 'Notification configuration hash was not computed from exact controls';
    end if;

    if public.notification_delivery_activation_ready(
      v_config.config_sha256,
      v_config.worker_source_sha256,
      v_config.provider,
      v_config.email_from,
      v_config.email_reply_to
    ) then
      raise exception using errcode = '23514', message = 'Notification activation gate ignored unresolved dependencies and absent scheduler';
    end if;

    begin
      update private.notification_delivery_configurations
      set email_from = 'Changed <changed@send.insuresprhealth.co.za>'
      where id = v_config.id;
      raise exception using errcode = '23514', message = 'Immutable notification controls changed in place';
    exception
      when sqlstate '55000' then null;
    end;

    update private.notification_delivery_configurations
    set
      state = 'revoked',
      revoked_at = timestamptz '2026-08-29 09:47:00+02',
      revocation_reason = 'Rollback-only migration probe'
    where id = v_config.id;

    raise exception 'ROLLBACK_NOTIFICATION_ACTIVATION_PROVENANCE_PROBE';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_NOTIFICATION_ACTIVATION_PROVENANCE_PROBE' then
        raise;
      end if;
  end;

  if exists (select 1 from private.notification_delivery_configurations) then
    raise exception using errcode = '23514', message = 'Notification activation provenance probe did not roll back';
  end if;
end;
$$;

commit;
