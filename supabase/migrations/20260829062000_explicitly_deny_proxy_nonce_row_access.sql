begin;

create policy proxy_attestation_nonces_deny_all
on private.proxy_attestation_nonces
for all
to public
using (false)
with check (false);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'private'
      and tablename = 'proxy_attestation_nonces'
      and policyname = 'proxy_attestation_nonces_deny_all'
      and roles = array['public']::name[]
      and qual = 'false'
      and with_check = 'false'
  ) then
    raise exception 'proxy attestation nonce deny-all policy is missing';
  end if;

  if has_table_privilege('anon', 'private.proxy_attestation_nonces', 'SELECT')
     or has_table_privilege('authenticated', 'private.proxy_attestation_nonces', 'SELECT')
     or has_table_privilege('service_role', 'private.proxy_attestation_nonces', 'SELECT') then
    raise exception 'proxy attestation nonce table grants are too broad';
  end if;
end;
$$;

commit;

