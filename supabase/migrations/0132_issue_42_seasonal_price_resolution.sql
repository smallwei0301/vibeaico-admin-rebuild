-- Issue #42：季節定價（`trip_plan_seasons`，0128）建立了資料模型，但 0128 的檔頭
-- 明確保留一句「本 migration 只建立資料模型與讀取隔離，不改既有 departure/order
-- 的價格 snapshot，也不決定季節重疊時的產品優先順序；那些是寫入/計價規則的
-- 責任」。0130 之後的 `create_tour_order` 仍然無條件使用 `trip_plans.price_per_person`，
-- 完全不查 `trip_plan_seasons`——GUIDE 後台可以設定季節加價／減價，但沒有任何
-- 訂單真的套用過，這是一個真實的假成功：UI 讓導遊以為季節定價會生效，實際
-- 成交價格永遠是基本價。
--
-- ## 本檔補的行為
--
-- `create_tour_order` 在算單價前，先用 departure 的 `departs_on` 對這個 plan
-- 目前 active 的 `trip_plan_seasons` 做一次比對，找到「當天落在哪個季節區間」，
-- 若該季節有 `price_override` 就用它取代 `price_per_person`；若沒有命中任何
-- 季節，或命中的季節 `price_override is null`（0128 的既有語意：null = 沿用
-- 方案基本價），維持原本的 `price_per_person`。算出來的單價之後才依 0110 的
-- `price_type`（PER_PERSON / PER_GROUP）套用，行為與既有邏輯銜接，不改變
-- PER_GROUP 整團一口價的既有語意。
--
-- 選到的單價會被 insert 進 `tour_orders.unit_price` / `total_amount`，因此
-- 天然是下單當下的 snapshot——之後導遊修改或刪除季節設定，不會回頭改舊單金額，
-- 與 0130 對退款政策 snapshot 採用的同一原則一致。
--
-- ## 重疊季節的 precedence（Owner 未裁示，本檔的 bounded 設計決策，非產品決策 blocker）
--
-- 0128 檔頭明確把「季節重疊時的優先順序」列為未決；本檔採「範圍最小的季節
-- 優先」：命中多個 active 季節時，取涵蓋天數最少的那個（愈精確、愈像是刻意
-- 為特定短檔期加價的設定，優先權愈高），天數相同再用 `sort_order` 小的優先，
-- 仍相同則用 `id` 排序做穩定 tie-break。若未來 Owner 對重疊 precedence 有不同
-- 裁示，只需替換這裡的排序條件，不影響資料模型或呼叫端。
--
-- 季節可跨年（0128 檔頭：例如 12/1 至 2/28），比對與跨年展期都用月/日在一個
-- 固定的閏年（2000）上换算成「一年中的第幾天」，只用來做月/日層級的比較，
-- 不代表任何真實日期，所以能安全處理 2/29 這種季節邊界。
--
-- ## 未在本檔處理、如實記錄的範圍外事項
--
-- - `child_price` 的季節 override：0128 檔頭與 issue #42 本文都沒有要求，本檔
--   不自行擴張。
-- - Self-scheduled（自選時間）動態建立 PRIVATE departure 時的季節定價：那條路徑
--   一樣是先有 `trip_departures.departs_on` 才呼叫 `create_tour_order`，本檔的
--   修改天然涵蓋，不需要另外處理。
-- - 本 migration 只新增 source，不套用到任何環境；套用需先由 canonical TEST
--   serialized 驗證，再依現行 release 流程走 Production，兩者都不是本檔範圍。

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
  v_season_price numeric;
  v_base    numeric;
  v_unit    numeric;
  v_total   numeric;
  v_deposit numeric;
  v_id      uuid;
  v_should_reserve boolean;
  v_cur_doy int;
begin
  select d.id, d.trip_id, d.plan_id, d.departs_on into v_dep
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

  -- 本檔新增：季節定價解析。用一個固定閏年（2000）把 departs_on 的月/日換算成
  -- 「一年中的第幾天」，用同樣方式展開每個季節的 start/end，再判斷是否命中
  -- （含跨年展期），最後依檔頭訂的 precedence 排序取第一筆。
  v_cur_doy := extract(doy from make_date(2000, extract(month from v_dep.departs_on)::int,
                                                  extract(day from v_dep.departs_on)::int))::int;

  select s.price_override
    into v_season_price
    from public.trip_plan_seasons s,
    lateral (
      select
        extract(doy from make_date(2000, s.start_month, s.start_day))::int as start_doy,
        extract(doy from make_date(2000, s.end_month, s.end_day))::int as end_doy
    ) bounds
   where s.tenant_id = p_tenant
     and s.plan_id = v_dep.plan_id
     and s.active
     and (
       case when bounds.start_doy <= bounds.end_doy
         then v_cur_doy between bounds.start_doy and bounds.end_doy
         else v_cur_doy >= bounds.start_doy or v_cur_doy <= bounds.end_doy
       end
     )
   order by
     case when bounds.start_doy <= bounds.end_doy
       then bounds.end_doy - bounds.start_doy
       else (366 - bounds.start_doy) + bounds.end_doy
     end asc,
     s.sort_order asc,
     s.id asc
   limit 1;

  v_base := coalesce(v_season_price, v_plan.price_per_person);

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
  -- 維持既有「單價 × 人數」。這一段不是本檔要修的範圍，只是把原本固定的
  -- `v_plan.price_per_person` 換成上面解析出的 `v_base`（季節 override 或
  -- 原基本價），其餘行為原樣保留。
  v_unit  := v_base;
  v_total := case v_plan.price_type
    when 'PER_GROUP' then v_base
    else v_base * p_party_size
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
