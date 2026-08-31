begin;

create policy notification_delivery_configurations_deny_api_roles
on private.notification_delivery_configurations
as restrictive
for all
to anon, authenticated, service_role
using (false)
with check (false);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'private'
      and tablename = 'notification_delivery_configurations'
      and policyname = 'notification_delivery_configurations_deny_api_roles'
      and permissive = 'RESTRICTIVE'
      and roles @> array['anon', 'authenticated', 'service_role']::name[]
      and qual = 'false'
      and with_check = 'false'
  ) then
    raise exception using errcode = '23514', message = 'Notification configuration deny policy was not installed exactly';
  end if;

  if has_table_privilege('anon', 'private.notification_delivery_configurations', 'SELECT')
     or has_table_privilege('authenticated', 'private.notification_delivery_configurations', 'SELECT')
     or has_table_privilege('service_role', 'private.notification_delivery_configurations', 'SELECT')
     or has_table_privilege('anon', 'private.notification_delivery_configurations', 'INSERT')
     or has_table_privilege('authenticated', 'private.notification_delivery_configurations', 'INSERT')
     or has_table_privilege('service_role', 'private.notification_delivery_configurations', 'INSERT') then
    raise exception using errcode = '23514', message = 'Notification configuration table privileges are broader than the private deny-all model';
  end if;
end;
$$;

commit;
