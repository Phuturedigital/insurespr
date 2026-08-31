begin;

create index services_category_id_idx on public.services(category_id);
create index availability_exceptions_service_id_idx on public.availability_exceptions(service_id);
create index booking_management_tokens_booking_id_idx on public.booking_management_tokens(booking_id);
create index booking_actions_booking_id_idx on public.booking_actions(booking_id);
create index analytics_events_service_id_idx on public.analytics_events(service_id);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'practice_settings',
    'service_categories',
    'services',
    'availability_rules',
    'availability_exceptions',
    'booking_slots',
    'customers',
    'bookings',
    'booking_status_history',
    'booking_management_tokens',
    'booking_actions',
    'employer_leads',
    'contact_enquiries',
    'consent_records',
    'notification_attempts',
    'analytics_events',
    'launch_dependencies'
  ]
  loop
    execute format(
      'create policy deny_direct_client_access on public.%I for all to anon, authenticated using (false) with check (false)',
      v_table
    );
  end loop;
end;
$$;

create policy deny_direct_client_access
on private.api_rate_limits
for all
to anon, authenticated
using (false)
with check (false);

commit;
