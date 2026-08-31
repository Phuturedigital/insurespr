begin;

create index notification_delivery_configurations_evidence_document_id_idx
  on private.notification_delivery_configurations (evidence_document_id);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index as index_definition
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_definition.indexrelid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_definition.indrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_relation.relnamespace
    where namespace.nspname = 'private'
      and table_relation.relname = 'notification_delivery_configurations'
      and index_relation.relname = 'notification_delivery_configurations_evidence_document_id_idx'
      and index_definition.indisvalid
  ) then
    raise exception using errcode = '23514', message = 'notification evidence foreign-key index was not created';
  end if;
end;
$$;

commit;
