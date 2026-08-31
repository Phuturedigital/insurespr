-- Owner-only launch control snapshot.
-- Run in Supabase Studio as the database owner. The result is aggregate-only;
-- it contains no submission fields, contact values, evidence locations, or secrets.
select jsonb_pretty(private.launch_readiness_snapshot());
