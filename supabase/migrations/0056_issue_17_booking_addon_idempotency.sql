-- Issue #17 forward-only retry safety.
--
-- A booking add-on changes financial state in one RPC, but LINE is an
-- external side effect.  The request key makes the financial mutation
-- replay-safe; PENDING is an explicit claim state so an ambiguous provider or
-- marker result is never silently sent a second time.

alter table public.booking_addons
  add column if not exists idempotency_key text,
  add column if not exists notification_requested boolean not null default false;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_addons'::regclass
      and conname = 'booking_addons_idempotency_key_format'
  ) then
    alter table public.booking_addons
      add constraint booking_addons_idempotency_key_format
      check (
        idempotency_key is null
        or idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) not valid;
  end if;
end $$;

create unique index if not exists booking_addons_idempotency_key_uq
  on public.booking_addons (tenant_id, booking_id, idempotency_key)
  where idempotency_key is not null;

-- Existing rows use the six settled outcomes.  PENDING means a server has
-- claimed notification delivery, but the final receipt marker is not yet
-- durable; retries must surface that state and must not push again.
alter table public.booking_addons drop constraint if exists booking_addons_notified_check;
alter table public.booking_addons
  add constraint booking_addons_notified_check
  check (notified in ('NONE', 'PENDING', 'LINE', 'NO_LINE', 'NOT_CONFIGURED', 'QUOTA_EXCEEDED', 'FAILED'));

-- The old nine-argument function cannot accept a request key.  Remove it so
-- every authenticated caller is forced through the idempotent entrypoint.
drop function if exists public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,uuid,boolean);

create or replace function public.add_booking_addon_17(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_service_id uuid,
  p_name text,
  p_price numeric,
  p_quantity integer,
  p_duration_minutes integer,
  p_idempotency_key text,
  p_staff_id uuid default null,
  p_no_personal_credit boolean default false,
  p_notify boolean default false
) returns table (
  addon_id uuid,
  final_price numeric,
  duration_minutes integer,
  end_at timestamptz,
  created boolean,
  notified text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_existing public.booking_addons%rowtype;
  v_service public.services%rowtype;
  v_staff public.staff%rowtype;
  v_amount numeric;
  v_minutes integer;
  v_request_key text;
  v_performance_mode public.addon_performance_mode;
  v_performance_staff_id uuid;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'BOOKING_ADDON_FORBIDDEN';
  end if;
  v_request_key := btrim(coalesce(p_idempotency_key, ''));
  if p_name is null or btrim(p_name) = '' or p_price < 0 or p_quantity < 1
     or p_duration_minutes < 0
     or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;

  -- The booking lock serializes both same-key replays and distinct add-ons on
  -- one booking, preserving the existing financial lock order.
  select * into v_booking from public.bookings
    where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;

  v_performance_mode := case
    when p_no_personal_credit then 'NONE'::public.addon_performance_mode
    when p_staff_id is not null then 'SPECIFIC_STAFF'::public.addon_performance_mode
    else 'PRIMARY'::public.addon_performance_mode end;
  v_performance_staff_id := case
    when p_no_personal_credit then null
    when p_staff_id is not null then p_staff_id
    else v_booking.staff_id end;

  -- A replay returns the already committed totals and persisted notification
  -- state.  It deliberately bypasses the current booking status gate: a
  -- response retry must not turn a completed booking into a second mutation.
  select * into v_existing from public.booking_addons
    where tenant_id = p_tenant_id and booking_id = p_booking_id
      and idempotency_key = v_request_key
    for update;
  if found then
    if v_existing.service_id is distinct from p_service_id
       or v_existing.name is distinct from btrim(p_name)
       or v_existing.price is distinct from p_price
       or v_existing.quantity is distinct from p_quantity
       or v_existing.duration_minutes is distinct from p_duration_minutes
       or v_existing.staff_id is distinct from p_staff_id
       or v_existing.performance_mode is distinct from v_performance_mode
       or v_existing.performance_staff_id is distinct from v_performance_staff_id
       or v_existing.notification_requested is distinct from coalesce(p_notify, false) then
      raise exception 'BOOKING_ADDON_IDEMPOTENCY_CONFLICT';
    end if;
    addon_id := v_existing.id;
    final_price := v_booking.final_price;
    duration_minutes := v_booking.duration_minutes;
    end_at := v_booking.end_at;
    created := false;
    notified := v_existing.notified;
    return next;
  end if;

  if v_booking.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_ADDON_STATUS_CONFLICT';
  end if;
  if p_service_id is not null then
    select * into v_service from public.services
      where id = p_service_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_SERVICE_NOT_FOUND'; end if;
  end if;
  if p_staff_id is not null then
    select * into v_staff from public.staff
      where id = p_staff_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_STAFF_NOT_FOUND'; end if;
  end if;
  if v_performance_mode = 'PRIMARY'::public.addon_performance_mode
     and v_performance_staff_id is not null then
    perform 1 from public.staff
      where id = v_performance_staff_id and tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_PRIMARY_STAFF_NOT_FOUND'; end if;
  end if;

  v_amount := p_price * p_quantity;
  v_minutes := p_duration_minutes * p_quantity;
  insert into public.booking_addons (
    tenant_id, booking_id, service_id, name, price, quantity, duration_minutes, staff_id,
    applied_amount, applied_minutes, performance_mode, performance_staff_id,
    idempotency_key, notification_requested
  ) values (
    p_tenant_id, p_booking_id, p_service_id, btrim(p_name), p_price, p_quantity, p_duration_minutes, p_staff_id,
    v_amount, v_minutes, v_performance_mode, v_performance_staff_id,
    v_request_key, coalesce(p_notify, false)
  ) returning id into addon_id;

  update public.bookings set
    final_price = public.bookings.final_price + v_amount,
    duration_minutes = public.bookings.duration_minutes + v_minutes,
    end_at = public.bookings.end_at + make_interval(mins => v_minutes)
  where id = p_booking_id and tenant_id = p_tenant_id
  returning public.bookings.final_price, public.bookings.duration_minutes, public.bookings.end_at
  into final_price, duration_minutes, end_at;
  created := true;
  notified := 'NONE';
  return next;
end $$;

-- Claim before calling LINE.  Once claimed, the row is intentionally no longer
-- eligible for another provider call until the first attempt records a final
-- outcome.  This is the fail-closed boundary for marker/network ambiguity.
create or replace function public.claim_booking_addon_notification_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid
) returns table (claimed boolean, notified text)
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  update public.booking_addons
  set notified = 'PENDING'
  where tenant_id = p_tenant_id and booking_id = p_booking_id and id = p_addon_id
    and notified = 'NONE'
  returning true, public.booking_addons.notified into claimed, notified;
  if found then return next; end if;

  select ba.notified into v_current from public.booking_addons ba
    where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  claimed := false;
  notified := v_current;
  return next;
end $$;

create or replace function public.mark_booking_addon_notification_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid, p_notified text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  if p_notified not in ('LINE','NO_LINE','NOT_CONFIGURED','QUOTA_EXCEEDED','FAILED') then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;
  update public.booking_addons
  set notified = p_notified
  where tenant_id = p_tenant_id and booking_id = p_booking_id and id = p_addon_id
    and notified = 'PENDING';
  if found then return; end if;

  -- A repeated marker call is harmless only when it records the same settled
  -- outcome.  Any other state is a real conflict, never a silent success.
  select ba.notified into v_current from public.booking_addons ba
    where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  if v_current = p_notified then return; end if;
  raise exception 'BOOKING_ADDON_NOTIFICATION_CONFLICT';
end $$;

revoke all on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,text,uuid,boolean,boolean)
  from public, anon, service_role;
grant execute on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,text,uuid,boolean,boolean)
  to authenticated;
revoke all on function public.claim_booking_addon_notification_17(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_booking_addon_notification_17(uuid,uuid,uuid)
  to service_role;
revoke all on function public.mark_booking_addon_notification_17(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.mark_booking_addon_notification_17(uuid,uuid,uuid,text)
  to service_role;
