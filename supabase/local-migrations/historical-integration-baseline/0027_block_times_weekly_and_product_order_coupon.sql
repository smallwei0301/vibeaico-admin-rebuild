-- 0027 — issue #33 第 ① ② 筆：商品訂單票券折抵、封鎖時段的「每週／自動產生」
--
-- ① product_orders 沒有任何票券欄位，於是 /tenant/product-orders 的「票券折抵」
--    列一直只能吃頁內假資料（d7b8158 已把寫死的 100 移除）。原站的
--    POST /api/product-orders/:id/apply-coupon 回應含 couponDiscount
--    （docs/specs/product-orders.json jsStrings[76]
--     「票券已套用！折抵 ${formatMoney(couponRes.data?.couponDiscount || 0)}」），
--    本 migration 補上存放「實際發生的折抵金額」的欄位。
--
-- ② block_times 表只有 id/tenant_id/staff_id/start_at/end_at/reason/created_at
--    （0004:115-124），沒有「每週重複」也沒有「自動產生」的概念。原站的
--    blockTimeModal 有 封鎖名稱(btTitle) / 原因(btReason) /
--    循環類型 SINGLE|WEEKLY(btRecurrence) / 星期幾(btDayOfWeek) /
--    整天封鎖(btFullDay) 五個欄位（docs/specs/block-times.json modals
--    [blockTimeModal].fields），列表也有「名稱／類型／日期/星期」三欄
--    （同檔 tables[0].columns）。auto 旗標的出處是
--    docs/specs/calendar.json jsStrings[78]：
--    「這是「每天不同營業時間」自動產生的休息時段，要調整請到 店家設定 → 營運時間」。

/* ------------------------------------------------------------ ① 商品訂單 */
-- 已發生的票券折抵金額。null = 沒有紀錄（不是 0），與 0022 對 bookings 的
-- coupon_discount 同一套語意：載入舊資料時畫面顯示「無」而非虛構一個 0。
-- 一張訂單套多張票券時累加。
alter table product_orders add column if not exists coupon_discount numeric;

-- 追溯性：哪一張票券實體被核銷在這張訂單上。bookings 因為表上沒有欄位，
-- 把它塞在 custom_fields jsonb 的 _coupon 鍵底下；product_orders 沒有 jsonb
-- 欄位，直接開一欄比再開一個 jsonb 誠實。
alter table product_orders add column if not exists coupon_instance_id uuid
  references coupon_instances(id) on delete set null;

/* ------------------------------------------------------------ ② 封鎖時段 */
-- 封鎖名稱。原站是必填（btTitle「封鎖名稱 *」），reason 才是選填的「原因」。
-- 我方接線前把兩欄併成一個 reason 用（block-times/page.tsx 的 Draft.title
-- 其實存進 reason），本欄補上之後兩者分家。
-- default '' 讓既有列不會變成 null（既有列的名稱就是它的 reason，由應用層回填）。
alter table block_times add column if not exists title text not null default '';

-- 循環類型。值域對齊原站 radio 的 value：'SINGLE' | 'WEEKLY'。
-- WEEKLY 的列表示「每週的 day_of_week 這一天、start_at/end_at 的時刻」重複，
-- **在讀取時展開**（/api/calendar、/api/bookings/available-slots），不預先
-- 產生一堆具體日期的列——預先產生需要一個維護視窗的排程，而那個排程不存在，
-- 有排程才敢說「未來每一週都擋得住」。
alter table block_times add column if not exists recurrence text not null default 'SINGLE';
alter table block_times drop constraint if exists block_times_recurrence_chk;
alter table block_times add constraint block_times_recurrence_chk
  check (recurrence in ('SINGLE', 'WEEKLY'));

-- WEEKLY 用的星期幾（0 = 週日，同原站 btDayOfWeek 的 option value 與
-- JS getDay()）。SINGLE 的列為 null。
alter table block_times add column if not exists day_of_week smallint;
alter table block_times drop constraint if exists block_times_day_of_week_chk;
alter table block_times add constraint block_times_day_of_week_chk
  check (day_of_week is null or (day_of_week between 0 and 6));

-- 整天封鎖（原站 btFullDay）。起訖時間仍然寫實際的 00:00–24:00，這一欄是
-- 「使用者當初勾的是整天」的原始意圖，回填表單時要用。
alter table block_times add column if not exists full_day boolean not null default false;

-- 由「每天不同營業時間」自動產生。true 的列不可在封鎖時段頁編輯／刪除，
-- 改逐日營業時間時整批重建（見 src/server/business-hours-blocks.ts）。
alter table block_times add column if not exists auto boolean not null default false;

-- 重建 auto 封鎖時要一次刪光本租戶的 auto 列，這是那個 delete 的索引。
create index if not exists i_block_times_tenant_auto
  on block_times (tenant_id, auto) where auto;
