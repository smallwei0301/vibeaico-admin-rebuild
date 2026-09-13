-- issue #218: 預約點數折抵的三步寫入改為單一交易，並補上 final_price 的 CAS。
--
-- `POST /api/bookings/:id/apply-points` 目前做三件事，彼此沒有交易保護：
--   ① 扣 `customers.points`（已有 CAS，擋得住 lost update）
--   ② insert `customer_point_logs`
--   ③ update `bookings.final_price = 讀到的舊值 - points`
--
-- 兩個缺口：
--
-- **A. `final_price` 沒有 CAS。** ③ 用的是進函式時讀到的 `final_price`。兩個併發
--    請求各折 30 點：①的 CAS 讓兩次扣點都成功（100 → 70 → 40，**點數真的少了 60**），
--    但兩邊都把 `final_price` 寫成「讀到的 100 − 30 = 70」。
--    **顧客付出 60 點，只換到 30 元折扣。** 這是本 issue 的核心症狀。
--
-- **B. 三步不在同一交易。** ② 或 ③ 失敗時，①已經扣掉的點數收不回來——
--    顧客的點數消失，卻沒有折扣、也沒有帳本紀錄可查。
--
-- 兩者都由這支 rpc 一次解決：plpgsql 函式本身就是一個交易，任何一步 raise
-- 都會讓整筆回滾；而 `final_price` 的扣減直接寫成
-- `final_price = final_price - p_points`（**由資料庫自己讀自己算**），
-- 併發時由 row lock 串行化，不可能有兩個請求各自從同一個舊值出發。
--
-- Contract: docs/integration/04-API-CONTRACTS.md §B-1。

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

  -- `for update` 取得列鎖：兩個併發折抵在這裡就被串行化，第二個看到的是第一個
  -- 寫完之後的值，而不是同一個舊值。這一句是缺口 A 的修法核心。
  select b.id, b.customer_id, b.final_price into v_booking
    from public.bookings b
   where b.id = p_booking and b.tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
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
  -- 讀 SQL 文字的單元測試看不出這件事，只有真的打一次資料庫才會發現。
  update public.bookings
     set final_price = bookings.final_price - p_points
   where id = p_booking and tenant_id = p_tenant;

  return query
    select b.final_price, c.points
      from public.bookings b
      join public.customers c on c.id = v_customer.id and c.tenant_id = p_tenant
     where b.id = p_booking and b.tenant_id = p_tenant;
end; $$ language plpgsql security definer set search_path = public;

-- security definer 繞過 RLS，因此函式內自己以 `tenant_id = p_tenant` 過濾每一句，
-- 並對前端持有的 token 撤銷執行權——否則任何登入者都能扣別家店顧客的點數。
--
-- ⚠️ 只撤 `anon, authenticated` 是不夠的：PostgreSQL 對新建函式**預設就 grant
-- EXECUTE 給 `PUBLIC`**，而 anon / authenticated 都是 PUBLIC 的成員，那條預設
-- 授權會讓瀏覽器仍然叫得到這支 RPC——側門還開著。#271 的 Sol audit 在
-- `0087` 的四支 tour-order RPC 上抓到的正是同一個洞（由 `0088` 補），這裡一開始
-- 就用同樣的三段式，不要讓同一個洞在第二個地方重演。
revoke all on function public.redeem_booking_points(uuid, uuid, int) from public;
revoke all on function public.redeem_booking_points(uuid, uuid, int) from anon, authenticated;
grant execute on function public.redeem_booking_points(uuid, uuid, int) to service_role;
