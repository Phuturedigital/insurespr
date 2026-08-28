begin;

create policy readiness_evidence_documents_deny_all
on private.readiness_evidence_documents
for all
to public
using (false)
with check (false);

create policy readiness_evidence_claims_deny_all
on private.readiness_evidence_claims
for all
to public
using (false)
with check (false);

create index readiness_evidence_claims_dependency_idx
on private.readiness_evidence_claims(linked_dependency_key)
where linked_dependency_key is not null;

revoke all on private.readiness_evidence_documents from public, anon, authenticated, service_role;
revoke all on private.readiness_evidence_claims from public, anon, authenticated, service_role;

do $$
declare
  v_policy_count integer;
  v_acl_count integer;
  v_index_valid boolean;
begin
  select count(*)
  into v_policy_count
  from pg_catalog.pg_policy as policy
  join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and (
      (relation.relname = 'readiness_evidence_documents' and policy.polname = 'readiness_evidence_documents_deny_all')
      or (relation.relname = 'readiness_evidence_claims' and policy.polname = 'readiness_evidence_claims_deny_all')
    )
    and policy.polcmd = '*';

  if v_policy_count <> 2 then
    raise exception using errcode = '42501', message = 'readiness evidence deny policies are incomplete';
  end if;

  select count(*)
  into v_acl_count
  from (
    values
      ('private.readiness_evidence_documents'::text),
      ('private.readiness_evidence_claims'::text)
  ) as relation(name)
  cross join (
    values
      ('public'::text),
      ('anon'::text),
      ('authenticated'::text),
      ('service_role'::text)
  ) as grantee(name)
  where has_table_privilege(grantee.name, relation.name, 'SELECT')
     or has_table_privilege(grantee.name, relation.name, 'INSERT')
     or has_table_privilege(grantee.name, relation.name, 'UPDATE')
     or has_table_privilege(grantee.name, relation.name, 'DELETE');

  if v_acl_count <> 0 then
    raise exception using errcode = '42501', message = 'readiness evidence tables have unexpected data privileges';
  end if;

  select index_state.indisvalid and index_state.indisready
  into v_index_valid
  from pg_catalog.pg_index as index_state
  join pg_catalog.pg_class as index_relation on index_relation.oid = index_state.indexrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = index_relation.relnamespace
  where namespace.nspname = 'private'
    and index_relation.relname = 'readiness_evidence_claims_dependency_idx';

  if v_index_valid is distinct from true then
    raise exception using errcode = '23514', message = 'readiness evidence dependency index is not valid';
  end if;
end;
$$;

commit;
