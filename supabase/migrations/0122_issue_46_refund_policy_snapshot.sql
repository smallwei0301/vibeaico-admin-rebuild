-- Issue #46：REQUEST 旅程需要在下單當下把「該方案當時的取消政策」snapshot 到
-- 訂單本身，之後導遊改了 Trip 的政策不會回頭改舊單的顯示文案。
--
-- `trips.refund_policy_type`（0089 建立，STANDARD/FLEXIBLE/STRICT 三值）已經是
-- 現有唯一的政策欄位，這裡沿用同一組值域，不新增第二套退款規則/百分比計算。

alter table public.tour_orders
  add column if not exists refund_policy_snapshot text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tour_orders_refund_policy_snapshot_check'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_refund_policy_snapshot_check
      check (refund_policy_snapshot is null
             or refund_policy_snapshot in ('STANDARD', 'FLEXIBLE', 'STRICT'));
  end if;
end $$;

-- ------------------------------------------------------- create_tour_order
-- 簽章與 0087／0110／0111 完全相同，只換函式本體（0099 的教訓：换 overload
-- 會讓 PostgREST 挑錯版本）。本次只多做一件事：insert 當下把 trips 目前的
-- refund_policy_type snapshot 進新欄位。
create or replace function public.create_tour_order(
  p_tenant        uuid,
  p_order_no      text,
  p_departure     uuid,
  p_party_size    int,
  p_customer      uuid,
  p_contact       jsonb,
  p_source        public.tour_order_source,
  p_payment_method uuid,
  p_note          text,
  p_hold_expires  timestamptz
) returns uuid as $$
declare
  v_dep     record;
  v_plan    record;
  v_trip    record;
  v_unit    numeric;
  v_total   numeric;
  v_deposit numeric;
  v_id      uuid;
  v_should_reserve boolean;
begin
  select d.id, d.trip_id, d.plan_id into v_dep
    from public.trip_departures d
   where d.id = p_departure and d.tenant_id = p_tenant;
  if not found then
    raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.price_per_person, p.deposit_mode, p.deposit_value, p.min_party, p.max_party,
         p.sales_mode, p.price_type
    into v_plan
    from public.trip_plans p
   where p.id = v_dep.plan_id and p.tenant_id = p_tenant;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  select t.refund_policy_type into v_trip
    from public.trips t
   where t.id = v_dep.trip_id and t.tenant_id = p_tenant;

  if p_party_size < v_plan.min_party or p_party_size > v_plan.max_party then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE' using errcode = 'P0003';
  end if;

  v_unit  := v_plan.price_per_person;
  v_total := case v_plan.price_type
    when 'PER_GROUP' then v_plan.price_per_person
    else v_plan.price_per_person * p_party_size
  end;
  v_deposit := case v_plan.deposit_mode
    when 'DEPOSIT_FIXED'   then least(v_plan.deposit_value, v_total)
    when 'DEPOSIT_PERCENT' then round(v_total * v_plan.deposit_value / 100.0)
    else 0
  end;

  v_should_reserve := coalesce(v_plan.sales_mode, 'FIXED_DEPARTURE') <> 'REQUEST';
  if v_should_reserve then
    perform public.reserve_seats(p_departure, p_party_size);
  end if;

  insert into public.tour_orders (
    tenant_id, order_no, trip_id, plan_id, departure_id, customer_id,
    party_size, unit_price, total_amount, deposit_amount, contact,
    source, payment_method_id, note, hold_expires_at, seats_reserved,
    refund_policy_snapshot
  ) values (
    p_tenant, p_order_no, v_dep.trip_id, v_dep.plan_id, p_departure, p_customer,
    p_party_size, v_unit, v_total, v_deposit, coalesce(p_contact, '{}'::jsonb),
    p_source, p_payment_method, coalesce(p_note, ''), p_hold_expires, v_should_reserve,
    coalesce(v_trip.refund_policy_type, 'STANDARD')
  ) returning id into v_id;

  return v_id;
end; $$ language plpgsql security definer set search_path = public;
