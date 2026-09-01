-- Issue #17 hardening.  0053 is already deployed in TEST: this migration only
-- converges ACLs and replaces the security-definer entrypoints forward.

alter table public.booking_addons enable row level security;
drop policy if exists p_booking_addons_s on public.booking_addons;
drop policy if exists p_booking_addons_i on public.booking_addons;
drop policy if exists p_booking_addons_u on public.booking_addons;
drop policy if exists p_booking_addons_d on public.booking_addons;
create policy p_booking_addons_s on public.booking_addons for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- REST callers have read-only table access.  Mutations must go through the
-- transaction RPCs below; service_role remains the server-internal role.
revoke all on table public.booking_addons from public, anon, authenticated;
grant select on table public.booking_addons to authenticated;
grant select, insert, update, delete on table public.booking_addons to service_role;

create or replace function public.add_booking_addon_17(
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
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_service public.services%rowtype;
  v_staff public.staff%rowtype;
  v_amount numeric;
  v_minutes integer;
  v_performance_mode public.addon_performance_mode;
  v_performance_staff_id uuid;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'BOOKING_ADDON_FORBIDDEN';
  end if;
  if p_name is null or btrim(p_name) = '' or p_price < 0 or p_quantity < 1 or p_duration_minutes < 0 then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;

  -- Canonical lock order: booking before related service/staff and add-on.
  select * into v_booking from public.bookings
    where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;
  if v_booking.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_ADDON_STATUS_CONFLICT';
  end if;
  if p_service_id is not null then
    select * into v_service from public.services where id = p_service_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_SERVICE_NOT_FOUND'; end if;
  end if;
  if p_staff_id is not null then
    select * into v_staff from public.staff where id = p_staff_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_STAFF_NOT_FOUND'; end if;
  end if;

  v_amount := p_price * p_quantity;
  v_minutes := p_duration_minutes * p_quantity;
  v_performance_mode := case
    when p_no_personal_credit then 'NONE'::public.addon_performance_mode
    when p_staff_id is not null then 'SPECIFIC_STAFF'::public.addon_performance_mode
    else 'PRIMARY'::public.addon_performance_mode end;
  v_performance_staff_id := case
    when p_no_personal_credit then null
    when p_staff_id is not null then p_staff_id
    else v_booking.staff_id end;
  if v_performance_mode = 'PRIMARY'::public.addon_performance_mode and v_performance_staff_id is not null then
    perform 1 from public.staff where id = v_performance_staff_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_PRIMARY_STAFF_NOT_FOUND'; end if;
  end if;

  insert into public.booking_addons (
    tenant_id, booking_id, service_id, name, price, quantity, duration_minutes, staff_id,
    applied_amount, applied_minutes, performance_mode, performance_staff_id
  ) values (
    p_tenant_id, p_booking_id, p_service_id, btrim(p_name), p_price, p_quantity, p_duration_minutes, p_staff_id,
    v_amount, v_minutes, v_performance_mode, v_performance_staff_id
  ) returning id into addon_id;

  update public.bookings set
    final_price = public.bookings.final_price + v_amount,
    duration_minutes = public.bookings.duration_minutes + v_minutes,
    end_at = public.bookings.end_at + make_interval(mins => v_minutes)
  where id = p_booking_id and tenant_id = p_tenant_id
  returning public.bookings.final_price, public.bookings.duration_minutes, public.bookings.end_at
  into final_price, duration_minutes, end_at;
  return next;
end $$;

create or replace function public.delete_booking_addon_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid
) returns table (final_price numeric, duration_minutes integer, end_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_addon public.booking_addons%rowtype;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  select * into v_booking from public.bookings where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;
  if v_booking.status not in ('PENDING', 'CONFIRMED') then raise exception 'BOOKING_ADDON_STATUS_CONFLICT'; end if;
  select * into v_addon from public.booking_addons
    where id = p_addon_id and booking_id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  if v_addon.applied_amount is null or v_addon.applied_amount < 0
     or v_addon.applied_minutes is null or v_addon.applied_minutes < 0 then
    raise exception 'BOOKING_ADDON_SNAPSHOT_CONFLICT';
  end if;
  if v_booking.duration_minutes < v_addon.applied_minutes
     or v_booking.end_at - make_interval(mins => v_addon.applied_minutes) <= v_booking.start_at then
    raise exception 'BOOKING_ADDON_DURATION_CONFLICT';
  end if;

  delete from public.booking_addons where id = p_addon_id and tenant_id = p_tenant_id;
  update public.bookings set
    final_price = public.bookings.final_price - v_addon.applied_amount,
    duration_minutes = public.bookings.duration_minutes - v_addon.applied_minutes,
    end_at = public.bookings.end_at - make_interval(mins => v_addon.applied_minutes)
  where id = p_booking_id and tenant_id = p_tenant_id
  returning public.bookings.final_price, public.bookings.duration_minutes, public.bookings.end_at
  into final_price, duration_minutes, end_at;
  return next;
end $$;

create or replace function public.mark_booking_addon_notification_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid, p_notified text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  if p_notified not in ('NONE','LINE','NO_LINE','NOT_CONFIGURED','QUOTA_EXCEEDED','FAILED') then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;
  update public.booking_addons set notified = p_notified
  where id = p_addon_id and booking_id = p_booking_id and tenant_id = p_tenant_id;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
end $$;

-- One conditional upsert owns the read/compare/increment operation, so two
-- concurrent callers cannot both reserve the final quota unit.
create or replace function public.consume_push_quota_17(
  p_tenant_id uuid, p_month text, p_count integer, p_quota integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_used integer;
begin
  if p_count < 1 or p_quota < 0 or p_count > p_quota then return false; end if;
  insert into public.push_quota_usage (tenant_id, month, used)
  values (p_tenant_id, p_month, p_count)
  on conflict (tenant_id, month) do update
    set used = public.push_quota_usage.used + excluded.used
    where public.push_quota_usage.used + excluded.used <= p_quota
  returning used into v_used;
  return found;
end $$;

revoke all on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,uuid,boolean)
  from public, anon, service_role;
revoke all on function public.delete_booking_addon_17(uuid,uuid,uuid)
  from public, anon, service_role;
revoke all on function public.mark_booking_addon_notification_17(uuid,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.consume_push_quota_17(uuid,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,uuid,boolean)
  to authenticated;
grant execute on function public.delete_booking_addon_17(uuid,uuid,uuid)
  to authenticated;
grant execute on function public.mark_booking_addon_notification_17(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.consume_push_quota_17(uuid,text,integer,integer)
  to service_role;
