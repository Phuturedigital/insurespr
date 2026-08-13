-- InsureSPR daily dashboard queries.
-- Run in the Supabase SQL editor as an approved operator. Results contain PII.
-- Do not export them to personal devices or paste them into tickets/chat.

-- 1. New and reschedule-requested bookings, oldest first.
select
  booking.id,
  booking.reference,
  booking.status,
  booking.created_at,
  booking.preferred_date,
  booking.preferred_time_period,
  slot.starts_at,
  service.name as service_name,
  customer.first_name,
  customer.surname,
  customer.mobile_e164,
  customer.email
from public.bookings as booking
join public.customers as customer on customer.id = booking.customer_id
join public.services as service on service.id = booking.service_id
left join public.booking_slots as slot on slot.id = booking.slot_id
where booking.status in ('pending', 'reschedule_requested')
order by booking.created_at;

-- 2. Active workforce leads.
select
  id,
  reference,
  status,
  created_at,
  company_name,
  contact_name,
  work_email,
  phone_e164,
  services_required
from public.employer_leads
where status in ('new', 'contacted', 'qualified')
order by created_at;

-- 3. Active contact enquiries. Open the full message only when handling it.
select
  id,
  reference,
  status,
  created_at,
  enquiry_type,
  name,
  email,
  phone_e164
from public.contact_enquiries
where status in ('new', 'contacted')
order by created_at;

-- 4. Delivery failures and stale leases. Recipient is shown for correction.
select
  id,
  entity_type,
  entity_id,
  notification_kind,
  recipient,
  status,
  attempt_count,
  next_attempt_at,
  lock_expires_at,
  last_error_code,
  last_http_status,
  updated_at
from public.notification_attempts
where status in ('failed', 'dead')
   or (status = 'processing' and lock_expires_at <= now())
order by
  case when status = 'dead' then 0 else 1 end,
  updated_at;

-- 5. Unresolved launch dependencies.
select dependency_key, category, title, owner, status, blocks_launch, updated_at
from public.launch_dependencies
where status not in ('resolved', 'not_applicable')
order by blocks_launch desc, category, title;

-- 6. Latest privacy-minimised operational audit events.
select id, created_at, actor_identifier, action, entity_type, entity_id,
       before_state, after_state, reason
from public.operational_audit_log
order by created_at desc
limit 100;

-- 7. Appointment-service availability policy and materialization coverage.
-- A missing policy or zero current future slots is an operations/configuration
-- issue, not permission to invent a schedule. Populate only approved values.
select
  service.id as service_id,
  service.slug,
  service.name,
  service.booking_mode,
  service.appointment_duration_minutes,
  policy.horizon_days,
  policy.minimum_notice_minutes,
  policy.buffer_minutes,
  policy.config_revision,
  count(slot.id) filter (
    where slot.starts_at >= now()
      and slot.status = 'open'
      and (
        slot.origin_kind = 'manual'
        or slot.config_revision = policy.config_revision
      )
  ) as current_open_future_slots,
  max(slot.starts_at) filter (
    where slot.starts_at >= now()
      and slot.status = 'open'
  ) as latest_open_slot
from public.services as service
left join private.booking_availability_policies as policy
  on policy.service_id = service.id
left join public.booking_slots as slot
  on slot.service_id = service.id
where service.is_published
  and service.booking_mode = 'appointment'
group by
  service.id,
  service.slug,
  service.name,
  service.booking_mode,
  service.appointment_duration_minutes,
  policy.horizon_days,
  policy.minimum_notice_minutes,
  policy.buffer_minutes,
  policy.config_revision
order by service.display_order, service.name;

-- 8. Unresolved materialization conflicts. A conflict protects a manual or
-- booked row from silent overwrite; resolve it before relying on generated
-- availability for that service/date.
select
  conflict.id,
  service.slug,
  service.name as service_name,
  conflict.slot_id,
  conflict.candidate_starts_at,
  conflict.candidate_ends_at,
  conflict.conflict_kind,
  conflict.first_detected_at,
  conflict.last_detected_at
from private.booking_availability_conflicts as conflict
join public.services as service on service.id = conflict.service_id
where conflict.resolved_at is null
order by conflict.last_detected_at desc, service.name;

-- 9. Slot freshness and provenance. Retired generated slots remain as history;
-- booked rows must never be silently deleted or moved.
select
  service.slug,
  slot.origin_kind,
  slot.status,
  count(*) as slot_count,
  count(*) filter (where slot.starts_at >= now()) as future_count,
  count(*) filter (where slot.retired_at is not null) as retired_count,
  max(slot.materialized_at) as latest_materialized_at
from public.booking_slots as slot
join public.services as service on service.id = slot.service_id
group by service.slug, slot.origin_kind, slot.status
order by service.slug, slot.origin_kind, slot.status;
