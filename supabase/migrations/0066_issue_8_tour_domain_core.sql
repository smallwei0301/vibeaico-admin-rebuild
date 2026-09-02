-- Phase 8b / #8-A: canonical tour-domain core, forward reconciliation.
--
-- A clean current-main database gets the four canonical tables below. TEST can
-- already contain the historical #37/#41 tour tables, so this migration is
-- deliberately additive and guarded: it adds missing canonical columns,
-- backfills them from legacy names, and keeps the legacy columns synchronized.
-- It never drops historical columns or replaces their formation/payment
-- contracts. Do not add tour_orders, seat RPCs, payment, staff, or availability
-- work here; those belong to later slices.
--
-- Contract: docs/integration/10-TOUR-DOMAIN.md §1.1–§1.2.

-- The enum labels are canonical. Existing historical enums are retained and
-- only missing canonical labels are added; enum labels are never removed.
do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'trip_status'
  ) then
    create type public.trip_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
  else
    execute 'alter type public.trip_status add value if not exists ''DRAFT''';
    execute 'alter type public.trip_status add value if not exists ''PUBLISHED''';
    execute 'alter type public.trip_status add value if not exists ''ARCHIVED''';
  end if;

  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'departure_status'
  ) then
    create type public.departure_status as enum ('OPEN', 'CLOSED', 'CANCELLED');
  else
    execute 'alter type public.departure_status add value if not exists ''OPEN''';
    execute 'alter type public.departure_status add value if not exists ''CLOSED''';
    execute 'alter type public.departure_status add value if not exists ''CANCELLED''';
  end if;
end $$;

-- Fresh-install definitions: these are the exact §1.1–§1.2 canonical fields.
create table if not exists public.trips (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
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
  status             public.trip_status not null default 'DRAFT',
  midao_listing      text not null default 'NONE'
    check (midao_listing in ('NONE', 'PENDING', 'LISTED', 'REJECTED')),
  midao_listing_note text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, slug)
);

-- Historical TEST trips already has the other canonical columns plus legacy
-- region/inclusions/safety_notice/duration_minutes fields.
alter table public.trips
  add column if not exists location text,
  add column if not exists duration_hours numeric,
  add column if not exists includes text,
  add column if not exists notes text;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'region') then
    execute $sql$update public.trips set location = coalesce(nullif(location, ''), coalesce(region, '')) where location is null or location = ''$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'inclusions') then
    execute $sql$
      update public.trips
         set includes = case
           when jsonb_typeof(inclusions) = 'array' then
             coalesce((select string_agg(value, E'\n') from jsonb_array_elements_text(inclusions)), '')
           else coalesce(inclusions #>> '{}', '')
         end
       where includes is null or includes = ''
    $sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'safety_notice') then
    execute $sql$update public.trips set notes = coalesce(nullif(notes, ''), coalesce(safety_notice, '')) where notes is null or notes = ''$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'duration_minutes') then
    execute $sql$update public.trips set duration_hours = duration_minutes / 60.0 where duration_hours is null and duration_minutes is not null$sql$;
  end if;
end $$;

alter table public.trips alter column location set default '';
alter table public.trips alter column location set not null;
alter table public.trips alter column includes set default '';
alter table public.trips alter column includes set not null;
alter table public.trips alter column notes set default '';
alter table public.trips alter column notes set not null;

-- Historical composite tenant FKs are stronger than the canonical single-column
-- FKs and are retained. Adding both would make PostgREST relationships
-- ambiguous. The fresh-install table above owns the canonical single-column FKs.

create table if not exists public.trip_plans (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  trip_id          uuid not null references public.trips(id) on delete cascade,
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

-- Historical plans use base_price/min_participants/max_participants (and the
-- later min/max_party_size names). Add canonical columns instead of renaming
-- or dropping those live contracts.
alter table public.trip_plans
  add column if not exists price_per_person numeric,
  add column if not exists min_party integer,
  add column if not exists max_party integer;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trip_plans' and column_name = 'base_price') then
    execute $sql$update public.trip_plans set price_per_person = coalesce(price_per_person, base_price, 0) where price_per_person is null$sql$;
  else
    execute $sql$update public.trip_plans set price_per_person = coalesce(price_per_person, 0) where price_per_person is null$sql$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trip_plans' and column_name = 'min_participants') then
    execute $sql$
      update public.trip_plans
         set min_party = greatest(coalesce(min_party, min_participants, 1), 1),
             max_party = greatest(coalesce(max_party, max_participants, 10), greatest(coalesce(min_party, min_participants, 1), 1))
       where min_party is null or max_party is null
    $sql$;
  else
    execute $sql$
      update public.trip_plans
         set min_party = coalesce(min_party, 1),
             max_party = greatest(coalesce(max_party, 10), coalesce(min_party, 1))
       where min_party is null or max_party is null
    $sql$;
  end if;
end $$;

alter table public.trip_plans alter column price_per_person set not null;
alter table public.trip_plans alter column min_party set default 1;
alter table public.trip_plans alter column min_party set not null;
alter table public.trip_plans alter column max_party set default 10;
alter table public.trip_plans alter column max_party set not null;

-- Keep canonical values and legacy plan names coherent. This trigger is only
-- created when the historical aliases exist, so fresh installs stay canonical.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trip_plans' and column_name = 'base_price')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trip_plans' and column_name = 'min_participants')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trip_plans' and column_name = 'max_participants')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trip_plans' and column_name = 'min_party_size')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trip_plans' and column_name = 'max_party_size') then
    execute $function$
      create or replace function public.sync_tour_plan_legacy_fields_0015()
      returns trigger
      language plpgsql
      as $body$
      begin
        if tg_op = 'INSERT' then
          -- A pre-0015 writer may omit the new columns while providing the
          -- legacy aliases. Prefer those aliases only when the canonical
          -- insert value is absent/defaulted; canonical API writes remain the
          -- source of truth.
          if new.price_per_person is null then
            new.price_per_person := coalesce(new.base_price, 0);
          end if;
          if coalesce(new.min_party, 1) = 1 and coalesce(new.min_participants, 1) <> 1 then
            new.min_party := greatest(new.min_participants, 1);
          end if;
          if coalesce(new.max_party, 10) = 10 and coalesce(new.max_participants, 10) <> 10 then
            new.max_party := greatest(new.max_participants, coalesce(new.min_party, 1));
          end if;
          new.base_price := new.price_per_person;
          new.min_participants := new.min_party;
          new.max_participants := new.max_party;
          new.min_party_size := new.min_party;
          new.max_party_size := new.max_party;
        elsif new.price_per_person is distinct from old.price_per_person
           or new.min_party is distinct from old.min_party
           or new.max_party is distinct from old.max_party then
          new.base_price := new.price_per_person;
          new.min_participants := new.min_party;
          new.max_participants := new.max_party;
          new.min_party_size := new.min_party;
          new.max_party_size := new.max_party;
        elsif new.base_price is distinct from old.base_price
           or new.min_participants is distinct from old.min_participants
           or new.max_participants is distinct from old.max_participants
           or new.min_party_size is distinct from old.min_party_size
           or new.max_party_size is distinct from old.max_party_size then
          new.price_per_person := coalesce(new.base_price, 0);
          new.min_party := greatest(coalesce(new.min_participants, new.min_party_size, 1), 1);
          new.max_party := greatest(coalesce(new.max_participants, new.max_party_size, 10), new.min_party);
        end if;
        return new;
      end;
      $body$;
    $function$;

    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.trip_plans'::regclass
         and tgname = 't_trip_plans_legacy_sync_0015'
         and not tgisinternal
    ) then
      execute 'create trigger t_trip_plans_legacy_sync_0015 before insert or update on public.trip_plans for each row execute function public.sync_tour_plan_legacy_fields_0015()';
    end if;
  end if;
end $$;

create table if not exists public.trip_departures (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  trip_id      uuid not null references public.trips(id) on delete cascade,
  plan_id      uuid not null references public.trip_plans(id) on delete cascade,
  departs_on   date not null,
  start_time   time,
  capacity     int not null,
  seats_booked int not null default 0,
  status       public.departure_status not null default 'OPEN',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  check (seats_booked >= 0 and seats_booked <= capacity),
  unique (tenant_id, plan_id, departs_on, start_time)
);

create table if not exists public.trip_addons (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  trip_id    uuid not null references public.trips(id) on delete cascade,
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

-- Existing TEST has the same key under another name. Do not create a duplicate;
-- use the canonical name only on a clean install.
do $$
begin
  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'trip_departures'
       and indexdef ilike '%(tenant_id, trip_id, departs_on)%'
  ) then
    if to_regclass('public.i_departures') is null then
      execute 'create index i_departures on public.trip_departures (tenant_id, trip_id, departs_on)';
    else
      execute 'create index i_trip_departures_tenant_trip_date_0015 on public.trip_departures (tenant_id, trip_id, departs_on)';
    end if;
  end if;
end $$;

-- Preserve #37/#41 composite tenant FKs where present. On a fresh install the
-- CREATE TABLE statements above provide the canonical single-column FKs; on an
-- existing install, parallel direct FKs could make nested PostgREST relations
-- ambiguous, so no second relationship is added.

-- Updated-at triggers are guarded because historical databases may already own
-- a trigger with the same purpose under another name.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.trips'::regclass and tgname = 't_trips_u' and not tgisinternal) then
    create trigger t_trips_u before update on public.trips
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.trip_addons'::regclass and tgname = 't_trip_addons_u' and not tgisinternal) then
    create trigger t_trip_addons_u before update on public.trip_addons
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Synchronize canonical trip fields with historical #37 display/storage names.
-- This is database write-time compatibility, not a page-local fallback.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'region')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'inclusions')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'safety_notice')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'duration_minutes') then
    execute $function$
      create or replace function public.sync_tour_trip_legacy_fields_0015()
      returns trigger
      language plpgsql
      as $body$
      begin
        if tg_op = 'INSERT' then
          if coalesce(btrim(new.location), '') = '' and coalesce(btrim(new.region), '') <> '' then
            new.location := new.region;
          end if;
          if coalesce(btrim(new.includes), '') = '' and jsonb_typeof(new.inclusions) = 'array' then
            new.includes := coalesce((select string_agg(value, chr(10)) from jsonb_array_elements_text(new.inclusions)), '');
          end if;
          if coalesce(btrim(new.notes), '') = '' and coalesce(btrim(new.safety_notice), '') <> '' then
            new.notes := new.safety_notice;
          end if;
          if new.duration_hours is null and new.duration_minutes is not null then
            new.duration_hours := new.duration_minutes / 60.0;
          end if;
          new.region := coalesce(new.location, '');
          if coalesce(btrim(new.includes), '') = '' then
            new.inclusions := '[]'::jsonb;
          else
            new.inclusions := to_jsonb(regexp_split_to_array(new.includes, '[[:space:]]*' || chr(10) || '[[:space:]]*'));
          end if;
          new.safety_notice := coalesce(new.notes, '');
          new.duration_minutes := case
            when new.duration_hours is null then null
            else round(new.duration_hours * 60)::integer
          end;
        elsif new.location is distinct from old.location
           or new.includes is distinct from old.includes
           or new.notes is distinct from old.notes
           or new.duration_hours is distinct from old.duration_hours then
          new.region := coalesce(new.location, '');
          if coalesce(btrim(new.includes), '') = '' then
            new.inclusions := '[]'::jsonb;
          else
            new.inclusions := to_jsonb(regexp_split_to_array(new.includes, '[[:space:]]*' || chr(10) || '[[:space:]]*'));
          end if;
          new.safety_notice := coalesce(new.notes, '');
          new.duration_minutes := case
            when new.duration_hours is null then null
            else round(new.duration_hours * 60)::integer
          end;
        elsif new.region is distinct from old.region
           or new.inclusions is distinct from old.inclusions
           or new.safety_notice is distinct from old.safety_notice
           or new.duration_minutes is distinct from old.duration_minutes then
          new.location := coalesce(new.region, '');
          if jsonb_typeof(new.inclusions) = 'array' then
            new.includes := coalesce((select string_agg(value, chr(10)) from jsonb_array_elements_text(new.inclusions)), '');
          else
            new.includes := coalesce(new.inclusions #>> '{}', '');
          end if;
          new.notes := coalesce(new.safety_notice, '');
          new.duration_hours := case
            when new.duration_minutes is null then null
            else new.duration_minutes / 60.0
          end;
        end if;
        return new;
      end;
      $body$;
    $function$;

    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.trips'::regclass
         and tgname = 't_trips_legacy_sync_0015'
         and not tgisinternal
    ) then
      execute 'create trigger t_trips_legacy_sync_0015 before insert or update on public.trips for each row execute function public.sync_tour_trip_legacy_fields_0015()';
    end if;
  end if;
end $$;

-- Every exposed core table remains tenant protected. Historical TEST already
-- has split p_*_s/i/u/d policies; those are equivalent and are left untouched.
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('trips', 'p_trips_all'),
      ('trip_plans', 'p_trip_plans_all'),
      ('trip_departures', 'p_trip_departures_all'),
      ('trip_addons', 'p_trip_addons_all')
    ) as v(table_name, policy_name)
  loop
    execute format('alter table public.%I enable row level security', item.table_name);
    if not exists (
      select 1
        from pg_policy p
       where p.polrelid = format('public.%I', item.table_name)::regclass
         and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ilike '%is_tenant_member(tenant_id)%'
    ) then
      execute format(
        'create policy %I on public.%I for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id))',
        item.policy_name, item.table_name
      );
    end if;
  end loop;
end $$;
