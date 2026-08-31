-- 0049 — #41 atomic order cancellation
--
-- Cancellation releases capacity, preserves the order, and records only the
-- objective refund boundary. It deliberately does not decide refund amounts,
-- percentages, forfeiture, or a provider refund action.

create or replace function public.cancel_tour_order_41(
  p_tenant pg_catalog.uuid,
  p_order pg_catalog.uuid,
  p_actor_user pg_catalog.uuid,
  p_reason pg_catalog.text default ''
) returns pg_catalog.uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure_id pg_catalog.uuid;
  v_dep public.trip_departures%rowtype;
  v_plan public.trip_plans%rowtype;
  v_order public.tour_orders%rowtype;
begin
  if not exists (
    select 1 from public.tenant_users
    where tenant_id = p_tenant and user_id = p_actor_user
      and role in ('OWNER', 'MANAGER')
  ) then
    raise exception 'TOUR_ORDER_ACTOR_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Lock the hierarchy in the same canonical order as payment and direct-write
  -- lineage guards: departure -> plan -> order. Re-check after locking so a
  -- service-role caller cannot race a reassignment across tenants.
  select departure_id into v_departure_id from public.tour_orders
  where id = p_order and tenant_id = p_tenant;
  if not found then raise exception 'TOUR_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_dep from public.trip_departures
  where id = v_departure_id and tenant_id = p_tenant for update;
  if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_plan from public.trip_plans
  where id = v_dep.plan_id and tenant_id = p_tenant for key share;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_order from public.tour_orders
  where id = p_order and tenant_id = p_tenant for update;
  if not found then raise exception 'TOUR_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.departure_id is distinct from v_dep.id
     or v_order.trip_id is distinct from v_dep.trip_id
     or v_order.plan_id is distinct from v_dep.plan_id then
    raise exception 'TOUR_ORDER_LINEAGE_INVALID' using errcode = 'P0001';
  end if;
  if v_order.status = 'CANCELLED' then raise exception 'TOUR_ORDER_ALREADY_CANCELLED' using errcode = 'P0001'; end if;
  if v_order.status = 'COMPLETED' then raise exception 'TOUR_ORDER_COMPLETED_NOT_CANCELLABLE' using errcode = 'P0001'; end if;

  update public.tour_orders
  set status = 'CANCELLED',
      payment_status = case
        when paid_amount > refunded_amount then 'REFUND_PENDING'
        else payment_status
      end,
      hold_expires_at = null,
      cancel_reason = coalesce(p_reason, ''),
      updated_at = pg_catalog.now()
  where id = v_order.id and tenant_id = p_tenant;

  update public.trip_departures
  set seats_booked = greatest(seats_booked - v_order.party_size, 0)
  where id = v_dep.id and tenant_id = p_tenant;
  return v_order.id;
end;
$$;

revoke execute on function public.cancel_tour_order_41(
  pg_catalog.uuid, pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text
) from public, anon, authenticated;
grant execute on function public.cancel_tour_order_41(
  pg_catalog.uuid, pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text
) to service_role;
