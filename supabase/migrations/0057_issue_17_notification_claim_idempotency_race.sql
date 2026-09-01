-- Issue #17 forward repair after 0056 was applied.
--
-- 0056 exposed two retry-boundary defects in TEST: the notification claim
-- UPDATE returned into an output parameter with the same name as the column,
-- and the pre-insert replay lookup was not sufficient protection against the
-- unique idempotency index.  Keep 0056 immutable and repair both behaviours
-- with a forward-only replacement.

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
  select * into v_booking from public.bookings as b
    where b.id = p_booking_id and b.tenant_id = p_tenant_id for update;
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
  select * into v_existing from public.booking_addons as ba
    where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id
      and ba.idempotency_key = v_request_key
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
    select * into v_service from public.services as s
      where s.id = p_service_id and s.tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_SERVICE_NOT_FOUND'; end if;
  end if;
  if p_staff_id is not null then
    select * into v_staff from public.staff as st
      where st.id = p_staff_id and st.tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_STAFF_NOT_FOUND'; end if;
  end if;
  if v_performance_mode = 'PRIMARY'::public.addon_performance_mode
     and v_performance_staff_id is not null then
    perform 1 from public.staff as st
      where st.id = v_performance_staff_id and st.tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_PRIMARY_STAFF_NOT_FOUND'; end if;
  end if;

  v_amount := p_price * p_quantity;
  v_minutes := p_duration_minutes * p_quantity;
  -- The partial-index predicate is part of the inference clause.  If an
  -- already committed same-key row wins the race, do not raise 23505: fetch
  -- and validate the authoritative row below, without changing the booking.
  insert into public.booking_addons (
    tenant_id, booking_id, service_id, name, price, quantity, duration_minutes, staff_id,
    applied_amount, applied_minutes, performance_mode, performance_staff_id,
    idempotency_key, notification_requested
  ) values (
    p_tenant_id, p_booking_id, p_service_id, btrim(p_name), p_price, p_quantity, p_duration_minutes, p_staff_id,
    v_amount, v_minutes, v_performance_mode, v_performance_staff_id,
    v_request_key, coalesce(p_notify, false)
  )
  on conflict (tenant_id, booking_id, idempotency_key)
    where (idempotency_key is not null) do nothing
  returning id into addon_id;

  if not found then
    select * into v_existing from public.booking_addons as ba
      where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id
        and ba.idempotency_key = v_request_key
      for update;
    if not found then raise exception 'BOOKING_ADDON_IDEMPOTENCY_CONFLICT'; end if;
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

  update public.bookings as b set
    final_price = b.final_price + v_amount,
    duration_minutes = b.duration_minutes + v_minutes,
    end_at = b.end_at + make_interval(mins => v_minutes)
  where b.id = p_booking_id and b.tenant_id = p_tenant_id
  returning b.final_price, b.duration_minutes, b.end_at
  into final_price, duration_minutes, end_at;
  created := true;
  notified := 'NONE';
  return next;
end $$;

-- Claim before calling LINE.  Keep the output parameter and table column
-- distinct: PostgreSQL otherwise rejects the UPDATE with 42702 ambiguity.
create or replace function public.claim_booking_addon_notification_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid
) returns table (claimed boolean, notified text)
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
  v_claim_notified text;
begin
  if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  update public.booking_addons as ba
  set notified = 'PENDING'
  where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id
    and ba.notified = 'NONE'
  returning ba.notified into v_claim_notified;
  if found then
    claimed := true;
    notified := v_claim_notified;
    return next;
  end if;

  select ba.notified into v_current from public.booking_addons as ba
    where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  claimed := false;
  notified := v_current;
  return next;
end $$;

revoke all on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,text,uuid,boolean,boolean)
  from public, anon, service_role;
grant execute on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,text,uuid,boolean,boolean)
  to authenticated;
revoke all on function public.claim_booking_addon_notification_17(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_booking_addon_notification_17(uuid,uuid,uuid)
  to service_role;
