-- 0119 — Issue #18 缺口 A：owner-notify「本人確認加入」的 3 位上限併發洞。
--
-- `src/server/owner-notify.ts` 的 `confirmOwnerNotifyBind()` 目前是
-- 「先 count 再 insert」（app 層兩個查詢，不在同一交易）：
--
--   select count(*) from owner_notify_recipients where tenant_id = :t
--   if count >= 3 then reject
--   insert into owner_notify_recipients (...)
--
-- 兩個 LINE 好友幾乎同時在 LINE 上點「是我，加入通知」時，兩個 webhook
-- postback 各自的 count 查詢都可能讀到「目前 2 位」，兩者都判斷「還沒滿」，
-- 兩者都執行 insert——最終變成 4 位，突破 Issue #18 明文裁決的
-- 「上限 3 位、無付費解鎖」。這與本檔 0090（`redeem_booking_points`）修的
-- final_price CAS 缺口、0070（welcome-card 圖片）修的併發覆蓋缺口是同一種病：
-- 「先查後寫」在併發下不是原子操作。
--
-- 修法：把「驗證 bind request → 檢查上限 → insert → 標記 CONFIRMED」四步收進
-- 單一 SECURITY DEFINER RPC，用 `pg_advisory_xact_lock` 把同一租戶的併發確認
-- 全部串行化（沿用 0012 / 0070 / 0103 已有的 advisory lock 慣例），交易內
-- `count(*)` 讀到的一定是上一個已提交交易之後的最新值，不會再有兩邊都讀到
-- 「還沒滿」的窗口。
--
-- 上限常數 3 與 `src/server/owner-notify.ts` 的 `OWNER_NOTIFY_MAX_RECIPIENTS`
-- 刻意各自硬編一份（0116 檔頭已說明理由：這個數字本來就不打算做成可調欄位，
-- 兩處都要動正是刻意的摩擦），此處用一個 SQL 常數函式集中，避免同一個數字
-- 散在多個 plpgsql 區塊裡各自打一次字。
create or replace function public.owner_notify_max_recipients()
returns int
language sql
immutable
as $$ select 3 $$;

create or replace function public.confirm_owner_notify_bind(
  p_tenant_id     uuid,
  p_request_id    uuid,
  p_line_user_id  text
) returns table (
  ok          boolean,
  reason      text,
  is_primary  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   record;
  v_count int;
begin
  if p_tenant_id is null or p_request_id is null or p_line_user_id is null or p_line_user_id = '' then
    return query select false, 'INVALID_OR_USED', null::boolean;
    return;
  end if;

  -- 同租戶的併發確認在這裡串行化；不同租戶用不同 lock key，互不阻塞。
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':owner_notify_recipients'));

  select id, line_user_id, status, expires_at into v_req
    from public.owner_notify_bind_requests
   where id = p_request_id and tenant_id = p_tenant_id
   for update;

  if not found or v_req.status <> 'PENDING' then
    return query select false, 'INVALID_OR_USED', null::boolean;
    return;
  end if;

  if v_req.line_user_id <> p_line_user_id then
    return query select false, 'USER_MISMATCH', null::boolean;
    return;
  end if;

  if v_req.expires_at < now() then
    update public.owner_notify_bind_requests
       set status = 'EXPIRED'
     where id = p_request_id and tenant_id = p_tenant_id;
    return query select false, 'EXPIRED', null::boolean;
    return;
  end if;

  -- advisory lock 已持有，這裡的 count 是「上一個已提交交易之後」的真值，
  -- 不會再看到別的併發請求還沒 commit 的舊快照。
  select count(*) into v_count
    from public.owner_notify_recipients
   where tenant_id = p_tenant_id;

  if v_count >= public.owner_notify_max_recipients() then
    update public.owner_notify_bind_requests
       set status = 'CANCELLED'
     where id = p_request_id and tenant_id = p_tenant_id;
    return query select false, 'LIMIT_REACHED', null::boolean;
    return;
  end if;

  insert into public.owner_notify_recipients (tenant_id, line_user_id, is_primary)
  values (p_tenant_id, p_line_user_id, v_count = 0);

  update public.owner_notify_bind_requests
     set status = 'CONFIRMED', confirmed_at = now()
   where id = p_request_id and tenant_id = p_tenant_id;

  return query select true, null::text, (v_count = 0);
end;
$$;

-- 同一種三段式撤權（0090 已在檔內解釋過為什麼只撤 anon/authenticated 不夠：
-- PostgreSQL 對新函式預設把 EXECUTE 授權給 PUBLIC，anon/authenticated 都是
-- PUBLIC 成員，漏撤 PUBLIC 等於側門沒關）。webhook 沒有登入 session，一律用
-- service-role admin client 呼叫，不開放給前端持有的 token。
revoke all on function public.confirm_owner_notify_bind(uuid, uuid, text) from public;
revoke all on function public.confirm_owner_notify_bind(uuid, uuid, text) from anon, authenticated;
grant execute on function public.confirm_owner_notify_bind(uuid, uuid, text) to service_role;

revoke all on function public.owner_notify_max_recipients() from public;
revoke all on function public.owner_notify_max_recipients() from anon, authenticated;
grant execute on function public.owner_notify_max_recipients() to service_role;
