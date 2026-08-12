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
