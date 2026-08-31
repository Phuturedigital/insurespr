begin;

create policy retention_legal_holds_deny_all
on private.retention_legal_holds
for all
to public
using (false)
with check (false);

create policy retention_runs_deny_all
on private.retention_runs
for all
to public
using (false)
with check (false);

do $$
declare
  v_inventory_rows integer;
  v_supported_rows integer;
  v_run_id uuid;
  v_run_rows integer;
begin
  select count(*), count(*) filter (where inventory.guarded_purge_supported)
  into v_inventory_rows, v_supported_rows
  from private.retention_inventory() as inventory;

  if v_inventory_rows <> 9 or v_supported_rows <> 4 then
    raise exception using errcode = '23514', message = 'retention inventory must expose all nine approved record classes and only four guarded purge classes';
  end if;

  if exists (
    select 1
    from private.retention_inventory() as inventory
    where inventory.guarded_purge_supported
      and (inventory.eligible_count <> 0 or inventory.held_count <> 0)
  ) then
    raise exception using errcode = '23514', message = 'initial production retention dry run unexpectedly found an eligible or held disposal candidate';
  end if;

  select result.run_id, count(*)
  into v_run_id, v_run_rows
  from private.apply_retention_policy() as result
  group by result.run_id;

  if v_run_id is null or v_run_rows <> 9 then
    raise exception using errcode = '23514', message = 'production retention dry run did not return the complete inventory';
  end if;

  if not exists (
    select 1
    from private.retention_runs as run
    where run.id = v_run_id
      and run.status = 'dry_run'
      and not run.execution_requested
      and not run.executed
      and run.deletion_counts = jsonb_build_object(
        'notification_delivery_metadata', 0,
        'anonymous_analytics', 0,
        'rate_limit_records', 0,
        'management_credentials', 0
      )
  ) then
    raise exception using errcode = '23514', message = 'production retention dry-run evidence is incomplete';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'private'
      and policy.tablename in ('retention_legal_holds', 'retention_runs')
      and policy.policyname in ('retention_legal_holds_deny_all', 'retention_runs_deny_all')
  ) <> 2 or exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'private'
      and policy.tablename in ('retention_legal_holds', 'retention_runs')
      and replace(policy.qual, ' ', '') not in ('false', '(false)')
  ) then
    raise exception using errcode = '42501', message = 'retention RLS policies must remain deny-all';
  end if;

  if exists (select 1 from public.customers)
    or exists (select 1 from public.bookings)
    or exists (select 1 from public.employer_leads)
    or exists (select 1 from public.contact_enquiries)
    or exists (select 1 from public.notification_attempts)
  then
    raise exception using errcode = '23514', message = 'retention hardening must not create patient, lead, enquiry or notification rows';
  end if;
end;
$$;

commit;
