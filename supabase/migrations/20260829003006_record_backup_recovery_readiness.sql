begin;

create table private.platform_recovery_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null check (provider in ('supabase')),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  observed_at timestamptz not null,
  observed_by text not null check (char_length(observed_by) between 1 and 160),
  evidence_status text not null check (evidence_status in ('verified_platform_state', 'superseded')),
  organization_plan text not null check (char_length(organization_plan) between 1 and 80),
  project_status text not null check (char_length(project_status) between 1 and 80),
  region text not null check (region ~ '^[a-z]{2}-[a-z]+-[0-9]+$'),
  database_version text not null check (char_length(database_version) between 1 and 80),
  managed_daily_backups_included boolean not null,
  pitr_included boolean not null,
  offsite_logical_backup_verified boolean not null,
  rpo_minutes integer check (rpo_minutes is null or rpo_minutes > 0),
  rto_minutes integer check (rto_minutes is null or rto_minutes > 0),
  recovery_owner text check (recovery_owner is null or char_length(recovery_owner) between 1 and 160),
  last_restore_drill_at timestamptz,
  source_reference text not null check (source_reference ~ '^https://supabase\.com/'),
  notes text not null check (char_length(notes) between 20 and 2000),
  created_at timestamptz not null default now(),
  unique (provider, project_ref, observed_at),
  check (last_restore_drill_at is null or last_restore_drill_at <= observed_at)
);

comment on table private.platform_recovery_observations is
  'Private point-in-time platform and recovery-capability evidence. It stores no database password, API key, backup payload or patient data.';

alter table private.platform_recovery_observations enable row level security;

create policy platform_recovery_observations_deny_all
on private.platform_recovery_observations
for all
to public
using (false)
with check (false);

revoke all on private.platform_recovery_observations
  from public, anon, authenticated, service_role;

insert into private.platform_recovery_observations (
  provider,
  project_ref,
  observed_at,
  observed_by,
  evidence_status,
  organization_plan,
  project_status,
  region,
  database_version,
  managed_daily_backups_included,
  pitr_included,
  offsite_logical_backup_verified,
  rpo_minutes,
  rto_minutes,
  recovery_owner,
  last_restore_drill_at,
  source_reference,
  notes
)
values (
  'supabase',
  'ffdmmxffzewqiacsuvhr',
  timestamptz '2026-08-29 02:23:00+02',
  'Phuture Digital release audit',
  'verified_platform_state',
  'free',
  'ACTIVE_HEALTHY',
  'eu-central-1',
  '17.6.1.155',
  false,
  false,
  false,
  null,
  null,
  null,
  null,
  'https://supabase.com/docs/guides/platform/backups',
  'The Supabase Management API verified the active project, database version, region and organization Free plan. Current provider documentation states that managed daily backups are included for Pro, Team and Enterprise projects and recommends regular off-site logical exports for Free projects. No approved off-site export, RPO, RTO, recovery owner or completed restore drill is on file.'
);

insert into public.launch_dependencies (
  dependency_key,
  category,
  title,
  detail,
  owner,
  status,
  blocks_launch,
  evidence_url,
  resolved_at
)
values (
  'backup-recovery',
  'technical',
  'Approve and verify backup and recovery capability',
  'Live Management API evidence on 2026-08-29 shows the production Supabase organization is on the Free plan. Managed daily backups and PITR are not included, and no encrypted off-site logical backup, approved RPO/RTO, named recovery owner or completed isolated restore drill is verified. Public intake must remain blocked until an approved recovery route is funded, implemented and tested.',
  'practice',
  'open',
  true,
  'https://supabase.com/docs/guides/platform/backups',
  null
)
on conflict (dependency_key) do update
set
  category = excluded.category,
  title = excluded.title,
  detail = excluded.detail,
  owner = excluded.owner,
  status = excluded.status,
  blocks_launch = excluded.blocks_launch,
  evidence_url = excluded.evidence_url,
  resolved_at = null,
  updated_at = now();

do $$
declare
  v_observation private.platform_recovery_observations%rowtype;
  v_public_privileges integer;
begin
  select observation.*
  into strict v_observation
  from private.platform_recovery_observations as observation
  where observation.provider = 'supabase'
    and observation.project_ref = 'ffdmmxffzewqiacsuvhr'
    and observation.observed_at = timestamptz '2026-08-29 02:23:00+02';

  if v_observation.organization_plan <> 'free'
    or v_observation.project_status <> 'ACTIVE_HEALTHY'
    or v_observation.region <> 'eu-central-1'
    or v_observation.database_version <> '17.6.1.155'
    or v_observation.managed_daily_backups_included
    or v_observation.pitr_included
    or v_observation.offsite_logical_backup_verified
    or v_observation.rpo_minutes is not null
    or v_observation.rto_minutes is not null
    or v_observation.recovery_owner is not null
    or v_observation.last_restore_drill_at is not null
  then
    raise exception using errcode = '23514', message = 'platform recovery observation does not preserve the verified fail-closed state';
  end if;

  if not exists (
    select 1
    from public.launch_dependencies as dependency
    where dependency.dependency_key = 'backup-recovery'
      and dependency.category = 'technical'
      and dependency.owner = 'practice'
      and dependency.status = 'open'
      and dependency.blocks_launch
      and dependency.resolved_at is null
  ) then
    raise exception using errcode = '23514', message = 'backup and recovery must remain a launch blocker';
  end if;

  if (
    select settings.privacy_notice_version
    from public.practice_settings as settings
    where settings.id = 'primary'
  ) !~* '^pending'
  then
    raise exception using errcode = '23514', message = 'recording recovery evidence must not open public intake';
  end if;

  if exists (select 1 from public.customers)
    or exists (select 1 from public.bookings)
    or exists (select 1 from public.employer_leads)
    or exists (select 1 from public.contact_enquiries)
    or exists (select 1 from public.notification_attempts)
  then
    raise exception using errcode = '23514', message = 'recovery evidence registration must not create operational submissions';
  end if;

  select count(*)
  into v_public_privileges
  from (
    values ('anon'::text), ('authenticated'::text), ('service_role'::text)
  ) as grantee(name)
  where has_table_privilege(grantee.name, 'private.platform_recovery_observations', 'SELECT')
     or has_table_privilege(grantee.name, 'private.platform_recovery_observations', 'INSERT')
     or has_table_privilege(grantee.name, 'private.platform_recovery_observations', 'UPDATE')
     or has_table_privilege(grantee.name, 'private.platform_recovery_observations', 'DELETE');

  if v_public_privileges <> 0 then
    raise exception using errcode = '42501', message = 'application roles have unexpected platform recovery evidence privileges';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'platform_recovery_observations'
      and relation.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'private'
      and policy.tablename = 'platform_recovery_observations'
      and policy.policyname = 'platform_recovery_observations_deny_all'
      and replace(policy.qual, ' ', '') in ('false', '(false)')
      and replace(policy.with_check, ' ', '') in ('false', '(false)')
  ) then
    raise exception using errcode = '42501', message = 'platform recovery evidence must retain deny-all RLS';
  end if;
end;
$$;

commit;
