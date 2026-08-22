-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0006（逐字轉錄，不可自行更動）
do $$
declare t text;
begin
  foreach t in array array[
    'membership_levels','customers','service_categories','services','staff','staff_services',
    'bookings','block_times','product_categories','products','inventory_logs',
    'product_orders','product_order_items','coupons','coupon_instances',
    'tenant_point_transactions','customer_point_logs','feature_subscriptions',
    'line_users','marketing_pushes','push_quota_usage','keyword_replies','campaigns',
    'portfolios','chat_messages','shift_templates','shifts','staff_leaves','recurring_bookings'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy p_%s_all on %I for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id))', t, t);
  end loop;
end $$;

-- 例外收緊：功能訂閱與點數錢包只有平台（service role）能寫
drop policy p_feature_subscriptions_all on feature_subscriptions;
create policy p_fs_r on feature_subscriptions for select using (is_tenant_member(tenant_id));
drop policy p_tenant_point_transactions_all on tenant_point_transactions;
create policy p_tpt_r on tenant_point_transactions for select using (is_tenant_member(tenant_id));
