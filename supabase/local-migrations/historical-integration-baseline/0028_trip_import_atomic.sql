-- 0028_trip_import_atomic.sql — issue #8: one transactional JSON import RPC.
--
-- The HTTP route uses its authenticated session client exactly once.  Keeping
-- the upsert/add-only logic here means an error in any later trip rolls the
-- whole import back, and concurrent imports cannot overrun the plan limit.

-- 0016 allowed an empty default slug and earlier seed data can therefore hold
-- duplicate empty values.  Canonicalise every legacy slug before introducing
-- the tuple constraint: keep the first readable base, suffix later duplicates
-- with their immutable row id, and resolve the pathological base/id collision
-- in a second deterministic pass.
with normalized as (
  select
    p.id,
    p.tenant_id,
    p.trip_id,
    coalesce(
      nullif(
        trim(both '-' from regexp_replace(
          lower(coalesce(nullif(btrim(p.slug), ''), nullif(btrim(p.name), ''), 'plan')),
          '[^a-z0-9一-鿿]+', '-', 'g'
        )),
        ''
      ),
      'plan'
    ) as base_slug
  from public.trip_plans p
), ranked as (
  select *, row_number() over (
    partition by tenant_id, trip_id, base_slug order by id
  ) as base_rank
  from normalized
), proposed as (
  select *, case when base_rank = 1 then base_slug
    else base_slug || '-' || replace(id::text, '-', '') end as proposed_slug
  from ranked
), collision_ranked as (
  select *, row_number() over (
    partition by tenant_id, trip_id, proposed_slug order by id
  ) as collision_rank
  from proposed
)
update public.trip_plans p
set slug = case when c.collision_rank = 1 then c.proposed_slug
  else c.proposed_slug || '-' || replace(c.id::text, '-', '') end
from collision_ranked c
where p.id = c.id;

alter table trip_plans
  add constraint trip_plans_tenant_trip_slug_key unique (tenant_id, trip_id, slug);

create or replace function public.import_trips_atomic(
  p_tenant_id uuid,
  p_trips jsonb
)
returns table (
  title text,
  trip_id uuid,
  created boolean,
  plans_added integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_trip jsonb;
  v_plans jsonb;
  v_trip_id uuid;
  v_created boolean;
  v_plans_added integer;
  v_existing_plan_count integer;
  v_new_plan_count integer;
  v_results jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  -- This is deliberately not delegated to route middleware: direct RPC calls
  -- must not be able to import into another tenant or bypass the role gate.
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.role in ('OWNER', 'MANAGER')
  ) then
    raise exception 'manager role required for this tenant' using errcode = '42501';
  end if;

  if jsonb_typeof(p_trips) <> 'array'
     or jsonb_array_length(p_trips) < 1
     or jsonb_array_length(p_trips) > 100 then
    raise exception 'p_trips must contain 1 to 100 trips' using errcode = '22023';
  end if;

  -- Validate every JSON member before writing the first row.  PostgreSQL
  -- additionally wraps a function call in the caller's statement transaction.
  for v_trip in select value from jsonb_array_elements(p_trips) loop
    if jsonb_typeof(v_trip) <> 'object'
       or coalesce(btrim(v_trip->>'title'), '') = ''
       or coalesce(btrim(v_trip->>'slug'), '') = '' then
      raise exception 'each trip requires a nonempty title and slug' using errcode = '22023';
    end if;
    v_plans := coalesce(v_trip->'activityPlans', '[]'::jsonb);
    if jsonb_typeof(v_plans) <> 'array' or jsonb_array_length(v_plans) > 100 then
      raise exception 'each trip may have at most 100 plans' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_plans) p(value)
      where jsonb_typeof(p.value) <> 'object'
         or coalesce(btrim(p.value->>'name'), '') = ''
         or coalesce(btrim(p.value->>'slug'), '') = ''
    ) then
      raise exception 'each plan requires a nonempty name and slug' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_plans) p(value)
      group by p.value->>'slug'
      having count(*) > 1
    ) then
      raise exception 'duplicate plan slug in a trip' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1
    from jsonb_array_elements(p_trips) p(value)
    group by p.value->>'slug'
    having count(*) > 1
  ) then
    raise exception 'duplicate trip slug in batch' using errcode = '22023';
  end if;

  -- Lock all pre-existing rows in the same order before the first trip write.
  -- A pair of overlapping [A, B] / [B, A] imports must never take A then B
  -- in one transaction and B then A in another.  New rows are likewise
  -- inserted below in slug order, so their unique-index conflict checks use
  -- that same order.
  perform 1
  from public.trips t
  where t.tenant_id = p_tenant_id
    and t.slug in (
      select p.value->>'slug'
      from jsonb_array_elements(p_trips) p(value)
    )
  order by t.slug
  for update;

  -- Mutate deterministic slug order.  Results are buffered and returned in
  -- caller input order after this loop, preserving the HTTP/RPC contract.
  for v_trip in
    select p.value
    from jsonb_array_elements(p_trips) p(value)
    order by p.value->>'slug'
  loop
    insert into public.trips (
      tenant_id, slug, title, tagline, summary, description, region, category,
      cover_image_url, gallery, duration_minutes, meeting_point, meeting_point_map_url,
      inclusions, exclusions, notices, refund_rules, safety_notice, good_for, faq,
      social_proof_quotes
    ) values (
      p_tenant_id, v_trip->>'slug', v_trip->>'title', coalesce(v_trip->>'tagline', ''),
      coalesce(v_trip->>'summary', ''), coalesce(v_trip->>'description', ''),
      coalesce(v_trip->>'region', ''), coalesce(v_trip->>'category', ''),
      coalesce(v_trip->>'cover_image_url', ''), coalesce(v_trip->'gallery', '[]'::jsonb),
      nullif(v_trip->>'duration_minutes', '')::integer, coalesce(v_trip->>'meeting_point', ''),
      coalesce(v_trip->>'meeting_point_map_url', ''), coalesce(v_trip->'inclusions', '[]'::jsonb),
      coalesce(v_trip->'exclusions', '[]'::jsonb), coalesce(v_trip->'notices', '[]'::jsonb),
      coalesce(v_trip->'refund_rules', '[]'::jsonb), coalesce(v_trip->>'safety_notice', ''),
      coalesce(v_trip->'good_for', '[]'::jsonb), coalesce(v_trip->'faq', '[]'::jsonb),
      coalesce(v_trip->'social_proof_quotes', '[]'::jsonb)
    )
    on conflict (tenant_id, slug) do update set
      title = excluded.title,
      tagline = excluded.tagline,
      summary = excluded.summary,
      description = excluded.description,
      region = excluded.region,
      category = excluded.category,
      cover_image_url = excluded.cover_image_url,
      gallery = excluded.gallery,
      duration_minutes = excluded.duration_minutes,
      meeting_point = excluded.meeting_point,
      meeting_point_map_url = excluded.meeting_point_map_url,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      notices = excluded.notices,
      refund_rules = excluded.refund_rules,
      safety_notice = excluded.safety_notice,
      good_for = excluded.good_for,
      faq = excluded.faq,
      social_proof_quotes = excluded.social_proof_quotes,
      updated_at = now()
    returning id, (xmax = 0) into v_trip_id, v_created;

    -- Serialise plan-limit decisions for one trip.  The tuple unique constraint
    -- handles duplicate plans; this row lock also prevents 99+1+1 races.
    perform 1 from public.trips t where t.id = v_trip_id for update;
    v_plans := coalesce(v_trip->'activityPlans', '[]'::jsonb);
    select count(*) into v_existing_plan_count
    from public.trip_plans tp where tp.tenant_id = p_tenant_id and tp.trip_id = v_trip_id;
    select count(*) into v_new_plan_count
    from jsonb_array_elements(v_plans) p(value)
    where not exists (
      select 1 from public.trip_plans existing
      where existing.tenant_id = p_tenant_id
        and existing.trip_id = v_trip_id
        and existing.slug = p.value->>'slug'
    );
    if v_existing_plan_count + v_new_plan_count > 100 then
      raise exception 'a trip may have at most 100 final plans' using errcode = '22023';
    end if;

    -- Insert every plan in one statement.  Besides avoiding one round trip
    -- through the PL/pgSQL executor per plan, RETURNING reports precisely the
    -- rows that survived the add-only tuple-unique conflict rule.
    with inserted as (
      insert into public.trip_plans (
        tenant_id, trip_id, slug, name, description, duration_minutes, price_type,
        base_price, child_price, min_participants, max_participants, booking_type,
        highlights, plan_inclusions, plan_exclusions, plan_notices, plan_refund_rules,
        plan_itinerary, meeting_point_name, meeting_address, experience_point_name,
        experience_address, language, earliest_departure, confirm_by_days,
        free_cancel_days, details_link_text, booking_btn_text, sort_order
      ) select
        p_tenant_id, v_trip_id, p.value->>'slug', p.value->>'name',
        coalesce(p.value->>'description', ''), coalesce(nullif(p.value->>'duration_minutes', '')::integer, 60),
        coalesce(p.value->>'price_type', 'PER_PERSON'), coalesce(nullif(p.value->>'base_price', '')::numeric, 0),
        nullif(p.value->>'child_price', '')::numeric, coalesce(nullif(p.value->>'min_participants', '')::integer, 1),
        coalesce(nullif(p.value->>'max_participants', '')::integer, 10),
        coalesce(p.value->>'booking_type', 'SCHEDULED'), coalesce(p.value->'highlights', '[]'::jsonb),
        coalesce(p.value->'plan_inclusions', '[]'::jsonb), coalesce(p.value->'plan_exclusions', '[]'::jsonb),
        coalesce(p.value->'plan_notices', '[]'::jsonb), coalesce(p.value->'plan_refund_rules', '[]'::jsonb),
        coalesce(p.value->'plan_itinerary', '[]'::jsonb), coalesce(p.value->>'meeting_point_name', ''),
        coalesce(p.value->>'meeting_address', ''), coalesce(p.value->>'experience_point_name', ''),
        coalesce(p.value->>'experience_address', ''), coalesce(p.value->>'language', ''),
        nullif(p.value->>'earliest_departure', '')::date, nullif(p.value->>'confirm_by_days', '')::integer,
        nullif(p.value->>'free_cancel_days', '')::integer, coalesce(p.value->>'details_link_text', ''),
        coalesce(p.value->>'booking_btn_text', ''), coalesce(nullif(p.value->>'sort_order', '')::integer, 0)
      from jsonb_array_elements(v_plans) with ordinality p(value, ordinal)
      order by p.ordinal
      -- Use the named tuple constraint rather than a column conflict target.
      -- `trip_id` is also a RETURNS TABLE output variable, so an unqualified
      -- conflict target can be ambiguous when this PL/pgSQL function executes.
      on conflict on constraint trip_plans_tenant_trip_slug_key do nothing
      returning 1
    )
    select count(*) into v_plans_added from inserted;

    v_results := v_results || jsonb_build_object(
      v_trip->>'slug',
      jsonb_build_object(
        'title', v_trip->>'title',
        'trip_id', v_trip_id,
        'created', v_created,
        'plans_added', v_plans_added
      )
    );
  end loop;

  -- Database writes deliberately use slug order, but callers continue to
  -- receive one result per input item in the order they supplied it.
  for v_trip in
    select p.value
    from jsonb_array_elements(p_trips) with ordinality p(value, ordinal)
    order by p.ordinal
  loop
    v_result := v_results -> (v_trip->>'slug');
    title := v_result->>'title';
    trip_id := (v_result->>'trip_id')::uuid;
    created := (v_result->>'created')::boolean;
    plans_added := (v_result->>'plans_added')::integer;
    return next;
  end loop;
end;
$$;

revoke all on function public.import_trips_atomic(uuid, jsonb) from public;
revoke all on function public.import_trips_atomic(uuid, jsonb) from anon;
revoke all on function public.import_trips_atomic(uuid, jsonb) from service_role;
grant execute on function public.import_trips_atomic(uuid, jsonb) to authenticated;
