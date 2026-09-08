-- 0093 — 已完成／已取消／爽約的預約不得再折抵點數（issue #291）
-- =============================================================================
-- `redeem_booking_points`（`0090`）的守門序列是：預約存在 → 點數為正 → 折抵不超過
-- 金額 → 顧客點數足夠。**沒有任何一道檢查 `bookings.status`。**
--
-- 於是一筆已取消的預約仍然折得下去：顧客的點數被真的扣掉、帳本真的記一筆，換到
-- 的是一筆不會發生的預約的折扣。點數等同金額（1 點 = 1 元），這是實質損失。
-- 已完成的預約同理——錢已經收了，事後再改 `final_price` 會讓帳目與實收金額對不起來。
--
-- Owner 2026-09-08 裁示：**擋 COMPLETED / CANCELLED / NO_SHOW，只允許 PENDING /
-- CONFIRMED**。想在完成後補折抵的情境，正確做法是把預約改回已確認再折抵，而不是
-- 讓一筆已結案的單子還能扣錢。
--
-- ⚠️ 這是一支 forward migration，**不修改 `0090`**。`0090` 已經套用到共用 TEST，
-- 依 PB-015／PB-017 只能往前補，不能回頭改已套用過的檔案。
--
-- ⚠️ 編號取 `0093` 而不是 `0092`：`0092` 已由 issue #37 的分支佔用。migration 編號
-- 是**跨分支的共用序列**（PB-017），先佔先得，不能因為自己這條分支上沒看到就重用。
--
-- 本檔只重建函式，不動任何資料列，也不建立或修改任何表。

create or replace function public.redeem_booking_points(
  p_tenant   uuid,
  p_booking  uuid,
  p_points   int
) returns table (final_price numeric, customer_points int) as $$
declare
  v_booking  record;
  v_customer record;
begin
  if p_points is null or p_points <= 0 then
    raise exception 'POINTS_INVALID' using errcode = 'P0003';
  end if;

  -- `for update` 取得列鎖：兩個併發折抵在這裡就被串行化（`0090` 的缺口 A 修法）。
  -- ⚠️ 這裡多取了 `b.status`，就是本次要用的那一欄。
  select b.id, b.customer_id, b.final_price, b.status into v_booking
    from public.bookings b
   where b.id = p_booking and b.tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- issue #291：狀態檢查放在「找到預約之後、其他業務檢查之前」。
  --
  -- 放這個位置的理由：一筆已取消的預約，回「這筆預約已結案，不能再折抵」比回
  -- 「顧客點數不足」或「折抵超過金額」有用得多——後兩者會讓店家去改點數或改金額，
  -- 而真正的問題根本不在那裡。
  --
  -- 用白名單而不是黑名單：`booking_status` 之後若新增列舉值（例如 REFUNDED），
  -- 黑名單會**默默放行**那個新狀態，白名單則會擋下來並讓人來決定。方向偏保守。
  if v_booking.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_NOT_ADJUSTABLE' using errcode = 'P0003';
  end if;

  if v_booking.customer_id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 折抵後不可低於 0（1 點 = 1 元）
  if v_booking.final_price - p_points < 0 then
    raise exception 'AMOUNT_EXCEEDED' using errcode = 'P0003';
  end if;

  select c.id, c.points into v_customer
    from public.customers c
   where c.id = v_booking.customer_id and c.tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.points < p_points then
    raise exception 'POINTS_INSUFFICIENT' using errcode = 'P0001';
  end if;

  update public.customers
     set points = points - p_points
   where id = v_customer.id and tenant_id = p_tenant;

  insert into public.customer_point_logs (
    tenant_id, customer_id, delta, reason, points_after
  ) values (
    p_tenant, v_customer.id, -p_points, 'REDEEM_BOOKING', v_customer.points - p_points
  );

  -- 由資料庫自己讀自己算，不接受呼叫端算好的值。
  --
  -- ⚠️ 右側**必須**寫成 `bookings.final_price`。本函式是 `returns table
  -- (final_price numeric, ...)`，那個 OUT 名稱同時是一個 PL/pgSQL 變數，未限定的
  -- `final_price` 會讓 Postgres 在執行期丟
  -- `column reference "final_price" is ambiguous`——不是建立時，是每一次呼叫。
  update public.bookings
     set final_price = bookings.final_price - p_points
   where id = p_booking and tenant_id = p_tenant;

  return query
    select b.final_price, c.points
      from public.bookings b
      join public.customers c on c.id = v_customer.id and c.tenant_id = p_tenant
     where b.id = p_booking and b.tenant_id = p_tenant;
end; $$ language plpgsql security definer set search_path = public;

-- PB-028 的三段式撤銷。**這一段的行為我實測過，結論與直覺不同，寫在這裡免得下一個
-- 人（或我自己）再推論一次：**
--
--   * `create or replace function` 作用在**既有函式**上時，**沿用原本的 ACL**，
--     不會退回預設。所以在 `0090` 已經跑過的資料庫上，就算把下面三行全部刪掉，
--     PUBLIC 也不會重新拿到 EXECUTE。（實測：刪掉 `from public` 那一行後套用，
--     ACL 仍是 `postgres=X | service_role=X`。）
--   * 但函式是**全新建立**時（乾淨資料庫、CI 的 local-isolated、或有人 drop 過），
--     PostgreSQL 會預設 grant EXECUTE 給 `PUBLIC`。這時少了 `from public` 那一行，
--     ACL 會變成 `=X/postgres | postgres=X | service_role=X`——`=X` 開頭那一項就是
--     PUBLIC，而 anon / authenticated 都是它的成員，側門就開著。
--     （實測：drop 後套用刪掉那一行的版本，下方自我核實確實 raise。）
--
-- 也就是說：三行都是必要的，而**必要性只在全新建立的路徑上顯現**。只在既有資料庫
-- 上驗證會得到「刪掉也沒事」的錯誤結論。
revoke all on function public.redeem_booking_points(uuid, uuid, int) from public;
revoke all on function public.redeem_booking_points(uuid, uuid, int) from anon, authenticated;
grant execute on function public.redeem_booking_points(uuid, uuid, int) to service_role;

-- 套用後自我核實：PUBLIC 不得留有 EXECUTE。
--
-- ⚠️ 這一段**不是裝飾**，但它只在「函式是全新建立」時擋得下東西（理由見上）。
-- 我用兩個變異實測過：在既有函式上刪掉 `from public` → 這段不會 raise（因為 ACL
-- 被沿用，本來就沒有 PUBLIC）；先 drop 再套用同一份 → 這段確實 raise。
-- 若哪天有人把它讀成「任何情況下都擋得住」，那是誤讀。
do $$
declare
  v_acl text;
begin
  select coalesce(array_to_string(proacl, ' | '), '(default: PUBLIC has EXECUTE)')
    into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_booking_points';
  -- 授予 PUBLIC 的項目在 ACL 文字裡是「`=` 前面沒有角色名」，例如 `=X/postgres`。
  -- `postgres=X/postgres` 之類的具名授權不該被誤判，所以錨在開頭或分隔符之後。
  if v_acl is null or v_acl ~ '(^|\| )=X/' then
    raise exception 'redeem_booking_points 仍對 PUBLIC 開放 EXECUTE：%', v_acl;
  end if;
end $$;
