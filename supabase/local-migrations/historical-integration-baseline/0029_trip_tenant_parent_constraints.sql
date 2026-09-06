-- 0029_trip_tenant_parent_constraints.sql — tenant/parent integrity for tours
--
-- The original tour tables have individual UUID foreign keys.  UUIDs make a
-- cross-tenant reference *possible* whenever a caller also supplies another
-- tenant_id, because those links do not prove that the parent belongs to that
-- tenant.  The composite keys below make the tenant part of every parent
-- identity and additionally make a departure prove its plan belongs to its
-- trip.
--
-- Delete behaviour is deliberately unchanged from 0016/0026:
--   trip → plan/addon/departure cascades; order → trip/plan/departure restricts.
-- A customer deletion continues to retain the order and clear customer_id.

-- Stop before the first schema mutation when legacy rows would violate the
-- tenant-aware parent identities below.  The existing one-column foreign keys
-- ensure every referenced parent exists; this guard identifies the tenant and
-- topology disagreements that those legacy keys could not express.
do $$
declare
  v_trip_plans_trip_mismatches bigint;
  v_trip_addons_trip_mismatches bigint;
  v_trip_departures_trip_mismatches bigint;
  v_trip_departures_trip_plan_mismatches bigint;
  v_tour_orders_trip_mismatches bigint;
  v_tour_orders_trip_plan_mismatches bigint;
  v_tour_orders_trip_plan_departure_mismatches bigint;
  v_tour_orders_customer_mismatches bigint;
  v_total_mismatches bigint;
begin
  select count(*) into v_trip_plans_trip_mismatches
    from trip_plans child
    join trips parent on parent.id = child.trip_id
   where child.tenant_id <> parent.tenant_id;

  select count(*) into v_trip_addons_trip_mismatches
    from trip_addons child
    join trips parent on parent.id = child.trip_id
   where child.tenant_id <> parent.tenant_id;

  select count(*) into v_trip_departures_trip_mismatches
    from trip_departures child
    join trips parent on parent.id = child.trip_id
   where child.tenant_id <> parent.tenant_id;

  select count(*) into v_trip_departures_trip_plan_mismatches
    from trip_departures child
    join trip_plans parent on parent.id = child.plan_id
   where (child.tenant_id, child.trip_id) <> (parent.tenant_id, parent.trip_id);

  select count(*) into v_tour_orders_trip_mismatches
    from tour_orders child
    join trips parent on parent.id = child.trip_id
   where child.tenant_id <> parent.tenant_id;

  select count(*) into v_tour_orders_trip_plan_mismatches
    from tour_orders child
    join trip_plans parent on parent.id = child.plan_id
   where (child.tenant_id, child.trip_id) <> (parent.tenant_id, parent.trip_id);

  select count(*) into v_tour_orders_trip_plan_departure_mismatches
    from tour_orders child
    join trip_departures parent on parent.id = child.departure_id
   where (child.tenant_id, child.trip_id, child.plan_id)
      <> (parent.tenant_id, parent.trip_id, parent.plan_id);

  select count(*) into v_tour_orders_customer_mismatches
    from tour_orders child
    join customers parent on parent.id = child.customer_id
   where child.customer_id is not null
     and child.tenant_id <> parent.tenant_id;

  v_total_mismatches := v_trip_plans_trip_mismatches
    + v_trip_addons_trip_mismatches
    + v_trip_departures_trip_mismatches
    + v_trip_departures_trip_plan_mismatches
    + v_tour_orders_trip_mismatches
    + v_tour_orders_trip_plan_mismatches
    + v_tour_orders_trip_plan_departure_mismatches
    + v_tour_orders_customer_mismatches;

  if v_total_mismatches > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        '0029 tenant/parent preflight failed: %s legacy relationship mismatch(es)',
        v_total_mismatches
      ),
      detail = format(
        'trip_plans.trip_id -> trips.id=%s; trip_addons.trip_id -> trips.id=%s; '
        || 'trip_departures.trip_id -> trips.id=%s; '
        || 'trip_departures.(tenant_id, trip_id, plan_id) -> trip_plans.(tenant_id, trip_id, id)=%s; '
        || 'tour_orders.trip_id -> trips.id=%s; '
        || 'tour_orders.(tenant_id, trip_id, plan_id) -> trip_plans.(tenant_id, trip_id, id)=%s; '
        || 'tour_orders.(tenant_id, trip_id, plan_id, departure_id) -> trip_departures.(tenant_id, trip_id, plan_id, id)=%s; '
        || 'tour_orders.customer_id -> customers.id (optional)=%s',
        v_trip_plans_trip_mismatches,
        v_trip_addons_trip_mismatches,
        v_trip_departures_trip_mismatches,
        v_trip_departures_trip_plan_mismatches,
        v_tour_orders_trip_mismatches,
        v_tour_orders_trip_plan_mismatches,
        v_tour_orders_trip_plan_departure_mismatches,
        v_tour_orders_customer_mismatches
      ),
      hint = 'Repair the named rows so every child tenant and topology matches its parent, then rerun migration 0029. No schema changes were applied.';
  end if;
end;
$$;

-- Every tenant-scoped table may now be addressed by (tenant_id, id).  The two
-- longer keys are the parent candidates that encode the topology itself.
alter table trips
  add constraint trips_tenant_id_id_key unique (tenant_id, id);
alter table customers
  add constraint customers_tenant_id_id_key unique (tenant_id, id);
alter table trip_plans
  add constraint trip_plans_tenant_id_id_key unique (tenant_id, id),
  add constraint trip_plans_tenant_trip_id_id_key unique (tenant_id, trip_id, id);
alter table trip_addons
  add constraint trip_addons_tenant_id_id_key unique (tenant_id, id);
alter table trip_departures
  add constraint trip_departures_tenant_id_id_key unique (tenant_id, id),
  add constraint trip_departures_tenant_trip_plan_id_id_key unique (tenant_id, trip_id, plan_id, id);
alter table tour_orders
  add constraint tour_orders_tenant_id_id_key unique (tenant_id, id);

-- Replace the one-column relationship links with their tenant-aware variants.
-- Keep tenant_id → tenants(id): it remains the direct tenant ownership and
-- cascade path for each table.
alter table trip_plans
  drop constraint if exists trip_plans_trip_id_fkey,
  add constraint trip_plans_tenant_trip_fkey
    foreign key (tenant_id, trip_id)
    references trips (tenant_id, id)
    on delete cascade;

alter table trip_addons
  drop constraint if exists trip_addons_trip_id_fkey,
  add constraint trip_addons_tenant_trip_fkey
    foreign key (tenant_id, trip_id)
    references trips (tenant_id, id)
    on delete cascade;

alter table trip_departures
  drop constraint if exists trip_departures_trip_id_fkey,
  drop constraint if exists trip_departures_plan_id_fkey,
  add constraint trip_departures_tenant_trip_fkey
    foreign key (tenant_id, trip_id)
    references trips (tenant_id, id)
    on delete cascade,
  add constraint trip_departures_tenant_trip_plan_fkey
    foreign key (tenant_id, trip_id, plan_id)
    references trip_plans (tenant_id, trip_id, id)
    on delete cascade;

alter table tour_orders
  drop constraint if exists tour_orders_trip_id_fkey,
  drop constraint if exists tour_orders_plan_id_fkey,
  drop constraint if exists tour_orders_departure_id_fkey,
  drop constraint if exists tour_orders_customer_id_fkey,
  add constraint tour_orders_tenant_trip_fkey
    foreign key (tenant_id, trip_id)
    references trips (tenant_id, id)
    on delete restrict,
  add constraint tour_orders_tenant_trip_plan_fkey
    foreign key (tenant_id, trip_id, plan_id)
    references trip_plans (tenant_id, trip_id, id)
    on delete restrict,
  add constraint tour_orders_tenant_trip_plan_departure_fkey
    foreign key (tenant_id, trip_id, plan_id, departure_id)
    references trip_departures (tenant_id, trip_id, plan_id, id)
    on delete restrict;

-- PostgreSQL 17 permits a column list for SET NULL.  That lets the composite
-- customer key retain tenant_id while deleting a customer clears only the
-- nullable customer_id.  Older supported PostgreSQL versions cannot express
-- that action on a composite key, so they retain the original single-column
-- SET NULL action alongside a composite NO ACTION key.  Once the action has
-- cleared customer_id, MATCH SIMPLE makes the composite key valid too.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter table tour_orders
      add constraint tour_orders_tenant_customer_fkey
      foreign key (tenant_id, customer_id)
      references customers (tenant_id, id)
      on delete set null (customer_id)';
  else
    execute 'alter table tour_orders
      add constraint tour_orders_customer_id_fkey
      foreign key (customer_id)
      references customers (id)
      on delete set null';
    execute 'alter table tour_orders
      add constraint tour_orders_tenant_customer_fkey
      foreign key (tenant_id, customer_id)
      references customers (tenant_id, id)
      on delete no action';
  end if;
end;
$$;
