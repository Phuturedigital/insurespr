-- InsureSPR owner-only staff work queues.
-- Run in the Supabase SQL Editor as an approved named operator.
-- These functions are private, bounded to at most 200 rows and intentionally
-- unavailable to anon, authenticated and service_role application sessions.
-- Results contain patient/prospect contact information. Do not export them to
-- personal devices, tickets, chat, analytics or unapproved spreadsheets.

-- 1. Start here: counts only, with no patient or prospect identifiers.
select * from private.staff_operations_summary();

-- 2. Active patient bookings and the next operational action.
select * from private.staff_booking_work_queue(100);

-- 3. Active workforce quote requests and the next commercial action.
select * from private.staff_employer_lead_work_queue(100);

-- 4. Active contact enquiries. The result includes the submitted message;
-- open it only while handling the enquiry.
select * from private.staff_contact_enquiry_work_queue(100);

-- 5. Failed/dead delivery attempts and stale worker leases.
select * from private.staff_notification_exception_queue(100);

-- Use the guarded procedures in staff_actions.sql for every status change or
-- reviewed notification requeue. Never directly edit a status column.
