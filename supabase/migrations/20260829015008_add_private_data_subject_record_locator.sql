begin;

create table private.privacy_request_search_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null references private.privacy_request_register(id) on delete restrict,
  searched_by text not null check (char_length(btrim(searched_by)) between 3 and 160),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  searched_email boolean not null,
  searched_mobile boolean not null,
  match_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(match_counts) = 'object'),
  searched_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  check (searched_email or searched_mobile),
  check (
    (completed_at is null and match_counts = '{}'::jsonb)
    or (completed_at is not null and completed_at >= searched_at)
  )
);

create table private.privacy_request_record_links (
  id bigint generated always as identity primary key,
  request_id uuid not null references private.privacy_request_register(id) on delete restrict,
  first_search_run_id uuid not null references private.privacy_request_search_runs(id) on delete restrict,
  last_search_run_id uuid not null references private.privacy_request_search_runs(id) on delete restrict,
  record_type text not null check (record_type in (
    'customer',
    'booking',
    'booking_status_history',
    'booking_management_token',
    'booking_action',
    'consent_record',
    'notification_attempt',
    'analytics_event',
    'employer_lead',
    'contact_enquiry',
    'operational_audit_event'
  )),
  record_identifier text not null check (char_length(btrim(record_identifier)) between 1 and 160),
  source_reference text check (
    source_reference is null or char_length(btrim(source_reference)) between 1 and 160
  ),
  match_basis text not null check (match_basis in (
    'direct_email',
    'direct_mobile',
    'email_and_mobile',
    'linked_entity'
  )),
  review_status text not null default 'located' check (review_status in (
    'located',
    'in_scope',
    'out_of_scope',
    'restricted',
    'actioned'
  )),
  first_located_at timestamptz not null default statement_timestamp(),
  last_located_at timestamptz not null default statement_timestamp(),
  reviewed_at timestamptz,
  last_changed_by text not null check (char_length(btrim(last_changed_by)) between 3 and 160),
  change_reason text not null check (char_length(btrim(change_reason)) between 10 and 1000),
  constraint privacy_request_record_links_unique_record
    unique (request_id, record_type, record_identifier),
  check (last_located_at >= first_located_at),
  check (
    (review_status = 'located' and reviewed_at is null)
    or (review_status <> 'located' and reviewed_at is not null)
  )
);

create table private.privacy_request_record_link_events (
  id bigint generated always as identity primary key,
  record_link_id bigint not null references private.privacy_request_record_links(id) on delete restrict,
  request_id uuid not null references private.privacy_request_register(id) on delete restrict,
  search_run_id uuid references private.privacy_request_search_runs(id) on delete restrict,
  event_kind text not null check (event_kind in ('located', 'reconfirmed', 'reviewed')),
  actor_identifier text not null check (char_length(btrim(actor_identifier)) between 3 and 160),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  previous_review_status text check (previous_review_status is null or previous_review_status in (
    'located', 'in_scope', 'out_of_scope', 'restricted', 'actioned'
  )),
  review_status text not null check (review_status in (
    'located', 'in_scope', 'out_of_scope', 'restricted', 'actioned'
  )),
  created_at timestamptz not null default statement_timestamp(),
  check (
    (event_kind = 'located' and previous_review_status is null and search_run_id is not null)
    or (event_kind = 'reconfirmed' and previous_review_status = review_status and search_run_id is not null)
    or (event_kind = 'reviewed' and previous_review_status is distinct from review_status and search_run_id is null)
  )
);

comment on table private.privacy_request_search_runs is
  'Owner-only audit of verified privacy-request record searches. Search values and deterministic hashes are deliberately not retained.';
comment on table private.privacy_request_record_links is
  'Owner-only, data-minimised index of operational records located for a verified privacy request. This is not an export, disclosure, correction, or deletion instruction.';
comment on table private.privacy_request_record_link_events is
  'Immutable audit of record discovery, reconfirmation, and human scope-review decisions. Record contents and search values are excluded.';

create index privacy_request_search_runs_request_idx
  on private.privacy_request_search_runs(request_id, searched_at);
create index privacy_request_record_links_request_review_idx
  on private.privacy_request_record_links(request_id, review_status, record_type);
create index privacy_request_record_link_events_link_idx
  on private.privacy_request_record_link_events(record_link_id, created_at);

create or replace function private.guard_privacy_request_search_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'privacy request search runs are immutable';
  end if;

  new.searched_by := btrim(new.searched_by);
  new.reason := btrim(new.reason);

  if tg_op = 'UPDATE' then
    if old.completed_at is not null then
      raise exception using errcode = '55000', message = 'completed privacy request search runs are immutable';
    end if;
    if new.id is distinct from old.id
      or new.request_id is distinct from old.request_id
      or new.searched_by is distinct from old.searched_by
      or new.reason is distinct from old.reason
      or new.searched_email is distinct from old.searched_email
      or new.searched_mobile is distinct from old.searched_mobile
      or new.searched_at is distinct from old.searched_at
      or new.completed_at is null then
      raise exception using errcode = '22023', message = 'a privacy request search run may only be completed once';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.guard_privacy_request_record_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'privacy request record links are immutable';
  end if;

  new.record_identifier := btrim(new.record_identifier);
  new.source_reference := nullif(btrim(coalesce(new.source_reference, '')), '');
  new.last_changed_by := btrim(new.last_changed_by);
  new.change_reason := btrim(new.change_reason);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.request_id is distinct from old.request_id
      or new.first_search_run_id is distinct from old.first_search_run_id
      or new.record_type is distinct from old.record_type
      or new.record_identifier is distinct from old.record_identifier
      or new.source_reference is distinct from old.source_reference
      or new.match_basis is distinct from old.match_basis
      or new.first_located_at is distinct from old.first_located_at then
      raise exception using errcode = '22023', message = 'privacy request record identity and first-discovery evidence are immutable';
    end if;

    if new.review_status is distinct from old.review_status then
      if new.last_search_run_id is distinct from old.last_search_run_id
        or new.last_located_at is distinct from old.last_located_at
        or not (
          (old.review_status = 'located' and new.review_status in ('in_scope', 'out_of_scope', 'restricted'))
          or (old.review_status = 'in_scope' and new.review_status in ('out_of_scope', 'restricted', 'actioned'))
          or (old.review_status = 'out_of_scope' and new.review_status in ('in_scope', 'restricted'))
          or (old.review_status = 'restricted' and new.review_status in ('in_scope', 'out_of_scope', 'actioned'))
        ) then
        raise exception using errcode = '22023', message = 'invalid privacy request record review transition';
      end if;
      new.reviewed_at := statement_timestamp();
    elsif new.last_search_run_id is distinct from old.last_search_run_id then
      if new.last_located_at <= old.last_located_at
        or new.reviewed_at is distinct from old.reviewed_at then
        raise exception using errcode = '22023', message = 'invalid privacy request record reconfirmation';
      end if;
    else
      raise exception using errcode = '22023', message = 'privacy request record update did not change review or search evidence';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.append_privacy_request_record_link_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into private.privacy_request_record_link_events (
    record_link_id,
    request_id,
    search_run_id,
    event_kind,
    actor_identifier,
    reason,
    previous_review_status,
    review_status
  ) values (
    new.id,
    new.request_id,
    case when tg_op = 'INSERT' or new.last_search_run_id is distinct from old.last_search_run_id
      then new.last_search_run_id else null end,
    case
      when tg_op = 'INSERT' then 'located'
      when new.review_status is distinct from old.review_status then 'reviewed'
      else 'reconfirmed'
    end,
    new.last_changed_by,
    new.change_reason,
    case when tg_op = 'INSERT' then null else old.review_status end,
    new.review_status
  );
  return new;
end;
$$;

create or replace function private.prevent_privacy_locator_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'privacy request record-link events are immutable';
end;
$$;

create trigger privacy_request_search_runs_guard
before insert or update or delete on private.privacy_request_search_runs
for each row execute function private.guard_privacy_request_search_run();

create trigger privacy_request_record_links_guard
before insert or update or delete on private.privacy_request_record_links
for each row execute function private.guard_privacy_request_record_link();

create trigger privacy_request_record_links_append_event
after insert or update on private.privacy_request_record_links
for each row execute function private.append_privacy_request_record_link_event();

create trigger privacy_request_record_link_events_immutable
before update or delete on private.privacy_request_record_link_events
for each row execute function private.prevent_privacy_locator_event_mutation();

create or replace function private.locate_privacy_request_records(
  p_request_id uuid,
  p_actor_identifier text,
  p_reason text,
  p_email text default null,
  p_mobile_e164 text default null
)
returns table (
  search_run_id uuid,
  record_type text,
  record_identifier text,
  source_reference text,
  match_basis text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_request private.privacy_request_register%rowtype;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_mobile text := nullif(btrim(coalesce(p_mobile_e164, '')), '');
  v_actor text := btrim(coalesce(p_actor_identifier, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_run_id uuid;
  v_counts jsonb;
begin
  if char_length(v_actor) not between 3 and 160 then
    raise exception using errcode = '22023', message = 'search actor must be between 3 and 160 characters';
  end if;
  if char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'search reason must be between 10 and 1000 characters';
  end if;
  if v_email is null and v_mobile is null then
    raise exception using errcode = '22023', message = 'a validated email or mobile number is required';
  end if;
  if v_email is not null and (
    char_length(v_email) > 320
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception using errcode = '22023', message = 'email search value is invalid';
  end if;
  if v_mobile is not null and v_mobile !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'mobile search value must use E.164 format';
  end if;

  select * into v_request
  from private.privacy_request_register as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'privacy request was not found';
  end if;
  if v_request.status not in ('under_review', 'actioning') then
    raise exception using errcode = '55000', message = 'privacy request must be under review or actioning before records are located';
  end if;
  if v_request.identity_status not in ('verified', 'not_required') then
    raise exception using errcode = '55000', message = 'requester identity must be verified or formally marked not required';
  end if;

  insert into private.privacy_request_search_runs (
    request_id, searched_by, reason, searched_email, searched_mobile
  ) values (
    p_request_id, v_actor, v_reason, v_email is not null, v_mobile is not null
  ) returning id into v_run_id;

  drop table if exists pg_temp.privacy_locator_results;
  create temporary table privacy_locator_results (
    record_type text not null,
    record_identifier text not null,
    source_reference text,
    match_basis text not null,
    constraint privacy_locator_results_pkey primary key (record_type, record_identifier)
  ) on commit drop;

  with matched_customers as (
    select customer.id,
      case
        when v_email is not null and lower(customer.email) = v_email
          and v_mobile is not null and customer.mobile_e164 = v_mobile then 'email_and_mobile'
        when v_email is not null and lower(customer.email) = v_email then 'direct_email'
        else 'direct_mobile'
      end as basis
    from public.customers as customer
    where customer.deleted_at is null
      and ((v_email is not null and lower(customer.email) = v_email)
        or (v_mobile is not null and customer.mobile_e164 = v_mobile))
  ), matched_bookings as (
    select booking.id, booking.reference
    from public.bookings as booking
    join matched_customers as customer on customer.id = booking.customer_id
  ), matched_employer_leads as (
    select lead.id, lead.reference,
      case
        when v_email is not null and lower(lead.work_email) = v_email
          and v_mobile is not null and lead.phone_e164 = v_mobile then 'email_and_mobile'
        when v_email is not null and lower(lead.work_email) = v_email then 'direct_email'
        else 'direct_mobile'
      end as basis
    from public.employer_leads as lead
    where (v_email is not null and lower(lead.work_email) = v_email)
      or (v_mobile is not null and lead.phone_e164 = v_mobile)
  ), matched_contact_enquiries as (
    select enquiry.id, enquiry.reference,
      case
        when v_email is not null and lower(enquiry.email) = v_email
          and v_mobile is not null and enquiry.phone_e164 = v_mobile then 'email_and_mobile'
        when v_email is not null and lower(enquiry.email) = v_email then 'direct_email'
        else 'direct_mobile'
      end as basis
    from public.contact_enquiries as enquiry
    where (v_email is not null and lower(enquiry.email) = v_email)
      or (v_mobile is not null and enquiry.phone_e164 = v_mobile)
  ), located as (
    select 'customer'::text, customer.id::text, null::text, customer.basis from matched_customers customer
    union all
    select 'booking', booking.id::text, booking.reference, 'linked_entity' from matched_bookings booking
    union all
    select 'booking_status_history', history.id::text, booking.reference, 'linked_entity'
      from public.booking_status_history history join matched_bookings booking on booking.id = history.booking_id
    union all
    select 'booking_management_token', token.id::text, booking.reference, 'linked_entity'
      from public.booking_management_tokens token join matched_bookings booking on booking.id = token.booking_id
    union all
    select 'booking_action', action.id::text, booking.reference, 'linked_entity'
      from public.booking_actions action join matched_bookings booking on booking.id = action.booking_id
    union all
    select 'analytics_event', event.id::text, booking.reference, 'linked_entity'
      from public.analytics_events event join matched_bookings booking on booking.id = event.booking_id
    union all
    select 'employer_lead', lead.id::text, lead.reference, lead.basis from matched_employer_leads lead
    union all
    select 'contact_enquiry', enquiry.id::text, enquiry.reference, enquiry.basis from matched_contact_enquiries enquiry
    union all
    select 'consent_record', consent.id::text, parent.reference, 'linked_entity'
      from public.consent_records consent
      join (
        select 'booking'::text entity_type, id entity_id, reference from matched_bookings
        union all select 'employer_lead', id, reference from matched_employer_leads
        union all select 'contact_enquiry', id, reference from matched_contact_enquiries
      ) parent on parent.entity_type = consent.entity_type and parent.entity_id = consent.entity_id
    union all
    select 'notification_attempt', attempt.id::text, parent.reference, 'linked_entity'
      from public.notification_attempts attempt
      join (
        select 'booking'::text entity_type, id entity_id, reference from matched_bookings
        union all select 'employer_lead', id, reference from matched_employer_leads
        union all select 'contact_enquiry', id, reference from matched_contact_enquiries
      ) parent on parent.entity_type = attempt.entity_type and parent.entity_id = attempt.entity_id
    union all
    select 'operational_audit_event', audit.id::text, parent.reference, 'linked_entity'
      from public.operational_audit_log audit
      join (
        select 'booking'::text entity_type, id entity_id, reference from matched_bookings
        union all select 'employer_lead', id, reference from matched_employer_leads
        union all select 'contact_enquiry', id, reference from matched_contact_enquiries
      ) parent on parent.entity_type = audit.entity_type and parent.entity_id = audit.entity_id
  )
  insert into privacy_locator_results(record_type, record_identifier, source_reference, match_basis)
  select * from located
  on conflict on constraint privacy_locator_results_pkey do nothing;

  insert into private.privacy_request_record_links (
    request_id,
    first_search_run_id,
    last_search_run_id,
    record_type,
    record_identifier,
    source_reference,
    match_basis,
    last_changed_by,
    change_reason
  )
  select
    p_request_id,
    v_run_id,
    v_run_id,
    result.record_type,
    result.record_identifier,
    result.source_reference,
    result.match_basis,
    v_actor,
    v_reason
  from privacy_locator_results as result
  on conflict on constraint privacy_request_record_links_unique_record do update set
    last_search_run_id = excluded.last_search_run_id,
    last_located_at = statement_timestamp(),
    last_changed_by = excluded.last_changed_by,
    change_reason = excluded.change_reason;

  select coalesce(jsonb_object_agg(counted.record_type, counted.record_count), '{}'::jsonb)
  into v_counts
  from (
    select result.record_type, count(*)::integer as record_count
    from privacy_locator_results as result
    group by result.record_type
  ) as counted;

  update private.privacy_request_search_runs as run
  set match_counts = v_counts,
      completed_at = statement_timestamp()
  where run.id = v_run_id;

  return query
  select
    v_run_id,
    result.record_type,
    result.record_identifier,
    result.source_reference,
    result.match_basis
  from privacy_locator_results as result
  order by result.record_type, result.record_identifier;
end;
$$;

create or replace function private.review_privacy_request_record(
  p_record_link_id bigint,
  p_review_status text,
  p_actor_identifier text,
  p_reason text
)
returns private.privacy_request_record_links
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_link private.privacy_request_record_links%rowtype;
begin
  if p_review_status not in ('in_scope', 'out_of_scope', 'restricted', 'actioned') then
    raise exception using errcode = '22023', message = 'invalid privacy request record review status';
  end if;
  if char_length(btrim(coalesce(p_actor_identifier, ''))) not between 3 and 160 then
    raise exception using errcode = '22023', message = 'review actor must be between 3 and 160 characters';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'review reason must be between 10 and 1000 characters';
  end if;

  update private.privacy_request_record_links as link
  set review_status = p_review_status,
      last_changed_by = btrim(p_actor_identifier),
      change_reason = btrim(p_reason)
  where link.id = p_record_link_id
  returning * into v_link;

  if not found then
    raise exception using errcode = 'P0002', message = 'privacy request record link was not found';
  end if;
  return v_link;
end;
$$;

alter table private.privacy_request_search_runs enable row level security;
alter table private.privacy_request_record_links enable row level security;
alter table private.privacy_request_record_link_events enable row level security;

create policy privacy_request_search_runs_deny_client_access
on private.privacy_request_search_runs for all to public using (false) with check (false);
create policy privacy_request_record_links_deny_client_access
on private.privacy_request_record_links for all to public using (false) with check (false);
create policy privacy_request_record_link_events_deny_client_access
on private.privacy_request_record_link_events for all to public using (false) with check (false);

revoke all on table private.privacy_request_search_runs from public, anon, authenticated, service_role;
revoke all on table private.privacy_request_record_links from public, anon, authenticated, service_role;
revoke all on table private.privacy_request_record_link_events from public, anon, authenticated, service_role;
revoke all on sequence private.privacy_request_record_links_id_seq from public, anon, authenticated, service_role;
revoke all on sequence private.privacy_request_record_link_events_id_seq from public, anon, authenticated, service_role;

revoke all on function private.guard_privacy_request_search_run() from public, anon, authenticated, service_role;
revoke all on function private.guard_privacy_request_record_link() from public, anon, authenticated, service_role;
revoke all on function private.append_privacy_request_record_link_event() from public, anon, authenticated, service_role;
revoke all on function private.prevent_privacy_locator_event_mutation() from public, anon, authenticated, service_role;
revoke all on function private.locate_privacy_request_records(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.review_privacy_request_record(bigint, text, text, text) from public, anon, authenticated, service_role;

do $$
declare
  v_request_id uuid;
  v_run_id uuid;
  v_link_id bigint;
  v_failed boolean := false;
begin
  begin
    insert into private.privacy_request_register (
      request_type,
      received_channel,
      requester_contact,
      status,
      identity_status,
      identity_evidence_reference,
      assigned_to,
      identity_verified_at,
      last_changed_by,
      change_reason
    ) values (
      'access',
      'email',
      'privacy-locator-probe@invalid.example',
      'under_review',
      'verified',
      'PROBE-IDENTITY-EVIDENCE-NOT-A-DOCUMENT',
      'Migration verification',
      statement_timestamp(),
      'Migration verification',
      'Verify locator transaction and access controls'
    ) returning id into v_request_id;

    select located.search_run_id into v_run_id
    from private.locate_privacy_request_records(
      v_request_id,
      'Migration verification',
      'Verify a completed no-match privacy record search',
      'privacy-locator-probe@invalid.example',
      null
    ) as located
    limit 1;

    select run.id into v_run_id
    from private.privacy_request_search_runs as run
    where run.request_id = v_request_id;

    if v_run_id is null or not exists (
      select 1 from private.privacy_request_search_runs as run
      where run.id = v_run_id and run.completed_at is not null and run.match_counts = '{}'::jsonb
    ) then
      raise exception 'privacy locator probe did not produce a completed zero-match search run';
    end if;

    insert into private.privacy_request_record_links (
      request_id,
      first_search_run_id,
      last_search_run_id,
      record_type,
      record_identifier,
      match_basis,
      last_changed_by,
      change_reason
    ) values (
      v_request_id,
      v_run_id,
      v_run_id,
      'customer',
      'privacy-locator-probe-record',
      'direct_email',
      'Migration verification',
      'Verify guarded record-scope review transition'
    ) returning id into v_link_id;

    perform private.review_privacy_request_record(
      v_link_id,
      'in_scope',
      'Migration verification',
      'Verified synthetic record belongs within request scope'
    );

    if not exists (
      select 1 from private.privacy_request_record_link_events as event
      where event.record_link_id = v_link_id and event.event_kind = 'reviewed'
    ) then
      raise exception 'privacy locator probe did not append a review event';
    end if;

    begin
      update private.privacy_request_record_link_events
      set reason = 'This mutation must be rejected by the immutable event guard'
      where record_link_id = v_link_id;
    exception when sqlstate '55000' then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'privacy locator event mutation guard did not reject an update';
    end if;

    raise exception using errcode = 'P0001', message = 'privacy_locator_probe_rollback';
  exception when raise_exception then
    if sqlerrm <> 'privacy_locator_probe_rollback' then
      raise;
    end if;
  end;

  if exists (
    select 1 from private.privacy_request_register
    where requester_contact = 'privacy-locator-probe@invalid.example'
  ) then
    raise exception 'privacy locator probe did not roll back synthetic records';
  end if;

  if has_table_privilege('service_role', 'private.privacy_request_search_runs', 'SELECT')
    or has_table_privilege('service_role', 'private.privacy_request_record_links', 'SELECT')
    or has_table_privilege('service_role', 'private.privacy_request_record_link_events', 'SELECT')
    or has_function_privilege('service_role', 'private.locate_privacy_request_records(uuid,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.review_privacy_request_record(bigint,text,text,text)', 'EXECUTE') then
    raise exception 'service role must not access private privacy locator records or functions';
  end if;
end;
$$;

commit;
