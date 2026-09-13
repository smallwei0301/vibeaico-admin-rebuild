-- 0084 — PREDEPLOY 相容性橋接：catalog 取號／重排函式支援三個 resource 與兩條 lane。
--
-- issue #238。本檔**刻意只做「新增應用程式會呼叫的東西」**，不加任何唯一索引、
-- 不重排既有列。理由是 rollout 順序的雙向相容性：
--
--   先部署 app、後套 DB → app 呼叫不存在的 RPC → 500
--   先套完整 DDL、後部署 app → 索引就位但舊 route 仍逐筆 update → 500
--
-- 兩邊都不安全，所以拆成三段，本檔是第一段（部署前套用，對舊 app 無影響——
-- 舊 route 不呼叫這些函式，而且沒有索引，逐筆 update 仍能運作）：
--
--   1. 本檔 0084          建 counter 表與兩支 RPC（PREDEPLOY，可立即套用）
--   2. 部署 #239 的 app    POST/reorder 改走 RPC
--   3. 0085               重排既有列 + 六個唯一索引（POSTDEPLOY）
--
-- ⚠️ 本檔同時修好一個**現在就在傷害使用者**的既有缺陷：
-- src/server/service-position.ts 早已呼叫 reserve_catalog_positions 與
-- reorder_catalog_items（0065／#128 建立），但實查正式庫
-- egehnijjpgijmccagxac 發現 catalog_position_counters 表與這兩支函式**都不存在**
-- ——0065 從未套用到正式庫。也就是說正式站的「新增服務」與「服務重新排序」
-- 目前就是壞的（呼叫不存在的函式）。本檔套用後即修復。
--
-- 為什麼用動態 SQL：3 個 resource × 2 條 lane = 6 條路徑，寫成 if/else 會讓同一段
-- staging 邏輯重複六次——那正是 #128 只做了 services 就停下來的原因之一。
-- p_resource 與 p_lane 都先過白名單，再用 quote_ident/%I 組裝，沒有注入面。
--
-- 對 services 的既有行為：授權檢查、staging 手法、錯誤碼一字未改；唯一放寬處是
-- lane 現在也接受 'line'（services 自 0065 起就有 line_sort_order 欄位）。
-- 目前沒有任何呼叫端對 services 送 lane='line'，所以這是擴充不是變更。

create table if not exists public.catalog_position_counters (
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  resource             text not null check (resource in ('services', 'products', 'portfolios')),
  next_sort_order      integer not null check (next_sort_order >= 0),
  next_line_sort_order integer not null check (next_line_sort_order >= 0),
  primary key (tenant_id, resource)
);

-- 三張表都要有 line_sort_order 才能讓函式一致處理（services 由 0065 補、
-- products/portfolios 由本檔補；皆為 additive）。
alter table public.services
  add column if not exists line_sort_order integer not null default 0;
alter table public.products
  add column if not exists line_sort_order integer not null default 0;
alter table public.portfolios
  add column if not exists line_sort_order integer not null default 0;

-- 兩支函式改為 create or replace，並用動態 SQL 一次涵蓋三個 resource 與兩個 lane。
--
-- 為什麼用動態 SQL：3 個 resource × 2 個 lane = 6 條路徑，寫成 if/else 會讓同一段
-- staging 邏輯重複六次——那正是 #128 只做了 services 就停下來的原因之一。
-- p_resource 與 p_lane 都先過白名單，再用 quote_ident/%I 組裝，沒有注入面。
--
-- 這裡刻意用 replace 而非 0065 的「不存在才建立」：canonical TEST 上這兩支函式
-- 已經存在但只認 services，不 replace 的話 products/portfolios 永遠打不進去。
--
-- 對 services 的既有行為：授權檢查、staging 手法、錯誤碼一字未改；唯一放寬處是
-- lane 現在也接受 'line'（services 自 0065 起就有 line_sort_order 欄位）。
-- 目前沒有任何呼叫端對 services 送 lane='line'，所以這是擴充不是變更。

create or replace function public.reserve_catalog_positions(
  p_tenant_id uuid,
  p_resource text
)
returns table(sort_order integer, line_sort_order integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  next_public integer;
  next_line integer;
  tbl text;
begin
  if p_tenant_id is null or p_resource not in ('services', 'products', 'portfolios') then
    raise exception 'invalid catalog position arguments' using errcode = '22023';
  end if;
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'catalog position allocation is not authorized' using errcode = '42501';
  end if;

  tbl := 'public.' || pg_catalog.quote_ident(p_resource);

  execute pg_catalog.format(
    'insert into public.catalog_position_counters (tenant_id, resource, next_sort_order, next_line_sort_order)
     select $1, $2, coalesce(max(sort_order), -1) + 1, coalesce(max(line_sort_order), -1) + 1
       from %s where tenant_id = $1
     on conflict (tenant_id, resource) do nothing', tbl)
  using p_tenant_id, p_resource;

  select c.next_sort_order, c.next_line_sort_order
    into next_public, next_line
    from public.catalog_position_counters as c
   where c.tenant_id = p_tenant_id and c.resource = p_resource
   for update;

  -- 計數器可能落後於實際最大值（例如有人直接寫資料庫），取兩者較大者。
  execute pg_catalog.format(
    'select greatest($1, coalesce(max(sort_order), -1) + 1),
            greatest($2, coalesce(max(line_sort_order), -1) + 1)
       from %s where tenant_id = $3', tbl)
    into next_public, next_line
   using next_public, next_line, p_tenant_id;

  update public.catalog_position_counters as c
     set next_sort_order = next_public + 1,
         next_line_sort_order = next_line + 1
   where c.tenant_id = p_tenant_id and c.resource = p_resource;

  return query select next_public, next_line;
end;
$function$;

grant execute on function public.reserve_catalog_positions(uuid, text)
  to authenticated, service_role;

create or replace function public.reorder_catalog_items(
  p_tenant_id uuid,
  p_resource text,
  p_lane text,
  p_ids uuid[]
)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  expected_count integer;
  submitted_count integer;
  has_missing boolean;
  stage_base bigint;
  tbl text;
  col text;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'catalog reorder is not authorized' using errcode = '42501';
  end if;

  if p_resource not in ('services', 'products', 'portfolios')
    or p_lane not in ('public', 'line')
    or p_ids is null
    or pg_catalog.cardinality(p_ids) = 0
    or pg_catalog.cardinality(p_ids) > 500 then
    raise exception 'invalid catalog reorder arguments' using errcode = '22023';
  end if;

  tbl := 'public.' || pg_catalog.quote_ident(p_resource);
  col := case when p_lane = 'line' then 'line_sort_order' else 'sort_order' end;

  select pg_catalog.count(*)::integer into submitted_count
    from (select distinct submitted.id
            from pg_catalog.unnest(p_ids) as submitted(id)) unique_ids;

  execute pg_catalog.format('select pg_catalog.count(*)::integer from %s where tenant_id = $1', tbl)
    into expected_count using p_tenant_id;

  if submitted_count <> expected_count
    or pg_catalog.cardinality(p_ids) <> expected_count then
    raise exception 'catalog reorder must include the complete tenant collection'
      using errcode = '22023';
  end if;

  execute pg_catalog.format(
    'select exists (select 1 from pg_catalog.unnest($1) as submitted(id)
        left join %s as item on item.id = submitted.id and item.tenant_id = $2
       where item.id is null)', tbl)
    into has_missing using p_ids, p_tenant_id;

  if has_missing then
    raise exception 'catalog reorder contains an unknown tenant item'
      using errcode = '22023';
  end if;

  -- 先整批搬到保證不衝突的高位區間，再依提交順序寫回 0..n-1。
  -- 這是唯一索引下做重排的標準解法，不需要 deferrable。
  execute pg_catalog.format(
    'select greatest(coalesce(max(%I), -1), $1)::bigint + $1 + 1
       from %s where tenant_id = $2', col, tbl)
    into stage_base using expected_count, p_tenant_id;

  execute pg_catalog.format(
    'with staged as (
       select id, ($1 + row_number() over (order by id))::integer as rank
         from %s where tenant_id = $2
     )
     update %s as item set %I = staged.rank
       from staged where item.id = staged.id and item.tenant_id = $2', tbl, tbl, col)
    using stage_base, p_tenant_id;

  execute pg_catalog.format(
    'update %s as item set %I = ranked.ordinal::integer - 1
       from pg_catalog.unnest($1) with ordinality as ranked(id, ordinal)
      where item.id = ranked.id and item.tenant_id = $2', tbl, col)
    using p_ids, p_tenant_id;
end;
$function$;

grant execute on function public.reorder_catalog_items(uuid, text, text, uuid[])
  to authenticated, service_role;
