-- #197 對帳：把已套用於正式庫、但不在本帳本裡的安全撤權補回來。
--
-- 2026-09-11 依 Owner 具名授權，對正式庫 egehnijjpgijmccagxac 套用了
-- `close_public_execute_on_server_only_security_definer_rpcs`，關閉五支
-- server-only SECURITY DEFINER 函式的 PUBLIC EXECUTE。那次是直接對線上下的，
-- **沒有對應的 migration 檔案**——也就是說，從本帳本重建出來的資料庫會少了
-- 這道防護，而這正是 #197 記錄的 drift。本檔把它補進帳本。
--
-- 為什麼需要撤 PUBLIC（PB-028）：
-- PostgreSQL 對新函式預設 `GRANT EXECUTE ... TO PUBLIC`。只 revoke
-- anon/authenticated 是不夠的，因為那兩個角色仍然從 PUBLIC 繼承。
-- 在 `proacl` 裡，開頭的 `=X/postgres`（grantee 空白）就是 PUBLIC 持有
-- EXECUTE 的字面證據。
--
-- 這五支為什麼只能由 server 呼叫：
--   subscribe_feature / subscribe_bundle
--     p_price 由呼叫端提供。p_price=0 即可免費開通任意功能與月數，並在
--     他人 tenant 的點數帳寫入 CONSUME 列。未登入即可執行。
--   user_id_by_email / email_exists
--     以 email 反查使用者是否存在，是帳號枚舉的直接工具。
--   next_tour_order_no
--     配發訂單編號；外部可呼叫即可耗號並在編號序列製造空隙。
--
-- 本檔可重入：revoke 不存在的權限不會失敗，grant 已存在的權限亦然。

revoke all on function public.subscribe_feature(uuid, text, integer, integer, text) from public;
revoke all on function public.subscribe_feature(uuid, text, integer, integer, text) from anon, authenticated;
grant execute on function public.subscribe_feature(uuid, text, integer, integer, text) to service_role;

revoke all on function public.subscribe_bundle(uuid, text, text[], integer, integer) from public;
revoke all on function public.subscribe_bundle(uuid, text, text[], integer, integer) from anon, authenticated;
grant execute on function public.subscribe_bundle(uuid, text, text[], integer, integer) to service_role;

revoke all on function public.user_id_by_email(text) from public;
revoke all on function public.user_id_by_email(text) from anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

revoke all on function public.email_exists(text) from public;
revoke all on function public.email_exists(text) from anon, authenticated;
grant execute on function public.email_exists(text) to service_role;

revoke all on function public.next_tour_order_no(uuid, date) from public;
revoke all on function public.next_tour_order_no(uuid, date) from anon, authenticated;
grant execute on function public.next_tour_order_no(uuid, date) to service_role;

-- 雙向自我驗證（PB-033）：撤權與加權在風險結構上對稱，兩邊都要斷言。
do $$
declare
  fn   text;
  v_acl text;
begin
  foreach fn in array array[
    'subscribe_feature', 'subscribe_bundle', 'user_id_by_email', 'email_exists', 'next_tour_order_no'
  ] loop
    select p.proacl::text into v_acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    if v_acl is null then
      raise exception '% 的 proacl 為 NULL——代表回到 PostgreSQL 的預設，PUBLIC 仍持有 EXECUTE', fn;
    end if;
    if v_acl ~ '(^|,)\{?=X' or v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
      raise exception '% 仍對 PUBLIC/anon/authenticated 開放：%', fn, v_acl;
    end if;
    -- 反向：service_role 被誤撤的話，所有 server route 會全面 403
    if v_acl not like '%service_role=X%' then
      raise exception '% 的 service_role 執行權被誤撤：%', fn, v_acl;
    end if;
  end loop;
end $$;
