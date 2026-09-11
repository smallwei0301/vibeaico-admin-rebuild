-- #350：逾期釋位改用專用 RPC，不再借用通用的 cancel_tour_order。
--
-- 來源：PR #271 的 Final Risk（Astra gate）MAJOR-1。
--
-- 問題出在 cron 的 select 與 RPC 執行之間有一段時間差，而通用的 cancel_tour_order
-- 不會重新驗「這筆現在還是逾期未付款嗎」。0087 的終態守門是：
--
--     if v_order.status in ('CANCELLED', 'COMPLETED') then return false;
--
-- **CONFIRMED 不在其中。** 於是這個序列會發生：
--
--   T+1.0s  cron 的 select 把訂單 X（PENDING、已過期）列進 batch
--   T+1.5s  導遊按 confirm-payment：X 變成 CONFIRMED / PAID /
--           paid_amount = total / hold_expires_at = null，commit
--   T+2.0s  cron 對 X 呼叫 cancel_tour_order。for update 讀到 CONFIRMED，
--           不在終態守門內 → 改成 CANCELLED、寫入「未在保留期限內完成付款」、
--           release_seats
--
-- 結果是一筆**已收款**的訂單被系統以「未付款」為由取消、席次放回去可以再賣，
-- 而 payment_status 仍是 PAID——導遊看到一筆自相矛盾的單，店家的錢已經收了。
--
-- 修法：把 cron 的**前提**（PENDING + 已過期）從「select 當下成立」變成「在 row
-- lock 底下重新成立」。這是唯一能關掉這個時間差的位置：條件必須與狀態變更在同一
-- 個鎖的保護範圍內求值，放在應用層再驗一次只會把視窗縮小、不會關掉。
--
-- 為什麼是新增一支函式、而不是給 cancel_tour_order 加參數：
-- cancel_tour_order 是導遊手動取消的入口，它的語意是「不論為什麼，把這筆取消」。
-- 逾期釋位的語意是「只有在它**仍然**逾期未付款時才取消」。把兩種語意塞進同一支
-- 函式，會讓手動取消多一個可以傳錯的參數，而傳錯的後果是靜默不取消。
--
-- ⚠️ 目前正式環境打不到這條 race：全 src/ 只有 /api/tour-orders/manual 會寫
-- tour_orders，且固定 p_hold_expires = null，所以 cron 的 select 永遠是空集合。
-- 但綠界／匯款建單那一刀落地的當下就會變成可達——那是第一個寫入 hold_expires_at
-- 的切片，也是這支 migration 的截止線。先修，不要等它變成線上事故。

create or replace function public.expire_tour_order(
  p_tenant uuid,
  p_order  uuid,
  p_reason text
) returns boolean as $$
declare
  v_order record;
begin
  -- for update 取得 row lock，**鎖定之後**才求值下面的條件。
  -- 把 status／hold_expires_at 的判斷寫進這個 select 的 where，等於在鎖的保護
  -- 範圍內重新確認前提；條件不成立就 not found，直接回 false。
  select id, departure_id, party_size into v_order
    from public.tour_orders
   where id = p_order
     and tenant_id = p_tenant
     and status = 'PENDING'
     and hold_expires_at is not null
     and hold_expires_at < now()
   for update;

  -- 不符即回 false：不改狀態、不釋放名額、不寫 cancel_reason。
  -- 涵蓋三種情形：訂單不存在／不屬於本租戶、已被改成 CONFIRMED 等非 PENDING 狀態、
  -- 或 hold_expires_at 已被清成 null（confirm-payment 會這麼做）。
  if not found then
    return false;
  end if;

  update public.tour_orders
     set status = 'CANCELLED',
         cancel_reason = coalesce(p_reason, ''),
         updated_at = now()
   where id = p_order and tenant_id = p_tenant;

  perform public.release_seats(v_order.departure_id, v_order.party_size);
  return true;
end; $$ language plpgsql security definer set search_path = public;

-- 同 0088：security definer 繞過 RLS，只有 server 端的 service_role 可以呼叫。
-- PostgreSQL 對新函式預設 GRANT EXECUTE TO PUBLIC，只 revoke anon/authenticated
-- 不夠，那兩個角色仍從 PUBLIC 繼承（PB-028）。
revoke all on function public.expire_tour_order(uuid, uuid, text) from public;
revoke all on function public.expire_tour_order(uuid, uuid, text) from anon, authenticated;
grant execute on function public.expire_tour_order(uuid, uuid, text) to service_role;

-- 雙向自我驗證（PB-033）。
do $$
declare
  v_acl  text;
  v_def  text;
begin
  select p.proacl::text, pg_get_functiondef(p.oid) into v_acl, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'expire_tour_order';

  if v_def is null then
    raise exception 'expire_tour_order 未建立';
  end if;

  -- ① 三個前提條件都必須出現在 for update 的 select 裡，而不是事後才檢查
  if v_def !~* 'status\s*=\s*''PENDING''' then
    raise exception '① expire_tour_order 少了 status = PENDING 的重新檢查——已收款的訂單會被自動取消';
  end if;
  if v_def !~* 'hold_expires_at\s+is\s+not\s+null' then
    raise exception '① expire_tour_order 少了 hold_expires_at is not null 的重新檢查';
  end if;
  if v_def !~* 'hold_expires_at\s*<\s*now\(\)' then
    raise exception '① expire_tour_order 少了 hold_expires_at < now() 的重新檢查';
  end if;
  if v_def !~* 'for update' then
    raise exception '① expire_tour_order 沒有取得 row lock，條件不在鎖的保護範圍內求值';
  end if;

  -- ② 權限雙向
  if v_acl is null then
    raise exception '② expire_tour_order 的 proacl 為 NULL——PUBLIC 仍持有 EXECUTE';
  end if;
  if v_acl ~ '(^|,)\{?=X' or v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception '② expire_tour_order 仍對 PUBLIC/anon/authenticated 開放：%', v_acl;
  end if;
  if v_acl not like '%service_role=X%' then
    raise exception '② expire_tour_order 的 service_role 執行權被誤撤：%（cron 會全面失敗）', v_acl;
  end if;

  -- ③ 反向：不得動到通用的 cancel_tour_order
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cancel_tour_order'
  ) then
    raise exception '③ cancel_tour_order 不該被本檔影響，但它不見了';
  end if;
end $$;
