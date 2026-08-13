-- InsureSPR staff-action templates.
-- Replace every value explicitly and run one statement at a time.
-- Do not bypass these procedures with direct status edits.

-- Confirm a pending or reschedule-requested booking with a real, available slot.
-- select public.staff_confirm_booking(
--   p_booking_id := 'BOOKING_UUID',
--   p_slot_id := 'AVAILABLE_SLOT_UUID',
--   p_actor_identifier := 'named.staff@insurespr.example',
--   p_reason := 'Confirmed after telephone availability check'
-- );

-- Close a booking. Status must be completed, cancelled, or no_show.
-- select public.staff_close_booking(
--   p_booking_id := 'BOOKING_UUID',
--   p_new_status := 'completed',
--   p_actor_identifier := 'named.staff@insurespr.example',
--   p_reason := 'Consultation completed'
-- );

-- Advance a workforce lead.
-- select public.staff_update_employer_lead_status(
--   p_lead_id := 'LEAD_UUID',
--   p_new_status := 'contacted',
--   p_actor_identifier := 'named.staff@insurespr.example',
--   p_reason := 'Initial response sent from the approved practice inbox'
-- );

-- Advance a contact enquiry.
-- select public.staff_update_contact_enquiry_status(
--   p_enquiry_id := 'ENQUIRY_UUID',
--   p_new_status := 'resolved',
--   p_actor_identifier := 'named.staff@insurespr.example',
--   p_reason := 'Question answered by telephone'
-- );

-- Requeue a reviewed failed/dead/skipped notification.
-- select public.staff_requeue_notification(
--   p_attempt_id := 'NOTIFICATION_UUID',
--   p_actor_identifier := 'named.staff@insurespr.example',
--   p_reason := 'Sender configuration corrected and recipient rechecked'
-- );
