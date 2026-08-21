begin;

do $$
begin
  if not exists (
    select 1
    from public.practice_settings
    where id = 'primary'
  ) then
    raise exception 'Primary practice settings are missing';
  end if;
end;
$$;

update public.practice_settings
set
  phone_display = '083 450 7861',
  phone_e164 = '+27834507861',
  whatsapp_e164 = '27834507861',
  public_email = 'motselisi@bonevc.co.za'
where id = 'primary';

update public.launch_dependencies
set
  detail = 'Owner Motselisi R. Mosiana is the named booking contact and approved recipient. Public evidence links her to 083 450 7861 and motselisi@bonevc.co.za; the receiving domain had an MX record on 2026-08-21. Automated delivery remains blocked until the sender domain, SPF, DKIM, DMARC, provider secrets and end-to-end delivery test are complete.',
  evidence_url = 'https://www.webportunities.net/tab_pages/general/supplier_info/supplier_info.aspx?SupplierId=MjIyMjA%3D&prth_act=info'
where dependency_key = 'email-delivery';

update public.launch_dependencies
set
  detail = 'Owner Motselisi R. Mosiana is the named booking recipient and first-line escalation owner. Phone, WhatsApp and the public receiving email are approved. Queued notification sending remains blocked until sender/reply-to configuration, worker secret, schedule monitoring and a controlled delivery test are complete.',
  evidence_url = 'https://www.webportunities.net/tab_pages/general/supplier_info/supplier_info.aspx?SupplierId=MjIyMjA%3D&prth_act=info'
where dependency_key = 'notification-operations';

update public.launch_dependencies
set
  detail = 'Owner approved website privacy notice 2026-08-21.1 and designated Motselisi R. Mosiana as the Information Officer on 2026-08-21. Intake remains blocked pending Information Regulator registration evidence, final operational sign-off and processor activation evidence.'
where dependency_key = 'privacy-popia';

update public.launch_dependencies
set
  detail = 'Owner approved 083 450 7861 as the practice booking phone and WhatsApp contact. Remaining work is to confirm that Google Business Profile name, address, hours, service destinations and canonical website match production.',
  evidence_url = 'https://www.webportunities.net/tab_pages/general/supplier_info/supplier_info.aspx?SupplierId=MjIyMjA%3D&prth_act=info'
where dependency_key = 'google-business-profile';

do $$
declare
  v_settings public.practice_settings%rowtype;
  v_privacy_detail text;
begin
  select *
  into strict v_settings
  from public.practice_settings
  where id = 'primary';

  if v_settings.phone_display is distinct from '083 450 7861'
    or v_settings.phone_e164 is distinct from '+27834507861'
    or v_settings.whatsapp_e164 is distinct from '27834507861'
    or v_settings.public_email is distinct from 'motselisi@bonevc.co.za'
  then
    raise exception 'Owner booking contact contract was not stored exactly';
  end if;

  if v_settings.privacy_notice_version is distinct from 'pending-approval' then
    raise exception 'Contact approval must not open public intake or publish a privacy version';
  end if;

  select detail
  into strict v_privacy_detail
  from public.launch_dependencies
  where dependency_key = 'privacy-popia';

  if v_privacy_detail not like '%designated Motselisi R. Mosiana as the Information Officer%'
    or (
      select count(*)
      from public.launch_dependencies
      where dependency_key in (
        'email-delivery',
        'notification-operations',
        'privacy-popia',
        'google-business-profile'
      )
      and status = 'open'
      and blocks_launch
    ) <> 4
  then
    raise exception 'Contact approvals must preserve their remaining launch gates';
  end if;
end;
$$;

commit;
