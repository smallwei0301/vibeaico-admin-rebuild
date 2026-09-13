-- 0096 — POSTDEPLOY 不變式：重排既有列並建立六個排序唯一索引。
--
-- 本檔原為 0085，內容成形於 #239 分支。#239 被 #352 取代，而在它停留於分支期間
-- main 已經走到 0095，因此併入帳本時必須重新編號為 0096（repo-integrity-guard
-- 要求新 migration 的編號大於 base 的最大值，否則從帳本重建資料庫的套用順序會與
-- 正式庫實際的套用順序不一致）。**SQL 內容一字未改**，只改編號與下方的 PR 指涉。
--
-- issue #238，rollout 三段的第三段。**必須在 #352 的 app 部署之後才套用**：
-- 這些索引一旦存在，逐筆 update({sort_order: i}) 的舊 route 就會在第一次迭代
-- 撞 23505（已實測）。app 走 RPC 之後才安全。
--
--   1. 0084   建 counter 表與兩支 RPC（PREDEPLOY）
--   2. 部署 #352 的 app
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
--
-- 本檔在 App 已上線後才執行，因此正式站此時仍可能收到新增／拖曳排序。若不先鎖住
-- 三張 catalog 表，某筆並行 INSERT/UPDATE 可能只落在 staging/restore 的其中一半，
-- 造成「索引成功建立但資料順序被悄悄改掉」。SHARE ROW EXCLUSIVE 會阻擋
-- INSERT/UPDATE/DELETE 的 RowExclusiveLock，但不阻擋一般 SELECT，適合這段短 migration。
--
-- Supabase CLI 2.115/2.116 對 migration 改用 pipeline 後，裸 LOCK TABLE 不再位於真正
-- transaction block，會 25P01；因此這裡明確 BEGIN/COMMIT，讓 local 2.116 與正式
-- migration 都確實把鎖持有到重排與索引建立完成。方向與 transaction/lock 契約由
-- tests/unit/catalog-position-migration.238.test.ts 鎖住。

begin;

lock table public.services, public.products, public.portfolios
  in share row exclusive mode;

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

commit;
