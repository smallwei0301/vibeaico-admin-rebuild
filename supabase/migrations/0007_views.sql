-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0007（逐字轉錄，不可自行更動）

-- security_invoker：以呼叫者權限套 RLS，不會繞過隔離
create view bookings_view with (security_invoker = true) as
select b.*,
       c.name  as customer_name,
       c.phone as customer_phone,
       s.name  as service_name,
       st.name as staff_name
from bookings b
join customers c  on c.id = b.customer_id
join services  s  on s.id = b.service_id
left join staff st on st.id = b.staff_id;

-- 顧客列表的統計欄位（bookingCount、totalSpent、lastVisitAt、atRisk）同理：
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
