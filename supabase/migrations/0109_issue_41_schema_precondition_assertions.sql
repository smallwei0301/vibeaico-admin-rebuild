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
-- 同一類缺口的第三個例子，而且是本檔自己犯過一次才發現的：第四段第一版無條件
-- 假設 `trip_departures.min_to_depart_snapshot`／`formation_status` 兩個欄位存在，
-- 直接對它們跑 `alter column ... set default`。但 Production 實測（2026-09-14）
-- 顯示 `0107_issue_41_formation_state_model` 在正式庫上是
-- `NOT_APPLIED / PENDING_APPLY`——`0108` 已套用、`0107` 沒有，兩者是各自獨立由
-- Owner 授權套用，**不是**嚴格依編號順序執行。於是這兩個欄位根本不存在，
-- `alter column` 直接以 `42703 undefined_column` 中止。這正是本檔第一段點名的
-- 同一個病：**依賴一個前提（這裡是「0107 已經套用」）卻從未斷言它**——差別只在
-- 於 0108 是「靜默通過」，這裡原本會是「直接中止」，成因完全相同。修法是先確認
-- 前提物件存在，不存在就整段 no-op（該欄位／型別由對應的 migration 日後套用時
-- 自己建出 canonical 形狀，不需要本檔越俎代庖），而不是中止。這個模式（先用
-- `to_regclass()`／`to_regtype()`／`pg_attribute` 存在性查詢，確認前提物件存在
-- 才動作）貫穿全檔四段，包含 `tour_orders` 表本身、`tour_payment_status` 型別、
-- 0108 新增的三個 `tour_orders` 欄位，與 `trip_departures` 表本身——同一輪盤點
-- 過，找到的同類缺口都已一併補齊，理由與範圍見各段落內的行內註解。
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
--
-- ⚠️（同一輪 Production 實測後回頭自查）：這一段以及第二、三段都隱含「
-- `public.tour_orders` 這張表存在」的前提，跟第四段原本對 `trip_departures`
-- 兩個欄位犯的是同一類問題——只是這裡假設的是「表存在」而不是「欄位存在」。
-- 差別在於這個前提目前明顯更穩固：`0108`（已證實套用於 Production）本身就是
-- `alter table public.tour_orders add column if not exists ...`，這個語句要成功
-- 執行，`tour_orders` 表**必須**在 0108 套用當下就已經存在——所以任何 0108 已
-- 套用的環境，`tour_orders` 表必然存在，這不是待驗證的假設，是 0108 能套用成功
-- 這件事本身的邏輯後果。但為了不讓本檔本身也犯「前提沒斷言」的問題，這裡仍然
-- 用 `to_regclass()`（找不到物件回傳 null，不會像 `::regclass` literal cast 那樣
-- 直接丟錯）明確查一次，查不到就整支 no-op：那代表這個環境連 `tour_orders` 都
-- 還沒建出來，0087（或建出它的 overlay 路徑）本身尚未套用，不是本檔要修的漂移，
-- 中止或嘗試建表都不是 0109 的職責。
do $$
declare
  current_type oid;
  bad_rows     int;
  bad_values   text;
  ck           record;
begin
  if to_regclass('public.tour_orders') is null then
    raise notice '0109 第一段 no-op：public.tour_orders 不存在，代表 0087（或建出它的路徑）尚未套用到這個環境。這不是本檔要修的漂移；本檔修的是「payment_status 已經是別的型別」，不是「表還沒被建出來」。';
    return;
  end if;

  select a.atttypid
    into current_type
    from pg_attribute a
   where a.attrelid = 'public.tour_orders'::regclass
     and a.attname = 'payment_status'
     and not a.attisdropped
     and a.attnum > 0;

  if current_type is null then
    -- 這裡不是「還沒套用某支 migration」——`payment_status` 是 0087 建表當下就有
    -- 的核心欄位（`create table` 本體的一部分，不是像 `min_to_depart_snapshot`
    -- 那樣事後才用 `add column if not exists` 補上去的），只要 `tour_orders` 表
    -- 存在，這個欄位理應存在。表在、欄位不在是真正反常的狀態，維持中止。
    raise exception '0109 中止：public.tour_orders 存在，但 payment_status 欄位不存在，這是反常狀態（payment_status 是 0087 建表當下就有的核心欄位），無法判斷前置狀態，需要人工判定。';
  -- 用 `to_regtype()` 而不是 `'public.tour_payment_status'::regtype` 字面 cast：
  -- 後者在型別真的不存在時會直接丟錯，讓這裡在「type 根本沒被建出來」的環境上
  -- 崩潰而不是走到下面任何一個分支去正確分類。`to_regtype()` 找不到就回傳
  -- null，`current_type = null` 自然為 false，會安全地落到下一個分支判斷，
  -- 不會提早炸掉。
  elsif current_type = to_regtype('public.tour_payment_status') then
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
    --
    -- ⚠️ 已知且刻意接受的行為差異：上面被刪掉的 CHECK 也包含
    -- `tour_orders_payment_amounts_nonnegative`——0087 明文接受的 overlay 別名（見
    -- 0087 對這個名字的 `if not exists` 判斷式），但在某些環境上它的實際內容是
    -- canonical 的**超集**：除了 canonical 的界線之外，還多帶一條
    -- `payment_status <> 'PARTIAL' or paid_amount >= upfront_required_amount`
    -- （PARTIAL 時已收金額不得低於應收頭期款）。本檔加回的五條是逐字抄自
    -- canonical 的內容，**不包含**這條額外不變量，所以走過這條修復路徑的環境
    -- 會從「canonical + 這條額外不變量」退回「純 canonical」。這是刻意的、不是
    -- 遺漏：本檔的目的是把前提修回 canonical 宣告的形狀，不是替 canonical 悄悄
    -- 追加一條它沒有明文要求的規則。若 PARTIAL 的已收金額下限應該成為平台行為，
    -- 需要另開一支 canonical migration 明確加上這條 CHECK，不能靠一個 overlay
    -- 殘留物在背後撐著。

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
--
-- ⚠️ 與第一段同理，本段一樣隱含「`tour_orders` 表存在」的前提，一樣用
-- `to_regclass()` 查而不是讓 `::regclass` literal cast 在表不存在時直接丟錯；
-- 表不存在就整段 no-op（理由同第一段：0087 尚未套用，不是本檔要修的漂移）。
--
-- 另外，「`tour_payment_status` 剛好五個 label」這件事本身是 **0108** 的產物
-- （0087 只建了 UNPAID／PAID／REFUNDED 三個，PARTIAL／REFUND_PENDING 是 0108
-- 才加的）。如果 0108 在這個環境上還沒套用，enum 只會有三個 label——這不是
-- 漂移，是「這支 migration 還沒輪到」，跟第四段 `trip_departures` 兩個欄位不存在
-- 是同一類前提缺口，所以五個 label 的檢查另外用 `upfront_required_amount`
-- 欄位（0108 的專屬產物）是否存在來判斷「0108 是否已套用」，沒套用就跳過這條
-- 檢查，不中止。型別／nullability／default 三項不受影響、維持無條件檢查——
-- 它們是 0087 的產物，只要 `payment_status` 欄位存在就該成立，與 0108 是否
-- 套用無關。
do $$
declare
  status_type    oid;
  status_notnull boolean;
  status_default text;
  missing        text;
  has_0108       boolean;
begin
  if to_regclass('public.tour_orders') is null then
    raise notice '0109 第二段 no-op：public.tour_orders 不存在，理由同第一段。';
    return;
  end if;

  select exists(
    select 1 from pg_attribute a
     where a.attrelid = 'public.tour_orders'::regclass
       and a.attname = 'upfront_required_amount'
       and not a.attisdropped and a.attnum > 0
  ) into has_0108;

  select a.atttypid, a.attnotnull
    into status_type, status_notnull
    from pg_attribute a
   where a.attrelid = 'public.tour_orders'::regclass
     and a.attname = 'payment_status'
     and not a.attisdropped
     and a.attnum > 0;

  -- 用 `to_regtype()` 而非字面 `::regtype` cast，理由同第一段：找不到型別時
  -- 回傳 null 而不是直接丟錯。
  if status_type is distinct from to_regtype('public.tour_payment_status') then
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

  -- tour_payment_status 的 label 集合必須正好是五個，不多不少——但**只在 0108
  -- 已套用時**才檢查。五個 label 裡的 PARTIAL／REFUND_PENDING 是 0108 才加的
  -- （見本段開頭註解），`has_0108 = false` 代表這個環境合法地只會有 0087 的三個
  -- label，那不是漂移，是「0108 這支 migration 還沒輪到」；0108 套用時自己會把
  -- label 補齊，不需要本檔在它之前搶著斷言一個它還沒達到的狀態。
  if has_0108 then
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
  else
    raise notice '0109 第二段跳過五個 label 的檢查：upfront_required_amount 不存在，代表 0108_issue_41_payment_state_model 尚未套用到這個環境，tour_payment_status 合法地只會有 0087 的三個 label。';
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
--
-- ⚠️ 與第四段對 `trip_departures` 兩個欄位同一類前提：這三個欄位是 0108 用
-- `alter table ... add column if not exists` 加上去的，不是 0087 建表當下就有
-- 的核心欄位，所以「0108 還沒套用到這個環境」是合法狀態，不是漂移——0108 套用
-- 時自己會把這三個欄位連同正確的 default 一起建出來。因此每個欄位都先用
-- `pg_attribute` 確認存在才斷言，不存在就對那個欄位整段 no-op，不中止。
--
-- 本段也是獨立的 `do $$ … $$` 陳述式，不會繼承第一、二段是否已經 no-op 的狀態，
-- 所以一樣先用 `to_regclass()` 查一次 `tour_orders` 表本身是否存在，理由同第一
-- 段：表不存在時整段 no-op，不讓 `::regclass` literal cast 直接丟錯。
do $$
declare
  d text;
  col_exists boolean;
begin
  if to_regclass('public.tour_orders') is null then
    raise notice '0109 第三段 no-op：public.tour_orders 不存在，理由同第一段。';
    return;
  end if;

  -- upfront_required_amount：canonical 0108 `add column ... not null default 0`。
  select exists(
    select 1 from pg_attribute a
     where a.attrelid = 'public.tour_orders'::regclass
       and a.attname = 'upfront_required_amount'
       and not a.attisdropped and a.attnum > 0
  ) into col_exists;
  if not col_exists then
    raise notice '0109 第三段跳過 upfront_required_amount：欄位不存在，代表 0108 尚未套用到這個環境，理由同上。';
  else
    select pg_get_expr(ad.adbin, ad.adrelid) into d
      from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
     where ad.adrelid = 'public.tour_orders'::regclass and a.attname = 'upfront_required_amount';
    if d is distinct from '0' then
      raise exception '0109 後置斷言失敗——tour_orders.upfront_required_amount 的 default 期望是 0，實際是 %。', coalesce(d, '(無 default)');
    end if;
  end if;

  -- refunded_amount：canonical 0108 `add column ... not null default 0`。
  select exists(
    select 1 from pg_attribute a
     where a.attrelid = 'public.tour_orders'::regclass
       and a.attname = 'refunded_amount'
       and not a.attisdropped and a.attnum > 0
  ) into col_exists;
  if not col_exists then
    raise notice '0109 第三段跳過 refunded_amount：欄位不存在，代表 0108 尚未套用到這個環境，理由同上。';
  else
    select pg_get_expr(ad.adbin, ad.adrelid) into d
      from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
     where ad.adrelid = 'public.tour_orders'::regclass and a.attname = 'refunded_amount';
    if d is distinct from '0' then
      raise exception '0109 後置斷言失敗——tour_orders.refunded_amount 的 default 期望是 0，實際是 %。', coalesce(d, '(無 default)');
    end if;
  end if;

  -- deposit_mode_snapshot：canonical 0108 `add column ... deposit_mode_snapshot text`
  -- ——刻意沒有 default（null = 建單當時尚未補這個欄位，見 0108 欄位註解）。
  -- 這裡斷言「沒有 default」，不是自己發明一個 canonical 沒說過的值。
  select exists(
    select 1 from pg_attribute a
     where a.attrelid = 'public.tour_orders'::regclass
       and a.attname = 'deposit_mode_snapshot'
       and not a.attisdropped and a.attnum > 0
  ) into col_exists;
  if not col_exists then
    raise notice '0109 第三段跳過 deposit_mode_snapshot：欄位不存在，代表 0108 尚未套用到這個環境，理由同上。';
  else
    select pg_get_expr(ad.adbin, ad.adrelid) into d
      from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
     where ad.adrelid = 'public.tour_orders'::regclass and a.attname = 'deposit_mode_snapshot';
    if d is not null then
      raise exception '0109 後置斷言失敗——tour_orders.deposit_mode_snapshot 依 canonical（0108）不應該有 default，實際卻是 %。', d;
    end if;
  end if;
end $$;

-- =============================================================================
-- 第四段：trip_departures 的 default——斷言，並在不符合 canonical 時修回 canonical
-- 形狀
-- =============================================================================
-- 這一段在防什麼：先前 `min_to_depart_snapshot` 曾在某環境上是 not null 卻沒有
-- default（`add column if not exists` 對已存在欄位的 no-op 特性），沒有被 0107
-- 的後置斷言抓到。canonical（origin/main:supabase/migrations/0107_issue_41_
-- formation_state_model.sql:104）明確是 `not null default 1`，所以這裡不只斷言，
-- 不符合時直接修回 canonical 的 default 1——修回而不只是報錯，是因為這個欄位的
-- 正確 default 在 canonical 裡有明確、單一的答案，不需要人工判定。
--
-- `formation_status`（同檔 0107:102，`not null default 'COLLECTING'`）是完全同一
-- 類缺口：同一支 canonical、同一個 `add column if not exists` no-op 成因、同樣
-- 只被舊斷言比對過型別／nullability，沒比對過 default。只補
-- `min_to_depart_snapshot` 卻漏掉 `formation_status`，等於這支檔案自己犯了它正在
-- 修的那個毛病（只補自己想到的個案，不補同類）。canonical 同樣只有一個明確、單一
-- 的 default 答案，所以比照修回，不只是報錯。
--
-- ⚠️（Production 實測，2026-09-14）：這一段原本無條件假設 `min_to_depart_snapshot`
-- 與 `formation_status` 兩個欄位存在，直接對它們跑 `alter column ... set
-- default`。但正式庫上 `0107_issue_41_formation_state_model` 目前是
-- `NOT_APPLIED / PENDING_APPLY`——`0108` 已套用、`0107` 沒有，兩者是各自獨立由
-- Owner 授權套用，不是嚴格依編號順序執行。於是這兩個欄位在正式庫上**根本不
-- 存在**，`alter column min_to_depart_snapshot ...` 直接以 `42703
-- undefined_column` 中止，`'COLLECTING'::public.departure_formation_status` 更
-- 早一步炸在型別解析（型別本身也不存在）。
--
-- 這正是本檔第一段開頭點名的同一個病：**依賴一個前提（這裡是「0107 已經套用」）
-- 卻從未斷言它，於是在前提不成立的環境上失敗**——差別只在於 0108 是「靜默通過」，
-- 這裡原本會是「直接中止」，成因完全相同。
--
-- 修法比照本檔全篇「no-op 優先於中止」的原則，而不是替這兩個欄位加一個
-- exception 分支：一個還沒套用 0107 的環境本來就不該有這些欄位，那不是漂移；
-- 0107 日後套用時，它自己的 `add column ... not null default 1／'COLLECTING'`
-- 會直接建成 canonical 形狀，不需要本檔越俎代庖。所以每個欄位都先用
-- `pg_attribute` 確認存在才動作，欄位不存在就整段 no-op、不報錯、不中止—— 讓
-- 0109 在「只套用到 0108、還沒套用 0107」的環境上仍然可以完整套用（第一到
-- 第三段對這個環境是有意義的，那些欄位確實都在）。
--
-- 與前三段同理，`trip_departures` 這張表本身（0066 建立，比 0107 更早）也是
-- 隱含前提；`to_regclass()` 查一次，表都不存在時直接整段 no-op——那是比「0107
-- 沒套用」更早期的環境，同樣不是本檔要處理的漂移。
do $$
declare
  d                      text;
  min_to_depart_exists   boolean;
  formation_status_exists boolean;
begin
  if to_regclass('public.trip_departures') is null then
    raise notice '0109 第四段 no-op：public.trip_departures 不存在，代表比 0107 更早的旅遊團次模型（0066）尚未套用到這個環境；本檔不處理這麼早期的漂移。';
    return;
  end if;

  select exists(
    select 1 from pg_attribute a
     where a.attrelid = 'public.trip_departures'::regclass
       and a.attname = 'min_to_depart_snapshot'
       and not a.attisdropped and a.attnum > 0
  ) into min_to_depart_exists;

  if not min_to_depart_exists then
    raise notice '0109 第四段 no-op（min_to_depart_snapshot）：trip_departures.min_to_depart_snapshot 不存在，代表 0107_issue_41_formation_state_model 尚未套用到這個環境。這不是漂移——0107 套用時會直接以 canonical 的 not null default 1 建出這個欄位，不需要本檔介入；中止或猜一個欄位定義反而更危險。';
  else
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
  end if;

  -- formation_status：與 min_to_depart_snapshot 同一段、同一種「0107 是否已套用」
  -- 的存在性前提，各自獨立判斷（不能假設兩個欄位總是一起存在或一起不存在——
  -- 雖然目前 canonical 是同一支 migration 加的，但存在性判斷仍應以系統目錄
  -- 實查為準，不以「反正是同一個檔案」去推論）。
  select exists(
    select 1 from pg_attribute a
     where a.attrelid = 'public.trip_departures'::regclass
       and a.attname = 'formation_status'
       and not a.attisdropped and a.attnum > 0
  ) into formation_status_exists;

  if not formation_status_exists then
    raise notice '0109 第四段 no-op（formation_status）：trip_departures.formation_status 不存在，代表 0107_issue_41_formation_state_model 尚未套用到這個環境；理由同上，0107 套用時會直接建出 canonical 形狀。';
    return;
  end if;

  -- formation_status：與 payment_status 的 default 斷言（第二段）同理，
  -- `pg_get_expr()` 是否替 enum 型別加上 `public.` schema 前綴取決於呼叫當下的
  -- search_path，因此改用片段比對而不是整串相等比對。
  select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.trip_departures'::regclass and a.attname = 'formation_status';

  if d is null or d not like '%COLLECTING%' or d not like '%departure_formation_status%' then
    alter table public.trip_departures
      alter column formation_status set default 'COLLECTING'::public.departure_formation_status;
  end if;

  select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.trip_departures'::regclass and a.attname = 'formation_status';

  if d is null or d not like '%COLLECTING%' or d not like '%departure_formation_status%' then
    raise exception '0109 後置斷言失敗——trip_departures.formation_status 的 default 期望是 ''COLLECTING''::public.departure_formation_status（canonical 0107），修復後實際仍是 %。', coalesce(d, '(無 default)');
  end if;
end $$;
