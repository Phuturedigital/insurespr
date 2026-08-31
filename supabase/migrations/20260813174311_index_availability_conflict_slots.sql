begin;

create index booking_availability_conflicts_slot_id_idx
  on private.booking_availability_conflicts(slot_id)
  where slot_id is not null;

commit;
