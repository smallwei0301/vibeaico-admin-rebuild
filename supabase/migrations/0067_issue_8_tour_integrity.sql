-- 0021_issue_8_tour_integrity.sql — #8-A forward integrity repair
--
-- 0015 creates the four core tour tables for a clean install and reconciles
-- the canonical columns on historical TEST schemas.  Its single-column child
-- foreign keys are sufficient for existence, but they do not prove that a
-- child belongs to the same tenant or that a departure's plan belongs to the
-- departure's trip.  This forward migration closes that gap without touching
-- tour_orders, checkout, seat RPCs, staff assignment, or availability.
--
-- The route layer owns MANAGER + TOUR_MODULE authorization.  RLS continues to
-- use the existing is_tenant_member(tenant_id) policy.  Changing direct
-- Supabase REST writes from tenant membership to a role-aware ACL is a
-- separate system/Owner decision and is intentionally not guessed here.

-- Fail closed before any schema mutation if historical rows cannot satisfy
-- the tenant-aware parent identities below.
do $$
declare
  v_plan_trip_mismatches bigint;
  v_addon_trip_mismatches bigint;
  v_departure_trip_mismatches bigint;
  v_departure_plan_mismatches bigint;
  v_total_mismatches bigint;
begin
  select count(*) into v_plan_trip_mismatches
    from public.trip_plans child
    join public.trips parent on parent.id = child.trip_id
   where child.tenant_id <> parent.tenant_id;

  select count(*) into v_addon_trip_mismatches
    from public.trip_addons child
    join public.trips parent on parent.id = child.trip_id
   where child.tenant_id <> parent.tenant_id;

  select count(*) into v_departure_trip_mismatches
    from public.trip_departures child
    join public.trips parent on parent.id = child.trip_id
   where child.tenant_id <> parent.tenant_id;

  select count(*) into v_departure_plan_mismatches
    from public.trip_departures child
    join public.trip_plans parent on parent.id = child.plan_id
   where child.tenant_id <> parent.tenant_id
      or child.trip_id <> parent.trip_id;

  v_total_mismatches := v_plan_trip_mismatches
    + v_addon_trip_mismatches
    + v_departure_trip_mismatches
    + v_departure_plan_mismatches;

  if v_total_mismatches > 0 then
    raise exception using
      errcode = 'P0001',
      message = format('0021 tenant/parent preflight failed: %s relationship mismatch(es)', v_total_mismatches),
      detail = format(
        'trip_plans.trip_id=%s; trip_addons.trip_id=%s; '
        || 'trip_departures.trip_id=%s; trip_departures.plan_id=%s',
        v_plan_trip_mismatches,
        v_addon_trip_mismatches,
        v_departure_trip_mismatches,
        v_departure_plan_mismatches
      ),
      hint = 'Repair the named rows so every child tenant and parent topology matches, then rerun 0021. No schema changes were applied.';
  end if;
end;
$$;

-- Every composite foreign key needs a matching unique parent key.  The names
-- are stable so this migration is safe to replay against a partially repaired
-- historical schema; existing differently-named equivalent keys are harmless
-- and are left in place.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trips'::regclass
       and conname = 'trips_tenant_id_id_key'
  ) then
    alter table public.trips
      add constraint trips_tenant_id_id_key unique (tenant_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_tenant_id_id_key'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_tenant_id_id_key unique (tenant_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_tenant_trip_id_id_key'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_tenant_trip_id_id_key unique (tenant_id, trip_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_addons'::regclass
       and conname = 'trip_addons_tenant_id_id_key'
  ) then
    alter table public.trip_addons
      add constraint trip_addons_tenant_id_id_key unique (tenant_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departures'::regclass
       and conname = 'trip_departures_tenant_id_id_key'
  ) then
    alter table public.trip_departures
      add constraint trip_departures_tenant_id_id_key unique (tenant_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departures'::regclass
       and conname = 'trip_departures_tenant_trip_plan_id_id_key'
  ) then
    alter table public.trip_departures
      add constraint trip_departures_tenant_trip_plan_id_id_key
      unique (tenant_id, trip_id, plan_id, id);
  end if;
end;
$$;

-- Keep the payment and capacity invariants at the database boundary too.
-- Existing invalid data intentionally aborts this migration rather than being
-- silently rewritten.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_price_per_person_nonnegative'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_price_per_person_nonnegative
      check (price_per_person is not null and price_per_person >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_child_price_nonnegative'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_child_price_nonnegative
      check (child_price is null or child_price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_party_range_valid'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_party_range_valid
      check (min_party is not null and max_party is not null and min_party >= 1 and max_party >= min_party);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_deposit_policy_valid'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_deposit_policy_valid
      check (
        deposit_mode is not null
        and deposit_value is not null
        and (
          (deposit_mode in ('NONE', 'FULL') and deposit_value = 0)
          or (deposit_mode = 'DEPOSIT_FIXED' and deposit_value > 0 and deposit_value <= price_per_person)
          or (deposit_mode = 'DEPOSIT_PERCENT' and deposit_value > 0 and deposit_value <= 100)
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_addons'::regclass
       and conname = 'trip_addons_price_nonnegative'
  ) then
    alter table public.trip_addons
      add constraint trip_addons_price_nonnegative
      check (price is not null and price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departures'::regclass
       and conname = 'trip_departures_capacity_positive'
  ) then
    alter table public.trip_departures
      add constraint trip_departures_capacity_positive
      check (capacity is not null and capacity > 0);
  end if;
end;
$$;

-- Remove only the old single-column child-to-parent links.  Existing
-- tenant-aware links are deliberately preserved; the exact-column checks below
-- make this block safe on TEST schemas that already received an earlier repair.
do $$
declare
  item record;
begin
  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_plans'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'trip_id')]::smallint[]
       and c.confkey = array[(select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')]::smallint[]
  loop
    execute format('alter table public.trip_plans drop constraint %I', item.conname);
  end loop;

  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_addons'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.trip_addons'::regclass and attname = 'trip_id')]::smallint[]
       and c.confkey = array[(select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')]::smallint[]
  loop
    execute format('alter table public.trip_addons drop constraint %I', item.conname);
  end loop;

  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_departures'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'trip_id')]::smallint[]
       and c.confkey = array[(select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')]::smallint[]
  loop
    execute format('alter table public.trip_departures drop constraint %I', item.conname);
  end loop;

  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_departures'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trip_plans'::regclass
       and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'plan_id')]::smallint[]
       and c.confkey = array[(select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'id')]::smallint[]
  loop
    execute format('alter table public.trip_departures drop constraint %I', item.conname);
  end loop;
end;
$$;

-- Add the tenant-aware topology links when an equivalent validated FK is not
-- already present.  A historical schema may use a different constraint name;
-- matching local and referenced column arrays is the source of truth.
do $$
declare
  item record;
begin
  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_plans'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'trip_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')
       ]::smallint[]
       and not c.convalidated
  loop
    execute format('alter table public.trip_plans validate constraint %I', item.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.trip_plans'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'trip_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')
       ]::smallint[]
  ) then
    alter table public.trip_plans
      add constraint trip_plans_tenant_trip_fkey
      foreign key (tenant_id, trip_id)
      references public.trips (tenant_id, id)
      on delete cascade;
  end if;

  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_addons'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_addons'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_addons'::regclass and attname = 'trip_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')
       ]::smallint[]
       and not c.convalidated
  loop
    execute format('alter table public.trip_addons validate constraint %I', item.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.trip_addons'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_addons'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_addons'::regclass and attname = 'trip_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')
       ]::smallint[]
  ) then
    alter table public.trip_addons
      add constraint trip_addons_tenant_trip_fkey
      foreign key (tenant_id, trip_id)
      references public.trips (tenant_id, id)
      on delete cascade;
  end if;

  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_departures'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'trip_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')
       ]::smallint[]
       and not c.convalidated
  loop
    execute format('alter table public.trip_departures validate constraint %I', item.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.trip_departures'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'trip_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')
       ]::smallint[]
  ) then
    alter table public.trip_departures
      add constraint trip_departures_tenant_trip_fkey
      foreign key (tenant_id, trip_id)
      references public.trips (tenant_id, id)
      on delete cascade;
  end if;

  for item in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trip_departures'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trip_plans'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'trip_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'plan_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'trip_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'id')
       ]::smallint[]
       and not c.convalidated
  loop
    execute format('alter table public.trip_departures validate constraint %I', item.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.trip_departures'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.trip_plans'::regclass
       and c.conkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'trip_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_departures'::regclass and attname = 'plan_id')
       ]::smallint[]
       and c.confkey = array[
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'tenant_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'trip_id'),
         (select attnum from pg_attribute where attrelid = 'public.trip_plans'::regclass and attname = 'id')
       ]::smallint[]
  ) then
    alter table public.trip_departures
      add constraint trip_departures_tenant_trip_plan_fkey
      foreign key (tenant_id, trip_id, plan_id)
      references public.trip_plans (tenant_id, trip_id, id)
      on delete cascade;
  end if;
end;
$$;

-- List queries filter by tenant + parent and order by sort_order.  The
-- canonical departure index from 0015 remains in place; these two indexes are
-- the missing bounded query paths called out by the audit.
create index if not exists trip_plans_tenant_trip_sort_idx
  on public.trip_plans (tenant_id, trip_id, sort_order);

create index if not exists trip_addons_tenant_trip_sort_idx
  on public.trip_addons (tenant_id, trip_id, sort_order);
