-- Issue #46：REQUEST 旅程需要在下單當下把「該方案當時的取消政策」snapshot 到
-- 訂單本身，之後導遊改了 Trip 的政策不會回頭改舊單的顯示文案。
--
-- `trips.refund_policy_type`（0089 建立，STANDARD/FLEXIBLE/STRICT 三值）已經是
-- 現有唯一的政策欄位，這裡沿用同一組值域，不新增第二套退款規則/百分比計算。
--
-- ## 這一片修的「假成功」是什麼
--
-- `src/server/mappers.ts` 的 `mapTourOrder` 早就在讀 `r.refund_policy_snapshot`
-- 並把它交給 `src/app/s/[shopCode]/requests/[orderId]/page.tsx` 顯示給旅客，
-- 但 `tour_orders.refund_policy_snapshot` 這個欄位從未真的進到 main 的
-- migration 序列（曾以 0122 的形式存在於 `agent/issue-46-refund-policy-snapshot-
-- migration` 分支，該分支從未合併）。結果是：每一筆 REQUEST 訂單，不論
-- Trip 實際設定的取消政策是什麼，旅客在狀態頁看到的永遠是「政策未提供」
-- （`mappers.ts` 對值域外/undefined 一律收斂成 null 的既有慣例）——UI 與
-- mapper 都已經照規格寫好，缺的只是這個欄位本身，本檔補上。
--
-- ## 為什麼重寫 create_tour_order 而不是照搬舊分支的版本
--
-- 舊分支的 0122 是在 `0110`（priceType）之後、`0111`（REQUEST 送出申請不鎖名額
-- ／`seats_reserved` 狀態機）之前切出來的，函式本體仍是「不分 sales_mode 一律
-- reserve_seats」的舊行為。若直接套用該檔，會讓 `create or replace` 把現在
-- main 上 0111 已經修好的 `seats_reserved` 分流邏輯整支覆蓋回舊行為，重新
-- 製造 0111 修的那個「REQUEST 送出申請就先扣名額」的假成功。本檔以目前 main
-- 上 0111 的函式本體為準，只多做一件事：insert 時把 trips 目前的
-- refund_policy_type snapshot 進新欄位。簽章與 0087／0110／0111 完全相同，
-- 只換函式本體（0099 的教訓：换 overload 會讓 PostgREST 挑錯版本）。

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

  -- 本檔新增：讀 Trip 目前的取消政策，insert 時 snapshot 成訂單當下的值。
  -- 找不到（理論上不會發生，departure 已經驗證過 trip_id）時保持 null，
  -- 不得替查不到的情況假造一個政策——同 mappers.ts 對值域外一律收斂成
  -- null 的既有慣例。
  select t.refund_policy_type into v_trip
    from public.trips t
   where t.id = v_dep.trip_id and t.tenant_id = p_tenant;

  if p_party_size < v_plan.min_party or p_party_size > v_plan.max_party then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE' using errcode = 'P0003';
  end if;

  -- `0110` 補上的 price_type：PER_GROUP 整團一口價，與人數無關；PER_PERSON
  -- 維持既有「單價 × 人數」。這一段不是本檔要修的範圍，原樣保留其行為。
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

  -- 18 分冊 §0.2：REQUEST 送出申請時不鎖名額；其餘 sales_mode 維持原行為，
  -- 建單當下就原子扣減，扣不到就整個交易回滾、不留下空單。與 0111 完全相同，
  -- 本檔不改動這段行為。
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
    v_trip.refund_policy_type
  ) returning id into v_id;

  return v_id;
end; $$ language plpgsql security definer set search_path = public;
