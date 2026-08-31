-- 0050 — reject changed-amount replays of an existing payment receipt.
create or replace function public.record_tour_order_payment_41(
  p_tenant pg_catalog.uuid, p_order pg_catalog.uuid, p_actor_user pg_catalog.uuid,
  p_amount pg_catalog.numeric, p_channel pg_catalog.text, p_receipt_reference pg_catalog.text
) returns pg_catalog.uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_departure_id pg_catalog.uuid;
  v_dep public.trip_departures%rowtype;
  v_plan public.trip_plans%rowtype;
  v_order public.tour_orders%rowtype;
  v_existing_order pg_catalog.uuid;
  v_existing_amount pg_catalog.numeric;
  v_paid pg_catalog.numeric;
  v_payment_status pg_catalog.text;
begin
  if p_amount is null or p_amount <= 0 or p_channel not in ('BANK_MANUAL', 'PROVIDER_SUCCESS')
     or nullif(p_receipt_reference, '') is null then
    raise exception 'PAYMENT_RECEIPT_INVALID' using errcode = 'P0001';
  end if;
  if p_channel = 'BANK_MANUAL' and not exists (
    select 1 from public.tenant_users where tenant_id = p_tenant and user_id = p_actor_user
      and role in ('OWNER', 'MANAGER')
  ) then raise exception 'PAYMENT_ACTOR_FORBIDDEN' using errcode = 'P0001'; end if;
  select departure_id into v_departure_id from public.tour_orders where id = p_order and tenant_id = p_tenant;
  if not found then raise exception 'TOUR_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_dep from public.trip_departures where id = v_departure_id and tenant_id = p_tenant for update;
  if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_plan from public.trip_plans where id = v_dep.plan_id and tenant_id = p_tenant for key share;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_order from public.tour_orders where id = p_order and tenant_id = p_tenant for update;
  if not found then raise exception 'TOUR_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.departure_id is distinct from v_dep.id or v_order.trip_id is distinct from v_dep.trip_id
     or v_order.plan_id is distinct from v_dep.plan_id then
    raise exception 'TOUR_ORDER_LINEAGE_INVALID' using errcode = 'P0001';
  end if;
  if v_order.status = 'CANCELLED' or v_order.payment_status in ('REFUND_PENDING', 'REFUNDED') then
    raise exception 'PAYMENT_ORDER_NOT_PAYABLE' using errcode = 'P0001';
  end if;
  select order_id, amount into v_existing_order, v_existing_amount
  from public.tour_order_payment_receipts_41
  where tenant_id = p_tenant and channel = p_channel and receipt_reference = p_receipt_reference;
  if found then
    if v_existing_order is distinct from p_order or v_existing_amount is distinct from p_amount then
      raise exception 'PAYMENT_RECEIPT_CONFLICT' using errcode = 'P0001';
    end if;
    return p_order;
  end if;
  v_paid := v_order.paid_amount + p_amount;
  if v_paid > v_order.total_amount then raise exception 'PAYMENT_AMOUNT_EXCEEDS_TOTAL' using errcode = 'P0001'; end if;
  v_payment_status := case when v_paid = v_order.total_amount then 'PAID'
    when v_paid >= v_order.upfront_required_amount then 'PARTIAL' else 'UNPAID' end;
  insert into public.tour_order_payment_receipts_41 (tenant_id, order_id, channel, receipt_reference, amount, confirmed_by)
  values (p_tenant, p_order, p_channel, p_receipt_reference, p_amount,
    case when p_channel = 'BANK_MANUAL' then p_actor_user else null end);
  update public.tour_orders
  set paid_amount = v_paid, payment_status = v_payment_status,
      status = case when status = 'PENDING' and (v_order.deposit_mode_snapshot = 'NONE'
        or v_paid >= v_order.upfront_required_amount) then 'CONFIRMED' else status end,
      hold_expires_at = case when v_order.deposit_mode_snapshot = 'NONE'
        or v_paid >= v_order.upfront_required_amount then null else hold_expires_at end,
      payment_ref = p_receipt_reference, balance_due = greatest(total_amount - v_paid, 0),
      balance_due_at = case when v_dep.formation_status = 'FORMED'
        and balance_collection_mode_snapshot = 'DEADLINE' and total_amount > v_paid
        then coalesce(balance_due_at, pg_catalog.now() + pg_catalog.make_interval(hours => balance_due_hours_snapshot))
        else balance_due_at end,
      updated_at = pg_catalog.now()
  where id = p_order and tenant_id = p_tenant;
  return p_order;
end;
$$;
revoke execute on function public.record_tour_order_payment_41(
  pg_catalog.uuid, pg_catalog.uuid, pg_catalog.uuid, pg_catalog.numeric, pg_catalog.text, pg_catalog.text
) from public, anon, authenticated;
grant execute on function public.record_tour_order_payment_41(
  pg_catalog.uuid, pg_catalog.uuid, pg_catalog.uuid, pg_catalog.numeric, pg_catalog.text, pg_catalog.text
) to service_role;
