-- issue #46（旅客側）：LINE-first 自助預約旅程的 REQUEST 最短迴路。
--
-- 這一片修的「假成功」是什麼
-- -----------------------------------------------------------------------------
-- `0111` 已經讓 REQUEST 訂單「送出申請不鎖名額、導遊接受才鎖」在資料庫層面成立，
-- 但畫面上完全沒有告訴旅客「這筆訂單當時適用哪一種取消／退款政策」——
-- `trips.refund_policy_type`（`0089`）可以被店家事後改掉，若訂單不 snapshot
-- 當下的值，日後政策一改，舊訂單的顯示會跟著默默改變，變成「用今天的政策回頭
-- 解釋昨天的承諾」，這正是 issue #46 owner 規格明講的「政策於購買時 snapshot
-- 到訂單上」要防的事。
--
-- 修法：`tour_orders` 新增 `refund_policy_snapshot`（沿用 `trips.refund_policy_type`
-- 既有值域，不新增列舉、不發明新的退款算式——issue 本身也明講這一片只做「顯示既有
-- 政策」，不做新的退款金額計算），`create_tour_order` 建單當下從 `trips` 讀一次、
-- 寫死進這個欄位；之後行程改政策不回頭改已存在的訂單。
--
-- 為什麼不是給 create_tour_order 加參數
-- -----------------------------------------------------------------------------
-- 同 `0111`／`0099` 的既有教訓：`create_tour_order` 的參數型別列表是它與
-- PostgREST 之間唯一的身分證，改列表會讓 `create or replace` 變成多建一個
-- overload，PostgREST 隨即在兩個同名候選之間猜不出要呼叫哪一支（PGRST203）。
-- 這裡完全不動簽章，只在函式本體內部多 select 一次 `trips.refund_policy_type`
-- 並多寫一欄。

alter table public.tour_orders
  add column if not exists refund_policy_snapshot text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_refund_policy_snapshot_ck'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_refund_policy_snapshot_ck
      check (refund_policy_snapshot is null
             or refund_policy_snapshot in ('STANDARD', 'FLEXIBLE', 'STRICT'));
  end if;
end $$;

comment on column public.tour_orders.refund_policy_snapshot is
  '#46：建單當下 `trips.refund_policy_type` 的 snapshot，供旅客端誠實顯示當時
   適用的取消／退款政策；null＝本欄位新增前的既有訂單，不得回填猜測值。';

-- ------------------------------------------------------- create_tour_order：多寫一欄
-- 簽章與 0087／0099／0110／0111 完全相同，只換函式本體。
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

  -- #46：取消／退款政策 snapshot 的來源。找不到就是 null——查不到行程理論上
  -- 不會發生（departure 已經驗證過屬於這個 tenant），但防禦性地不讓一次查詢
  -- 失敗擋掉整筆訂單的建立，null 由呼叫端與畫面誠實顯示成「政策未提供」。
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
    v_trip.refund_policy_type
  ) returning id into v_id;

  return v_id;
end; $$ language plpgsql security definer set search_path = public;

-- =============================================================================
-- 後置斷言（PB-026／PB-033）
-- =============================================================================
do $$
declare
  v_n    int;
  v_args text;
  v_def  text;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';
  if v_n <> 1 then
    raise exception '0119 後置斷言失敗——create_tour_order 應唯一，實際 % 個', v_n;
  end if;

  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';
  if v_args <> 'p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone' then
    raise exception '0119 後置斷言失敗——create_tour_order 的簽章被改動，不是 canonical：%', v_args;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';
  if v_def !~* 'refund_policy_snapshot' then
    raise exception '0119 後置斷言失敗——create_tour_order 沒有寫入 refund_policy_snapshot';
  end if;
  if v_def !~* 'v_should_reserve' then
    raise exception '0119 後置斷言失敗——0111 的 REQUEST 分流邏輯意外被本檔覆蓋掉了';
  end if;

  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.tour_orders'::regclass
       and a.attname = 'refund_policy_snapshot' and not a.attisdropped and a.attnum > 0
       and a.atttypid = 'text'::regtype
  ) then
    raise exception '0119 後置斷言失敗——tour_orders.refund_policy_snapshot 不存在或型別不符';
  end if;
end $$;
