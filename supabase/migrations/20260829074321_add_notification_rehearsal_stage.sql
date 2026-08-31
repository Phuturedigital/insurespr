begin;

alter table private.notification_delivery_configurations
  drop constraint notification_delivery_configurations_state_check,
  drop constraint notification_delivery_configurations_check2,
  alter column controlled_delivery_evidence_ref drop not null,
  alter column failure_alert_test_evidence_ref drop not null,
  alter column activated_at drop not null,
  add column rehearsal_authorized_at timestamptz,
  add column rehearsal_expires_at timestamptz,
  add column rehearsal_recipient text,
  add column rehearsal_evidence_ref text;

alter table private.notification_delivery_configurations
  add constraint notification_delivery_configurations_state_check
    check (state in ('rehearsal', 'active', 'revoked')),
  add constraint notification_delivery_configurations_rehearsal_recipient_check
    check (rehearsal_recipient is null or (rehearsal_recipient = lower(rehearsal_recipient) and rehearsal_recipient like '%@%')),
  add constraint notification_delivery_configurations_rehearsal_evidence_check
    check (rehearsal_evidence_ref is null or length(btrim(rehearsal_evidence_ref)) >= 8),
  add constraint notification_delivery_configurations_lifecycle_check check (
    (
      state = 'rehearsal'
      and rehearsal_authorized_at is not null
      and rehearsal_expires_at > rehearsal_authorized_at
      and rehearsal_expires_at <= rehearsal_authorized_at + interval '24 hours'
      and rehearsal_recipient is not null
      and rehearsal_evidence_ref is not null
      and controlled_delivery_evidence_ref is null
      and failure_alert_test_evidence_ref is null
      and activated_at is null
      and revoked_at is null
      and revocation_reason is null
    )
    or (
      state = 'active'
      and rehearsal_authorized_at is not null
      and rehearsal_expires_at > rehearsal_authorized_at
      and rehearsal_recipient is not null
      and rehearsal_evidence_ref is not null
      and controlled_delivery_evidence_ref is not null
      and failure_alert_test_evidence_ref is not null
      and activated_at is not null
      and revoked_at is null
      and revocation_reason is null
    )
    or (
      state = 'revoked'
      and revoked_at is not null
      and length(btrim(revocation_reason)) >= 8
    )
  );

comment on column private.notification_delivery_configurations.rehearsal_expires_at is
  'A short-lived approval window, no longer than 24 hours, for a controlled synthetic queue test before Cron or public intake is enabled.';
comment on column private.notification_delivery_configurations.rehearsal_recipient is
  'Approved non-patient mailbox used for the controlled worker rehearsal. It must not be copied from a public form submission.';

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
    if new.state <> 'rehearsal' then
      raise exception 'notification configurations must enter through a short-lived rehearsal, never directly as active'
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
     or new.rehearsal_authorized_at is distinct from old.rehearsal_authorized_at
     or new.rehearsal_expires_at is distinct from old.rehearsal_expires_at
     or new.rehearsal_recipient is distinct from old.rehearsal_recipient
     or new.rehearsal_evidence_ref is distinct from old.rehearsal_evidence_ref then
    raise exception 'notification activation configuration, approval and rehearsal evidence are immutable; revoke it and insert a new revision'
      using errcode = '55000';
  end if;

  if old.state = 'rehearsal' and new.state = 'active' then
    if new.controlled_delivery_evidence_ref is null
       or new.failure_alert_test_evidence_ref is null
       or new.activated_at is null
       or new.revoked_at is not null
       or new.revocation_reason is not null then
      raise exception 'controlled delivery, failure-alert evidence and activation timestamp are required after rehearsal'
        using errcode = '22023';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.state in ('rehearsal', 'active') and new.state = 'revoked' then
    if new.revoked_at is null or length(btrim(new.revocation_reason)) < 8 then
      raise exception 'revocation timestamp and reason are required'
        using errcode = '22023';
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'notification activation records permit only rehearsal-to-active or rehearsal/active-to-revoked transitions'
    using errcode = '55000';
end;
$$;

create or replace function public.notification_delivery_activation_ready(
  p_config_sha256 text,
  p_worker_source_sha256 text,
  p_provider text,
  p_email_from text,
  p_email_reply_to text,
  p_mode text
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
     or p_mode not in ('rehearsal', 'active')
     or nullif(btrim(p_provider), '') is null
     or nullif(btrim(p_email_from), '') is null
     or nullif(btrim(p_email_reply_to), '') is null then
    return false;
  end if;

  select configuration.*
  into v_config
  from private.notification_delivery_configurations as configuration
  where configuration.state = p_mode
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
    and (
      p_mode = 'active'
      or (now() >= configuration.rehearsal_authorized_at and now() < configuration.rehearsal_expires_at)
    )
  limit 1;

  if not found then
    return false;
  end if;

  if p_mode = 'rehearsal' then
    return true;
  end if;

  if 2 <> (
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

create or replace function public.notification_delivery_activation_ready(
  p_config_sha256 text,
  p_worker_source_sha256 text,
  p_provider text,
  p_email_from text,
  p_email_reply_to text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.notification_delivery_activation_ready(
    p_config_sha256,
    p_worker_source_sha256,
    p_provider,
    p_email_from,
    p_email_reply_to,
    'active'
  );
$$;

revoke all on function public.notification_delivery_activation_ready(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.notification_delivery_activation_ready(text, text, text, text, text, text)
  to service_role;

comment on function public.notification_delivery_activation_ready(text, text, text, text, text, text) is
  'Fail-closed service-role worker gate. Rehearsal mode permits only an exact short-lived reviewed configuration; active mode additionally requires resolved dependencies and a matching active pg_cron/pg_net job.';

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
      state,
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
      rehearsal_authorized_at,
      rehearsal_expires_at,
      rehearsal_recipient,
      rehearsal_evidence_ref
    ) values (
      repeat('0', 64),
      'rehearsal',
      'resend',
      'notification-rehearsal-probe-account',
      'notification-rehearsal-probe-domain',
      'insuresprhealth.co.za',
      'send.insuresprhealth.co.za',
      'resend._domainkey.insuresprhealth.co.za',
      'InsureSPR <bookings@insuresprhealth.co.za>',
      'motselisi@bonevc.co.za',
      'motselisi@bonevc.co.za',
      repeat('a', 64),
      repeat('b', 64),
      repeat('c', 64),
      'notification_probe_project_url',
      'notification_probe_publishable_key',
      'notification_probe_worker_secret',
      'insurespr-notification-rehearsal-probe',
      '*/5 * * * *',
      'Africa/Johannesburg',
      8,
      v_document_id,
      'notification_rehearsal_probe_approver',
      'notification_rehearsal_probe_peer',
      timestamptz '2026-08-29 09:50:00+02',
      'NOTIFY-REHEARSAL-PROBE',
      'notification_rehearsal_probe_schedule_owner',
      'notification_rehearsal_probe_alert_owner',
      'notification_rehearsal_probe_rollback',
      'controlled:probe-spf',
      'controlled:probe-return-path-mx',
      'controlled:probe-dkim',
      'controlled:probe-dmarc',
      'controlled:probe-sender',
      'controlled:probe-provider-secret',
      'controlled:probe-worker-secret',
      clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '1 hour',
      'motselisi@bonevc.co.za',
      'controlled:probe-rehearsal'
    );

    select *
    into strict v_config
    from private.notification_delivery_configurations
    where schedule_name = 'insurespr-notification-rehearsal-probe';

    if not public.notification_delivery_activation_ready(
         v_config.config_sha256,
         v_config.worker_source_sha256,
         v_config.provider,
         v_config.email_from,
         v_config.email_reply_to,
         'rehearsal'
       )
       or public.notification_delivery_activation_ready(
         v_config.config_sha256,
         v_config.worker_source_sha256,
         v_config.provider,
         v_config.email_from,
         v_config.email_reply_to
       ) then
      raise exception using errcode = '23514', message = 'Notification rehearsal/active gate separation failed';
    end if;

    update private.notification_delivery_configurations
    set
      state = 'active',
      controlled_delivery_evidence_ref = 'controlled:probe-delivery',
      failure_alert_test_evidence_ref = 'controlled:probe-alert',
      activated_at = clock_timestamp()
    where id = v_config.id;

    select * into strict v_config
    from private.notification_delivery_configurations
    where schedule_name = 'insurespr-notification-rehearsal-probe';

    if public.notification_delivery_activation_ready(
      v_config.config_sha256,
      v_config.worker_source_sha256,
      v_config.provider,
      v_config.email_from,
      v_config.email_reply_to
    ) then
      raise exception using errcode = '23514', message = 'Active notification gate ignored unresolved dependencies and absent Cron';
    end if;

    begin
      update private.notification_delivery_configurations
      set email_from = 'Changed <changed@insuresprhealth.co.za>'
      where id = v_config.id;
      raise exception using errcode = '23514', message = 'Immutable rehearsal configuration changed in place';
    exception
      when sqlstate '55000' then null;
    end;

    update private.notification_delivery_configurations
    set
      state = 'revoked',
      revoked_at = clock_timestamp(),
      revocation_reason = 'Rollback-only rehearsal probe'
    where id = v_config.id;

    raise exception 'ROLLBACK_NOTIFICATION_REHEARSAL_STAGE_PROBE';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_NOTIFICATION_REHEARSAL_STAGE_PROBE' then
        raise;
      end if;
  end;

  if exists (select 1 from private.notification_delivery_configurations) then
    raise exception using errcode = '23514', message = 'Notification rehearsal stage probe did not roll back';
  end if;
end;
$$;

commit;
