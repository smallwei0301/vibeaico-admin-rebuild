-- 0030_trip_plan_global_limit.sql — issue #8: forward, database-wide plan cap.
--
-- 0028/0029 may already be applied.  This migration therefore never rewrites
-- history: it first refuses legacy states above the cap, then installs a
-- trigger that protects every writer (HTTP API, duplicate, import RPC, and
-- direct SQL subject to the table's existing RLS policies).  Re-running is
-- safe: CREATE OR REPLACE refreshes functions and the trigger is recreated.

-- Do not silently delete or archive plans in a forward migration.  An
-- operator must repair a legacy violation deliberately; a normal Supabase
-- migration transaction rolls this preflight and all following DDL back.
do $$
declare
  v_trip_id uuid;
  v_plan_count bigint;
begin
  -- Block INSERT/UPDATE/DELETE writers from slipping a 101st row between the
  -- legacy scan and trigger installation.  SHARE ROW EXCLUSIVE is the least
  -- table lock that conflicts with normal writes; it is held to transaction
  -- end, including CREATE TRIGGER below.
  lock table public.trip_plans in share row exclusive mode;

  select tp.trip_id, count(*)
    into v_trip_id, v_plan_count
    from public.trip_plans tp
   group by tp.trip_id
  having count(*) > 100
   order by tp.trip_id
   limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = format('0030 trip-plan preflight failed: trip %s has %s plans (limit 100)', v_trip_id, v_plan_count),
      hint = 'Repair this legacy trip to at most 100 plans, then rerun migration 0030. No schema changes were applied.';
  end if;
end;
$$;

-- SECURITY DEFINER is intentionally limited to the trigger's internal parent
-- lock/count query.  It does not grant callers data access: INSERT/UPDATE
-- still pass trip_plans RLS, and direct execution is revoked below.  Statement
-- transition tables mean a 100-plan batch locks/counts each affected trip
-- once instead of doing O(n²) scans.  Do not use FOR UPDATE here:
-- the tenant-aware FK in 0029 takes KEY SHARE on the same parent, which is
-- compatible with FOR NO KEY UPDATE but can deadlock with FOR UPDATE.
create or replace function public.enforce_trip_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target record;
begin
  -- `new_trip_plans` is the transition table supplied by both statement
  -- triggers below.  Slug order deliberately matches import_trips_atomic's
  -- all-parent lock order, preventing cross-writer lock-order inversions.
  for v_target in
    select n.tenant_id, n.trip_id
      from new_trip_plans n
      join public.trips t on t.tenant_id = n.tenant_id and t.id = n.trip_id
     group by n.tenant_id, n.trip_id, t.slug
     order by n.tenant_id, t.slug, n.trip_id
  loop
    perform 1
      from public.trips t
     where t.tenant_id = v_target.tenant_id
       and t.id = v_target.trip_id
     for no key update;

    if not found then
      raise exception 'TRIP_PLAN_PARENT_NOT_FOUND' using errcode = '23503';
    end if;

    if (
      select count(*)
        from public.trip_plans tp
       where tp.tenant_id = v_target.tenant_id
         and tp.trip_id = v_target.trip_id
    ) > 100 then
      raise exception 'TRIP_PLAN_LIMIT: a trip may have at most 100 plans'
        using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.enforce_trip_plan_limit() from public;
revoke all on function public.enforce_trip_plan_limit() from anon;
revoke all on function public.enforce_trip_plan_limit() from authenticated;
revoke all on function public.enforce_trip_plan_limit() from service_role;

drop trigger if exists trip_plan_limit_guard on public.trip_plans;
drop trigger if exists trip_plan_limit_guard_update on public.trip_plans;
create trigger trip_plan_limit_guard
after insert on public.trip_plans
referencing new table as new_trip_plans
for each statement execute function public.enforce_trip_plan_limit();
create trigger trip_plan_limit_guard_update
after update on public.trip_plans
referencing new table as new_trip_plans
for each statement execute function public.enforce_trip_plan_limit();

-- Re-declare the latest RPC in this *forward* migration.  0028 remains the
-- historical install for clean databases; environments that already applied
-- it now receive the exact same auth/transaction/concurrency contract plus
-- the global trigger above.
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

  -- Validate the entire input before its first write.  A raised exception
  -- rolls the function statement back, including every prior trip in batch.
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
      select 1 from jsonb_array_elements(v_plans) p(value)
       where jsonb_typeof(p.value) <> 'object'
          or coalesce(btrim(p.value->>'name'), '') = ''
          or coalesce(btrim(p.value->>'slug'), '') = ''
    ) then
      raise exception 'each plan requires a nonempty name and slug' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_plans) p(value)
       group by p.value->>'slug' having count(*) > 1
    ) then
      raise exception 'duplicate plan slug in a trip' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_trips) p(value)
     group by p.value->>'slug' having count(*) > 1
  ) then
    raise exception 'duplicate trip slug in batch' using errcode = '22023';
  end if;

  -- Take all existing trip locks in slug order before writing.  This avoids
  -- [A,B]/[B,A] deadlocks; the plan trigger later reuses the same parent lock.
  perform 1
    from public.trips t
   where t.tenant_id = p_tenant_id
     and t.slug in (select p.value->>'slug' from jsonb_array_elements(p_trips) p(value))
   order by t.slug
   for update;

  for v_trip in
    select p.value from jsonb_array_elements(p_trips) p(value)
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
      title = excluded.title, tagline = excluded.tagline, summary = excluded.summary,
      description = excluded.description, region = excluded.region, category = excluded.category,
      cover_image_url = excluded.cover_image_url, gallery = excluded.gallery,
      duration_minutes = excluded.duration_minutes, meeting_point = excluded.meeting_point,
      meeting_point_map_url = excluded.meeting_point_map_url, inclusions = excluded.inclusions,
      exclusions = excluded.exclusions, notices = excluded.notices, refund_rules = excluded.refund_rules,
      safety_notice = excluded.safety_notice, good_for = excluded.good_for, faq = excluded.faq,
      social_proof_quotes = excluded.social_proof_quotes, updated_at = now()
    returning id, (xmax = 0) into v_trip_id, v_created;

    v_plans := coalesce(v_trip->'activityPlans', '[]'::jsonb);
    -- This precheck returns the stable 22023 contract for import callers.  It
    -- is only an optimisation/error-shape aid; the trigger is the global
    -- invariant for every writer and the final authority under concurrency.
    select count(*) into v_existing_plan_count
      from public.trip_plans tp
     where tp.tenant_id = p_tenant_id and tp.trip_id = v_trip_id;
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
      on conflict on constraint trip_plans_tenant_trip_slug_key do nothing
      returning 1
    )
    select count(*) into v_plans_added from inserted;

    v_results := v_results || jsonb_build_object(
      v_trip->>'slug', jsonb_build_object(
        'title', v_trip->>'title', 'trip_id', v_trip_id,
        'created', v_created, 'plans_added', v_plans_added
      )
    );
  end loop;

  -- Storage uses slug order; the public contract returns input order.
  for v_trip in
    select p.value from jsonb_array_elements(p_trips) with ordinality p(value, ordinal)
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
