begin;

-- Publish only staff-confirmed request/quote pathways. Clinical, operational,
-- commercial, preparation, timing, reporting, and referral details remain
-- intentionally unpublished unless they are explicit safety requirements.
insert into public.services (
  category_id,
  slug,
  name,
  short_description,
  audience,
  booking_mode,
  confirmation_mode,
  appointment_duration_minutes,
  price_type,
  cash_price_cents,
  cash_price_max_cents,
  price_note,
  medical_aid_status,
  referral_requirement,
  appointment_requirement,
  what_to_bring,
  expected_duration,
  results_process,
  preparation_instructions,
  source_url,
  verification_status,
  display_order,
  is_published
)
values
  (
    (select id from public.service_categories where slug = 'individuals'),
    'primary-healthcare-x-ray',
    'Primary Healthcare X-Ray',
    'Requested X-ray imaging that supports a healthcare professional''s clinical assessment. Direct contact is welcome, but exposure only follows a suitability check and an appropriate written, signed clinical request.',
    'individual',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    'An appropriate written, signed clinical request is required before exposure; staff must confirm that the requested examination is suitable.',
    'Contact the practice directly. Staff must confirm the requested examination, suitability and written, signed clinical request before any exposure or scheduling.',
    null,
    null,
    null,
    null,
    'https://www.sahpra.org.za/document/guidelines-on-requests-for-medical-x-ray-examinations/',
    'needs_confirmation',
    10,
    true
  ),
  (
    (select id from public.service_categories where slug = 'individuals'),
    'visa-chest-x-ray',
    'Administrative & Foreign-Programme Chest X-Ray',
    'A staff-reviewed chest X-ray request for administrative or foreign-programme documentation where the requesting programme accepts the practice''s imaging and reporting process.',
    'individual',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    'An appropriate written, signed clinical request is required before exposure; an administrative form on its own may not satisfy the clinical-request requirement.',
    'Contact staff with the requesting authority, country or programme and its current forms. Staff must confirm acceptance, identity and documentation requirements, an appropriate written, signed clinical request and suitability before any exposure. This service is not represented as a South African Department of Home Affairs requirement or an approved panel medical.',
    null,
    null,
    null,
    null,
    'https://travel.state.gov/content/travel/en/us-visas/Supplements/Supplements_by_Post/JHN-Johannesburg.html',
    'needs_confirmation',
    20,
    true
  ),
  (
    (select id from public.service_categories where slug = 'individuals'),
    'musculoskeletal-x-ray',
    'Musculoskeletal X-Ray',
    'Requested plain X-ray imaging for a clinician-identified bone or joint concern. Staff must confirm the requested examination and suitability before exposure.',
    'individual',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    'An appropriate written, signed clinical request is required before exposure; staff must confirm that the requested examination is suitable.',
    'Contact the practice directly. Staff must confirm the requested examination, suitability and written, signed clinical request before any exposure or scheduling.',
    null,
    null,
    null,
    null,
    'https://www.sahpra.org.za/document/guidelines-on-requests-for-medical-x-ray-examinations/',
    'needs_confirmation',
    30,
    true
  ),
  (
    (select id from public.service_categories where slug = 'individuals'),
    'chest-x-ray',
    'Chest X-Ray',
    'Requested chest radiography for a clinician-identified indication. A chest X-ray is not a stand-alone diagnosis or exclusion test for tuberculosis.',
    'individual',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    'An appropriate written, signed clinical request is required before exposure; staff must confirm that the requested examination is suitable.',
    'Contact the practice directly. Staff must confirm the requested examination, suitability and written, signed clinical request before any exposure or scheduling.',
    null,
    null,
    null,
    null,
    'https://www.sahpra.org.za/document/guidelines-on-requests-for-medical-x-ray-examinations/',
    'needs_confirmation',
    40,
    true
  ),
  (
    (select id from public.service_categories where slug = 'individuals'),
    'orthopaedic-follow-up-x-ray',
    'Orthopaedic Follow-Up X-Ray',
    'Requested follow-up X-ray imaging when an appropriate clinician needs to review healing, alignment or another orthopaedic concern.',
    'individual',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    'An appropriate written, signed clinical request is required before exposure; staff must confirm that the requested examination is suitable.',
    'Contact the practice directly. Staff must confirm the requested follow-up examination, suitability and written, signed clinical request before any exposure or scheduling.',
    null,
    null,
    null,
    null,
    'https://www.sahpra.org.za/document/guidelines-on-requests-for-medical-x-ray-examinations/',
    'needs_confirmation',
    50,
    true
  ),
  (
    (select id from public.service_categories where slug = 'scanning'),
    'runner-athlete-bone-health',
    'Runner & Athlete Bone Health',
    'A staff-reviewed pathway that helps runners and athletes identify whether DXA measurement, clinically indicated X-ray imaging or referral is the appropriate next step.',
    'scanning',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    null,
    'Submit a request. Staff must confirm the concern or measurement goal, service availability, suitability, any required clinician involvement and the next step before scheduling.',
    null,
    null,
    null,
    null,
    'https://pubmed.ncbi.nlm.nih.gov/42369533/',
    'needs_confirmation',
    40,
    true
  ),
  (
    (select id from public.service_categories where slug = 'scanning'),
    'menopause-bone-health',
    'Menopause & Bone Health',
    'A staff-reviewed bone-health pathway for people around or after menopause with clinician-identified risk factors; staff confirms whether DXA or referral is appropriate.',
    'scanning',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    null,
    'Submit a request. Staff must confirm the clinical purpose, service availability, suitability, any required clinician involvement and the next step before scheduling.',
    null,
    null,
    null,
    null,
    'https://knowledgehub.health.gov.za/system/files/elibdownloads/2023-10/APC_2023_Clinical_tool-DIGITAL.pdf',
    'needs_confirmation',
    50,
    true
  ),
  (
    (select id from public.service_categories where slug = 'scanning'),
    'treatment-related-bone-health',
    'Treatment-Related Bone Health',
    'A staff-reviewed bone-health request for people whose clinician is monitoring medicine- or treatment-related fracture risk; the responsible clinician determines whether and when DXA is appropriate.',
    'scanning',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    null,
    'Submit a request. Staff must confirm the clinical purpose, service availability, suitability, responsible clinician and next step before scheduling.',
    null,
    null,
    null,
    null,
    'https://osteoporosis.org.za/download/151/guidelines/10117/guidelines-on-diagnosis-and-management-of-osteoporosis-draft.pdf',
    'needs_confirmation',
    60,
    true
  ),
  (
    (select id from public.service_categories where slug = 'scanning'),
    'post-fracture-bone-health',
    'Post-Fracture Bone Health',
    'A staff-reviewed pathway after a low-trauma fracture or clinician concern to determine whether DXA, vertebral assessment availability or specialist referral is the appropriate next step.',
    'scanning',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    null,
    'Submit a request. Staff must confirm the clinical purpose, service availability, suitability, required clinician involvement and next step before scheduling.',
    null,
    null,
    null,
    null,
    'https://osteoporosis.org.za/fracture-liaison-service-first-fracture-care-as-a-prevention-tool/',
    'needs_confirmation',
    70,
    true
  ),
  (
    (select id from public.service_categories where slug = 'scanning'),
    'body-composition-progress',
    'Body Composition Progress',
    'A request for a standardised DXA body-composition baseline or comparison to support a qualified health or fitness professional; it is not a diagnosis of metabolic disease.',
    'scanning',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    null,
    'Submit a request. Staff must confirm body-composition capability, suitability, standardised comparison conditions, any required professional involvement and the next step before scheduling.',
    null,
    null,
    null,
    null,
    'https://www.sahpra.org.za/document/bone-densitometer-shielding-qualifications-and-monitoring-of-operators/',
    'needs_confirmation',
    80,
    true
  ),
  (
    (select id from public.service_categories where slug = 'scanning'),
    'long-term-condition-bone-health',
    'Long-Term Condition Bone Health',
    'A staff-reviewed request for clinician-directed bone-health assessment where a long-term condition or treatment may affect fracture risk.',
    'scanning',
    'request',
    'staff',
    null,
    'unpublished',
    null,
    null,
    null,
    null,
    null,
    'Submit a request. Staff must confirm the clinical purpose, service availability, suitability, responsible clinician and next step before scheduling.',
    null,
    null,
    null,
    null,
    'https://www.sahivsoc.org/Files/SAHCS%202026%20OPWH%20guideline.pdf',
    'needs_confirmation',
    90,
    true
  ),
  (
    (select id from public.service_categories where slug = 'workforce'),
    'workplace-chest-x-ray',
    'Workplace Chest X-Ray',
    'Risk-based chest radiography requested by employers and occupational-health professionals as part of an appropriate medical-surveillance programme; not a stand-alone fitness certificate or tuberculosis diagnosis.',
    'workforce',
    'quote',
    'staff',
    null,
    'quote',
    null,
    null,
    null,
    null,
    'An appropriate written, signed clinical request is required before exposure; the employer or occupational-health programme does not replace individual clinical justification.',
    'Employers or occupational-health professionals should request a quote with workforce size, exposure and risk context, required programme, timing and location. Staff must confirm scope, partners, reporting, each appropriate written, signed clinical request, suitability before any exposure and whether fixed-premises service is appropriate.',
    null,
    null,
    null,
    null,
    'https://www.labour.gov.za/DocumentCenter/Publications/Occupational%20Health%20and%20Safety/Guide%20on%20workers%20health%20protection%20through%20the%20good%20handling%20and%20use%20of%20Crystalline%20Silica%20dust%20and%20produrcts%20containing%20it.pdf',
    'needs_confirmation',
    20,
    true
  )
on conflict (slug) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  short_description = excluded.short_description,
  audience = excluded.audience,
  booking_mode = excluded.booking_mode,
  confirmation_mode = excluded.confirmation_mode,
  appointment_duration_minutes = excluded.appointment_duration_minutes,
  price_type = excluded.price_type,
  cash_price_cents = excluded.cash_price_cents,
  cash_price_max_cents = excluded.cash_price_max_cents,
  price_note = excluded.price_note,
  medical_aid_status = excluded.medical_aid_status,
  referral_requirement = excluded.referral_requirement,
  appointment_requirement = excluded.appointment_requirement,
  what_to_bring = excluded.what_to_bring,
  expected_duration = excluded.expected_duration,
  results_process = excluded.results_process,
  preparation_instructions = excluded.preparation_instructions,
  source_url = excluded.source_url,
  verification_status = excluded.verification_status,
  display_order = excluded.display_order,
  is_published = excluded.is_published;

-- Catalogue and least-privilege contract. A valid synthetic row is inserted in
-- a nested subtransaction and deliberately rolled back by the TST01 sentinel.
-- Unexpected errors escape and abort the migration.
do $contract$
declare
  v_synthetic_slug text := 'catalogue-contract-' || substr(extensions.gen_random_uuid()::text, 1, 8);
begin
  if (
    with expected(
      slug,
      category_slug,
      audience,
      booking_mode,
      price_type,
      display_order,
      requires_clinical_request
    ) as (
      values
        ('primary-healthcare-x-ray', 'individuals', 'individual', 'request', 'unpublished', 10, true),
        ('visa-chest-x-ray', 'individuals', 'individual', 'request', 'unpublished', 20, true),
        ('musculoskeletal-x-ray', 'individuals', 'individual', 'request', 'unpublished', 30, true),
        ('chest-x-ray', 'individuals', 'individual', 'request', 'unpublished', 40, true),
        ('orthopaedic-follow-up-x-ray', 'individuals', 'individual', 'request', 'unpublished', 50, true),
        ('runner-athlete-bone-health', 'scanning', 'scanning', 'request', 'unpublished', 40, false),
        ('menopause-bone-health', 'scanning', 'scanning', 'request', 'unpublished', 50, false),
        ('treatment-related-bone-health', 'scanning', 'scanning', 'request', 'unpublished', 60, false),
        ('post-fracture-bone-health', 'scanning', 'scanning', 'request', 'unpublished', 70, false),
        ('body-composition-progress', 'scanning', 'scanning', 'request', 'unpublished', 80, false),
        ('long-term-condition-bone-health', 'scanning', 'scanning', 'request', 'unpublished', 90, false),
        ('workplace-chest-x-ray', 'workforce', 'workforce', 'quote', 'quote', 20, true)
    )
    select count(*)
    from expected
    left join public.services as service on service.slug = expected.slug
    left join public.service_categories as category on category.id = service.category_id
    where service.id is null
      or category.slug is distinct from expected.category_slug
      or service.audience is distinct from expected.audience
      or service.booking_mode is distinct from expected.booking_mode
      or service.confirmation_mode is distinct from 'staff'
      or service.price_type is distinct from expected.price_type
      or service.verification_status is distinct from 'needs_confirmation'
      or service.display_order is distinct from expected.display_order
      or service.is_published is not true
      or service.appointment_duration_minutes is not null
      or service.cash_price_cents is not null
      or service.cash_price_max_cents is not null
      or service.price_note is not null
      or service.medical_aid_status is not null
      or service.what_to_bring is not null
      or service.expected_duration is not null
      or service.results_process is not null
      or service.preparation_instructions is not null
      or (
        expected.requires_clinical_request
        and (
          service.referral_requirement is null
          or service.referral_requirement not ilike '%written, signed clinical request%'
          or service.referral_requirement not ilike '%before exposure%'
          or service.appointment_requirement is null
          or service.appointment_requirement not ilike '%suitability%'
          or service.appointment_requirement not ilike '%before any exposure%'
        )
      )
      or (
        not expected.requires_clinical_request
        and service.referral_requirement is not null
      )
      or nullif(btrim(service.short_description), '') is null
      or nullif(btrim(service.appointment_requirement), '') is null
      or nullif(btrim(service.source_url), '') is null
  ) <> 0 then
    raise exception 'Johannesburg X-ray/DXA catalogue contract failed';
  end if;

  if not exists (
    select 1
    from public.services
    where slug = 'primary-healthcare-x-ray'
      and short_description ilike '%Direct contact%'
      and short_description ilike '%suitability check%'
      and short_description ilike '%written, signed clinical request%'
      and short_description ilike '%exposure%'
      and referral_requirement ilike '%written, signed clinical request%'
      and appointment_requirement ilike '%before any exposure%'
  ) then
    raise exception 'primary healthcare X-ray request guardrail failed';
  end if;

  if not exists (
    select 1
    from public.services
    where slug = 'visa-chest-x-ray'
      and name = 'Administrative & Foreign-Programme Chest X-Ray'
      and short_description ilike '%administrative or foreign-programme%'
      and appointment_requirement ilike '%not represented as a South African Department of Home Affairs requirement%'
      and appointment_requirement ilike '%approved panel medical%'
  ) then
    raise exception 'administrative chest X-ray scope guardrail failed';
  end if;

  if exists (
    select 1
    from public.services
    where slug in (
      'primary-healthcare-x-ray',
      'visa-chest-x-ray',
      'musculoskeletal-x-ray',
      'chest-x-ray',
      'orthopaedic-follow-up-x-ray',
      'runner-athlete-bone-health',
      'menopause-bone-health',
      'treatment-related-bone-health',
      'post-fracture-bone-health',
      'body-composition-progress',
      'long-term-condition-bone-health',
      'workplace-chest-x-ray'
    )
      and booking_mode = 'appointment'
  ) then
    raise exception 'unverified catalogue row exposed appointment booking';
  end if;

  if not (
    select count(*) = 2
      and coalesce(bool_and(class.relrowsecurity), false)
    from pg_class as class
    join pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in ('services', 'service_categories')
  )
    or has_table_privilege('anon', 'public.services', 'SELECT')
    or has_table_privilege('anon', 'public.services', 'INSERT')
    or has_table_privilege('anon', 'public.services', 'UPDATE')
    or has_table_privilege('anon', 'public.services', 'DELETE')
    or has_table_privilege('authenticated', 'public.services', 'SELECT')
    or has_table_privilege('authenticated', 'public.services', 'INSERT')
    or has_table_privilege('authenticated', 'public.services', 'UPDATE')
    or has_table_privilege('authenticated', 'public.services', 'DELETE')
    or has_table_privilege('anon', 'public.service_categories', 'SELECT')
    or has_table_privilege('authenticated', 'public.service_categories', 'SELECT')
    or not has_table_privilege('service_role', 'public.services', 'SELECT')
    or not has_table_privilege('service_role', 'public.services', 'INSERT')
    or not has_table_privilege('service_role', 'public.services', 'UPDATE')
    or not has_table_privilege('service_role', 'public.services', 'DELETE')
    or not has_table_privilege('service_role', 'public.service_categories', 'SELECT') then
    raise exception 'catalogue RLS or ACL posture failed';
  end if;

  begin
    insert into public.services (
      category_id,
      slug,
      name,
      short_description,
      audience,
      booking_mode,
      confirmation_mode,
      price_type,
      appointment_requirement,
      verification_status,
      display_order,
      is_published
    ) values (
      (select id from public.service_categories where slug = 'individuals'),
      v_synthetic_slug,
      'Catalogue rollback contract',
      'Synthetic migration contract; never committed.',
      'individual',
      'request',
      'staff',
      'unpublished',
      'Synthetic migration contract; never committed.',
      'needs_confirmation',
      9999,
      false
    );

    if not exists (
      select 1 from public.services where slug = v_synthetic_slug
    ) then
      raise exception 'catalogue rollback contract could not create its synthetic row';
    end if;

    raise exception 'rollback Johannesburg catalogue contract'
      using errcode = 'TST01';
  exception when sqlstate 'TST01' then
    null;
  end;

  if exists (
    select 1 from public.services where slug = v_synthetic_slug
  ) then
    raise exception 'catalogue rollback contract left synthetic data';
  end if;
end;
$contract$;

commit;
