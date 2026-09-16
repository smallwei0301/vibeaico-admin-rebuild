-- issue #42: GUIDE 方案管理進階設定分層——`mapTripPlan()` 目前對
-- `durationMinutes` / `priceType` / `yearRound` 三個欄位回傳寫死的假值，因為
-- `trip_plans`（`0066`）從來沒有對應欄位。畫面上每個方案的時長／計價方式／
-- 是否全年販售全部長得一樣，與方案實際設定無關——這是「假資料假裝是真資料」。
--
-- 本 migration 只補這三個欄位，且只做加法：不改任何既有欄位的型別、預設值
-- 或 not-null 約束，也不 drop 任何東西，不動既有 RLS（`0066`/`0068` 已建好
-- tenant 隔離）。
--
-- 範圍界線（Issue #42 本輪明確排除，見 Issue/PR 說明）：
--   * seasons（季節價格覆寫陣列）——需要獨立的季節編輯 UI，另案處理。
--   * reviewState / reviewNote（Midao 審核流程）——目前整個程式碼庫沒有任何
--     地方會把它設成非 NONE，觸發條件是產品設計判斷，另案處理。
--   * bookingType——與 #41 已落地的 salesMode 語意重疊，是否合併是產品判斷，
--     不在本次授權範圍內，維持寫死 'SCHEDULED' 不動。
--
-- 同一支 migration 也把 `create_tour_order`（`0087`）改成依 `price_type` 決定
-- 訂單總額：PER_PERSON 維持既有「單價 × 人數」，PER_GROUP 是整團一口價、
-- 與人數無關。這是讓 priceType 從「純顯示」變成「真的影響金額」的那一半。

alter table public.trip_plans
  add column if not exists duration_minutes int not null default 60,
  add column if not exists price_type       text not null default 'PER_PERSON',
  add column if not exists year_round       boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_duration_minutes_positive'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_duration_minutes_positive
      check (duration_minutes > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_price_type_check'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_price_type_check
      check (price_type in ('PER_PERSON', 'PER_GROUP'));
  end if;
end $$;

-- `add column if not exists` 對「同名但不同型別」的既有欄位是靜默跳過的
-- （PB-026）。跳過等於這支 migration 宣稱做了事、實際什麼都沒做，下游測試
-- 卻還是綠燈。所以把「跳過」轉成大聲失敗。
do $$
declare
  r record;
  v_actual text;
begin
  for r in
    select * from (values
      ('duration_minutes', 'integer'),
      ('price_type', 'text'),
      ('year_round', 'boolean')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public' and table_name = 'trip_plans' and column_name = r.col;
    if v_actual is null then
      raise exception 'trip_plans.% 不存在——0110 沒有生效', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'trip_plans.% 的型別是 %，預期 %——既有欄位形狀與本 migration 不一致',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;

-- ------------------------------------------------- create_tour_order：priceType 真的影響金額
-- `create or replace function` 用完全相同的簽名，保留 `0088` 對這支函式做的
-- GRANT/REVOKE（只有 service_role 能執行）——PostgreSQL 對 replace 同簽名函式
-- 不會重置既有的權限狀態。
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
  v_unit    numeric;
  v_total   numeric;
  v_deposit numeric;
  v_id      uuid;
begin
  -- 團次與方案都必須屬於同一個租戶：這支函式是 security definer，繞過了 RLS，
  -- 所以租戶隔離必須在這裡自己做，不能倚賴呼叫端。
  select d.id, d.trip_id, d.plan_id into v_dep
    from public.trip_departures d
   where d.id = p_departure and d.tenant_id = p_tenant;
  if not found then
    raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.price_per_person, p.deposit_mode, p.deposit_value, p.min_party, p.max_party, p.price_type
    into v_plan
    from public.trip_plans p
   where p.id = v_dep.plan_id and p.tenant_id = p_tenant;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 人數範圍檢查與計價方式無關：即使是整團一口價，容量／人數限制照樣要驗。
  if p_party_size < v_plan.min_party or p_party_size > v_plan.max_party then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE' using errcode = 'P0003';
  end if;

  v_unit  := v_plan.price_per_person;
  -- issue #42：PER_GROUP 是整團一口價、與人數無關；PER_PERSON 維持既有語意
  -- （單價 × 人數）。未知值一律當 PER_PERSON，與 mapTripPlan() 的 fail-closed
  -- 方向一致。
  v_total := case when v_plan.price_type = 'PER_GROUP' then v_unit else v_unit * p_party_size end;
  v_deposit := case v_plan.deposit_mode
    when 'DEPOSIT_FIXED'   then least(v_plan.deposit_value, v_total)
    when 'DEPOSIT_PERCENT' then round(v_total * v_plan.deposit_value / 100.0)
    else 0
  end;

  -- 先扣名額再建單：扣不到就 raise，整個交易回滾，不會留下 PENDING 的空單。
  perform public.reserve_seats(p_departure, p_party_size);

  insert into public.tour_orders (
    tenant_id, order_no, trip_id, plan_id, departure_id, customer_id,
    party_size, unit_price, total_amount, deposit_amount, contact,
    source, payment_method_id, note, hold_expires_at
  ) values (
    p_tenant, p_order_no, v_dep.trip_id, v_dep.plan_id, p_departure, p_customer,
    p_party_size, v_unit, v_total, v_deposit, coalesce(p_contact, '{}'::jsonb),
    p_source, p_payment_method, coalesce(p_note, ''), p_hold_expires
  ) returning id into v_id;

  return v_id;
end; $$ language plpgsql security definer set search_path = public;

-- `create or replace function` 保留既有 owner/grant，但這裡重申一次意圖，
-- 避免日後有人讀這支檔案時以為權限是懸空的：這四支只能由 service_role 呼叫。
revoke execute on function public.create_tour_order(
  uuid, text, uuid, int, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz
) from anon, authenticated;

-- Final Risk (claude-fable-5-1) 非阻擋建議：比照 0099 的作法，讓「create or
-- replace 沒有意外多出一個 overload、簽章仍是原本那組」這件事自我驗證，而不是
-- 只靠審查時人工比對兩份 SQL 文字。
do $$
declare
  v_args text;
  v_n    int;
begin
  select pg_catalog.count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';

  if v_n <> 1 then
    raise exception 'create_tour_order 應唯一，實際 % 個（>1 代表 create or replace 意外新增了 overload，會 PGRST203）', v_n;
  end if;

  select pg_catalog.pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';

  if v_args <> 'p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone' then
    raise exception '簽章與 0087/0099 的 canonical 版本不一致，ACL 可能已重置：%', v_args;
  end if;
end $$;
