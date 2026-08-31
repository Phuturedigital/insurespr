-- Remove only disposable records created by the 2026-08-12 production contract
-- test. The example.invalid marker is reserved for non-deliverable test data.
delete from public.notification_attempts
where entity_id in (
  select b.id
  from public.bookings b
  join public.customers c on c.id = b.customer_id
  where c.email like 'insurespr-%-e2e@example.invalid'
  union
  select id from public.employer_leads
  where work_email like 'insurespr-%-e2e@example.invalid'
  union
  select id from public.contact_enquiries
  where email like 'insurespr-%-e2e@example.invalid'
);

delete from public.consent_records
where entity_id in (
  select b.id
  from public.bookings b
  join public.customers c on c.id = b.customer_id
  where c.email like 'insurespr-%-e2e@example.invalid'
  union
  select id from public.employer_leads
  where work_email like 'insurespr-%-e2e@example.invalid'
  union
  select id from public.contact_enquiries
  where email like 'insurespr-%-e2e@example.invalid'
);

delete from public.booking_management_tokens
where booking_id in (
  select b.id from public.bookings b
  join public.customers c on c.id = b.customer_id
  where c.email like 'insurespr-%-e2e@example.invalid'
);

delete from public.booking_actions
where booking_id in (
  select b.id from public.bookings b
  join public.customers c on c.id = b.customer_id
  where c.email like 'insurespr-%-e2e@example.invalid'
);

delete from public.booking_status_history
where booking_id in (
  select b.id from public.bookings b
  join public.customers c on c.id = b.customer_id
  where c.email like 'insurespr-%-e2e@example.invalid'
);

delete from public.bookings
where customer_id in (
  select id from public.customers
  where email like 'insurespr-%-e2e@example.invalid'
);

delete from public.customers
where email like 'insurespr-%-e2e@example.invalid';

delete from public.employer_leads
where work_email like 'insurespr-%-e2e@example.invalid';

delete from public.contact_enquiries
where email like 'insurespr-%-e2e@example.invalid';
