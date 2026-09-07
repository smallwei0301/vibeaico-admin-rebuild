-- issue #259: trips 補上五個「編輯得到但存不進去」的欄位。
--
-- 行程詳情頁（`/tenant/trips/[id]`）的基本資料分頁可以編輯這五個欄位，但
-- `trips` 表（`0066` 建表時）沒有對應欄位，`tripApiPayload()` 也不會帶上它們。
-- PR #267 接上真實端點之後，其餘欄位都會持久化，**只有這五個不會**——於是以
-- 「此欄位尚未建立資料庫欄位，儲存後不會保留」誠實標註在每個欄位下方。
--
-- 本 migration 讓那五個欄位真的存得住，那些註記也就該一併移除。
--
-- ⚠️ **只新增欄位**：不改任何既有欄位的型別、預設值或 not-null 約束，
-- 也不 drop 任何東西。既有列由 default 補值，不需要 backfill。
--
-- 為什麼是 jsonb 而不是 text[]：`Trip.exclusions` / `Trip.notices` 在型別契約是
-- `string[]`，兩種表示法都對得上。選 jsonb 是因為**同一張表的既有陣列欄位
-- （`gallery`）就是 jsonb**，而且 local-isolated lane 的 overlay `0016` 早就用
-- jsonb 建過同名欄位。若這裡寫 text[]，`add column if not exists` 會在那條
-- lane 上靜默跳過（PB-026 的同型陷阱），CI 綠燈跑的是 jsonb、真實 TEST/正式庫
-- 卻是 text[]——同一個欄位兩種形狀，而且測試永遠測不到那個差異。
--
-- 至於 `includes`（text，換行分隔）與 `inclusions` 表示法不一致：**改既有欄位
-- 不在本次授權範圍內**，屬後續獨立切片。
--
-- Owner 授權：docs/decisions/2026-09-07-owner-production-ddl-0086-0087-0089.md §三

alter table public.trips
  add column if not exists tagline               text   not null default '',
  add column if not exists meeting_point_map_url text   not null default '',
  add column if not exists exclusions            jsonb  not null default '[]',
  add column if not exists notices               jsonb  not null default '[]',
  add column if not exists refund_policy_type    text   not null default 'STANDARD';

-- 退費規則是列舉語意（Trip['refundPolicyType']）。用 check 而不是 enum：
-- 新增列舉標籤要 `alter type`，而 check 約束可以在同一支 migration 裡替換，
-- 對這種「產品可能會再加一種」的欄位比較好維護。
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trips'::regclass
       and conname = 'trips_refund_policy_type_check'
  ) then
    alter table public.trips
      add constraint trips_refund_policy_type_check
      check (refund_policy_type in ('STANDARD', 'FLEXIBLE', 'STRICT'));
  end if;
end $$;

-- `add column if not exists` 對「同名但不同型別」的既有欄位是靜默跳過的（PB-026）。
-- 靜默跳過等於這支 migration 宣稱做了事、實際什麼都沒做，而下游測試還是會綠。
-- 所以在這裡把「跳過」轉成大聲失敗：欄位型別不是預期的就直接中止。
do $$
declare
  r record;
  v_actual text;
begin
  for r in
    select * from (values
      ('tagline', 'text'),
      ('meeting_point_map_url', 'text'),
      ('exclusions', 'jsonb'),
      ('notices', 'jsonb'),
      ('refund_policy_type', 'text')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public' and table_name = 'trips' and column_name = r.col;
    if v_actual is null then
      raise exception 'trips.% 不存在——0089 沒有生效', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'trips.% 的型別是 %，預期 %——既有欄位形狀與本 migration 不一致',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;
