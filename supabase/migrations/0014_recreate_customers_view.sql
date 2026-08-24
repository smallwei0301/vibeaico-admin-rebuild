-- 0014 — 重建 customers_view（P7-2 整合測試實抓的 bug）
--
-- 0007 以 `select c.*` 建 view，Postgres 在 CREATE 當下把欄位清單展開凍結；
-- 0013 之後才 `alter table customers add last_recall_at`，view 因此缺這一欄。
-- cron customer-recall 查 customers_view.last_recall_at → 42703，被單店
-- try/catch 吞掉 → recalled 恆 0、喚回永不推播（cron-jobs.07 三例紅燈根因）。
--
-- 修法：create or replace 重跑 0007 原定義，c.* 重新展開即含新欄位。
-- ⚠️ 之後任何對 customers 表加欄且 view 需要透出的 migration，都要記得
--    一併 create or replace 這個 view（c.* 不會自動跟進）。
--
-- 註：view 的欄位「尾端新增」可以用 create or replace；本次 c.* 展開後
-- 新欄 last_recall_at 落在 c.* 區段內、位於 membership_level_name 之前，
-- 屬「中段插入」，create or replace 會被 Postgres 拒絕（cannot change name
-- of view column），故先 drop 再 create。security_invoker 與 0007 一致。

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
