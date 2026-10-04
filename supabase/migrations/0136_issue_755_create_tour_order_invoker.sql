-- #755: 0130/0132 在 create_tour_order 內以
--   select t.refund_policy_type into v_trip from public.trips t where ...
-- 讀取 Trip 的取消政策並 snapshot 進訂單，且沒有 `if not found`。受控 Production
-- writer 以 production_migration_owner（nosuperuser、nobypassrls、noinherit）建立此
-- SECURITY DEFINER 函式；public.trips 的 owner 是 postgres 且啟用 RLS，policy 為
-- is_tenant_member(tenant_id)（依 auth.uid()）。唯一的呼叫者 service_role 沒有終端使用者
-- JWT，因此函式以 owner 身分執行時 trips 那一列被 RLS 濾掉，refund_policy_snapshot
-- 會被靜默寫成 NULL（trip_departures／trip_plans 的 owner 就是該 role，不受 RLS 影響，
-- 所以只有取消政策壞掉）。
--
-- 唯一被授權的呼叫者 service_role 已具備各表 DML 權限與 BYPASSRLS；改以呼叫者權限執行
-- 未變更的函式本體，trips 即可被讀到，租戶檢查（`tenant_id = p_tenant`）仍照舊生效。
-- 本檔沿用 0134 的作法：不可覆寫的後續 migration，不改 0132 已套用的位元組、不改函式本體。
--
-- ALTER FUNCTION 要求簽名與 0132 完全一致，簽名不存在時整個 migration 失敗（fail closed）。
-- 既有的 PUBLIC/anon/authenticated revoke 與 service_role execute grant 都保留，不重複授權。
alter function public.create_tour_order(
  uuid, text, uuid, integer, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz
) security invoker;
