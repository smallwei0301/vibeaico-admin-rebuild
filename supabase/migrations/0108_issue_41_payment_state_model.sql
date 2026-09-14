-- =============================================================================
-- 0108 — #41 成團生命週期：付款狀態模型（canonical）
-- =============================================================================
-- 依 `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §4。
--
-- ## 這一片做什麼、不做什麼
--
-- **做**：把「訂單狀態」與「付款狀態」分開這件事在資料庫層補齊——`tour_orders`
-- 目前只有 `UNPAID/PAID/REFUNDED` 三種付款狀態、只有 `paid_amount` 一個實收金額
-- 欄位（0087:98 明確寫下這些屬 #41、延到本檔）。本檔補上 §4 要求的
-- `PARTIAL`／`REFUND_PENDING` 與 `upfront_required_amount`／`refunded_amount`／
-- `deposit_mode_snapshot`。
--
-- **不做**：§5–§6 的自動推進 transaction、§7 通知事件、§8 金流 credentials、§9
-- 退款流程。那些是後續切片，本檔只建立它們必須寫入的欄位與不變量。
--
-- ## 為什麼用 `add column if not exists` 而且還要後置斷言
--
-- PB-026：`0087` 的 `create table if not exists public.tour_orders` 在 local-isolated
-- 曾是 no-op——historical overlay 早就建過同名表，欄位不同。於是程式對著 overlay
-- 的契約寫入，migration 本身「成功」了但欄位長得不一樣。「套用成功」與「欄位真的
-- 長成我要的樣子」是兩件事，且在套用日誌上無法區分，因此本檔沿用 0107 的做法：
-- 最後一段 post-assertion 逐項查系統目錄，任何一項不符就 raise。
-- =============================================================================

-- ------------------------------------------------------------------ 付款狀態值域
-- 18 分冊 §4：訂單狀態（PENDING/CONFIRMED/COMPLETED/CANCELLED）與付款狀態分開。
-- 付款狀態目前只有 UNPAID/PAID/REFUNDED（0087），補上 PARTIAL 與 REFUND_PENDING。
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'tour_payment_status'
  ) then
    create type public.tour_payment_status as enum (
      'UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED'
    );
  else
    execute 'alter type public.tour_payment_status add value if not exists ''UNPAID''';
    execute 'alter type public.tour_payment_status add value if not exists ''PARTIAL''';
    execute 'alter type public.tour_payment_status add value if not exists ''PAID''';
    execute 'alter type public.tour_payment_status add value if not exists ''REFUND_PENDING''';
    execute 'alter type public.tour_payment_status add value if not exists ''REFUNDED''';
  end if;
end $$;

-- -------------------------------------------------------------- tour_orders 欄位
-- 18 分冊 §4：transaction snapshot 需要保留「當初要收多少訂金／全額」、「實際退了
-- 多少」，以及成交當下的收款政策快照（Plan 日後改價、改訂金比例，不回頭重算舊單）。
alter table public.tour_orders
  add column if not exists upfront_required_amount numeric not null default 0,
  add column if not exists refunded_amount numeric not null default 0,
  add column if not exists deposit_mode_snapshot text;

-- 約束只在「本檔的名字」與「同用途的 historical 名字」都不存在時才建：兩邊同時掛
-- 會變成同一條規則有兩份定義，日後只改了一邊就會出現「兩個約束互相矛盾」的死結
-- （沿用 0087 的既有慣例）。
do $$
begin
  -- upfront_required_amount 必須落在 [0, total_amount]：不能要求收超過訂單總額
  -- 的頭期款，也不能是負數。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_upfront_required_amount_ck'
  ) and not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_upfront_amount_bounds'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_upfront_required_amount_ck
      check (upfront_required_amount >= 0 and upfront_required_amount <= total_amount);
  end if;

  -- refunded_amount 必須落在 [0, paid_amount]：退款不能超過實際收到的錢，這是
  -- 18 分冊 §9.3 的平台固定底線（「退款／扣款不得形成負數、重複計算或超過實際已
  -- 付款」）在資料庫層的落實，不是可協商的商業偏好。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_refunded_amount_ck'
  ) and not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_refunded_amount_bounds'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_refunded_amount_ck
      check (refunded_amount >= 0 and refunded_amount <= paid_amount);
  end if;

  -- deposit_mode_snapshot 與 0066 的 trip_plans.deposit_mode 是同一個值域；成交時
  -- snapshot 下來，Plan 日後改收款政策不污染舊單。null = 建單當時尚未補這個欄位。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_deposit_mode_snapshot_ck'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_deposit_mode_snapshot_ck
      check (deposit_mode_snapshot is null
        or deposit_mode_snapshot in ('NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL'));
  end if;

  -- PARTIAL 必須誠實：已收了一部分、但還沒收齊。paid_amount = 0 或
  -- paid_amount = total_amount 都不該被標成 PARTIAL——前者根本還沒收錢，後者
  -- 應該是 PAID。
  -- ⚠️ 這兩條 CHECK 刻意寫成 `payment_status::text <> '…'`，不是
  --    `payment_status <> '…'`。PostgreSQL 規定：**同一個交易內以
  --    `alter type … add value` 新增的 enum 值，不能在該交易內被使用**，否則
  --    `unsafe use of new value "PARTIAL" of enum type`。Supabase CLI 預設把每支
  --    migration 包在一個交易裡，而本檔上方才剛新增這兩個值——在 historical
  --    overlay 的安裝路徑上那是真的新增（overlay 的 0026 只建了三個值），不是
  --    no-op。把欄位轉成 text 之後，字面值就只是字串，不會被解析成 enum label。
  --
  --    0087 用同樣的 `payment_status <> 'PAID'` 寫法卻沒事，是因為 'PAID' 在
  --    overlay 上早就存在，它那次 add value 是 no-op——沒有新值被引入，自然沒有
  --    不安全使用。差別在「這個值是不是本交易新增的」，不在寫法本身。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_partial_paid_amount_ck'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_partial_paid_amount_ck
      check (payment_status::text <> 'PARTIAL' or (paid_amount > 0 and paid_amount < total_amount));
  end if;

  -- REFUND_PENDING：18 分冊 §9.3「REFUND_PENDING 不可顯示成 REFUNDED」的前提是
  -- REFUND_PENDING 本身必須代表「確實收過錢、正在退款中」，不能是一筆從未收款
  -- 的訂單被誤標。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_refund_pending_paid_amount_ck'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_refund_pending_paid_amount_ck
      check (payment_status::text <> 'REFUND_PENDING' or paid_amount > 0);
  end if;
end $$;

comment on column public.tour_orders.upfront_required_amount is
  '18 分冊 §4：成交當下要求收多少頭期款（訂金或全額）的 snapshot，Plan 日後改收款政策不回頭重算舊單。';
comment on column public.tour_orders.refunded_amount is
  '18 分冊 §4／§9.3：實際已退款金額；不得為負、不得超過 paid_amount。';
comment on column public.tour_orders.deposit_mode_snapshot is
  '18 分冊 §4：成交當下 trip_plans.deposit_mode 的 snapshot，值域與 0066 的 deposit_mode 相同。';

-- =============================================================================
-- 後置斷言：套用成功 ≠ 欄位真的長成這樣（PB-026）
-- =============================================================================
do $$
declare
  missing text;
begin
  -- 1. 付款狀態 enum 的值域完全正確（不多不少）。先查它，因為第 2 步的型別比對
  --    要用到 tour_payment_status 這個型別本身是否存在、是否為預期名稱。
  if (
    select array_agg(e.enumlabel::text order by e.enumlabel)
      from pg_enum e join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'tour_payment_status'
  ) is distinct from array['PAID', 'PARTIAL', 'REFUND_PENDING', 'REFUNDED', 'UNPAID'] then
    raise exception '0108 後置斷言失敗——tour_payment_status 的值域不是 18 分冊 §4 的那五個。';
  end if;

  -- 2. 欄位存在且型別正確。比對用 `regtype` 的 OID，不用 `format_type()` 的字串
  --    （0107 的教訓：`format_type()` 依 search_path 決定要不要加 schema 前綴，
  --    拿拼寫去比會在欄位其實完全正確的情況下誤報，那比沒有斷言更糟）。
  select string_agg(expected.col, ', ') into missing
    from (values
      ('tour_orders', 'upfront_required_amount', 'numeric'),
      ('tour_orders', 'refunded_amount', 'numeric'),
      ('tour_orders', 'deposit_mode_snapshot', 'text'),
      ('tour_orders', 'paid_amount', 'numeric')
    ) as expected(tbl, col, typ)
   where not exists (
     select 1 from pg_attribute a
      where a.attrelid = ('public.' || expected.tbl)::regclass
        and a.attname = expected.col
        and not a.attisdropped
        and a.attnum > 0
        and a.atttypid = expected.typ::regtype
   );
  if missing is not null then
    raise exception '0108 後置斷言失敗——以下欄位不存在或型別不符：%。這通常代表 historical overlay 已先建過同名物件，導致本檔的 add column 變成 no-op（PB-026）。', missing;
  end if;

  -- 3. 五個新 CHECK 都在，而且內容真的是我要的那一條。
  select string_agg(expected.name, ', ') into missing
    from (values
      ('tour_orders', 'tour_orders_upfront_required_amount_ck', '%upfront_required_amount%'),
      ('tour_orders', 'tour_orders_refunded_amount_ck', '%refunded_amount%'),
      ('tour_orders', 'tour_orders_deposit_mode_snapshot_ck', '%DEPOSIT_PERCENT%'),
      ('tour_orders', 'tour_orders_partial_paid_amount_ck', '%PARTIAL%'),
      ('tour_orders', 'tour_orders_refund_pending_paid_amount_ck', '%REFUND_PENDING%')
    ) as expected(tbl, name, fragment)
   where not exists (
     select 1 from pg_constraint c
      where c.conrelid = ('public.' || expected.tbl)::regclass
        and c.conname = expected.name
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like expected.fragment
   );
  if missing is not null then
    raise exception '0108 後置斷言失敗——以下 CHECK 不存在或內容不符：%。', missing;
  end if;

  -- 4. paid_amount 沒有被本檔動過——0087 已經定義它的型別與既有 CHECK，本檔只
  --    是在旁邊加新欄位，不得移除或改寫既有的實收金額欄位。
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.tour_orders'::regclass and attname = 'paid_amount' and not attisdropped
  ) then
    raise exception '0108 後置斷言失敗——tour_orders.paid_amount 不見了。本檔應該只新增 upfront_required_amount／refunded_amount／deposit_mode_snapshot，不得移除或改寫既有的實收金額欄位。';
  end if;
end $$;
