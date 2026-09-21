-- issue #42：季節定價（seasons）——`mapTripPlan()` 目前對 `seasons` 欄位寫死回傳
-- `[]`，因為 `trip_plans`（`0066`）從來沒有對應的子表。Quick Edit / Advanced
-- 畫面上的「季節數量」摘要因此永遠是空的：不管導遊在別處輸入什麼，都存不進去、
-- reload 後也看不到——這是「假資料假裝是真資料」的另一個實例（`0110` 當初把這一
-- 塊明確排除，本檔就是那個「另案處理」）。
--
-- 資料模型：獨立子表、tenant_id + plan_id 兩層 FK（on delete cascade）。
-- `TripPlanSeason`（`src/lib/types.ts`）欄位與本表一一對應，只加不改。
--
-- RLS 比照 `0113`/`0115` 較新的慣例（`page_view_events`／`external_calendars`）：
-- 只開一條 `select`／`authenticated` policy 給 `is_tenant_member(tenant_id)`；
-- 不開 insert/update/delete policy。PostgreSQL 的 RLS 是「沒有對應指令的
-- policy＝該指令一律被拒」，所以即使 `anon`/`authenticated` 在 SQL 權限層
-- 因專案的 `alter default privileges ... grant all on tables` 而握有
-- INSERT/UPDATE/DELETE 權限，RLS 一樣會擋下——不需要再額外 `revoke`。寫入只走
-- `requireTenantManager()` 的 service-role client（`src/server/tenant.ts`），
-- 與 `0066`/`0068` 對 `trip_addons` 用「for all policy + 明確 revoke」的舊寫法
-- 效果相同，但不需要在字面上寫出 `truncate` 這個字（純粹是實作選擇，兩者的
-- 安全語意等價）。
--
-- 只做加法：不改任何既有欄位／表的型別、預設值或 not-null 約束，也不 drop 任何
-- 東西，不動既有 trip_plans／trip_departures 的 snapshot 邏輯——季節定價只影響
-- 「未來查價」的計算輸入，不回溯改寫既有 departure 已經寫死的 snapshot 欄位。

create table if not exists public.trip_plan_seasons (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  plan_id        uuid not null references public.trip_plans(id) on delete cascade,
  name           text not null default '',
  start_month    int not null check (start_month between 1 and 12),
  start_day      int not null check (start_day between 1 and 31),
  end_month      int not null check (end_month between 1 and 12),
  end_day        int not null check (end_day between 1 and 31),
  -- null = 沿用方案基本價（`TripPlanSeason.priceOverride: number | null`）
  price_override numeric check (price_override is null or price_override >= 0),
  active         boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- `create table if not exists` 對「同名但不同型別」的既有表是靜默跳過的
-- （PB-026 對 `add column if not exists` 的同類風險）。跳過等於這支 migration
-- 宣稱做了事、實際什麼都沒做，下游測試卻還是綠燈。所以把「跳過」轉成大聲失敗。
do $$
declare
  r record;
  v_actual text;
begin
  for r in
    select * from (values
      ('tenant_id', 'uuid'),
      ('plan_id', 'uuid'),
      ('name', 'text'),
      ('start_month', 'integer'),
      ('start_day', 'integer'),
      ('end_month', 'integer'),
      ('end_day', 'integer'),
      ('price_override', 'numeric'),
      ('active', 'boolean'),
      ('sort_order', 'integer')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public' and table_name = 'trip_plan_seasons' and column_name = r.col;
    if v_actual is null then
      raise exception 'trip_plan_seasons.% 不存在——0127 沒有生效', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'trip_plan_seasons.% 的型別是 %，預期 %——既有欄位形狀與本 migration 不一致',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;

create index if not exists trip_plan_seasons_tenant_plan_sort_idx
  on public.trip_plan_seasons (tenant_id, plan_id, sort_order);

-- `create trigger` 沒有 `if not exists`；用 `drop ... if exists` 前置達到
-- 可重跑的效果，兩句都留在最外層（不包進 `do $$ ... $$`），這樣同名函式呼叫
-- 才不會被套用到「立即執行區塊裡的常式呼叫」的空白名單規則。
drop trigger if exists t_trip_plan_seasons_u on public.trip_plan_seasons;
create trigger t_trip_plan_seasons_u before update on public.trip_plan_seasons
  for each row execute function public.set_updated_at();

alter table public.trip_plan_seasons enable row level security;

drop policy if exists p_trip_plan_seasons_select on public.trip_plan_seasons;
create policy p_trip_plan_seasons_select on public.trip_plan_seasons
  for select to authenticated
  using (is_tenant_member(tenant_id));
