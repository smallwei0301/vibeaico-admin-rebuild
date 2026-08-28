-- 0034_tour_staff_availability_and_addon_performance.sql — issue #37（source-only）
--
-- DO NOT apply this file to Production or TEST without the Owner's separate
-- authorization.  It records the schema required by 10-TOUR-DOMAIN.md §1/§5;
-- no seed, reset, or data repair is performed here.

-- GUIDE availability is a property of each staff member, never a tenant-wide
-- SOLO/TEAM or availability setting. DEFAULT_AVAILABLE preserves existing
-- schedulability; EXPLICIT_ONLY requires a shift covering the candidate time.
alter table staff
  add column if not exists availability_policy text not null default 'DEFAULT_AVAILABLE'
    check (availability_policy in ('DEFAULT_AVAILABLE', 'EXPLICIT_ONLY'));
alter table staff
  add constraint staff_tenant_id_id_key unique (tenant_id, id);

create type departure_staff_role as enum ('PRIMARY', 'ASSISTANT');
create type addon_performance_mode as enum ('PRIMARY', 'SPECIFIC_STAFF', 'NONE');

-- A departure has at most one PRIMARY and any number of ASSISTANTs. Composite
-- foreign keys make cross-tenant ids impossible at the database boundary.
create table trip_departure_staff (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  departure_id  uuid not null,
  staff_id      uuid not null,
  role          departure_staff_role not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, departure_id, staff_id),
  foreign key (tenant_id, departure_id)
    references trip_departures (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id)
    references staff (tenant_id, id) on delete restrict
);
create unique index one_primary_staff_per_departure
  on trip_departure_staff(departure_id) where role = 'PRIMARY';
create index trip_departure_staff_staff_idx
  on trip_departure_staff(tenant_id, staff_id, departure_id);

-- C+ snapshot: PRIMARY resolves to the departure primary at completion,
-- SPECIFIC_STAFF resolves to the selected tenant staff, NONE stays unassigned.
create table tour_order_addons (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  order_id              uuid not null,
  trip_addon_id         uuid,
  name                  text not null,
  unit_price            numeric not null check (unit_price >= 0),
  quantity              int not null default 1 check (quantity >= 1),
  applied_amount        numeric not null check (applied_amount >= 0),
  performance_mode      addon_performance_mode not null default 'PRIMARY',
  specific_staff_id     uuid,
  performance_staff_id  uuid,
  performance_amount    numeric check (performance_amount is null or performance_amount >= 0),
  -- Completion records this once.  It makes an intentionally empty NONE
  -- snapshot distinguishable from an addon that has not been frozen yet.
  performance_frozen_at timestamptz,
  created_at            timestamptz not null default now(),
  foreign key (tenant_id, order_id)
    references tour_orders (tenant_id, id) on delete cascade,
  -- API/RPC creation validates SPECIFIC_STAFF.  The database must still allow
  -- the FK action to clear a deleted staff id without attempting to null the
  -- non-null tenant_id in the same composite relationship.
  check (performance_mode in ('PRIMARY', 'SPECIFIC_STAFF', 'NONE'))
);
create index tour_order_addons_order_idx on tour_order_addons(tenant_id, order_id, created_at);

-- PostgreSQL 17 permits a column list for SET NULL on a composite FK.  Earlier
-- supported versions need the nullable id FK plus a tenant-scoping composite
-- FK.  Do not use bare `ON DELETE SET NULL` here: it would also null tenant_id.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter table tour_order_addons add constraint tour_order_addons_trip_addon_fkey
      foreign key (tenant_id, trip_addon_id) references trip_addons (tenant_id, id)
      on delete set null (trip_addon_id)';
    execute 'alter table tour_order_addons add constraint tour_order_addons_specific_staff_fkey
      foreign key (tenant_id, specific_staff_id) references staff (tenant_id, id)
      on delete set null (specific_staff_id)';
    execute 'alter table tour_order_addons add constraint tour_order_addons_performance_staff_fkey
      foreign key (tenant_id, performance_staff_id) references staff (tenant_id, id)
      on delete set null (performance_staff_id)';
  else
    execute 'alter table tour_order_addons add constraint tour_order_addons_trip_addon_id_fkey
      foreign key (trip_addon_id) references trip_addons (id) on delete set null';
    execute 'alter table tour_order_addons add constraint tour_order_addons_trip_addon_tenant_fkey
      foreign key (tenant_id, trip_addon_id) references trip_addons (tenant_id, id) on delete no action';
    execute 'alter table tour_order_addons add constraint tour_order_addons_specific_staff_id_fkey
      foreign key (specific_staff_id) references staff (id) on delete set null';
    execute 'alter table tour_order_addons add constraint tour_order_addons_specific_staff_tenant_fkey
      foreign key (tenant_id, specific_staff_id) references staff (tenant_id, id) on delete no action';
    execute 'alter table tour_order_addons add constraint tour_order_addons_performance_staff_id_fkey
      foreign key (performance_staff_id) references staff (id) on delete set null';
    execute 'alter table tour_order_addons add constraint tour_order_addons_performance_staff_tenant_fkey
      foreign key (tenant_id, performance_staff_id) references staff (tenant_id, id) on delete no action';
  end if;
end;
$$;

-- Existing booking addons retain their execution-staff field. Performance gets
-- an explicit mode so null can no longer ambiguously mean inherit or NONE.
alter table booking_addons
  add column if not exists performance_mode addon_performance_mode not null default 'PRIMARY',
  add column if not exists performance_staff_id uuid;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter table booking_addons add constraint booking_addons_performance_staff_fkey
      foreign key (tenant_id, performance_staff_id) references staff (tenant_id, id)
      on delete set null (performance_staff_id)';
  else
    execute 'alter table booking_addons add constraint booking_addons_performance_staff_id_fkey
      foreign key (performance_staff_id) references staff (id) on delete set null';
    execute 'alter table booking_addons add constraint booking_addons_performance_staff_tenant_fkey
      foreign key (tenant_id, performance_staff_id) references staff (tenant_id, id) on delete no action';
  end if;
end;
$$;

alter table trip_departure_staff enable row level security;
alter table tour_order_addons enable row level security;

create policy p_trip_departure_staff_s on trip_departure_staff for select using (is_tenant_member(tenant_id));
create policy p_trip_departure_staff_i on trip_departure_staff for insert with check (is_tenant_member(tenant_id));
create policy p_trip_departure_staff_u on trip_departure_staff for update using (is_tenant_member(tenant_id));
create policy p_trip_departure_staff_d on trip_departure_staff for delete using (is_tenant_member(tenant_id));

create policy p_tour_order_addons_s on tour_order_addons for select using (is_tenant_member(tenant_id));
create policy p_tour_order_addons_i on tour_order_addons for insert with check (is_tenant_member(tenant_id));
create policy p_tour_order_addons_u on tour_order_addons for update using (is_tenant_member(tenant_id));
create policy p_tour_order_addons_d on tour_order_addons for delete using (is_tenant_member(tenant_id));
