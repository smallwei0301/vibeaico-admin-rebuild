-- 0022 — issue #35：三頁「假欄位混在真資料列裡」的欄位落地
--
-- 背景：bookings / coupons / membership-levels 三頁把一部分欄位的值寫死在頁內
-- 常數（BOOKING_EXTRAS_* / COUPON_EXTRAS_* / LEVEL_EXTRAS_*），與同一列的真實
-- 資料混在一起顯示。本 migration 只補「原站確有、我方 schema 沒有」的那些欄位；
-- 判定依據逐欄記於 docs/integration/14-GAP-AUDIT.md §6.17 的盤點表。
--
-- ⚠️ 刻意**不**補 bookings.paid_amount（「已收金額」）：原站的 paidAmount 來自
-- 線上金流交易（issue #32 顧客端線上付款尚未建置），補它需要訂金／尾款／退款
-- 的連動規則，屬擁有者裁決事項，見 14 分冊 §6.17「待裁決」。

/* ---------------------------------------------------------------- 預約 */
-- 票券折抵／點數折抵的**已發生金額**。原站 apply-coupon 的回應含 couponDiscount
-- （docs/specs/bookings.json jsStrings[127]）；我方 apply-coupon / apply-points
-- 一直只把差額寫進 final_price，折抵了多少沒有留下來，於是頁面只能吃假資料。
-- null = 沒有紀錄（不是 0）：載入舊資料時畫面顯示「未知」而非「折抵 0 元」。
alter table bookings add column if not exists coupon_discount numeric;
alter table bookings add column if not exists points_redeemed int;

/* ---------------------------------------------------------------- 票券 */
-- 皆為原站 formModal 既有欄位（docs/specs/coupons.json modals[formModal].fields）
alter table coupons add column if not exists min_order_amount    numeric;
alter table coupons add column if not exists max_discount_amount numeric;
alter table coupons add column if not exists gift_item           text not null default '';
alter table coupons add column if not exists limit_per_customer  int;
alter table coupons add column if not exists private_mode        boolean not null default false;

/* ------------------------------------------------------------ 會員等級 */
-- 皆為原站 levelModal 既有欄位（docs/specs/membership-levels.json）
alter table membership_levels add column if not exists description text not null default '';
alter table membership_levels add column if not exists active      boolean not null default true;
alter table membership_levels add column if not exists is_default  boolean not null default false;

-- 「預設等級」每租戶至多一個（原站標籤為單數「設為預設等級」）。
create unique index if not exists u_membership_levels_default
  on membership_levels (tenant_id) where is_default;

/* ------------------------------------------------------------ view 更新 */
-- 顧客可用點數：預約頁的「使用點數」modal 需要餘額，customers.points 本來就有，
-- 只是沒有被 bookings_view 帶出來。
--
-- ⚠️ 這裡必須 drop + create，不能用 create or replace：view 是 `select b.*, …`，
-- 而 b.* 展開後的欄位順序會因為本檔剛加的 bookings 欄位（以及 0013 的
-- reminder_sent_at）而改變，Postgres 會回 42P16「cannot change name of view
-- column」。實測 400 的錯誤原文見本輪 issue 留言。
drop view if exists bookings_view;
create view bookings_view with (security_invoker = true) as
select b.*,
       c.name  as customer_name,
       c.phone as customer_phone,
       s.name  as service_name,
       st.name as staff_name,
       c.points as customer_points
from bookings b
join customers c  on c.id = b.customer_id
join services  s  on s.id = b.service_id
left join staff st on st.id = b.staff_id;
