-- #197：關閉 catalog 取號／重排 RPC 的 PUBLIC 與 anon 執行權，保留 authenticated。
--
-- Owner 2026-09-11 授權：「只撤 PUBLIC、保留 authenticated、零程式碼變更」。
--
-- ## 為什麼不是照原本說的「只撤 PUBLIC」
--
-- 實查正式庫 egehnijjpgijmccagxac 的 proacl：
--
--   reserve_catalog_positions  {=X/postgres,postgres=X/postgres,anon=X/postgres,
--                               authenticated=X/postgres,service_role=X/postgres}
--   reorder_catalog_items      （同上）
--
-- 開頭的 `=X`（grantee 空白）是 PUBLIC；但 `anon=X` 是**另一筆明文授權**，而且它
-- 不是 0084 給的——0084 只寫 `to authenticated, service_role`。它來自 Supabase 專案
-- 層級的 ALTER DEFAULT PRIVILEGES。
--
-- 也就是說**只 revoke PUBLIC 不足以擋掉未登入呼叫**：anon 仍有自己的那一筆。
-- 這跟 PB-028 是同一族的陷阱，只是多一層：那一條講的是「只撤 anon/authenticated
-- 不夠，因為它們從 PUBLIC 繼承」；這裡是反過來——「只撤 PUBLIC 不夠，因為 anon
-- 另有明文授權」。兩個方向都必須各自查 proacl 才看得出來，不能從 migration 原始碼
-- 推斷。
--
-- ## 為什麼保留 authenticated（不照 0088 那樣一併撤掉）
--
-- 0084 對 authenticated 的授權是**刻意設計**，而且有測試鎖住：
-- tests/unit/catalog-position-bridge.242.test.ts 明文斷言
--   /grant execute on function public\.reserve_catalog_positions\(uuid, text\)\s+to authenticated, service_role;/
--
-- 而 reserve_catalog_positions 自己驗呼叫者的角色：
--
--   if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
--     raise exception 'catalog position allocation is not authorized' using errcode = '42501';
--
-- 所以一個已登入使用者就算直接呼叫它，也只能動自己是 MANAGER 的那家店的計數器——
-- 這不是跨租戶的洞。撤掉 authenticated 會讓服務／商品／作品集全部建立不了
-- （route 用 cookie-backed session client 呼叫），那是破壞功能，不是修安全。
--
-- reorder_catalog_items 甚至不是 SECURITY DEFINER（`secdef=false`），RLS 對它照常
-- 生效；但它同樣不該讓未登入者呼叫，所以一併處理。
--
-- ## 剩下的風險面
--
-- 撤除 anon 之後，未登入者完全打不到這兩支。已登入者仍需通過函式自身的 MANAGER
-- 檢查。這是縱深防禦，不是修補一個可被利用的洞——原本 anon 呼叫也會被
-- tenant_role_at_least 擋下（auth.uid() 為 null），本檔讓它在更早的一層就被拒絕，
-- 並讓 proacl 誠實反映「誰真的該呼叫這支」。

revoke all on function public.reserve_catalog_positions(uuid, text) from public;
revoke all on function public.reserve_catalog_positions(uuid, text) from anon;
grant execute on function public.reserve_catalog_positions(uuid, text) to authenticated, service_role;

revoke all on function public.reorder_catalog_items(uuid, text, text, uuid[]) from public;
revoke all on function public.reorder_catalog_items(uuid, text, text, uuid[]) from anon;
grant execute on function public.reorder_catalog_items(uuid, text, text, uuid[]) to authenticated, service_role;

-- 雙向自我驗證（PB-033）：撤權與加權在風險結構上對稱，兩邊都要斷言。
do $$
declare
  fn    text;
  v_acl text;
begin
  foreach fn in array array['reserve_catalog_positions', 'reorder_catalog_items'] loop
    select p.proacl::text into v_acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    if v_acl is null then
      raise exception '% 的 proacl 為 NULL——代表回到預設，PUBLIC 仍持有 EXECUTE', fn;
    end if;

    -- ① PUBLIC（proacl 開頭的 =X）必須消失
    if v_acl ~ '(^|,)\{?=X' then
      raise exception '① % 仍對 PUBLIC 開放：%', fn, v_acl;
    end if;

    -- ② anon 的明文授權必須消失——這是本檔相對於「只撤 PUBLIC」多做的一步
    if v_acl like '%anon=X%' then
      raise exception '② % 仍對 anon 開放：%（只撤 PUBLIC 擋不掉這一筆）', fn, v_acl;
    end if;

    -- ③ 反向：authenticated 不得被誤撤，否則服務／商品／作品集全部建立不了
    if v_acl not like '%authenticated=X%' then
      raise exception '③ % 的 authenticated 執行權被誤撤：%（#242 的刻意設計，且有測試鎖住）', fn, v_acl;
    end if;

    -- ④ 反向：service_role 不得被誤撤
    if v_acl not like '%service_role=X%' then
      raise exception '④ % 的 service_role 執行權被誤撤：%', fn, v_acl;
    end if;
  end loop;

  -- ⑤ 反向：本檔不得改變 reserve 的 SECURITY DEFINER 邊界，也不得把 reorder 變成 definer
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'reserve_catalog_positions') then
    raise exception '⑤ reserve_catalog_positions 不再是 SECURITY DEFINER';
  end if;
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reorder_catalog_items') then
    raise exception '⑤ reorder_catalog_items 變成了 SECURITY DEFINER（#242 刻意讓它走 invoker security）';
  end if;
end $$;
