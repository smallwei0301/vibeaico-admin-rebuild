-- Issue #17: general-booking add-ons.  This is deliberately 0053 because the
-- live TEST lineage already reserves the 0053–0055 sequence.  Current main's
-- source graph still ends at 0014, so this remains self-contained for clean
-- applies; historic 0020 is provenance only.  IF NOT EXISTS/ALTER also
-- reconciles an already-created TEST shape without replaying 0055.

do $$ begin
  create type addon_performance_mode as enum ('PRIMARY', 'SPECIFIC_STAFF', 'NONE');
exception when duplicate_object then null;
end $$;

-- TEST already has this matching UNIQUE constraint/index from an earlier
-- lineage.  `duplicate_object` alone is insufficient there because Postgres
-- reports the backing relation conflict as 42P07.  Keep either equivalent
-- constraint/index; never drop/recreate or weaken staff uniqueness.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, id)'
  ) and not exists (
    select 1 from pg_index
    where indrelid = 'public.staff'::regclass and indisunique
      and regexp_replace(pg_get_indexdef(indexrelid), '\s+', '', 'g') like '%(tenant_id,id)%'
  ) then
    alter table staff add constraint staff_tenant_id_id_key unique (tenant_id, id);
  end if;
end $$;

create table if not exists booking_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  name text not null,
  price numeric not null check (price >= 0),
  quantity integer not null check (quantity >= 1),
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  staff_id uuid references staff(id) on delete set null,
  -- Transaction snapshots are used for the exact inverse operation.
  applied_amount numeric not null check (applied_amount >= 0),
  applied_minutes integer not null check (applied_minutes >= 0),
  notified text not null default 'NONE'
    check (notified in ('NONE', 'LINE', 'NO_LINE', 'NOT_CONFIGURED', 'QUOTA_EXCEEDED', 'FAILED')),
  performance_mode addon_performance_mode not null default 'PRIMARY'::addon_performance_mode,
  performance_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, performance_staff_id) references staff(tenant_id, id)
    on delete set null (performance_staff_id)
);

-- Old drifted installations may have the baseline table.  Add the explicit
-- owner-decided C+ semantic instead of treating NULL as both inherit and none.
alter table booking_addons add column if not exists performance_mode addon_performance_mode;
alter table booking_addons add column if not exists performance_staff_id uuid;
alter table booking_addons add column if not exists updated_at timestamptz not null default now();
alter table booking_addons alter column applied_amount set default 0;
alter table booking_addons alter column applied_minutes set default 0;
-- Do not rewrite unknown legacy snapshots.  NOT VALID enforces every new or
-- changed row while preserving a readable drifted row for the guarded delete
-- RPC to reject explicitly rather than silently changing financial history.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'booking_addons_applied_amount_nonnegative') then
    alter table booking_addons add constraint booking_addons_applied_amount_nonnegative
      check (applied_amount >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'booking_addons_applied_minutes_nonnegative') then
    alter table booking_addons add constraint booking_addons_applied_minutes_nonnegative
      check (applied_minutes >= 0) not valid;
  end if;
end $$;
alter table booking_addons alter column performance_mode set default 'PRIMARY'::addon_performance_mode;
update booking_addons ba
set performance_mode = case when ba.staff_id is null then 'PRIMARY'::addon_performance_mode else 'SPECIFIC_STAFF'::addon_performance_mode end,
    performance_staff_id = case when ba.staff_id is null then b.staff_id else ba.staff_id end
from bookings b
where ba.booking_id = b.id and ba.tenant_id = b.tenant_id and ba.performance_mode is null;
alter table booking_addons alter column performance_mode set not null;
alter table booking_addons
  drop constraint if exists booking_addons_tenant_id_performance_staff_id_fkey;
alter table booking_addons
  drop constraint if exists booking_addons_performance_staff_fkey;
alter table booking_addons
  add constraint booking_addons_tenant_id_performance_staff_id_fkey
  foreign key (tenant_id, performance_staff_id) references staff(tenant_id, id)
    on delete set null (performance_staff_id);

create index if not exists i_booking_addons_booking
  on booking_addons (tenant_id, booking_id, created_at);
drop trigger if exists t_booking_addons_u on booking_addons;
create trigger t_booking_addons_u before update on booking_addons
  for each row execute function set_updated_at();
alter table booking_addons enable row level security;

-- Read is tenant scoped.  There are intentionally no table write policies:
-- add/remove must use the security-definer transaction below, so the booking
-- balance, duration and add-on row cannot be partially changed through REST.
drop policy if exists p_booking_addons_s on booking_addons;
create policy p_booking_addons_s on booking_addons for select
  using (is_tenant_member(tenant_id));
drop policy if exists p_booking_addons_i on booking_addons;
drop policy if exists p_booking_addons_u on booking_addons;
drop policy if exists p_booking_addons_d on booking_addons;

create or replace function add_booking_addon_17(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_service_id uuid,
  p_name text,
  p_price numeric,
  p_quantity integer,
  p_duration_minutes integer,
  p_staff_id uuid default null,
  p_no_personal_credit boolean default false
) returns table (addon_id uuid, final_price numeric, duration_minutes integer, end_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_service services%rowtype;
  v_staff staff%rowtype;
  v_amount numeric;
  v_minutes integer;
  v_performance_mode addon_performance_mode;
  v_performance_staff_id uuid;
begin
  if not tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'BOOKING_ADDON_FORBIDDEN';
  end if;
  if p_name is null or btrim(p_name) = '' or p_price < 0 or p_quantity < 1 or p_duration_minutes < 0 then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;

  -- Canonical lock order: booking before related service/staff and add-on.
  select * into v_booking from bookings
    where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;
  if v_booking.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_ADDON_STATUS_CONFLICT';
  end if;
  if p_service_id is not null then
    select * into v_service from services where id = p_service_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_SERVICE_NOT_FOUND'; end if;
  end if;
  if p_staff_id is not null then
    select * into v_staff from staff where id = p_staff_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_STAFF_NOT_FOUND'; end if;
  end if;

  v_amount := p_price * p_quantity;
  v_minutes := p_duration_minutes * p_quantity;
  v_performance_mode := case
    when p_no_personal_credit then 'NONE'::addon_performance_mode
    when p_staff_id is not null then 'SPECIFIC_STAFF'::addon_performance_mode
    else 'PRIMARY'::addon_performance_mode end;
  v_performance_staff_id := case
    when p_no_personal_credit then null
    when p_staff_id is not null then p_staff_id
    else v_booking.staff_id end;
  if v_performance_mode = 'PRIMARY'::addon_performance_mode and v_performance_staff_id is not null then
    perform 1 from staff where id = v_performance_staff_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_PRIMARY_STAFF_NOT_FOUND'; end if;
  end if;

  insert into booking_addons (
    tenant_id, booking_id, service_id, name, price, quantity, duration_minutes, staff_id,
    applied_amount, applied_minutes, performance_mode, performance_staff_id
  ) values (
    p_tenant_id, p_booking_id, p_service_id, btrim(p_name), p_price, p_quantity, p_duration_minutes, p_staff_id,
    v_amount, v_minutes, v_performance_mode, v_performance_staff_id
  ) returning id into addon_id;

  update bookings set
    final_price = final_price + v_amount,
    duration_minutes = duration_minutes + v_minutes,
    end_at = end_at + make_interval(mins => v_minutes)
  where id = p_booking_id and tenant_id = p_tenant_id
  returning bookings.final_price, bookings.duration_minutes, bookings.end_at
  into final_price, duration_minutes, end_at;
  return next;
end $$;

create or replace function delete_booking_addon_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid
) returns table (final_price numeric, duration_minutes integer, end_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_addon booking_addons%rowtype;
begin
  if not tenant_role_at_least(p_tenant_id, 'MANAGER') then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  select * into v_booking from bookings where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;
  if v_booking.status not in ('PENDING', 'CONFIRMED') then raise exception 'BOOKING_ADDON_STATUS_CONFLICT'; end if;
  select * into v_addon from booking_addons
    where id = p_addon_id and booking_id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  if v_addon.applied_amount is null or v_addon.applied_amount < 0
     or v_addon.applied_minutes is null or v_addon.applied_minutes < 0 then
    raise exception 'BOOKING_ADDON_SNAPSHOT_CONFLICT';
  end if;
  -- A corrupted legacy row must not move an end time to/before start time.
  -- For rows produced by add_booking_addon_17 this is an exact inverse.
  if v_booking.duration_minutes < v_addon.applied_minutes
     or v_booking.end_at - make_interval(mins => v_addon.applied_minutes) <= v_booking.start_at then
    raise exception 'BOOKING_ADDON_DURATION_CONFLICT';
  end if;

  delete from booking_addons where id = p_addon_id and tenant_id = p_tenant_id;
  update bookings set
    final_price = final_price - v_addon.applied_amount,
    duration_minutes = duration_minutes - v_addon.applied_minutes,
    end_at = end_at - make_interval(mins => v_addon.applied_minutes)
  where id = p_booking_id and tenant_id = p_tenant_id
  returning bookings.final_price, bookings.duration_minutes, bookings.end_at
  into final_price, duration_minutes, end_at;
  return next;
end $$;

create or replace function mark_booking_addon_notification_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid, p_notified text
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- Route authorization happens before this service-role-only marker RPC.
  -- service role has no auth.uid() tenant membership, so do not call
  -- tenant_role_at_least here after a receipt was already sent.
  if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  if p_notified not in ('NONE','LINE','NO_LINE','NOT_CONFIGURED','QUOTA_EXCEEDED','FAILED') then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;
  update booking_addons set notified = p_notified
  where id = p_addon_id and booking_id = p_booking_id and tenant_id = p_tenant_id;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
end $$;

revoke all on function add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,uuid,boolean) from public, anon;
revoke all on function delete_booking_addon_17(uuid,uuid,uuid) from public, anon;
revoke all on function mark_booking_addon_notification_17(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,uuid,boolean) to authenticated;
grant execute on function delete_booking_addon_17(uuid,uuid,uuid) to authenticated;
grant execute on function mark_booking_addon_notification_17(uuid,uuid,uuid,text) to service_role;
