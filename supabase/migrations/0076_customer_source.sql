-- 0076 — customers.source（Issue #7）
--
-- 背景：src/app/tenant/customers/page.tsx 曾用寫死的
-- `AUTO_CREATED_CUSTOMER_IDS = new Set(['c_2'])` 決定要不要顯示「自動建立檔案」
-- 徽章 —— 永遠掛在第二筆顧客身上，跟該筆顧客實際怎麼來的完全無關。
-- Owner 2026-09-04 裁示：取向為復原成可用，不是取消徽章 —— 新增來源欄位，
-- 讓徽章依真實來源顯示。
--
-- 值域依實查結果訂定（見 PR 說明）：目前 repo 內只有一條真的會寫入
-- customers 表的路徑 —— src/app/api/customers/route.ts 的 POST（店家後台手動
-- 新增），對應 'MANUAL'。'LINE' / 'PUBLIC_BOOKING' 是本頁說明文字（顧客透過
-- LINE 或公開預約頁完成第一筆預約後會自動建檔）描述的既定語意，先保留欄位
-- 值域供之後那兩條建檔路徑落地時使用，避免屆時又要一支 migration 改
-- check 約束；今天不會有資料落在這兩個值上。
--
-- ⚠️ 冪等：add column if not exists；約束用 exception 包裹 —— 線上 TEST／PROD
-- 可能已因先前嘗試而存在同名約束或欄位（本專案已發生過兩次 schema drift）。
--
-- ⚠️ customers_view（0007 建立、0014 因同一個 c.* 展開問題重建過一次）用
-- `select c.*, ...` 建立，欄位清單在 CREATE 當下就展開凍結。新欄位是
-- ALTER TABLE ADD COLUMN 加到 customers 表的尾端，會落在 c.* 展開结果的尾端、
-- 但仍排在 membership_level_name 等既有的 view 尾端欄位「之前」——對 view 來說
-- 是中段插入，`create or replace view` 會被 Postgres 拒絕（cannot change name
-- of view column），比照 0014 的作法：drop 再重建。

alter table public.customers
  add column if not exists source text not null default 'MANUAL';

do $$
begin
  alter table public.customers
    add constraint customers_source_check
    check (source in ('MANUAL', 'LINE', 'PUBLIC_BOOKING'));
exception
  when duplicate_object then null;
end $$;

drop view if exists customers_view;

create view customers_view with (security_invoker = true) as
select c.*,
       ml.name as membership_level_name,
       coalesce(bs.cnt, 0)  as booking_count,
       coalesce(bs.spent, 0) as total_spent,
       bs.last_visit_at,
       (bs.last_visit_at is not null and bs.last_visit_at < now() - interval '60 days') as at_risk
from customers c
left join membership_levels ml on ml.id = c.membership_level_id
left join lateral (
  select count(*) filter (where b.status = 'COMPLETED') as cnt,
         coalesce(sum(b.final_price) filter (where b.status = 'COMPLETED'), 0) as spent,
         max(b.start_at) filter (where b.status = 'COMPLETED') as last_visit_at
  from bookings b where b.customer_id = c.id
) bs on true;
