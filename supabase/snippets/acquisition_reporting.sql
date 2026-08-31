-- InsureSPR owner-only acquisition reporting templates.
-- Run only in the Supabase SQL editor as the database owner or an explicitly
-- approved operator role with direct underlying-table access. The reporting
-- functions are unavailable to the website, anon, authenticated and service
-- roles. Results are aggregate and intentionally omit personal information.

-- 1. Operational outcomes for the last 30 days. A request is a stored booking,
-- employer quote or contact enquiry. "Progressed" and "successful" use the
-- workflow definitions documented in OPERATIONS-RUNBOOK.md.
select *
from private.acquisition_outcome_report(
  statement_timestamp() - interval '30 days',
  statement_timestamp()
);

-- 2. Privacy-minimised conversion events for the same period. Unique session
-- counts are calculated inside the function; session identifiers are not
-- returned. Treat browser events as intent evidence, not booked revenue.
select *
from private.acquisition_event_report(
  statement_timestamp() - interval '30 days',
  statement_timestamp()
);

-- 3. Compare a previous 30-day period by changing both explicit boundaries.
-- Never use an unbounded reporting query; each function rejects windows longer
-- than 366 days.
-- select *
-- from private.acquisition_outcome_report(
--   timestamptz '2026-06-01 00:00:00+02',
--   timestamptz '2026-07-01 00:00:00+02'
-- );

-- Revenue is deliberately unavailable. Do not replace null
-- attributed_value_cents values with list-price estimates. Revenue reporting
-- requires approved prices, actual payment/claim data, refund handling and an
-- approved financial-data retention/access process.
