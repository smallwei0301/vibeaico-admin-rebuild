-- =============================================================================
-- 0107 — #41 成團生命週期：狀態模型（canonical，從 current main 重建）
-- =============================================================================
-- Owner 2026-09-14 裁示：#41 從 current main 重新建立 canonical 成團／付款生命
-- 週期。**不復活舊 PR #58／#70**，**不採用 TEST 的歷史 #41 overlay**
-- （`supabase/local-migrations/issue-41-candidate-baseline/0040_*.sql`，其 manifest
-- 自標 `CANDIDATE_SOURCE_NOT_CANONICAL`）。本檔不重用 `0040` 前綴，也不引用它的內容。
--
-- 依 `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §1–§3、§5–§6。
--
-- ## 這一片做什麼、不做什麼
--
-- **做**：把「成團」變成資料庫裡的真實狀態——Plan 的販售規則與成團門檻、Departure
-- 的成團狀態軸與 snapshot、以及一次性的成團證據。
--
-- **不做**：自動推進的 transaction 邏輯（§6）、通知事件（§7）、金流（§8）、退款
-- （§9）。那些是後續切片，本檔只建立它們必須寫入的欄位與不變量。
--
-- ## 為什麼用 `add column if not exists` 而且還要後置斷言
--
-- PB-026：`0087` 的 `create table if not exists public.tour_orders` 在 local-isolated
-- 是一個 **no-op**——historical overlay 的 `0026` 早就建過同名表，欄位不同。於是程式
-- 對著 overlay 的契約寫入，`confirm-payment` 回 `500 / 23514`，而 migration 本身
-- 「成功」了。
--
-- 「套用成功」與「欄位真的長成我要的樣子」是兩件事，而且在套用日誌上無法區分。
-- 因此本檔最後有一段 post-assertion：逐項查系統目錄，任何一項不符就 raise。
-- =============================================================================

-- ------------------------------------------------------------------ 成團狀態軸
-- `OPEN/CLOSED/CANCELLED` 回答「還能不能賣」；成團狀態回答「這團是否已對旅客做出
-- 出團承諾」。兩者是兩條軸，不得合併（18 分冊 §3）。
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'departure_formation_status'
  ) then
    create type public.departure_formation_status as enum (
      'COLLECTING', 'FORMED', 'REVIEW_REQUIRED', 'AT_RISK', 'FAILED'
    );
  else
    execute 'alter type public.departure_formation_status add value if not exists ''COLLECTING''';
    execute 'alter type public.departure_formation_status add value if not exists ''FORMED''';
    execute 'alter type public.departure_formation_status add value if not exists ''REVIEW_REQUIRED''';
    execute 'alter type public.departure_formation_status add value if not exists ''AT_RISK''';
    execute 'alter type public.departure_formation_status add value if not exists ''FAILED''';
  end if;
end $$;

-- --------------------------------------------------------------- Plan 販售規則
-- 18 分冊 §1：`min_party_size` 不能再同時代表「最低成團人數」。既有的
-- `min_party`／`max_party` 就是每筆訂單的 party size 上下限，維持原意不動；
-- 成團門檻 `min_to_depart` 是**另一個概念**，獨立新增。
alter table public.trip_plans
  add column if not exists sales_mode text not null default 'FIXED_DEPARTURE',
  add column if not exists participation_mode text not null default 'SHARED',
  add column if not exists min_to_depart int not null default 1,
  add column if not exists formation_deadline_days_before int not null default 7;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass and conname = 'trip_plans_sales_mode_ck'
  ) then
    alter table public.trip_plans add constraint trip_plans_sales_mode_ck
      check (sales_mode in ('FIXED_DEPARTURE', 'INSTANT', 'REQUEST'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass and conname = 'trip_plans_participation_mode_ck'
  ) then
    alter table public.trip_plans add constraint trip_plans_participation_mode_ck
      check (participation_mode in ('SHARED', 'PRIVATE'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass and conname = 'trip_plans_min_to_depart_ck'
  ) then
    alter table public.trip_plans add constraint trip_plans_min_to_depart_ck
      check (min_to_depart >= 1);
  end if;

  -- 18 分冊 §2.1：預設 7 天，UI 範圍 0–90。`0` 代表可募集到出發日，是合法的
  -- 專業用法，不得禁止——UI 顯示風險提醒即可。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_plans'::regclass and conname = 'trip_plans_formation_deadline_days_ck'
  ) then
    alter table public.trip_plans add constraint trip_plans_formation_deadline_days_ck
      check (formation_deadline_days_before between 0 and 90);
  end if;
end $$;

-- ------------------------------------------------------- Departure 成團狀態與 snapshot
-- 18 分冊 §2.2：建立團次時不能只保存「7」，要算成實際時間並 snapshot。Plan 日後
-- 改成 5 天，不回頭改已公開的舊 Departure。
alter table public.trip_departures
  add column if not exists formation_status public.departure_formation_status not null default 'COLLECTING',
  add column if not exists formation_deadline_at timestamptz,
  add column if not exists min_to_depart_snapshot int not null default 1,
  add column if not exists formed_at timestamptz,
  add column if not exists formed_by text,
  add column if not exists formed_participants int,
  add column if not exists formation_decided_at timestamptz,
  add column if not exists formation_decided_by uuid references auth.users(id) on delete set null;

-- 既有團次沒有宣告過成團門檻。誠實的回填值是 1（＝沒有門檻），不是從 Plan 推算
-- 一個它當初並未承諾的數字。
do $$
declare
  bad_rows int;
begin
  -- `min_to_depart_snapshot <= capacity` 是接下來要加的不變量。先查有沒有既有
  -- 資料違反它——capacity 從 0066 起就沒有下界檢查，理論上可能是 0。
  -- 這種情況要**指名報錯**，不是把資料悄悄改成能通過檢查的樣子。
  select count(*) into bad_rows from public.trip_departures where capacity < 1;
  if bad_rows > 0 then
    raise exception '0107 無法加上 min_to_depart_snapshot <= capacity：有 % 筆既有 trip_departures 的 capacity < 1。請先修正那些團次的容量，本 migration 不會替它們決定一個容量。', bad_rows;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departures'::regclass and conname = 'trip_departures_min_to_depart_ck'
  ) then
    alter table public.trip_departures add constraint trip_departures_min_to_depart_ck
      check (min_to_depart_snapshot >= 1 and min_to_depart_snapshot <= capacity);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departures'::regclass and conname = 'trip_departures_formed_by_ck'
  ) then
    alter table public.trip_departures add constraint trip_departures_formed_by_ck
      check (formed_by is null or formed_by in ('SYSTEM', 'GUIDE_OVERRIDE'));
  end if;

  -- 18 分冊 §3「一次性成團證據」：一旦 FORMED，證據必須齊全。AT_RISK 是 FORMED
  -- 之後才可能發生的狀態，所以它同樣必須保有成團證據——不得因人數下降就把證據
  -- 抹掉，那等於否認曾經對旅客做過的出團承諾。
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departures'::regclass and conname = 'trip_departures_formed_evidence_ck'
  ) then
    alter table public.trip_departures add constraint trip_departures_formed_evidence_ck
      check (
        formation_status not in ('FORMED', 'AT_RISK')
        or (formed_at is not null and formed_by is not null and formed_participants is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departures'::regclass and conname = 'trip_departures_formed_participants_ck'
  ) then
    alter table public.trip_departures add constraint trip_departures_formed_participants_ck
      check (formed_participants is null or formed_participants >= 1);
  end if;
end $$;

comment on column public.trip_departures.formation_status is
  '成團狀態軸（18 分冊 §3）。與 status(OPEN/CLOSED/CANCELLED) 是兩條獨立的軸；FORMED 不等同 CLOSED。';
comment on column public.trip_departures.min_to_depart_snapshot is
  '建立團次時從 Plan snapshot 的成團門檻。Plan 日後調整不回頭改已公開的團次。';
comment on column public.trip_plans.min_to_depart is
  '整個 Departure 合計至少幾人才宣布成團。與 min_party（單筆訂單最少幾人）是不同概念，不得混用。';

-- =============================================================================
-- 後置斷言：套用成功 ≠ 欄位真的長成這樣（PB-026）
-- =============================================================================
do $$
declare
  missing text;
begin
  -- 1. enum 的值域完全正確（不多不少）。先查它，因為第 2 步的型別比對要用到它。
  if (
    select array_agg(e.enumlabel::text order by e.enumlabel)
      from pg_enum e join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'departure_formation_status'
  ) is distinct from array['AT_RISK', 'COLLECTING', 'FAILED', 'FORMED', 'REVIEW_REQUIRED'] then
    raise exception '0107 後置斷言失敗——departure_formation_status 的值域不是 18 分冊 §3 的那五個。';
  end if;

  -- 2. 欄位存在且型別正確
  /*
   * 型別比對用 `regtype` 的 OID，不用 `format_type()` 的字串。
   * `format_type()` 會依 search_path 決定要不要加 schema 前綴——同一個 enum 在
   * 不同 search_path 下會拼成 `departure_formation_status` 或
   * `public.departure_formation_status`。拿拼寫去比，斷言會在「欄位其實完全正確」
   * 的情況下誤報，那比沒有斷言更糟（永遠失敗的斷言會擋住合法套用）。
   * `::regtype` 把兩邊都解析成同一個 OID，不受拼寫與 search_path 影響。
   */
  select string_agg(expected.col, ', ') into missing
    from (values
      ('trip_plans', 'sales_mode', 'text'),
      ('trip_plans', 'participation_mode', 'text'),
      ('trip_plans', 'min_to_depart', 'integer'),
      ('trip_plans', 'formation_deadline_days_before', 'integer'),
      ('trip_departures', 'formation_status', 'public.departure_formation_status'),
      ('trip_departures', 'formation_deadline_at', 'timestamp with time zone'),
      ('trip_departures', 'min_to_depart_snapshot', 'integer'),
      ('trip_departures', 'formed_at', 'timestamp with time zone'),
      ('trip_departures', 'formed_by', 'text'),
      ('trip_departures', 'formed_participants', 'integer'),
      ('trip_departures', 'formation_decided_at', 'timestamp with time zone'),
      ('trip_departures', 'formation_decided_by', 'uuid')
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
    raise exception '0107 後置斷言失敗——以下欄位不存在或型別不符：%。這通常代表 historical overlay 已先建過同名物件，導致本檔的 add column 變成 no-op（PB-026）。', missing;
  end if;

  -- 3. 六個 CHECK 都在，而且內容真的是我要的那一條
  select string_agg(expected.name, ', ') into missing
    from (values
      ('trip_plans', 'trip_plans_sales_mode_ck', '%REQUEST%'),
      ('trip_plans', 'trip_plans_participation_mode_ck', '%PRIVATE%'),
      ('trip_plans', 'trip_plans_min_to_depart_ck', '%min_to_depart%'),
      ('trip_plans', 'trip_plans_formation_deadline_days_ck', '%90%'),
      ('trip_departures', 'trip_departures_min_to_depart_ck', '%capacity%'),
      ('trip_departures', 'trip_departures_formed_evidence_ck', '%formed_participants%')
    ) as expected(tbl, name, fragment)
   where not exists (
     select 1 from pg_constraint c
      where c.conrelid = ('public.' || expected.tbl)::regclass
        and c.conname = expected.name
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like expected.fragment
   );
  if missing is not null then
    raise exception '0107 後置斷言失敗——以下 CHECK 不存在或內容不符：%。', missing;
  end if;

  -- 4. 成團證據那條 CHECK 必須同時涵蓋 FORMED 與 AT_RISK。
  --    只寫 FORMED 會讓「人數跌破門檻後把證據抹掉」變成合法操作。
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.trip_departures'::regclass
       and c.conname = 'trip_departures_formed_evidence_ck'
       and pg_get_constraintdef(c.oid) like '%AT_RISK%'
       and pg_get_constraintdef(c.oid) like '%FORMED%'
  ) then
    raise exception '0107 後置斷言失敗——成團證據的 CHECK 沒有同時涵蓋 FORMED 與 AT_RISK。';
  end if;

  -- 5. min_party 必須還在，而且沒有被本檔改動。18 分冊 §1 要求把兩個概念拆開，
  --    不是把舊欄位改用途——改用途會讓既有資料的語意在不知不覺中變掉。
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.trip_plans'::regclass and attname = 'min_party' and not attisdropped
  ) then
    raise exception '0107 後置斷言失敗——trip_plans.min_party 不見了。本檔應該只新增 min_to_depart，不得移除或改寫既有的每筆訂單人數欄位。';
  end if;
end $$;
