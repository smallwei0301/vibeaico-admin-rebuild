-- Issue #218 — atomic booking-points redemption. API calls use the user's
-- session client; SECURITY INVOKER preserves RLS and auth.uid() semantics.
create or replace function public.apply_booking_points(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_points integer
) returns table (final_price numeric, customer_points integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_customer public.customers%rowtype;
  v_rows integer;
begin
  if p_tenant_id is null or p_booking_id is null or p_points is null or p_points <= 0 then
    raise exception 'BOOKING_POINTS_INVALID';
  end if;

  -- This also protects direct authenticated RPC calls from crossing a tenant.
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'BOOKING_POINTS_FORBIDDEN';
  end if;

  -- Keep POINT_SYSTEM enforced for direct RPC calls as well as through the route.
  if not exists (
    select 1
    from public.feature_subscriptions
    where tenant_id = p_tenant_id
      and code = 'POINT_SYSTEM'
      and active
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'BOOKING_POINTS_FEATURE_LOCKED';
  end if;

  -- Fixed lock order protects same-booking and shared-customer concurrent calls.
  select * into v_booking
  from public.bookings
  where id = p_booking_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'BOOKING_POINTS_BOOKING_NOT_FOUND';
  end if;

  select * into v_customer
  from public.customers
  where id = v_booking.customer_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'BOOKING_POINTS_CUSTOMER_NOT_FOUND';
  end if;

  if v_booking.final_price < p_points then
    raise exception 'BOOKING_POINTS_FINAL_PRICE_EXCEEDED';
  end if;
  if v_customer.points < p_points then
    raise exception 'BOOKING_POINTS_INSUFFICIENT';
  end if;

  update public.customers
  set points = v_customer.points - p_points
  where id = v_customer.id and tenant_id = p_tenant_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'BOOKING_POINTS_CUSTOMER_WRITE_FAILED';
  end if;

  insert into public.customer_point_logs (tenant_id, customer_id, delta, reason, points_after)
  values (p_tenant_id, v_customer.id, -p_points, 'REDEEM_BOOKING', v_customer.points - p_points);

  update public.bookings
  set final_price = v_booking.final_price - p_points
  where id = v_booking.id and tenant_id = p_tenant_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'BOOKING_POINTS_BOOKING_WRITE_FAILED';
  end if;

  return query select v_booking.final_price - p_points, v_customer.points - p_points;
end;
$$;

revoke execute on function public.apply_booking_points(uuid, uuid, integer) from public;
revoke execute on function public.apply_booking_points(uuid, uuid, integer) from anon;
grant execute on function public.apply_booking_points(uuid, uuid, integer) to authenticated, service_role;
