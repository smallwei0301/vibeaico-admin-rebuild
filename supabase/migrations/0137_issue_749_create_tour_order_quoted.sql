-- Issue #749：旅客在 /s/{shopCode}/plans/{planId}/book 與 /request 頁面看到的金額，必須等於
-- 實際建立的 `tour_orders.total_amount`。頁面載入後店家若改了基本價或季節價，原本的送出流程
-- 會靜默以「新價格」建單，旅客付的不是他確認過的金額。
--
-- ## 本檔補的行為
--
-- 新增 `create_tour_order_quoted`：參數與 `create_tour_order`（0132／0136）完全相同，再多一個
-- `p_expected_total`（旅客在頁面上看到並確認的總額）。本體只做三件事：
--   1. 呼叫既有 `create_tour_order(...)` 建單（沿用同一套計價、鎖位、snapshot 規則，不另寫第二份）；
--   2. 讀回剛建好那一筆的 `total_amount`／`unit_price`；
--   3. 與 `p_expected_total` 比對，不相符就 `raise exception 'PRICE_CHANGED'`（errcode P0004），
--      並把「現在的實際金額」以 JSON 放進 `detail`，讓呼叫端回給旅客重新確認。
--
-- ## Atomicity
--
-- 函式本身就是一個交易；`raise exception` 會讓整個 RPC 回滾，包含 `reserve_seats` 對
-- `trip_departures.seats_booked` 的扣減與 `tour_orders` 的 insert。因此價格不符時
-- 不會留下錯價訂單，也不會留下被佔住的名額。這個比對是在「與計價同一個交易」內完成，
-- 沒有 server 端先查價、再建單之間的 TOCTOU 空窗。
--
-- ## 不修改 create_tour_order
--
-- 沿用 0134／0136 的「不可覆寫、只增不改」作法：本檔不 `create or replace` create_tour_order，
-- 也不動它的 ACL；舊頁面快取（不帶 expectedTotal）仍呼叫原函式。
--
-- ## 發布順序與範圍
--
-- - 必須在 0132（create_tour_order 的季節計價版本）與 0136（security invoker）之後套用。
-- - security invoker：與 0136 同理，呼叫端（service_role）自己的權限決定可讀寫的表，
--   不以函式 owner 權限放大。
-- - ACL 比照 0088：PostgreSQL 預設把執行權限給 PUBLIC，必須先 revoke，再只 grant service_role。
-- - 本 migration 只新增 source，不套用到任何環境；Production 套用屬 #755 受控 release。
--   在 Production 套用前，server 端會偵測函式不存在並走非原子的價格預檢 fallback。

create or replace function public.create_tour_order_quoted(
  p_tenant         uuid,
  p_order_no       text,
  p_departure      uuid,
  p_party_size     int,
  p_customer       uuid,
  p_contact        jsonb,
  p_source         public.tour_order_source,
  p_payment_method uuid,
  p_note           text,
  p_hold_expires   timestamptz,
  p_expected_total numeric
) returns uuid as $$
declare
  v_id    uuid;
  v_total numeric;
  v_unit  numeric;
begin
  v_id := public.create_tour_order(
    p_tenant, p_order_no, p_departure, p_party_size, p_customer,
    p_contact, p_source, p_payment_method, p_note, p_hold_expires
  );

  select o.total_amount, o.unit_price into v_total, v_unit
    from public.tour_orders o
   where o.id = v_id;

  if v_total is distinct from p_expected_total then
    raise exception 'PRICE_CHANGED' using errcode = 'P0004',
      detail = json_build_object('unitPrice', v_unit, 'total', v_total)::text;
  end if;

  return v_id;
end;
$$ language plpgsql security invoker set search_path = public;

revoke all on function public.create_tour_order_quoted(
  uuid, text, uuid, integer, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz, numeric
) from public;
revoke all on function public.create_tour_order_quoted(
  uuid, text, uuid, integer, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz, numeric
) from anon, authenticated;
grant execute on function public.create_tour_order_quoted(
  uuid, text, uuid, integer, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz, numeric
) to service_role;
