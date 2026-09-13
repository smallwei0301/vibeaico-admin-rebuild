-- 0020_booking_addons.sql — 預約加購明細（GitHub issue #17 / 補齊-2）
--
-- 原站有這個功能（docs/specs/bookings.json 的 jsApiCalls：
-- `/api/bookings/${b.id}/addons`、`/api/bookings/${bookingId}/addons/${itemId}`），
-- 我方後端零實作、04 分冊 §B-1 亦零記載，故本檔為新建。契約補寫於
-- docs/integration/04-API-CONTRACTS.md §B-1.1。
--
-- ⚠️ 與 trip_addons（10 分冊 §5 / Phase 8b「行程加購」）是**兩個不同的資料模型**，
-- 只是同名。CLAUDE.md 明令 services 與 trips 兩套庫存模型不得合併；LOCAL_SHOP／
-- CLINIC 租戶根本不會開 TOUR_MODULE，卻一樣要有預約加購。issue #3 內文把本功能
-- 誤標為「Phase 8b 排期」，成因即此同名（記於 14 分冊 §8）。
--
-- 欄位設計說明（為什麼要存 applied_*）
-- ---------------------------------------------------------------------------
-- bookings.final_price 在本專案是一個**流水餘額**，不是由組成項推導出來的值：
-- adjust-price 直接絕對覆寫、apply-coupon／apply-points 都以「目前的 final_price」
-- 為基底加減（見 apply-coupon/route.ts 的註解）。因此刪除加購時無法「重算」，
-- 只能「回沖」。回沖若在刪除當下用 price × quantity 重新算一次，跟當初實際加上去
-- 的數字未必相同（日後若開放編輯加購、或計價規則變動就會分岔）。
-- 所以建立當下實際加進去的金額與分鐘各存一欄，刪除時嚴格減回同一個數字——
-- 「回沖」的定義因此是**當初那一次異動的精確反向操作**，而不是一個事後推算值。
--
-- staff_id 只是「誰做的」的紀錄，**不參與業績歸戶**：
-- 依 2026-08-25 主導者裁示（issue #1 留言 comment-5412922443），加購金額
-- 「與主服務同一位服務人員、依實收金額全額計入」——也就是靠 final_price 進到
-- /api/reports/staff-performance 既有的 `group by bookings.staff_id` 聚合。
-- 該算法是**我們選的，不是從原站還原的**（同上裁示原文）。欄位仍照原站表單存下來，
-- 日後若改成逐項歸戶不需要補資料。
--
-- notified：這一筆加購「實際上」有沒有通知到顧客（不是「有沒有要求通知」）。
-- 值域見 04 分冊 §B-1.1；用途是讓畫面說得出真的發生過的事，不要寫死「已通知」。

create table booking_addons (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  booking_id       uuid not null references bookings(id) on delete cascade,
  -- 「從服務清單帶入」時記來源服務；自由輸入（耗材／商品類）為 null
  service_id       uuid references services(id) on delete set null,
  name             text not null,
  price            numeric not null default 0 check (price >= 0),
  quantity         int not null default 1 check (quantity >= 1),
  duration_minutes int not null default 0 check (duration_minutes >= 0),
  -- 執行人員（原站 addonStaffSelect）；null = 同本預約的人員。不參與業績歸戶，見檔頭
  staff_id         uuid references staff(id) on delete set null,
  -- 建立當下實際加進 bookings.final_price / duration_minutes 的量（回沖用，見檔頭）
  applied_amount   numeric not null default 0,
  applied_minutes  int not null default 0,
  -- 消費明細通知的實際結果（不是意圖）
  notified         text not null default 'NONE'
    check (notified in ('NONE','LINE','NO_LINE','NOT_CONFIGURED','QUOTA_EXCEEDED','FAILED')),
  created_at       timestamptz not null default now()
);

-- 明細清單一律「某筆預約、依建立時間」查詢
create index i_booking_addons_booking on booking_addons (tenant_id, booking_id, created_at);

-- RLS：02 分冊 §0006 慣例（四條 is_tenant_member），寫法同 0016 的 trips/trip_plans
alter table booking_addons enable row level security;

create policy p_booking_addons_s on booking_addons for select using (is_tenant_member(tenant_id));
create policy p_booking_addons_i on booking_addons for insert with check (is_tenant_member(tenant_id));
create policy p_booking_addons_u on booking_addons for update using (is_tenant_member(tenant_id));
create policy p_booking_addons_d on booking_addons for delete using (is_tenant_member(tenant_id));
