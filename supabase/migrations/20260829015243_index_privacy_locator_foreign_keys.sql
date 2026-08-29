begin;

create index privacy_request_record_links_first_search_run_idx
  on private.privacy_request_record_links(first_search_run_id);

create index privacy_request_record_links_last_search_run_idx
  on private.privacy_request_record_links(last_search_run_id);

create index privacy_request_record_link_events_request_idx
  on private.privacy_request_record_link_events(request_id, created_at);

create index privacy_request_record_link_events_search_run_idx
  on private.privacy_request_record_link_events(search_run_id)
  where search_run_id is not null;

do $$
begin
  if (
    select count(*)
    from pg_indexes
    where schemaname = 'private'
      and indexname in (
        'privacy_request_record_links_first_search_run_idx',
        'privacy_request_record_links_last_search_run_idx',
        'privacy_request_record_link_events_request_idx',
        'privacy_request_record_link_events_search_run_idx'
      )
  ) <> 4 then
    raise exception 'privacy locator foreign-key index contract is incomplete';
  end if;
end;
$$;

commit;
