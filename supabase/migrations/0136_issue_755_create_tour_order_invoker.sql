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
-- 發布順序：本檔必須與 0128、0130、0132 同一個 release（FULL_PENDING_SET），或在它們之後套用；
-- 簽名由 0132 定義，早於 0132 套用會因簽名不存在而失敗。
-- 明確授權（Codex P1）：改為 SECURITY INVOKER 後，函式以呼叫者 service_role 的權限執行，
-- 而 0132 會讀取 public.trip_plan_seasons。該表由 0128 新建且啟用 RLS，0128 並未明確授權，
-- service_role 的權限完全仰賴 schema 預設 ACL（目前 Production 的 production_migration_owner
-- 預設 ACL 有授予 service_role，但這個相依是隱性的；若表由沒有該預設 ACL 的角色建立就會壞）。
-- 這裡只對「本函式會讀、且由 0128 新建」的這一張表，明確授予唯一被許可的呼叫者 service_role
-- SELECT；不授予 anon／authenticated／PUBLIC，也不授予其他權限。
-- 函式讀寫的其他表（trips／trip_departures／trip_plans 的 SELECT、tour_orders 的 INSERT）
-- 皆為既有表，service_role 權限已於 2026-10-04 Owner catalog 讀取驗證，故不重複授權。
-- 若 0128 尚未套用（表不存在）此語句會明確失敗，藉此強制套用順序。
grant select on table public.trip_plan_seasons to service_role;

alter function public.create_tour_order(
  uuid, text, uuid, integer, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz
) security invoker;
