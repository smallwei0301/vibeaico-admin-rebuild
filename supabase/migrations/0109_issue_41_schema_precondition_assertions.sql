-- =============================================================================
-- 0109 — #41 schema precondition assertions（PB-026 的變形：補「依賴」而非「新增」的斷言）
-- =============================================================================
-- 背景見 `docs/schema-truth/2026-09-14-test-orphan-tour-order-triggers.md`（第二項
-- 漂移：TEST 上 `tour_orders.payment_status` 是 `text`，不是 canonical 0087:71 宣告
-- 的 `public.tour_payment_status`）。
--
-- 0108 花了整支 migration 在替 `tour_payment_status` 補 `PARTIAL`／`REFUND_PENDING`
-- 兩個 label，並加上一組以 `payment_status` 為前提的誠實 CHECK。它的後置斷言
-- （同一份 PB-026 教訓：套用成功 ≠ 欄位真的長成這樣）只檢查了**本檔新增的三個
-- 欄位**（upfront_required_amount / refunded_amount / deposit_mode_snapshot）的型別
-- 與 nullability，卻沒有檢查自己整支檔案都依賴的那個前提——`payment_status` 本身
-- 是不是真的是那個 enum。於是 0108 在一個把 `payment_status` 換成 `text` 的環境上
-- 完整套用成功、零告警。這支檔案要修的正是這個模式：**後置斷言只檢查自己新增的
-- 東西，不檢查自己所依賴的東西。**
--
-- 同一類缺口的第二個例子：`0107`／`0108` 的後置斷言都比對型別與 nullability，但
-- 都沒比對 default。`trip_departures.min_to_depart_snapshot`（0107）曾在某個環境
-- 上是 not null 卻沒有 default，同樣沒有被任何斷言抓到——因為 `add column if not
-- exists` 對已存在的同名欄位是 no-op，不會補上型別、nullability 或 default 任何一項。
--
-- ## 設計原則：canonical／overlay／Production 上必須是 no-op
--
-- 三邊查證過的事實（同一份 schema-truth 文件）：canonical `0087:71`、overlay
-- `historical-integration-baseline/0026:99`、Production（`egehnijjpgijmccagxac`）的
-- `tour_orders.payment_status` 本來就是 `public.tour_payment_status`。也就是說本檔
-- 第一段「前置修復」在那三邊全部走「已經是 enum，什麼都不做」那條路徑；只有當一個
-- 環境被人工改成別的形狀（就像目前的 TEST）時，這支檔案才會真的有動作，而且只有
-- 在改動安全時才動——資料不乾淨就整段中止，讓人先確認，不猜。這一點決定了下面每
-- 一段該長什麼樣：修復段落必須能在「已經是 canonical 形狀」時安全地什麼都不做，
-- 斷言段落必須不管走哪條路徑最後都要成立。
-- =============================================================================

-- =============================================================================
-- 第一段：前置修復——tour_orders.payment_status 的型別
-- =============================================================================
-- 這一段在防什麼：0108 全篇假設 `payment_status` 是 `public.tour_payment_status`，
-- 但從未驗證過這個前提。如果環境上它其實是 `text`（外加一條 CHECK 在頂替值域），
-- 0108 的四條「誠實 CHECK」與本檔第二段的斷言全部會失效或誤判。這裡把前提修回
-- canonical 形狀，而不是讓後面的斷言在一個錯的地基上通過。
do $$
declare
  current_type oid;
  bad_rows     int;
  bad_values   text;
  ck           record;
begin
  select a.atttypid
    into current_type
    from pg_attribute a
   where a.attrelid = 'public.tour_orders'::regclass
     and a.attname = 'payment_status'
     and not a.attisdropped
     and a.attnum > 0;

  if current_type is null then
    raise exception '0109 中止：public.tour_orders.payment_status 欄位不存在，無法判斷前置狀態。';
  elsif current_type = 'public.tour_payment_status'::regtype then
    -- canonical／overlay／Production 走這條：型別本來就對，no-op。
    null;
  elsif current_type = 'text'::regtype then
    -- 只有環境被人工改成 text 時才會進來（2026-09-14 實測的 TEST 正是這個形狀）。
    --
    -- 轉型前先確認表內沒有任何一列的值落在五個合法 label 之外（含 NULL——
    -- `x not in (...)` 對 NULL 值會評估成 unknown、被 WHERE 悄悄濾掉，所以這裡
    -- 用 `is null or ... not in (...)` 明確把 NULL 也算進「不合法」）。
    -- 沿用 0107／0108 對既有資料的一貫態度：發現不乾淨的資料就整段 raise
    -- exception 中止，不替它猜一個值。
    select count(*), string_agg(distinct coalesce(payment_status, '<NULL>'), ', ')
      into bad_rows, bad_values
      from public.tour_orders
     where payment_status is null
        or payment_status not in ('UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED');

    if bad_rows > 0 then
      raise exception
        '0109 無法把 tour_orders.payment_status 由 text 轉型為 public.tour_payment_status：有 % 筆既有資料的值不在五個合法 label（UNPAID／PARTIAL／PAID／REFUND_PENDING／REFUNDED）之內，實際出現的值：%。本 migration 不會替這些列猜一個值，請先確認真實資料並修正後再重新套用。',
        bad_rows, coalesce(bad_values, '(none)');
    end if;

    -- 刪掉所有引用 payment_status 的既有 CHECK。用系統目錄反查定義內容而不是
    -- 硬寫名單，因為 TEST 上出現過一條整個 repo 反查零命中的
    -- `tour_orders_payment_status_check`——名單式作法會漏掉任何尚未被記錄過的
    -- 別名。enum 型別本身就是值域，text 時代用來頂替值域的那條 CHECK 不需要
    -- 加回來（見下方註解）。
    for ck in
      select c.conname
        from pg_constraint c
       where c.conrelid = 'public.tour_orders'::regclass
         and c.contype = 'c'
         and pg_get_constraintdef(c.oid) ilike '%payment_status%'
    loop
      execute format('alter table public.tour_orders drop constraint %I', ck.conname);
    end loop;

    -- 型別轉換前先拿掉舊 default，避免 Postgres 嘗試把一個 text 型別的 default
    -- 表達式套上新型別轉換失敗；轉完型別後再把 default 設回 canonical 形狀。
    alter table public.tour_orders alter column payment_status drop default;
    alter table public.tour_orders
      alter column payment_status type public.tour_payment_status
      using payment_status::public.tour_payment_status;
    alter table public.tour_orders
      alter column payment_status set default 'UNPAID'::public.tour_payment_status;
    -- 上面的前置檢查已排除 NULL，這裡可以安全地補回 not null（若本來就是
    -- not null，這行只是重新驗證一次，不是新增行為）。
    alter table public.tour_orders alter column payment_status set not null;

    -- 依 canonical 逐字加回五條 CHECK。**不**加回 `tour_orders_payment_status_check`
    -- ——enum 型別本身就是值域，那條 CHECK 是 text 時代的替代品，canonical 沒有它。

    -- origin/main:supabase/migrations/0087_issue_8b_tour_orders.sql
    -- （tour_orders_paid_amount_consistent，逐字）
    alter table public.tour_orders
      add constraint tour_orders_paid_amount_consistent
      check (
        paid_amount >= 0
        and paid_amount <= total_amount
        and (payment_status <> 'PAID' or paid_amount = total_amount)
      );

    -- origin/main:supabase/migrations/0108_issue_41_payment_state_model.sql
    -- 以下四條都刻意保留 `payment_status::text <> '…'` 的寫法（逐字），理由見
    -- 0108 的長註解：同一交易內以 `alter type … add value` 新增的 enum 值不能在
    -- 該交易內被當字面值使用；即使本檔的轉型交易並未新增任何 enum 值，維持與
    -- canonical 完全一致的寫法可以避免任何未來維護者需要先判斷「這個標籤是不是
    -- 新加的」才知道能不能省略 `::text`。
    alter table public.tour_orders
      add constraint tour_orders_partial_paid_amount_ck
      check (payment_status::text <> 'PARTIAL' or (paid_amount > 0 and paid_amount < total_amount));

    alter table public.tour_orders
      add constraint tour_orders_refund_pending_paid_amount_ck
      check (payment_status::text <> 'REFUND_PENDING' or paid_amount > 0);

    alter table public.tour_orders
      add constraint tour_orders_refunded_paid_amount_ck
      check (payment_status::text <> 'REFUNDED' or (paid_amount > 0 and refunded_amount > 0));

    alter table public.tour_orders
      add constraint tour_orders_unpaid_amount_ck
      check (payment_status::text <> 'UNPAID' or paid_amount = 0);
  else
    -- 第三種型別：不是 canonical 的 enum，也不是已知的 text 漂移形狀。不嘗試
    -- 轉換——猜一個轉換路徑比停下來問人更危險。
    raise exception
      '0109 中止：tour_orders.payment_status 的型別既不是 public.tour_payment_status 也不是 text（實際型別 oid=%、regtype=%）。這是未知的第三種型別，本 migration 不會嘗試轉換，需要人工判定正確的修復方式。',
      current_type, current_type::regtype;
  end if;
end $$;

-- =============================================================================
-- 第二段：後置斷言——補上 0108 沒斷言的前提（PB-026 的變形）
-- =============================================================================
-- 這一段在防什麼：不管第一段走的是「no-op」還是「修復」那條路徑，離開這支
-- migration 時 `tour_orders.payment_status` 的型別、nullability、default 與
-- `tour_payment_status` 的值域都必須是 canonical 形狀；任何一項不符就中止，而不是
-- 讓 migration「成功套用」但地基是錯的（正是 0108 這次踩到的坑）。
do $$
declare
  status_type    oid;
  status_notnull boolean;
  status_default text;
  missing        text;
begin
  select a.atttypid, a.attnotnull
    into status_type, status_notnull
    from pg_attribute a
   where a.attrelid = 'public.tour_orders'::regclass
     and a.attname = 'payment_status'
     and not a.attisdropped
     and a.attnum > 0;

  if status_type is distinct from 'public.tour_payment_status'::regtype then
    raise exception '0109 後置斷言失敗——tour_orders.payment_status 的型別不是 public.tour_payment_status（實際 regtype=%）。', status_type::regtype;
  end if;

  if status_notnull is distinct from true then
    raise exception '0109 後置斷言失敗——tour_orders.payment_status 必須是 not null，目前不是。';
  end if;

  select pg_get_expr(ad.adbin, ad.adrelid)
    into status_default
    from pg_attrdef ad
    join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.tour_orders'::regclass
     and a.attname = 'payment_status';

  -- 用 `like` 片段而不是整串相等比對：`pg_get_expr()` 是否替 enum 型別加上
  -- `public.` schema 前綴取決於呼叫當下的 search_path，兩種拼法在語意上都是
  -- 「default 是 UNPAID」，字串完全相等比對會在型別其實完全正確時誤報。
  if status_default is null
     or status_default not like '%UNPAID%'
     or status_default not like '%tour_payment_status%' then
    raise exception '0109 後置斷言失敗——tour_orders.payment_status 的 default 期望是 ''UNPAID''::public.tour_payment_status，實際是 %。', coalesce(status_default, '(無 default)');
  end if;

  -- tour_payment_status 的 label 集合必須正好是五個，不多不少。
  --
  -- ⚠️ PB-041：`pg_enum.enumlabel` 型別是 `name`，走 C collation，`REFUNDED` 會
  -- 排在 `REFUND_PENDING` 之前——0108 第一版就是把 `array_agg(... order by
  -- enumlabel)` 拿去跟手寫的有序陣列比對，寫出一條永遠為假的斷言。這裡改用
  -- full outer join 做純集合比對（差集為空），完全不依賴任何排序規則。
  select string_agg(
           case
             when actual.enumlabel is null then '(missing:' || expected.label || ')'
             else '(unexpected:' || actual.enumlabel || ')'
           end,
           ', ')
    into missing
    from (
      select e.enumlabel::text as enumlabel
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typname = 'tour_payment_status'
    ) actual
    full outer join (
      select unnest(array['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED']) as label
    ) expected on expected.label = actual.enumlabel
   where actual.enumlabel is null or expected.label is null;

  if missing is not null then
    raise exception '0109 後置斷言失敗——tour_payment_status 的值域集合與 18 分冊 §4 的 UNPAID／PARTIAL／PAID／REFUND_PENDING／REFUNDED 不完全相同：%。', missing;
  end if;

  if (
    select count(*) from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'tour_payment_status'
  ) <> 5 then
    raise exception '0109 後置斷言失敗——tour_payment_status 的值不是剛好五個。';
  end if;
end $$;

-- =============================================================================
-- 第三段：後置斷言——補上型別／nullability 之外的 default 缺口
-- =============================================================================
-- 這一段在防什麼：`add column if not exists` 對已存在的同名欄位是 no-op，不會
-- 補上 default。0107／0108 的後置斷言都只比對型別與 nullability，從未比對
-- default，於是一個「型別對、nullable 對，但 default 被人工拿掉或改掉」的欄位
-- 可以無聲地通過兩份既有斷言。這裡把 0108 新增的三個欄位（tour_orders）與 0107
-- 曾經在某環境上漏掉 default 的 `min_to_depart_snapshot` 一併補上斷言。
do $$
declare
  d text;
begin
  -- upfront_required_amount：canonical 0108 `add column ... not null default 0`。
  select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.tour_orders'::regclass and a.attname = 'upfront_required_amount';
  if d is distinct from '0' then
    raise exception '0109 後置斷言失敗——tour_orders.upfront_required_amount 的 default 期望是 0，實際是 %。', coalesce(d, '(無 default)');
  end if;

  -- refunded_amount：canonical 0108 `add column ... not null default 0`。
  select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.tour_orders'::regclass and a.attname = 'refunded_amount';
  if d is distinct from '0' then
    raise exception '0109 後置斷言失敗——tour_orders.refunded_amount 的 default 期望是 0，實際是 %。', coalesce(d, '(無 default)');
  end if;

  -- deposit_mode_snapshot：canonical 0108 `add column ... deposit_mode_snapshot text`
  -- ——刻意沒有 default（null = 建單當時尚未補這個欄位，見 0108 欄位註解）。
  -- 這裡斷言「沒有 default」，不是自己發明一個 canonical 沒說過的值。
  select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.tour_orders'::regclass and a.attname = 'deposit_mode_snapshot';
  if d is not null then
    raise exception '0109 後置斷言失敗——tour_orders.deposit_mode_snapshot 依 canonical（0108）不應該有 default，實際卻是 %。', d;
  end if;
end $$;

-- =============================================================================
-- 第四段：trip_departures.min_to_depart_snapshot 的 default——斷言，並在不符合
-- canonical 時修回 canonical 形狀
-- =============================================================================
-- 這一段在防什麼：先前 `min_to_depart_snapshot` 曾在某環境上是 not null 卻沒有
-- default（`add column if not exists` 對已存在欄位的 no-op 特性），沒有被 0107
-- 的後置斷言抓到。canonical（origin/main:supabase/migrations/0107_issue_41_
-- formation_state_model.sql:104）明確是 `not null default 1`，所以這裡不只斷言，
-- 不符合時直接修回 canonical 的 default 1——修回而不只是報錯，是因為這個欄位的
-- 正確 default 在 canonical 裡有明確、單一的答案，不需要人工判定。
do $$
declare
  d text;
begin
  select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.trip_departures'::regclass and a.attname = 'min_to_depart_snapshot';

  if d is distinct from '1' then
    alter table public.trip_departures alter column min_to_depart_snapshot set default 1;
  end if;

  select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.trip_departures'::regclass and a.attname = 'min_to_depart_snapshot';

  if d is distinct from '1' then
    raise exception '0109 後置斷言失敗——trip_departures.min_to_depart_snapshot 的 default 期望是 1（canonical 0107），修復後實際仍是 %。', coalesce(d, '(無 default)');
  end if;
end $$;
