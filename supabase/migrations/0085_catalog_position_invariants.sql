-- 0085 — POSTDEPLOY 不變式：重排既有列並建立六個排序唯一索引。
--
-- issue #238，rollout 三段的第三段。**必須在 #239 的 app 部署之後才套用**：
-- 這些索引一旦存在，逐筆 update({sort_order: i}) 的舊 route 就會在第一次迭代
-- 撞 23505（已實測）。app 走 RPC 之後才安全。
--
--   1. 0084   建 counter 表與兩支 RPC（PREDEPLOY）
--   2. 部署 #239 的 app
--   3. 本檔    重排既有列 + 六個唯一索引（POSTDEPLOY）
--
-- services 的兩個索引也在這裡：實查正式庫 egehnijjpgijmccagxac 發現
-- services_tenant_sort_order_uq / services_tenant_line_sort_order_uq 同樣不存在
-- （0065 從未套用到正式庫），所以三張表一起補齊，而不是只補 #239 新加的兩張。
--
-- 重排手法沿用 0065 對 services 的兩階段做法：先把整批搬到負數區間，避免重排
-- 過程中自己撞自己，再寫回 0..n-1。注意 staging 值是愈後面的列愈負：原本
-- 0,1,2 會暫存成 -1000000001,-1000000002,-1000000003。因此從 staging 恢復時
-- 必須 DESC 才會保留原順序；若 ASC 會把順序反轉，而且每次重跑都再翻一次。
-- LINE lane 在 public lane 已暫存成負數後才 staging，所以同 line_sort_order 的
-- tie-break 也必須用 sort_order DESC 才等價於原本的 public 排序。
-- 這三個方向由 tests/unit/catalog-position-migration.238.test.ts 鎖住。

-- ---- services ----
with ranked as (
  select id, (-1000000000 - row_number() over (partition by tenant_id order by sort_order, id))::integer as rank
    from public.services
)
update public.services as item set sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (-1000000000 - row_number() over (partition by tenant_id order by line_sort_order, sort_order desc, id))::integer as rank
    from public.services
)
update public.services as item set line_sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (row_number() over (partition by tenant_id order by sort_order desc, id) - 1)::integer as rank
    from public.services
)
update public.services as item set sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (row_number() over (partition by tenant_id order by line_sort_order desc, sort_order, id) - 1)::integer as rank
    from public.services
)
update public.services as item set line_sort_order = ranked.rank from ranked where item.id = ranked.id;

create unique index if not exists services_tenant_sort_order_uq
  on public.services (tenant_id, sort_order);

create unique index if not exists services_tenant_line_sort_order_uq
  on public.services (tenant_id, line_sort_order);

-- ---- products ----
with ranked as (
  select id, (-1000000000 - row_number() over (partition by tenant_id order by sort_order, id))::integer as rank
    from public.products
)
update public.products as item set sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (-1000000000 - row_number() over (partition by tenant_id order by line_sort_order, sort_order desc, id))::integer as rank
    from public.products
)
update public.products as item set line_sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (row_number() over (partition by tenant_id order by sort_order desc, id) - 1)::integer as rank
    from public.products
)
update public.products as item set sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (row_number() over (partition by tenant_id order by line_sort_order desc, sort_order, id) - 1)::integer as rank
    from public.products
)
update public.products as item set line_sort_order = ranked.rank from ranked where item.id = ranked.id;

create unique index if not exists products_tenant_sort_order_uq
  on public.products (tenant_id, sort_order);

create unique index if not exists products_tenant_line_sort_order_uq
  on public.products (tenant_id, line_sort_order);

-- ---- portfolios ----
with ranked as (
  select id, (-1000000000 - row_number() over (partition by tenant_id order by sort_order, id))::integer as rank
    from public.portfolios
)
update public.portfolios as item set sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (-1000000000 - row_number() over (partition by tenant_id order by line_sort_order, sort_order desc, id))::integer as rank
    from public.portfolios
)
update public.portfolios as item set line_sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (row_number() over (partition by tenant_id order by sort_order desc, id) - 1)::integer as rank
    from public.portfolios
)
update public.portfolios as item set sort_order = ranked.rank from ranked where item.id = ranked.id;

with ranked as (
  select id, (row_number() over (partition by tenant_id order by line_sort_order desc, sort_order, id) - 1)::integer as rank
    from public.portfolios
)
update public.portfolios as item set line_sort_order = ranked.rank from ranked where item.id = ranked.id;

create unique index if not exists portfolios_tenant_sort_order_uq
  on public.portfolios (tenant_id, sort_order);

create unique index if not exists portfolios_tenant_line_sort_order_uq
  on public.portfolios (tenant_id, line_sort_order);
