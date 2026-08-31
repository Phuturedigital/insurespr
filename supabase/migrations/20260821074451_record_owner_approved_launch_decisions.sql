begin;

update public.practice_settings
set
  data_retention_policy = 'Website schedule approved 2026-08-21: spam/incomplete submissions 90 days; unconverted enquiries and employer leads 24 months; booking requests, history and consent 6 years after last activity; notification delivery metadata 12 months; anonymous analytics 13 months; rate-limit records no more than 30 days; management credentials expire after 90 days; audit/security evidence 6 years after closure unless a documented legal hold or another statutory/professional duty applies.',
  updated_at = now()
where id = 'primary';

update public.launch_dependencies
set
  status = 'confirmed',
  blocks_launch = false,
  detail = case dependency_key
    when 'service-catalogue' then
      'Owner approved the conservative 16-service request-led catalogue on 2026-08-21. Publication does not verify clinical facts: each service remains needs_confirmation until its evidence is held.'
    when 'blog-migration' then
      'Owner approved an inactive hold for every inventoried legacy content URL on 2026-08-21. No content is migrated, deleted or redirected without a later URL-specific licensing and clinical decision.'
    when 'domain-redirects' then
      'Owner approved the 153-entry no-routing hold on 2026-08-21. activationAuthorized remains false; no mass redirect to an unrelated page is permitted.'
    else detail
  end,
  resolved_at = null,
  updated_at = now()
where dependency_key in ('service-catalogue', 'blog-migration', 'domain-redirects');

update public.launch_dependencies
set
  status = 'open',
  blocks_launch = true,
  detail = case dependency_key
    when 'privacy-popia' then
      'Owner approved website privacy notice 2026-08-21.1 and the website retention schedule. Intake remains blocked pending Information Officer registration evidence, final operational sign-off and processor activation evidence.'
    when 'anti-spam-secrets' then
      'Cloudflare Turnstile is the approved provider. Intake remains blocked until an official-domain site key and matching secret are stored together and the full rejection/acceptance test passes.'
    when 'email-delivery' then
      'Resend is the approved adapter. Delivery remains blocked until the account, receiving mailbox, sending domain, SPF, DKIM, DMARC, sender, reply-to, independent worker secret, Cron owner and end-to-end delivery evidence exist.'
    when 'verified-credentials' then
      'Owner approved the evidence-first publication rule. Equipment licence, responsible person, practitioner registrations and reporting scope remain unverified and must not be inferred.'
    when 'approved-prices' then
      'Owner approved keeping prices unpublished. The supplied rate report is review evidence only until effective date, billing meaning, VAT, service mapping and source anomalies are resolved.'
    when 'booking-rules' then
      'Owner approved keeping availability inactive. Actual duration, notice, horizon, buffer, weekly rota, closures, equipment capacity and schedule owner are still required.'
    when 'notification-operations' then
      'Owner approved fail-closed queued notifications. Recipients, escalation owner, sender/reply-to and scheduler operation remain unconfigured.'
    when 'clinical-requirements' then
      'Owner approved conservative request-led wording. Written-request, preparation, result, reporting and service-capability facts remain evidence-bound.'
    else detail
  end,
  resolved_at = null,
  updated_at = now()
where dependency_key in (
  'privacy-popia',
  'anti-spam-secrets',
  'email-delivery',
  'verified-credentials',
  'approved-prices',
  'booking-rules',
  'notification-operations',
  'clinical-requirements'
);

do $$
declare
  v_policy text;
  v_notice text;
  v_confirmed integer;
  v_open integer;
begin
  select settings.data_retention_policy, settings.privacy_notice_version
  into v_policy, v_notice
  from public.practice_settings as settings
  where settings.id = 'primary';

  if v_policy is null or position('Website schedule approved 2026-08-21' in v_policy) <> 1 then
    raise exception using errcode = '23514', message = 'owner-approved retention policy was not recorded';
  end if;

  if v_notice !~* '^pending' then
    raise exception using errcode = '23514', message = 'this decision migration must not open transactional intake';
  end if;

  select count(*) into v_confirmed
  from public.launch_dependencies as dependency
  where dependency.dependency_key in ('service-catalogue', 'blog-migration', 'domain-redirects')
    and dependency.status = 'confirmed'
    and dependency.blocks_launch is false;

  if v_confirmed <> 3 then
    raise exception using errcode = '23514', message = 'owner-decision dependencies were not confirmed safely';
  end if;

  select count(*) into v_open
  from public.launch_dependencies as dependency
  where dependency.dependency_key in (
      'privacy-popia',
      'anti-spam-secrets',
      'email-delivery',
      'verified-credentials',
      'approved-prices',
      'booking-rules',
      'notification-operations',
      'clinical-requirements'
    )
    and dependency.status = 'open'
    and dependency.blocks_launch is true;

  if v_open <> 8 then
    raise exception using errcode = '23514', message = 'evidence-bound dependencies must remain fail-closed';
  end if;
end;
$$;

commit;
