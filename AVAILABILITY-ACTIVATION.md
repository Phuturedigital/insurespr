# Availability activation and rollback

The availability engine is deployed, but it is intentionally inactive until
the practice approves real operating rules. Do not schedule the materializer or
publish generated slots merely to make the calendar appear populated.

## Required approved inputs

Record and peer-review these for each appointment service:

- appointment duration;
- booking horizon;
- minimum booking notice;
- buffer between appointments;
- capacity (`1` in the current model);
- weekly hours and IANA timezone;
- service-specific exceptions;
- whole-practice closures;
- the person responsible for future schedule changes.

The approved values belong in a separate data migration. Schema migrations must
not guess them.

## Rehearsal

1. Keep the privacy notice pending and public submissions closed.
2. Enter the approved policy, weekly rules, and a short exception/closure
   sample in a non-production branch or local database.
3. Run the PostgreSQL-owned materializer for a narrow range:

   ```sql
   select private.materialize_booking_slots(
     current_date,
     current_date + 7,
     '<approved-service-uuid>'::uuid
   );
   ```

4. Run queries 7–9 in `supabase/snippets/daily_operations.sql`.
5. Verify local wall-clock times, notice/buffer boundaries, closures, provenance,
   revisions, and zero unresolved conflicts.
6. Exercise booking, simultaneous-claim rejection, cancellation, reschedule,
   rule shortening, and booked/manual-slot preservation using synthetic people.
7. Delete the synthetic rows and confirm production business tables remain
   unchanged.

## Production activation

1. Apply the peer-reviewed approved-data migration.
2. Run the materializer manually for a small initial horizon.
3. Inspect the current-slot and conflict queries before opening intake.
4. Book and manage one authorized synthetic appointment end to end.
5. Only after that proof, create one PostgreSQL-owned daily `pg_cron` job. Use
   `cron.schedule`; never write directly to `cron.job`, never pin an extension
   version, and keep the job's horizon bounded.
6. Record the job name, owner, run time, alert recipient, and rollback authority
   in the operations runbook.

No service-role/public wrapper should be added merely for Cron. The private
materializer is PostgreSQL-only by design.

## Daily monitoring

- Review missing policies, current revisions, open-slot coverage, latest
  materialization time, and unresolved conflicts.
- Review `cron.job_run_details` after Cron is activated.
- Treat an unresolved conflict as protected operational state—not as permission
  to overwrite a manual or booked slot.
- If a configuration edit increments a revision before rematerialization, stale
  generated slots automatically disappear from public availability.

## Rollback

1. Close online intake by returning the privacy version to a pending value if
   there is an immediate booking-safety concern.
2. Unschedule the named Cron job with `cron.unschedule`.
3. Mark only unbooked generated future slots `cancelled`; never delete, move, or
   reopen booked/manual slots as a bulk rollback.
4. Preserve conflicts and operational history for review.
5. Correct the policy/rule/exception data in a new migration, increment the
   revision, rematerialize a narrow range, and re-run the rehearsal checks.
6. Reopen intake only after a peer has verified the final rows and one synthetic
   end-to-end journey.
