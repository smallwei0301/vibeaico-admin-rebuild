-- issue #46（GUIDE 側）：REQUEST 訂單的導遊接受／拒絕，與「送出申請不鎖時間」
-- 這條 owner 決策的名額鎖定時機修正。
--
-- Owner Decision 依據：
--   docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md §0.2／§1
--     「REQUEST 旅客送出申請時不鎖導遊時間；導遊接受時才原子重查 availability
--      並建立／鎖定私人 Departure。」
--   docs/decisions/2026-09-14-guide-request-payment-hold.md
--     「導遊按『接受』時，系統原子重查 availability。時段仍可用時，才…開始付款
--      保留期。預設付款保留期為 12 小時。」「導遊可針對 Plan 設定自己的 REQUEST
--      付款保留預設。接受單一 REQUEST 時可再針對該次交易覆寫保留時間。實際接受
--      時必須 snapshot 成具體截止時間…12 小時不得分散硬編碼在 checkout、cron、
--      UI 或通知文案；應由單一設定／計算來源產生實際截止時間。」
--
-- ## 這一片修的「假成功」是什麼
--
-- `0087` 的 `create_tour_order` 不分 sales_mode，一律呼叫 `reserve_seats`。
-- 而 `/api/tour-orders/manual`（目前 REQUEST 訂單唯一的建單入口，見
-- `src/app/api/guide/action-inbox/route.ts` 的說明）對所有 sales_mode 都走同一
-- 支 rpc。結果是：REQUEST 訂單在旅客／導遊「送出申請」的當下就已經扣了名額，
-- 跟上面兩份 owner 決策明講的「送出申請不鎖時間，導遊接受才鎖」完全相反——
-- 畫面（PENDING、等待導遊決定）說時段還沒鎖，資料庫裡名額已經被這筆申請佔走。
--
-- 修法：`create_tour_order` 依 `trip_plans.sales_mode` 分流——
--   FIXED_DEPARTURE / INSTANT：維持原行為，建單當下就 `reserve_seats`。
--   REQUEST：建單當下**不**呼叫 `reserve_seats`，訂單以 `seats_reserved = false`
--     入列；真正鎖名額的時機延後到 `accept_tour_request`。
--
-- `seats_reserved` 是新欄位，唯一存在理由是讓「這筆訂單有沒有真的佔著名額」變成
-- 可查詢的顯式狀態，而不是靠「sales_mode 是不是 REQUEST」加「status 是不是
-- PENDING」兩條規則在呼叫端各自推導一次——那樣容易漏一處。新欄位預設 `true`：
-- 既有資料與非 REQUEST 訂單一律「已經佔著名額」，這是它們原本、也應該繼續成立
-- 的事實，不是本檔新設的規則。
--
-- ## 為什麼不是給 create_tour_order 加參數
--
-- `0099` 已經記過一次教訓：`create_tour_order` 的參數型別列表是它與 PostgREST
-- 之間唯一的身分證，改列表（即使只是新增一個有 default 的參數）會讓
-- `create or replace` 變成多建一個 overload，PostgREST 隨即在兩個同名候選之間
-- 猜不出要呼叫哪一支（PGRST203）。這裡改成從 `trip_plans.sales_mode` 內部判斷要
-- 不要鎖位，簽章完全不動，`create or replace` 才真的是「替換」而不是「新增」。
--
-- ## accept／reject 兩支新 rpc
--
-- `accept_tour_request`：只對「PENDING 且 plan.sales_mode = REQUEST」的訂單生效
-- ——不合條件回 `ORDER_NOT_ELIGIBLE`（P0010），不改動任何資料。合條件時：
--   1. 尚未鎖位（`seats_reserved = false`）才呼叫 `reserve_seats`——這就是「導遊
--      接受時才原子重查 availability」；名額不夠時 `reserve_seats` 自己 raise
--      `SEATS_UNAVAILABLE`（P0001），整個呼叫回滾，訂單狀態不動。
--      若訂單已經是 `seats_reserved = true`（例如本檔套用前就已用舊行為建立的
--      既有 REQUEST 訂單），不重複鎖位、直接視為「名額本來就在」——這是把既有
--      資料的既成事實接上新狀態機，不是替它們重新分配名額。
--   2. `hold_expires_at` = `now() + (p_hold_hours 或 plan 的 request_hold_hours
--      預設) 小時`，一次算好寫進去，snapshot 成具體時間；之後 Plan 改預設值
--      不回頭改這一筆（決策文件明講的「不得事後偷偷回寫舊單」同一類不變量）。
--   3. `status` PENDING → CONFIRMED——沿用既有狀態機（`canTransitionTourOrder`
--      早就允許這個轉換），不新增列舉值：CONFIRMED 在這裡的語意就是「導遊已接受、
--      名額已鎖、付款保留期正在跑」，跟其他 sales_mode 走到 CONFIRMED 時「已收
--      款」的語意不同，但都是「這筆訂單對旅客的承諾已經確定」，沿用同一個狀態
--      比新增一個只給 REQUEST 用的專屬狀態更符合現有契約（`src/lib/types.ts`
--      的 `TourOrderStatusValue` 只能加，不能改既有形狀）。
--
-- `reject_tour_request`：只對「PENDING 且 plan.sales_mode = REQUEST」的訂單生效
-- ——不合條件回 `false`（沿用 `cancel_tour_order` 的既有慣例：找不到／已非法狀態
-- 都回 false，由呼叫端翻成 404／409）。合條件時：
--   1. 若 `seats_reserved = true`（同上，既有資料的既成事實）才 `release_seats`；
--      修好之後的新建 REQUEST 訂單在被拒絕時 `seats_reserved` 必為 false，本來
--      就沒鎖過名額，不呼叫 `release_seats`——呼叫了才是憑空多放一次名額。
--   2. `status` → CANCELLED，`cancel_reason` 記導遊填的理由。
--
-- 兩支都不是把 `cancel_tour_order` 加參數重疊語意：`cancel_tour_order` 的語意是
-- 「不論為什麼，把一筆已經在生效中的訂單取消掉」，`reject_tour_request` 的語意是
-- 「導遊還沒做出承諾之前，回絕這筆申請」，兩者在名額釋放的前提判斷不同（前者
-- 無條件釋放；後者要看 `seats_reserved` 才知道有沒有東西可放），沿用 `0099`
-- 對 `expire_tour_order` vs `cancel_tour_order` 的同一個理由：把不同語意塞進
-- 同一支函式，會讓其中一種呼叫方式多一個容易傳錯、傳錯又靜默不對的參數。

-- ------------------------------------------------------------------ 新欄位
alter table public.trip_plans
  add column if not exists request_hold_hours numeric not null default 12;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass
       and conname = 'trip_plans_request_hold_hours_ck'
  ) then
    -- 上限 168 小時（7 天）：純粹防呆（避免打字打成 1200），不是產品裁示的
    -- 業務上限；決策文件本身沒有替它劃一個硬上限。
    alter table public.trip_plans
      add constraint trip_plans_request_hold_hours_ck
      check (request_hold_hours > 0 and request_hold_hours <= 168);
  end if;
end $$;

comment on column public.trip_plans.request_hold_hours is
  'REQUEST 訂單被導遊接受後的預設付款保留時數（2026-09-14 owner decision，預設 12）。'
  '單一設定來源；accept_tour_request 用它算 hold_expires_at，接受當下可被覆寫但不回頭改本欄位。';

alter table public.tour_orders
  add column if not exists seats_reserved boolean not null default true;

comment on column public.tour_orders.seats_reserved is
  '這筆訂單目前是否真的佔著 trip_departures 的名額。非 REQUEST 訂單與既有資料一律
   true（建單當下就鎖位，原本即成立的事實）；REQUEST 訂單建立時為 false，直到導遊
   透過 accept_tour_request 接受才轉 true——18 分冊 §0.2「送出申請不鎖導遊時間」。';

-- ------------------------------------------------------- create_tour_order：分流
-- 簽章與 0087／0110 完全相同，只換函式本體，維持 create or replace 是「替換」
-- 而不是新增 overload（0099 的教訓）。
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
  -- 建單當下就原子扣減，扣不到就整個交易回滾、不留下空單。
  v_should_reserve := coalesce(v_plan.sales_mode, 'FIXED_DEPARTURE') <> 'REQUEST';
  if v_should_reserve then
    perform public.reserve_seats(p_departure, p_party_size);
  end if;

  insert into public.tour_orders (
    tenant_id, order_no, trip_id, plan_id, departure_id, customer_id,
    party_size, unit_price, total_amount, deposit_amount, contact,
    source, payment_method_id, note, hold_expires_at, seats_reserved
  ) values (
    p_tenant, p_order_no, v_dep.trip_id, v_dep.plan_id, p_departure, p_customer,
    p_party_size, v_unit, v_total, v_deposit, coalesce(p_contact, '{}'::jsonb),
    p_source, p_payment_method, coalesce(p_note, ''), p_hold_expires, v_should_reserve
  ) returning id into v_id;

  return v_id;
end; $$ language plpgsql security definer set search_path = public;

-- ------------------------------------------------------- accept_tour_request
create or replace function public.accept_tour_request(
  p_tenant     uuid,
  p_order      uuid,
  p_hold_hours numeric
) returns uuid as $$
declare
  v_order  record;
  v_hours  numeric;
begin
  -- for update 拿 row lock：「原子重查 availability」在同一個鎖的保護範圍內完成，
  -- 不是先讀一次狀態、再另外呼叫 reserve_seats（那中間仍有時間差）。
  select o.id, o.status, o.departure_id, o.party_size, o.seats_reserved,
         p.sales_mode, p.request_hold_hours
    into v_order
    from public.tour_orders o
    join public.trip_plans p on p.id = o.plan_id and p.tenant_id = o.tenant_id
   where o.id = p_order and o.tenant_id = p_tenant
   for update of o;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 只有「還在等待導遊決定的 REQUEST 申請」才能被接受。不合條件一律
  -- ORDER_NOT_ELIGIBLE，不做任何資料變更——這條擋掉的典型情境是重複按接受
  -- （已經是 CONFIRMED）與對非 REQUEST 方案誤呼叫這支 rpc。
  if v_order.status <> 'PENDING' or v_order.sales_mode <> 'REQUEST' then
    raise exception 'ORDER_NOT_ELIGIBLE' using errcode = 'P0010';
  end if;

  -- 尚未鎖位才鎖：`reserve_seats` 名額不夠時自己 raise SEATS_UNAVAILABLE，
  -- 整個呼叫（含下面還沒執行到的 update）回滾，訂單維持 PENDING 不動。
  -- 已經是 true 的情況只發生在本檔套用前就存在的既有 REQUEST 訂單（修法前的
  -- create_tour_order 一律鎖位）——把既有事實接上新狀態機，不重複鎖一次。
  if not v_order.seats_reserved then
    perform public.reserve_seats(v_order.departure_id, v_order.party_size);
  end if;

  -- 付款保留時數：接受動作可覆寫；未覆寫則用 Plan 的預設（單一設定來源，
  -- 2026-09-14 owner decision）。算出來的具體時間點在下面 update 一次寫死，
  -- 之後 Plan 改預設值不回頭改這一筆。
  v_hours := coalesce(p_hold_hours, v_order.request_hold_hours);
  if v_hours is null or v_hours <= 0 then
    raise exception 'INVALID_HOLD_HOURS' using errcode = 'P0011';
  end if;

  -- `numeric * interval` 沒有直接運算子，`make_interval` 的 hours 參數又是
  -- `int`（不接受小數）。轉成 `double precision` 再乘 `interval '1 hour'` 兩者
  -- 都支援，且能保留小數小時（例如 0.5 小時＝30 分鐘）。
  update public.tour_orders
     set status = 'CONFIRMED',
         seats_reserved = true,
         hold_expires_at = now() + (v_hours::double precision * interval '1 hour'),
         updated_at = now()
   where id = p_order and tenant_id = p_tenant;

  return p_order;
end; $$ language plpgsql security definer set search_path = public;

-- ------------------------------------------------------- reject_tour_request
create or replace function public.reject_tour_request(
  p_tenant uuid,
  p_order  uuid,
  p_reason text
) returns boolean as $$
declare
  v_order record;
begin
  select o.id, o.status, o.departure_id, o.party_size, o.seats_reserved, p.sales_mode
    into v_order
    from public.tour_orders o
    join public.trip_plans p on p.id = o.plan_id and p.tenant_id = o.tenant_id
   where o.id = p_order and o.tenant_id = p_tenant
   for update of o;

  if not found then
    return false;
  end if;

  if v_order.status <> 'PENDING' or v_order.sales_mode <> 'REQUEST' then
    return false;
  end if;

  update public.tour_orders
     set status = 'CANCELLED',
         cancel_reason = coalesce(p_reason, ''),
         updated_at = now()
   where id = p_order and tenant_id = p_tenant;

  -- 只有真的鎖著名額（既有資料的既成事實）才釋放；修好之後新建的 REQUEST
  -- 訂單在這裡永遠是 false，本來就沒鎖過，呼叫 release_seats 會憑空放出名額。
  if v_order.seats_reserved then
    perform public.release_seats(v_order.departure_id, v_order.party_size);
  end if;

  return true;
end; $$ language plpgsql security definer set search_path = public;

-- --------------------------------------------------------------------- ACL
-- 同 0088／0100：security definer 繞過 RLS，只能由 server 端 service_role 呼叫。
-- 先 revoke all from public 再個別 grant，PostgreSQL 對新函式預設
-- `GRANT EXECUTE TO PUBLIC`，只 revoke anon/authenticated 不夠（PB-028）。
revoke all on function public.accept_tour_request(uuid, uuid, numeric) from public;
revoke all on function public.accept_tour_request(uuid, uuid, numeric) from anon, authenticated;
grant execute on function public.accept_tour_request(uuid, uuid, numeric) to service_role;

revoke all on function public.reject_tour_request(uuid, uuid, text) from public;
revoke all on function public.reject_tour_request(uuid, uuid, text) from anon, authenticated;
grant execute on function public.reject_tour_request(uuid, uuid, text) to service_role;

-- =============================================================================
-- 後置斷言（PB-026／PB-033）
-- =============================================================================
do $$
declare
  v_n    int;
  v_args text;
  v_def  text;
  v_acl  text;
begin
  -- ① create_tour_order 仍然唯一，且簽章與 0087/0099 canonical 完全相同——
  -- 這是本檔最重要的一條：本檔的整個安全論證建立在「沒有新建 overload」上。
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';
  if v_n <> 1 then
    raise exception '0111 後置斷言失敗——create_tour_order 應唯一，實際 % 個（>1 代表本檔的 create or replace 意外多建了一個 overload，會 PGRST203）', v_n;
  end if;

  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';
  if v_args <> 'p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone' then
    raise exception '0111 後置斷言失敗——create_tour_order 的簽章被改動，不是 0099 canonical：%', v_args;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';
  -- ⚠️ 這裡不能直接找 `sales_mode\s*<>\s*'REQUEST'`：實際寫法是
  -- `v_should_reserve := coalesce(v_plan.sales_mode, ...) <> 'REQUEST'`，
  -- `sales_mode` 與 `<>` 之間隔著 `coalesce(...)` 的其餘引數，不是相鄰 token。
  -- 分開找三個關鍵字比找一句連續字串更耐重構，也更誠實地反映「這裡到底在
  -- 檢查什麼」——這條斷言真正要防的是「分流邏輯被拿掉」，不是「特定寫法沒變」。
  if v_def !~* 'v_should_reserve' or v_def !~* 'sales_mode' or v_def !~* '''REQUEST''' then
    raise exception '0111 後置斷言失敗——create_tour_order 沒有依 sales_mode 分流，REQUEST 訂單仍會在建單當下鎖名額';
  end if;
  if v_def !~* 'if\s+v_should_reserve\s+then' then
    raise exception '0111 後置斷言失敗——create_tour_order 沒有依分流結果決定要不要呼叫 reserve_seats';
  end if;

  -- ② accept_tour_request：三個前提都要在鎖的保護範圍內求值，而且真的會呼叫
  -- reserve_seats（不是只改狀態、假裝鎖了名額）。
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_tour_request';
  if v_def is null then
    raise exception '0111 後置斷言失敗——accept_tour_request 未建立';
  end if;
  if v_def !~* 'for update' then
    raise exception '0111 後置斷言失敗——accept_tour_request 沒有取得 row lock';
  end if;
  if v_def !~* 'status\s*<>\s*''PENDING''' then
    raise exception '0111 後置斷言失敗——accept_tour_request 少了 PENDING 前提檢查';
  end if;
  if v_def !~* 'sales_mode\s*<>\s*''REQUEST''' then
    raise exception '0111 後置斷言失敗——accept_tour_request 少了 sales_mode=REQUEST 前提檢查';
  end if;
  if v_def !~* 'reserve_seats' then
    raise exception '0111 後置斷言失敗——accept_tour_request 沒有呼叫 reserve_seats，等於沒有真的重查並鎖名額';
  end if;
  if v_def !~* 'interval\s+''1 hour''' then
    raise exception '0111 後置斷言失敗——accept_tour_request 沒有把保留期限算成具體 snapshot 時間';
  end if;

  select p.proacl::text into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_tour_request';
  if v_acl is null or v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception '② accept_tour_request 的權限不正確（仍對 anon/authenticated 開放，或 ACL 為 NULL）：%', v_acl;
  end if;
  if v_acl not like '%service_role=X%' then
    raise exception '② accept_tour_request 的 service_role 執行權被誤撤：%', v_acl;
  end if;

  -- ③ reject_tour_request：只在 seats_reserved 為真時才釋放名額。
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_tour_request';
  if v_def is null then
    raise exception '0111 後置斷言失敗——reject_tour_request 未建立';
  end if;
  if v_def !~* 'for update' then
    raise exception '0111 後置斷言失敗——reject_tour_request 沒有取得 row lock';
  end if;
  if v_def !~* 'seats_reserved' then
    raise exception '0111 後置斷言失敗——reject_tour_request 沒有依 seats_reserved 判斷要不要釋放名額，可能憑空多放一次';
  end if;

  select p.proacl::text into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_tour_request';
  if v_acl is null or v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception '③ reject_tour_request 的權限不正確（仍對 anon/authenticated 開放，或 ACL 為 NULL）：%', v_acl;
  end if;
  if v_acl not like '%service_role=X%' then
    raise exception '③ reject_tour_request 的 service_role 執行權被誤撤：%', v_acl;
  end if;

  -- ④ 欄位型別真的長成我要的樣子（PB-026）。
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.trip_plans'::regclass
       and a.attname = 'request_hold_hours' and not a.attisdropped and a.attnum > 0
       and a.atttypid = 'numeric'::regtype
  ) then
    raise exception '0111 後置斷言失敗——trip_plans.request_hold_hours 不存在或型別不符';
  end if;
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.tour_orders'::regclass
       and a.attname = 'seats_reserved' and not a.attisdropped and a.attnum > 0
       and a.atttypid = 'boolean'::regtype
  ) then
    raise exception '0111 後置斷言失敗——tour_orders.seats_reserved 不存在或型別不符';
  end if;

  -- ⑤ 反向：不得動到既有的 reserve_seats / release_seats / cancel_tour_order /
  -- expire_tour_order。
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in
       ('reserve_seats', 'release_seats', 'cancel_tour_order', 'expire_tour_order')
     group by 1 having count(*) = 4
  ) then
    raise exception '0111 後置斷言失敗——reserve_seats/release_seats/cancel_tour_order/expire_tour_order 其中一支不見了';
  end if;
end $$;
