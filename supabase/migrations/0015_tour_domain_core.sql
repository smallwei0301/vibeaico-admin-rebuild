-- Phase 8b / #8-A: canonical tour-domain core.
-- Source-only migration.  Do not add tour_orders or seat RPCs here; those belong
-- to #8-B after the order contract is separately validated.
-- Contract: docs/integration/10-TOUR-DOMAIN.md §1.1–§1.2.

create type trip_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type departure_status as enum ('OPEN', 'CLOSED', 'CANCELLED');

create table trips (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  slug               text not null,
  title              text not null,
  summary            text not null default '',
  description        text not null default '',
  cover_image_url    text not null default '',
  gallery            jsonb not null default '[]',
  location           text not null default '',
  duration_hours     numeric,
  meeting_point      text not null default '',
  includes           text not null default '',
  notes              text not null default '',
  status             trip_status not null default 'DRAFT',
  midao_listing      text not null default 'NONE'
    check (midao_listing in ('NONE', 'PENDING', 'LISTED', 'REJECTED')),
  midao_listing_note text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, slug)
);

create trigger t_trips_u before update on trips
  for each row execute function set_updated_at();

create table trip_plans (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  trip_id          uuid not null references trips(id) on delete cascade,
  name             text not null,
  description      text not null default '',
  price_per_person numeric not null,
  child_price      numeric,
  min_party        int not null default 1,
  max_party        int not null default 10,
  deposit_mode     text not null default 'FULL'
    check (deposit_mode in ('NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL')),
  deposit_value    numeric not null default 0,
  sort_order       int not null default 0,
  active           boolean not null default true
);

create table trip_departures (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  trip_id      uuid not null references trips(id) on delete cascade,
  plan_id      uuid not null references trip_plans(id) on delete cascade,
  departs_on   date not null,
  start_time   time,
  capacity     int not null,
  seats_booked int not null default 0,
  status       departure_status not null default 'OPEN',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  check (seats_booked >= 0 and seats_booked <= capacity),
  unique (tenant_id, plan_id, departs_on, start_time)
);

create index i_departures on trip_departures (tenant_id, trip_id, departs_on);

create table trip_addons (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  trip_id    uuid not null references trips(id) on delete cascade,
  name       text not null,
  price      numeric not null default 0 check (price >= 0),
  unit       text not null default 'PER_PERSON'
    check (unit in ('PER_PERSON', 'PER_GROUP')),
  stock      int check (stock is null or stock >= 0),
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger t_trip_addons_u before update on trip_addons
  for each row execute function set_updated_at();

alter table trips enable row level security;
alter table trip_plans enable row level security;
alter table trip_departures enable row level security;
alter table trip_addons enable row level security;

create policy p_trips_all on trips for all
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
create policy p_trip_plans_all on trip_plans for all
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
create policy p_trip_departures_all on trip_departures for all
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
create policy p_trip_addons_all on trip_addons for all
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
