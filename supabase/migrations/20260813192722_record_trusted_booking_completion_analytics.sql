begin;

-- A booking request is not a completed appointment. The public analytics RPC
-- intentionally rewrites browser-supplied booking_completed events to
-- booking_request_submitted. Emit the completion event only inside the trusted
-- staff transition that actually sets the booking to completed.
alter table public.analytics_events
  add column booking_id uuid references public.bookings(id) on delete set null;

create unique index analytics_events_booking_completion_once_idx
  on public.analytics_events (booking_id)
  where event_name = 'booking_completed'
    and booking_id is not null;

create or replace function public.staff_close_booking(
  p_booking_id uuid,
  p_new_status text,
  p_actor_identifier text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_actor text := btrim(coalesce(p_actor_identifier, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_booking_id is null
    or p_new_status is null
    or p_new_status not in ('completed', 'cancelled', 'no_show')
    or char_length(v_actor) not between 3 and 200
    or char_length(v_reason) not between 3 and 1000 then
    raise exception 'invalid staff booking closure parameters' using errcode = '22023';
  end if;

  begin
    select * into strict v_booking
    from public.bookings
    where id = p_booking_id
    for update;
  exception when no_data_found then
    raise exception 'booking not found' using errcode = 'P0002';
  end;

  if not (
    (v_booking.status = 'pending' and p_new_status = 'cancelled')
    or (v_booking.status in ('confirmed', 'rescheduled') and p_new_status in ('completed', 'cancelled', 'no_show'))
    or (v_booking.status = 'reschedule_requested' and p_new_status = 'cancelled')
  ) then
    raise exception 'invalid booking status transition' using errcode = '22023';
  end if;

  perform set_config('insurespr.actor', 'staff', true);

  update public.bookings
  set
    status = p_new_status,
    cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
    completed_at = case when p_new_status = 'completed' then now() else completed_at end
  where id = v_booking.id;

  insert into public.operational_audit_log(
    actor_identifier,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    reason
  ) values (
    v_actor,
    'booking.' || p_new_status,
    'booking',
    v_booking.id,
    jsonb_build_object('status', v_booking.status, 'slot_id', v_booking.slot_id),
    jsonb_build_object('status', p_new_status, 'slot_id', v_booking.slot_id),
    v_reason
  );

  if p_new_status = 'completed' then
    insert into public.analytics_events(
      event_name,
      anonymous_session_id,
      page_path,
      service_id,
      booking_id,
      marketing_context,
      occurred_at
    ) values (
      'booking_completed',
      null,
      '/staff/booking-completion',
      v_booking.service_id,
      v_booking.id,
      private.safe_marketing_context(v_booking.marketing_context),
      now()
    )
    on conflict (booking_id)
      where event_name = 'booking_completed'
        and booking_id is not null
      do nothing;
  end if;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'reference', v_booking.reference,
    'status', p_new_status
  );
end;
$$;

alter function public.staff_close_booking(uuid, text, text, text) owner to postgres;
revoke execute on function public.staff_close_booking(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.staff_close_booking(uuid, text, text, text)
  to service_role;

comment on function public.staff_close_booking(uuid, text, text, text) is
  'Completes, cancels, or marks a confirmed booking as no-show; a completed transition records one trusted, privacy-minimised booking completion analytics event.';

do $$
declare
  v_category_id uuid := extensions.gen_random_uuid();
  v_service_id uuid := extensions.gen_random_uuid();
  v_customer_id uuid := extensions.gen_random_uuid();
  v_booking_id uuid := extensions.gen_random_uuid();
  v_reference text := 'T-COMP-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 12));
  v_before_count bigint;
  v_after_count bigint;
  v_event public.analytics_events%rowtype;
begin
  select count(*) into v_before_count from public.analytics_events;

  begin
    insert into public.service_categories(
      id,
      slug,
      name,
      audience,
      summary,
      primary_cta,
      display_order,
      is_published
    ) values (
      v_category_id,
      'contract-completion-' || substr(v_category_id::text, 1, 8),
      'Completion contract',
      'scanning',
      'Synthetic migration contract.',
      'book',
      9998,
      false
    );

    insert into public.services(
      id,
      category_id,
      slug,
      name,
      short_description,
      audience,
      booking_mode,
      confirmation_mode,
      price_type,
      display_order,
      verification_status,
      is_published
    ) values (
      v_service_id,
      v_category_id,
      'contract-completion-' || substr(v_service_id::text, 1, 8),
      'Completion contract service',
      'Synthetic migration contract.',
      'scanning',
      'request',
      'staff',
      'unpublished',
      9998,
      'needs_confirmation',
      false
    );

    insert into public.customers(id, first_name, surname, mobile_e164, email)
    values (v_customer_id, 'Contract', 'Completion', '+27820000006', 'completion-contract@example.test');

    insert into public.bookings(
      id,
      reference,
      idempotency_key,
      customer_id,
      service_id,
      preferred_date,
      preferred_time_period,
      patient_status,
      status,
      confirmation_mode,
      marketing_context,
      request_fingerprint
    ) values (
      v_booking_id,
      v_reference,
      extensions.gen_random_uuid(),
      v_customer_id,
      v_service_id,
      current_date + 1,
      'morning',
      'new',
      'confirmed',
      'staff',
      jsonb_build_object(
        'utm_source', 'contract-source',
        'utm_campaign', 'contract-campaign',
        'landing_path', '/dxa-body-composition',
        'referrer_host', 'example.test'
      ),
      extensions.digest(
        ('completion-contract-' || v_booking_id::text)::text,
        'sha256'
      )
    );

    perform public.staff_close_booking(
      v_booking_id,
      'completed',
      'migration.contract',
      'Verify trusted completion attribution'
    );

    select * into strict v_event
    from public.analytics_events
    where event_name = 'booking_completed'
      and booking_id = v_booking_id;

    if v_event.service_id is distinct from v_service_id
      or v_event.anonymous_session_id is not null
      or v_event.page_path <> '/staff/booking-completion'
      or v_event.marketing_context->>'utm_source' <> 'contract-source'
      or v_event.booking_id is distinct from v_booking_id then
      raise exception 'trusted completion attribution contract failed';
    end if;

    begin
      insert into public.analytics_events(
        event_name,
        page_path,
        service_id,
        booking_id,
        marketing_context
      ) values (
        'booking_completed',
        '/staff/booking-completion',
        v_service_id,
        v_booking_id,
        '{}'::jsonb
      );
      raise exception 'completion analytics deduplication contract failed';
    exception when unique_violation then
      null;
    end;

    raise exception 'rollback trusted completion contract' using errcode = 'TST01';
  exception when sqlstate 'TST01' then
    null;
  end;

  select count(*) into v_after_count from public.analytics_events;
  if v_after_count <> v_before_count then
    raise exception 'trusted completion contract left synthetic analytics rows';
  end if;

  if has_function_privilege('anon', 'public.staff_close_booking(uuid,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.staff_close_booking(uuid,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.staff_close_booking(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'staff booking closure ACL contract failed';
  end if;
end;
$$;

commit;
