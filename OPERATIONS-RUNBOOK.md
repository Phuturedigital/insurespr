# InsureSPR operations runbook

Status: technically implemented; practice ownership, response targets and named
staff access are still awaiting approval.

This runbook uses the Supabase dashboard as the initial staff interface. Do not
share a service-role key with staff, embed it in browser code, or build a public
admin panel around these procedures. Give named operators the least access the
practice approves and remove access promptly when responsibilities change.

## Start and end of each operating day

1. Open the project dashboard and run `supabase/snippets/daily_operations.sql`
   in the SQL editor.
2. Work oldest unresolved booking requests first, then workforce leads and
   general enquiries, subject to the practice's approved clinical escalation
   rules.
3. Check `failed`, `dead`, and stale `processing` notifications. A `dead` item
   must never be treated as delivered.
4. Check open launch dependencies before publishing prices, service facts,
   hours, slots, privacy wording or credentials.
5. Review the latest audit events for unexpected changes and record/escalate
   discrepancies outside the patient record.

The practice must still name the person responsible for each queue and approve
response-time targets. Until then, this is a technical procedure, not a promise
to patients or employers.

## Booking handling

For a pending or reschedule-requested booking:

1. Confirm the service and any operational notes in the secure record.
2. Select a future `booking_slots` row for the same service. The slot must be
   `open` and not owned by another active booking.
3. Run `public.staff_confirm_booking` using the template in
   `supabase/snippets/staff_actions.sql` and identify yourself with the approved
   staff identifier.
4. Verify that the booking is `confirmed`, the status history contains a staff
   transition, an audit event exists, and a patient confirmation notification is
   queued.

Use `public.staff_close_booking` for `completed`, `cancelled`, or `no_show`.
Every closure requires a reason. The database rejects unsafe transitions; do
not bypass the procedure with a direct table edit.

The confirmation email contains the exact slot time only after staff assigns a
slot. A pending request must never be described as a confirmed appointment.

## Employer leads and contact enquiries

- Employer flow: `new` → `contacted` or `qualified` → `won`/`lost`. Spam may be
  marked from the active states. `lost` and `spam` require a reason.
- Contact flow: `new` → `contacted` → `resolved`. Spam may be marked from an
  active state and requires a reason.
- Use the service-role-only procedures in `staff_actions.sql`; they append an
  audit event without copying the full message, notes, or contact record into
  the audit log.

## Notification failures

The worker claims at most eight rows per run. Each lease expires after five
minutes. Retryable failures back off at 1, 5, 15, 60, and 180 minutes; the sixth
failed delivery becomes `dead`. Non-retryable provider errors become `dead`
immediately.

Before requeueing:

1. Confirm the sender domain and provider are healthy.
2. Check that the recipient and template are approved and correct.
3. Decide whether another email is appropriate; do not repeatedly contact a
   patient merely to clear an operational queue.
4. Run `public.staff_requeue_notification` with a clear audit reason.
5. Verify the next worker run changes the row to `sent` or records a new safe
   error code. Provider response bodies and message content must not be copied
   into application logs.

## Enabling outbound email after approval

The deployed `insurespr-notifications` function returns `503` until all required
configuration exists. This is intentional.

1. Verify the selected sender domain and complete SPF, DKIM and DMARC setup.
2. Put `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and a random
   `NOTIFICATION_WORKER_SECRET` of at least 32 characters in Supabase Edge
   Function secrets. Never put them in this repository.
3. Store the same worker secret in Supabase Vault under a clearly named secret,
   then schedule a once-per-minute POST with Supabase Cron and `pg_net`. Send the
   secret only as `x-worker-secret`. Follow the current official guide:
   <https://supabase.com/docs/guides/functions/schedule-functions>.
4. Invoke the worker manually with a synthetic `.invalid`-style test record only
   after the sender is in provider test mode. Verify `sent`, provider message ID,
   and idempotent replay, then remove the synthetic record.
5. Test a retryable provider outage and a non-retryable rejection. Confirm the
   queue enters `failed`/`dead` as designed and that the assigned staff monitor
   sees it.
6. Approve the rendered patient, employer and practice templates before enabling
   the recurring schedule.

Do not put the service-role key in the Cron request. The worker has access to the
server-side key inside Supabase; the scheduler authenticates with the separate
worker secret.

## Incident and privacy handling

- Disable or unschedule the worker if the wrong recipient, sender, or template
  is detected. Preserve queue/audit evidence and notify the responsible owner.
- Treat email as a notification channel, not a clinical record. Free-text form
  notes and contact messages are intentionally omitted from worker payloads and
  staff emails.
- Do not export production submissions to personal devices or unapproved tools.
- Follow the approved POPIA incident, data-subject request, retention and backup
  procedures once the practice supplies them; this repository cannot define
  those business/legal decisions.
