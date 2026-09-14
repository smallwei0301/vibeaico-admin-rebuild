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

-- M2（Final Risk 2026-09-14）：UNPAID 但 paid_amount > 0 的訂單語意上根本不是
-- 「未付款」——它應該是 PARTIAL 或 PAID，繼續讓 UI 顯示「未付款」是說謊。0087
-- 當時只顧到 PAID 那一側（見上方 tour_orders_paid_amount_consistent），PARTIAL
-- 在本檔才出現，UNPAID 這一側的誠實檢查因此一直缺。跟 0107 對 capacity<1 的
-- 既有資料一樣：migration 不會替違規列決定一個新狀態，發現就整段中止。
do $$
declare
  bad_rows int;
begin
  select count(*) into bad_rows
    from public.tour_orders
   where payment_status::text = 'UNPAID' and paid_amount <> 0;
  if bad_rows > 0 then
    raise exception '0108 無法加上 UNPAID 誠實 CHECK：有 % 筆既有 tour_orders 標成 UNPAID 卻 paid_amount <> 0。這些列語意上是 PARTIAL 或 PAID，請先修正它們的 payment_status，本 migration 不會替它們決定一個狀態。', bad_rows;
  end if;
end $$;

-- 約束只在「本檔的名字」不存在時才建，避免重跑時撞名。
--
-- ⚠️ 這裡原本還多掛了一組「同用途的 historical 名字」skip 條件
-- （`tour_orders_upfront_amount_bounds` / `tour_orders_refunded_amount_bounds`），
-- 是沿用 0087 對 `tour_orders_payment_amounts_nonnegative` 的既有慣例寫的。但那組
-- 慣例存在是因為 0087 的名字**真的**在 historical overlay 出現過（0087 的註解與
-- `supabase/local-migrations/**` 都查得到）。這兩個 `_bounds` 名字反查
-- `supabase/**` 全庫零命中——它們不對應任何已知的 historical overlay 物件，是
-- 複製慣例時多寫的防禦，不是真的有這麼一個環境。Final Risk 覆核（claude-fable-5-1，
-- 2026-09-14）指出這段死碼；既然找不到會用到它的環境，予以移除而非保留猜測。
do $$
begin
  -- upfront_required_amount 必須落在 [0, total_amount]：不能要求收超過訂單總額
  -- 的頭期款，也不能是負數。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_upfront_required_amount_ck'
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

  -- M1（Final Risk 2026-09-14）：REFUNDED 必須誠實——「已退款」的前提是「曾經
  -- 收過錢，而且真的退了」。修正前接受 payment_status='REFUNDED' + paid_amount=0
  -- + refunded_amount=0，也就是一筆從未收款的訂單自稱「已退款」，是同一種假宣稱
  -- （見 0087 對 PAID 的既有告誡：畫面說了，資料庫裡卻沒有金額佐證）。
  --
  -- ⚠️ 沿用上面 PARTIAL／REFUND_PENDING 兩條的 `payment_status::text <> '…'`
  -- 寫法，即使 REFUNDED 本身不是本檔新增的標籤（0087 就有），理由是保持本檔
  -- 內部一致：同一個檔案的付款狀態 CHECK 只要有一種安全寫法，就不要讓維護者
  -- 得先分辨「這個標籤是不是新加的」才知道能不能省略 ::text——那個判斷本身
  -- 就是上面那段長註解在講的陷阱來源，讓所有人一律用安全寫法比較不會出錯。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_refunded_paid_amount_ck'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_refunded_paid_amount_ck
      check (payment_status::text <> 'REFUNDED' or (paid_amount > 0 and refunded_amount > 0));
  end if;

  -- M2（Final Risk 2026-09-14）：UNPAID 必須誠實——見上方的既有資料前置檢查。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_unpaid_amount_ck'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_unpaid_amount_ck
      check (payment_status::text <> 'UNPAID' or paid_amount = 0);
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
  --    刻意**不**用 `array_agg(... order by e.enumlabel)` 去比一個手寫的有序陣列。
  --    第一版那樣寫，被 CI 的 fresh-install replay 擋下來：`pg_enum.enumlabel` 的
  --    型別是 `name`，它的排序走 C collation，於是 'REFUNDED' 會排在
  --    'REFUND_PENDING' **之前**（共同前綴 'REFUND' 之後比 'E'=0x45 與 '_'=0x5F），
  --    而手寫的期望陣列把兩者寫反了。更糟的是，換一個 collation 的資料庫可能又
  --    是另一個順序——一條會隨環境變動的斷言，不是保證，是定時炸彈。
  --
  --    改成比對**集合**：數量剛好五個，且沒有任何一個值落在預期集合之外。
  --    完全不依賴排序規則。
  select string_agg(e.enumlabel::text, ', ' order by e.enumlabel::text) into missing
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'tour_payment_status'
     and e.enumlabel::text not in ('UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED');
  if missing is not null then
    raise exception
      '0108 後置斷言失敗——tour_payment_status 出現 18 分冊 §4 以外的值：%', missing;
  end if;

  if (
    select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'tour_payment_status'
  ) <> 5 then
    raise exception
      '0108 後置斷言失敗——tour_payment_status 的值不是五個（18 分冊 §4 要求 UNPAID／PARTIAL／PAID／REFUND_PENDING／REFUNDED）。';
  end if;

  -- 2. 欄位存在、型別正確、而且 nullability 也對。比對型別用 `regtype` 的 OID，
  --    不用 `format_type()` 的字串（0107 的教訓：`format_type()` 依 search_path
  --    決定要不要加 schema 前綴，拿拼寫去比會在欄位其實完全正確的情況下誤報，
  --    那比沒有斷言更糟）。
  --
  --    ⚠️ I1（Final Risk 2026-09-14）：只比對 `atttypid` 抓不住「型別對、但
  --    nullable 不對」的殘留欄位——`add column if not exists` 遇到一個同名同型別
  --    但可為 null 的既有欄位會直接 no-op，不會補上 `not null`，而本檔上面所有
  --    數字欄位的誠實 CHECK 全部假設它們一定有值（`upfront_required_amount >= 0`
  --    這類比較式在欄位是 null 時整條 CHECK 直接評估成 unknown、被當成通過，
  --    等於誠實檢查形同虛設）。2026-09-14 實查 shared TEST，`trip_departures.
  --    formation_status` 正是這個形狀——型別對但 nullable，來自 historical
  --    overlay——不是假設性風險。三個數字欄位補上 `a.attnotnull = true`；
  --    `deposit_mode_snapshot` 設計上本來就允許 null（見上方欄位註解「未補這個
  --    欄位的舊資料」），維持 false，不能對它也要求 not null。
  select string_agg(expected.col, ', ') into missing
    from (values
      ('tour_orders', 'upfront_required_amount', 'numeric', true),
      ('tour_orders', 'refunded_amount', 'numeric', true),
      ('tour_orders', 'deposit_mode_snapshot', 'text', false),
      ('tour_orders', 'paid_amount', 'numeric', true)
    ) as expected(tbl, col, typ, want_notnull)
   where not exists (
     select 1 from pg_attribute a
      where a.attrelid = ('public.' || expected.tbl)::regclass
        and a.attname = expected.col
        and not a.attisdropped
        and a.attnum > 0
        and a.atttypid = expected.typ::regtype
        and a.attnotnull = expected.want_notnull
   );
  if missing is not null then
    raise exception '0108 後置斷言失敗——以下欄位不存在、型別不符或 nullability 不符：%。這通常代表 historical overlay 已先建過同名物件，導致本檔的 add column 變成 no-op（PB-026）。', missing;
  end if;

  -- 3. 七個新 CHECK 都在，而且內容真的是我要的那一條。
  --
  --    ⚠️（Final Risk 2026-09-14，原斷言是空殼）：改版前每條只比對一個 `like`
  --    片段（例如 `%PARTIAL%`），而一個被掏空成 `check (payment_status::text <>
  --    'PARTIAL' or true)` 的 CHECK——語法合法、完全不擋任何資料——照樣含有
  --    'PARTIAL' 這個字，照樣通過那條斷言。單一片段測的是「這個標籤字串還在
  --    constraint 定義裡」，不是「這條不變量真的還在擋東西」，兩者是不同的
  --    斷言，原本的寫法在斷言名稱上宣稱做到後者，實際只做到前者。
  --
  --    改成每條 CHECK 配一組片段、**全部**都要在 `pg_get_constraintdef()` 的
  --    輸出裡命中才算數（`bool_and`）：不只比對狀態標籤本身，也比對金額比較式
  --    的兩側（欄位名＋運算子）。下面每組片段旁邊的註解寫的是「這組片段現在能
  --    多擋住什麼樣的掏空版本」，不是重複描述 CHECK 本身要做什麼。
  select string_agg(expected.name, ', ') into missing
    from (values
      -- 只有 '%PARTIAL%' 擋不住 `check (... 'PARTIAL' or true)`；加上兩側的
      -- 金額比較式之後，任何拿掉 `paid_amount > 0` 或 `paid_amount < total_amount`
      -- 其中一半的掏空版本都會在這裡落網。
      ('tour_orders', 'tour_orders_partial_paid_amount_ck',
        array['%PARTIAL%', '%paid_amount > %', '%paid_amount < total_amount%']),
      -- 同理：只有 '%REFUND_PENDING%' 擋不住把 `paid_amount > 0` 拿掉的掏空版本。
      ('tour_orders', 'tour_orders_refund_pending_paid_amount_ck',
        array['%REFUND_PENDING%', '%paid_amount > %']),
      -- M1 新增：REFUNDED 必須同時比對「有收過款」與「有退過款」兩側，否則
      -- `check (... 'REFUNDED' or paid_amount > 0)`（漏掉 refunded_amount 那半）
      -- 一樣會被判定成合法。
      ('tour_orders', 'tour_orders_refunded_paid_amount_ck',
        array['%REFUNDED%', '%paid_amount > %', '%refunded_amount > %']),
      -- M2 新增：UNPAID 必須比對到 `paid_amount = …` 那個等式本身，不只是
      -- 'UNPAID' 這個字。（Postgres 正規化後 `0` 會變成 `(0)::numeric`，所以
      -- 片段只到 `=` 為止，不釘死字面 `0` 的寫法。）
      ('tour_orders', 'tour_orders_unpaid_amount_ck',
        array['%UNPAID%', '%paid_amount = %']),
      -- upfront_required_amount 的上下界各自需要獨立片段，否則拿掉其中一側的
      -- 邊界（例如只剩 `>= 0`，任意超收頭期款都會通過）測不出來。
      ('tour_orders', 'tour_orders_upfront_required_amount_ck',
        array['%upfront_required_amount >= %', '%upfront_required_amount <= total_amount%']),
      -- refunded_amount 同理，且上界必須真的是 `paid_amount`（不能被悄悄換成
      -- `total_amount`——那會允許退款超過實收金額，正是 §9.3 要擋的事）。
      ('tour_orders', 'tour_orders_refunded_amount_ck',
        array['%refunded_amount >= %', '%refunded_amount <= paid_amount%']),
      -- deposit_mode_snapshot 除了值域字串，也要求「is null」那個分支還在——
      -- 拿掉它會讓舊資料（null）全部無法通過本 CHECK，屬於另一種掏空（過嚴）。
      ('tour_orders', 'tour_orders_deposit_mode_snapshot_ck',
        array['%DEPOSIT_PERCENT%', '%deposit_mode_snapshot IS NULL%'])
    ) as expected(tbl, name, fragments)
   where not exists (
     select 1 from pg_constraint c
      where c.conrelid = ('public.' || expected.tbl)::regclass
        and c.conname = expected.name
        and c.contype = 'c'
        and (
          select bool_and(pg_get_constraintdef(c.oid) like frag)
            from unnest(expected.fragments) as frag
        )
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
