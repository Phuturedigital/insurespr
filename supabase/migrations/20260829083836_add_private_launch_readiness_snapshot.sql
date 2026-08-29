-- Consolidate launch state into one private, aggregate-only operator snapshot.
-- The function deliberately returns no submission rows, contact values,
-- evidence URLs, provider references, fingerprints, or secrets.

create or replace function private.launch_readiness_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'evaluated_at', now(),
    'status', case
      when public.public_intake_activation_ready() then 'ready'
      else 'blocked'
    end,
    'ready_for_public_intake', public.public_intake_activation_ready(),
    'privacy', (
      select jsonb_build_object(
        'notice_version', settings.privacy_notice_version,
        'approved', nullif(btrim(settings.privacy_notice_version), '') is not null
          and settings.privacy_notice_version !~* '^pending'
      )
      from public.practice_settings as settings
      where settings.id = 'primary'
    ),
    'dependencies', jsonb_build_object(
      'total', (select count(*) from public.launch_dependencies),
      'open', (
        select count(*)
        from public.launch_dependencies as dependency
        where dependency.status = 'open'
      ),
      'blocking', (
        select count(*)
        from public.launch_dependencies as dependency
        where dependency.blocks_launch
           or dependency.status = 'open'
      ),
      'blockers', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'key', dependency.dependency_key,
              'category', dependency.category,
              'status', dependency.status,
              'owner', dependency.owner
            )
            order by dependency.category, dependency.dependency_key
          ),
          '[]'::jsonb
        )
        from public.launch_dependencies as dependency
        where dependency.blocks_launch
           or dependency.status = 'open'
      )
    ),
    'services', (
      select jsonb_build_object(
        'total', count(*),
        'published', count(*) filter (where service.is_published),
        'verified', count(*) filter (
          where service.is_published
            and service.verification_status = 'verified'
        ),
        'needs_confirmation', count(*) filter (
          where service.is_published
            and service.verification_status <> 'verified'
        ),
        'appointment_services', count(*) filter (
          where service.is_published
            and service.booking_mode = 'appointment'
        ),
        'appointment_services_missing_duration', count(*) filter (
          where service.is_published
            and service.booking_mode = 'appointment'
            and service.appointment_duration_minutes is null
        ),
        'unverified_slugs', coalesce(
          jsonb_agg(service.slug order by service.display_order, service.slug)
            filter (
              where service.is_published
                and service.verification_status <> 'verified'
            ),
          '[]'::jsonb
        )
      )
      from public.services as service
    ),
    'availability', jsonb_build_object(
      'policies', (
        select jsonb_build_object(
          'total', count(*),
          'approved', count(*) filter (where policy.is_approved)
        )
        from private.booking_availability_policies as policy
      ),
      'rules', (select count(*) from public.availability_rules),
      'exceptions', (select count(*) from public.availability_exceptions),
      'future_open_slots', (
        select count(*)
        from public.booking_slots as slot
        where slot.status = 'open'
          and slot.starts_at > now()
      )
    ),
    'notifications', jsonb_build_object(
      'configurations_by_state', (
        select coalesce(jsonb_object_agg(state_count.state, state_count.total), '{}'::jsonb)
        from (
          select configuration.state, count(*) as total
          from private.notification_delivery_configurations as configuration
          group by configuration.state
          order by configuration.state
        ) as state_count
      ),
      'attempts_by_status', (
        select coalesce(jsonb_object_agg(status_count.status, status_count.total), '{}'::jsonb)
        from (
          select attempt.status, count(*) as total
          from public.notification_attempts as attempt
          group by attempt.status
          order by attempt.status
        ) as status_count
      )
    ),
    'recovery', jsonb_build_object(
      'ready', private.recovery_activation_ready(),
      'configurations_by_state', (
        select coalesce(jsonb_object_agg(state_count.state, state_count.total), '{}'::jsonb)
        from (
          select configuration.state, count(*) as total
          from private.recovery_activation_configurations as configuration
          group by configuration.state
          order by configuration.state
        ) as state_count
      ),
      'evidence_by_kind', (
        select coalesce(jsonb_object_agg(kind_count.kind, kind_count.total), '{}'::jsonb)
        from (
          select evidence.execution_kind as kind, count(*) as total
          from private.recovery_execution_evidence as evidence
          group by evidence.execution_kind
          order by evidence.execution_kind
        ) as kind_count
      )
    ),
    'operations', jsonb_build_object(
      'bookings_by_status', (
        select coalesce(jsonb_object_agg(status_count.status, status_count.total), '{}'::jsonb)
        from (
          select booking.status, count(*) as total
          from public.bookings as booking
          group by booking.status
          order by booking.status
        ) as status_count
      ),
      'employer_leads_by_status', (
        select coalesce(jsonb_object_agg(status_count.status, status_count.total), '{}'::jsonb)
        from (
          select lead.status, count(*) as total
          from public.employer_leads as lead
          group by lead.status
          order by lead.status
        ) as status_count
      ),
      'contact_enquiries_by_status', (
        select coalesce(jsonb_object_agg(status_count.status, status_count.total), '{}'::jsonb)
        from (
          select enquiry.status, count(*) as total
          from public.contact_enquiries as enquiry
          group by enquiry.status
          order by enquiry.status
        ) as status_count
      )
    )
  );
$$;

revoke all on function private.launch_readiness_snapshot()
  from public, anon, authenticated, service_role;

comment on function private.launch_readiness_snapshot() is
  'Owner-only aggregate launch-control snapshot. It returns readiness state and record counts without submission fields, evidence locations, provider references, fingerprints, or secrets.';

do $$
declare
  v_snapshot jsonb;
  v_function_config text[];
begin
  select private.launch_readiness_snapshot()
  into v_snapshot;

  if jsonb_typeof(v_snapshot) <> 'object'
     or not (v_snapshot ? 'status')
     or not (v_snapshot ? 'ready_for_public_intake')
     or not (v_snapshot ? 'dependencies')
     or not (v_snapshot ? 'services')
     or not (v_snapshot ? 'availability')
     or not (v_snapshot ? 'notifications')
     or not (v_snapshot ? 'recovery')
     or not (v_snapshot ? 'operations') then
    raise exception 'launch-readiness snapshot contract is incomplete';
  end if;

  if v_snapshot::text ~* '"[^"]*(first_name|last_name|surname|mobile_number|email_address|booking_notes|additional_notes|evidence_url|secret|fingerprint)[^"]*"[[:space:]]*:' then
    raise exception 'launch-readiness snapshot contains a prohibited field';
  end if;

  select routine.proconfig
  into v_function_config
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = routine.pronamespace
  where namespace.nspname = 'private'
    and routine.proname = 'launch_readiness_snapshot'
    and pg_catalog.pg_get_function_identity_arguments(routine.oid) = '';

  if v_function_config is null
     or not ('search_path=""' = any(v_function_config)) then
    raise exception 'launch-readiness snapshot search_path is not empty';
  end if;

  if has_function_privilege('anon', 'private.launch_readiness_snapshot()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.launch_readiness_snapshot()', 'EXECUTE')
     or has_function_privilege('service_role', 'private.launch_readiness_snapshot()', 'EXECUTE') then
    raise exception 'an API role can execute the private launch-readiness snapshot';
  end if;
end;
$$;
