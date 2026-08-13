begin;

-- Remove only analytics generated while the site was still an internal/local
-- preview. The official InsureSPR domain was not launched during this window.
delete from public.analytics_events
where occurred_at > timestamptz '2026-08-12 15:10:00+00'
  and occurred_at <= timestamptz '2026-08-13 10:30:00+00';

do $$
begin
  if exists (
    select 1
    from public.analytics_events
    where occurred_at > timestamptz '2026-08-12 15:10:00+00'
      and occurred_at <= timestamptz '2026-08-13 10:30:00+00'
  ) then
    raise exception 'pre-launch analytics cleanup did not complete';
  end if;
end
$$;

commit;
