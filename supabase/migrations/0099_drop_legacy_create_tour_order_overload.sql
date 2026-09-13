-- #197 對帳：把 0087 在正式庫的另一項前置處置補進帳本。
--
-- 2026-09-11 套用 0087 之前，正式庫 egehnijjpgijmccagxac 上存在一支舊簽章的
-- create_tour_order（來自 #37/#41 時期）：
--
--   create_tour_order(p_tenant uuid, p_departure uuid, p_party integer,
--                     p_customer_name text, p_customer_phone text,
--                     p_source tour_order_source, p_note text,
--                     p_payment_method uuid, p_customer uuid,
--                     p_hold_expires timestamptz)
--
-- 而 main 的 0087 是：
--
--   create_tour_order(p_tenant uuid, p_order_no text, p_departure uuid,
--                     p_party_size int, p_customer uuid, p_contact jsonb,
--                     p_source tour_order_source, p_payment_method uuid,
--                     p_note text, p_hold_expires timestamptz)
--
-- 參數型別清單不同，所以 `create or replace` **不會取代**舊的，而是多建一個
-- overload。兩個同名 overload 並存時，PostgREST 無法由 JSON body 唯一決定要
-- 呼叫哪一支（PGRST203 could not choose the best candidate function）——等於把
-- 原本的 PGRST202 換成另一種壞法。因此必須在套 0087 之前移除舊的。
--
-- 當時判定移除安全的三項證據（PB-033：撤除任何東西之前先查呼叫端）：
--   1. public.tour_orders 為 0 筆——迄今沒有任何呼叫端曾用它成功建過單
--   2. 其 ACL 為 {postgres, service_role}，不存在前端呼叫者
--   3. 本 repo 的 /api/tour-orders/manual 送的是 0087 的參數名，當時回 PGRST202
--
--
-- ⚠️ 帳本順序 vs. 正式庫歷程：在正式庫上，本段是在 0087 **之前**跑的（必須先移除
-- 舊 overload，0087 才不會變成多建一個）。補進帳本時只能排在末尾。這不會造成矛盾：
-- 從乾淨帳本重建出來的資料庫沒有舊簽章，drop if exists 為 no-op，而下方斷言在
-- 0087 已跑過的前提下仍然成立。
-- 可重入：舊簽章不存在時（乾淨帳本重建出來的資料庫本來就沒有）drop if exists 為 no-op。

drop function if exists public.create_tour_order(
  uuid, uuid, integer, text, text, public.tour_order_source, text, uuid, uuid, timestamptz
);

do $$
declare
  v_args text;
  v_n    int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';

  -- 本檔在帳本順序上位於 0087 之後，因此此時 canonical 版本應已存在且唯一。
  if v_n <> 1 then
    raise exception 'create_tour_order 應唯一，實際 % 個（>1 代表舊 overload 未清乾淨，會 PGRST203）', v_n;
  end if;

  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tour_order';

  if v_args <> 'p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone' then
    raise exception '留下來的不是 0087 的 canonical 簽章：%', v_args;
  end if;
end $$;
