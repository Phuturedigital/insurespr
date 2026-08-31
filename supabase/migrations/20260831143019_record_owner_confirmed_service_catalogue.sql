begin;

-- Catalogue approval and clinical verification answer different questions.
-- The owner has confirmed that these 16 conservative routes belong in the
-- public catalogue. Missing capability, licensing, practitioner, pricing,
-- medical-aid, preparation, reporting and availability evidence must remain
-- visible through verification_status and the other launch dependencies.
alter table public.services
  add column catalogue_status text not null default 'pending'
    check (catalogue_status in ('pending', 'owner_confirmed', 'withdrawn')),
  add column catalogue_confirmed_at timestamptz,
  add column catalogue_confirmed_by text,
  add column catalogue_confirmation_scope text,
  add column catalogue_confirmation_evidence_ref text,
  add constraint services_owner_confirmation_complete_check check (
    catalogue_status <> 'owner_confirmed'
    or (
      catalogue_confirmed_at is not null
      and nullif(btrim(catalogue_confirmed_by), '') is not null
      and nullif(btrim(catalogue_confirmation_scope), '') is not null
      and nullif(btrim(catalogue_confirmation_evidence_ref), '') is not null
    )
  );

comment on column public.services.catalogue_status is
  'Owner decision about whether a service belongs in the public catalogue; separate from clinical verification_status.';
comment on column public.services.catalogue_confirmation_scope is
  'Human-readable boundary of the owner catalogue decision so it cannot be mistaken for clinical, regulatory, price or availability verification.';

do $$
declare
  v_expected_slugs constant text[] := array[
    'body-composition-progress',
    'chest-x-ray',
    'dxa-body-composition',
    'dxa-bone-density',
    'long-term-condition-bone-health',
    'menopause-bone-health',
    'musculoskeletal-x-ray',
    'orthopaedic-follow-up-x-ray',
    'osteoporosis-care',
    'post-fracture-bone-health',
    'primary-healthcare-x-ray',
    'runner-athlete-bone-health',
    'treatment-related-bone-health',
    'visa-chest-x-ray',
    'workplace-chest-x-ray',
    'workplace-medicals'
  ];
  v_affected integer;
begin
  if (select count(*) from public.services where is_published) <> 16
     or exists (
       select 1
       from public.services
       where is_published
         and not (slug = any(v_expected_slugs))
     )
     or exists (
       select 1
       from unnest(v_expected_slugs) as expected(slug)
       where not exists (
         select 1
         from public.services as service
         where service.is_published
           and service.slug = expected.slug
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'Published service catalogue differs from the 16 routes explicitly confirmed by the owner';
  end if;

  update public.services
  set
    catalogue_status = 'owner_confirmed',
    catalogue_confirmed_at = timestamptz '2026-08-31 14:30:00+02',
    catalogue_confirmed_by = 'Motselisi R. Mosiana, owner',
    catalogue_confirmation_scope = 'Confirms only that the 16 conservative, request-led routes belong in the InsureSPR public catalogue. Does not verify current capability, equipment or licensing, responsible practitioners or reporting, referral or preparation requirements, prices or medical-aid arrangements, duration or results timing, availability or operating capacity.',
    catalogue_confirmation_evidence_ref = 'owner-task-2026-08-31-service-catalogue-confirmation',
    updated_at = now()
  where is_published
    and slug = any(v_expected_slugs);

  get diagnostics v_affected = row_count;
  if v_affected <> 16 then
    raise exception using
      errcode = '23514',
      message = 'Owner confirmation did not update exactly 16 services';
  end if;
end;
$$;

update public.launch_dependencies
set
  detail = 'Owner confirmation recorded 31 August 2026 for all 16 published conservative, request-led catalogue entries. This closes catalogue membership only. Every service remains needs_confirmation for separate capability, licensing, practitioner/reporting, referral/preparation, pricing/medical-aid, duration/results and availability facts; the corresponding clinical, credential, commercial and operations dependencies remain open.',
  status = 'resolved',
  blocks_launch = false,
  resolved_at = timestamptz '2026-08-31 14:30:00+02'
where dependency_key = 'service-catalogue';

do $$
begin
  if (select count(*) from public.services where is_published and catalogue_status = 'owner_confirmed') <> 16
     or exists (
       select 1
       from public.services
       where is_published
         and verification_status <> 'needs_confirmation'
     )
     or not exists (
       select 1
       from public.launch_dependencies
       where dependency_key = 'service-catalogue'
         and status = 'resolved'
         and not blocks_launch
         and resolved_at is not null
     ) then
    raise exception using
      errcode = '23514',
      message = 'Owner-confirmed catalogue invariants failed';
  end if;
end;
$$;

commit;
