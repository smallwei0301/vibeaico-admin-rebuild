# 10 — 行程領域與導遊金流（Phase 8）

> 讓 VibeAI 成為旅遊行程的**唯一事實來源**：行程/方案/團次/名額/旅遊訂單
> 全部只存在這個資料庫。Midao 前台與 VibeAI 公開商店頁都是它的客戶端（11 分冊）。
> 本冊依賴 Phase 0–3；金流設定頁依賴 §4。
>
> 決策背景（Owner 2026-08-21 拍板）：Midao 平台不再碰金流，收款由導遊自行設定
> （綠界 API 或匯款帳號）；Midao 商業模式改為 VibeAI 使用費＋前台上架費。
>
> **2026-08-27 Owner 補充裁示：**方案不綁導遊；實際人員綁在團次；一團支援一位
> PRIMARY 主導遊與多位 ASSISTANT 協同導遊；一般預約與團次必須雙向防撞；加購業績
> 採 C+（預設主導遊、可改派、可不計個人業績）；0 元允許、負數禁止。
> 決策背景見 `docs/decisions/2026-08-27-tour-guide-assignment.md`。

---

## 0. 領域模型與既有預約的關係

VibeAI 既有 `bookings` 是「時段 × 服務人員」（美髮/診所型）。旅遊是
「**團次（日期）× 方案 × 名額**」。兩者資料模型分開，但共用人員可用時間，
因此同一位導遊不能在同一時間同時被一般預約與旅遊團次指派。

```text
Trip 行程
├─ TripPlan 方案：價格／人數／定金／販售規則（不綁導遊）
├─ TripAddon 行程加購目錄
└─ TripDeparture 團次：日期／時間／名額
   ├─ TripDepartureStaff
   │  ├─ PRIMARY 主導遊（最多一位）
   │  └─ ASSISTANT 協同導遊（0..N）
   └─ TourOrder 旅遊訂單
      └─ TourOrderAddon 訂單實際加購快照＋業績歸戶
```

導遊租戶同時擁有既有全部功能（LINE、顧客、票券…）；行程是新增的一個領域，
不是 services 的變形。**名額扣減必須在資料庫層原子完成（§2）**；人員可用性則
必須由共用 availability engine 同時檢查 `shifts + bookings + block_times + departures`。

---

## 1. 資料表

RLS 樣板與 02 分冊 §0006 相同，全部套 `is_tenant_member(tenant_id)`；
公開讀取（前台看行程）走 API 層 service role + 顯式欄位挑選，不開匿名 RLS。

### 1.1 行程、方案、團次與訂單基礎

```sql
create type trip_status as enum ('DRAFT','PUBLISHED','ARCHIVED');
create type departure_status as enum ('OPEN','CLOSED','CANCELLED');
create type tour_order_status as enum ('PENDING','CONFIRMED','COMPLETED','CANCELLED');
create type tour_payment_status as enum ('UNPAID','PAID','REFUNDED');
create type tour_order_source as enum ('MIDAO','VIBEAI_SHOP','LINE','MANUAL');

create table trips (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  slug              text not null,
  title             text not null,
  summary           text not null default '',
  description       text not null default '',
  cover_image_url   text not null default '',
  gallery           jsonb not null default '[]',
  location          text not null default '',
  duration_hours    numeric,
  meeting_point     text not null default '',
  includes          text not null default '',
  notes             text not null default '',
  status            trip_status not null default 'DRAFT',
  midao_listing     text not null default 'NONE'
    check (midao_listing in ('NONE','PENDING','LISTED','REJECTED')),
  midao_listing_note text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table trip_plans (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  trip_id          uuid not null references trips(id) on delete cascade,
  name             text not null,
  description      text not null default '',
  price_per_person numeric not null,
  child_price      numeric,
  min_party        int not null default 1,
  max_party        int not null default 10,
  deposit_mode     text not null default 'FULL'
    check (deposit_mode in ('NONE','DEPOSIT_FIXED','DEPOSIT_PERCENT','FULL')),
  deposit_value    numeric not null default 0,
  sort_order       int not null default 0,
  active           boolean not null default true
);

create table trip_departures (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  trip_id      uuid not null references trips(id) on delete cascade,
  plan_id      uuid not null references trip_plans(id) on delete cascade,
  departs_on   date not null,
  start_time   time,
  capacity     int not null,
  seats_booked int not null default 0,
  status       departure_status not null default 'OPEN',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  check (seats_booked >= 0 and seats_booked <= capacity),
  unique (tenant_id, plan_id, departs_on, start_time)
);
create index i_departures on trip_departures (tenant_id, trip_id, departs_on);

create table tour_orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  order_no          text not null,
  trip_id           uuid not null references trips(id) on delete restrict,
  plan_id           uuid not null references trip_plans(id) on delete restrict,
  departure_id      uuid not null references trip_departures(id) on delete restrict,
  customer_id       uuid references customers(id) on delete set null,
  traveler_user_id  uuid,
  party_size        int not null,
  unit_price        numeric not null,
  total_amount      numeric not null,
  deposit_amount    numeric not null default 0,
  contact           jsonb not null default '{}',
  status            tour_order_status not null default 'PENDING',
  payment_status    tour_payment_status not null default 'UNPAID',
  payment_method_id uuid,
  payment_ref       text not null default '',
  source            tour_order_source not null,
  hold_expires_at   timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, order_no)
);
create index i_tour_orders on tour_orders (tenant_id, status, created_at desc);
create index i_tour_orders_traveler on tour_orders (traveler_user_id)
  where traveler_user_id is not null;
```

**方案不放 `staff_id`。** 同一個「4 人包團」方案，9/10 可由小王執行、9/11 可由小李執行；
若把人員綁在方案，會把販售規則和實際排班混在一起。

### 1.2 `trip_addons`：行程可販售的加購目錄

```sql
create table trip_addons (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  trip_id    uuid not null references trips(id) on delete cascade,
  name       text not null,
  price      numeric not null default 0 check (price >= 0),
  unit       text not null default 'PER_PERSON'
    check (unit in ('PER_PERSON','PER_GROUP')),
  stock      int check (stock is null or stock >= 0),
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`trip_addons` 只是目錄，不是某張訂單真正買了什麼。訂單成立後必須另存 §1.4 的快照。

### 1.3 `trip_departure_staff`：團次實際執行人員

不要只在 `trip_departures` 塞一個 `staff_id`，因為一團可能有主導遊與協同導遊。

```sql
create type departure_staff_role as enum ('PRIMARY', 'ASSISTANT');

create table trip_departure_staff (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  departure_id  uuid not null references trip_departures(id) on delete cascade,
  staff_id      uuid not null references staff(id) on delete restrict,
  role          departure_staff_role not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, departure_id, staff_id)
);

create unique index one_primary_staff_per_departure
  on trip_departure_staff(departure_id)
  where role = 'PRIMARY';
```

相容策略：既有團次可暫時誠實顯示「未指派」；但新建或重新編輯且狀態為 `OPEN` 的團次，
完成後必須有一位 PRIMARY。不得替舊資料假造主導遊。

### 1.4 `tour_order_addons`：訂單加購與業績快照

```sql
create type addon_performance_mode as enum ('PRIMARY', 'SPECIFIC_STAFF', 'NONE');

create table tour_order_addons (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  order_id              uuid not null references tour_orders(id) on delete cascade,
  trip_addon_id         uuid references trip_addons(id) on delete set null,
  name                  text not null,
  unit_price            numeric not null check (unit_price >= 0),
  quantity              int not null default 1 check (quantity >= 1),
  applied_amount        numeric not null check (applied_amount >= 0),
  performance_mode      addon_performance_mode not null default 'PRIMARY',
  specific_staff_id     uuid references staff(id) on delete set null,
  performance_staff_id  uuid references staff(id) on delete set null,
  performance_amount    numeric,
  created_at            timestamptz not null default now(),
  check (
    (performance_mode = 'SPECIFIC_STAFF' and specific_staff_id is not null)
    or performance_mode <> 'SPECIFIC_STAFF'
  )
);
```

- `PRIMARY`：預設歸團次主導遊。
- `SPECIFIC_STAFF`：改派指定人員。
- `NONE`：門票、餐費、車資等只算店家營收，不計個人業績。
- 訂單 `COMPLETED` 時解析真正歸屬，凍結到 `performance_staff_id`／`performance_amount`。
- 完成後不得因日後改派導遊而回頭改歷史業績。
- 0 元可代表招待／贈送／免費升級；負數一律拒絕。

---

## 2. 名額原子扣減（禁止在應用層算庫存）

```sql
create or replace function reserve_seats(p_departure uuid, p_count int) returns void as $$
begin
  update trip_departures
     set seats_booked = seats_booked + p_count
   where id = p_departure and status = 'OPEN'
     and seats_booked + p_count <= capacity;
  if not found then
    raise exception 'SEATS_UNAVAILABLE' using errcode = 'P0001';
  end if;
end; $$ language plpgsql security definer set search_path = public;

create or replace function release_seats(p_departure uuid, p_count int) returns void as $$
begin
  update trip_departures
     set seats_booked = greatest(seats_booked - p_count, 0)
   where id = p_departure;
end; $$ language plpgsql security definer set search_path = public;

revoke execute on function reserve_seats, release_seats from anon, authenticated;
```

**建立訂單與 `reserve_seats` 必須同一交易**（包成 `create_tour_order` RPC）；取消／過期釋放
名額時也要同交易改訂單狀態。剩餘名額永遠即時計算 `capacity - seats_booked`，不做快取。
錯誤碼：`TOUR_001` 名額不足（409）。

---

## 3. 訂單生命週期與名額保留

```text
PENDING（已佔名額）──付款確認──► CONFIRMED ──出團後──► COMPLETED
   │                                  │
   └─ 過期/取消 ─► CANCELLED（釋放名額）◄─ 取消（已付款須人工退款）
```

| 付款方式 | hold_expires_at | 過期處理 |
|---|---|---|
| 綠界（線上刷卡） | 下單 + 30 分鐘 | cron 釋放名額、訂單 CANCELLED |
| 匯款 | 下單 + 3 天（租戶可設定） | 旅客回報後五碼 → 導遊確認收款 → CONFIRMED |
| LINE / 手動單 | null | 不自動過期，由導遊管理 |

cron：`/api/cron/tour-order-expiry`（每小時，併入 07 分冊與 `vercel.json`）。
狀態變更走 LINE 推播 + Email，開關沿用 06／05 分冊機制。

---

## 4. 導遊自訂金流

**設定 UI 已存在**：`/tenant/payment-methods` 頁支援六種收款類型與雙金流商。

```sql
create type payment_method_type as enum
  ('LINE_PAY','JKOPAY','BANK_TRANSFER','CASH','ONLINE_PAYMENT','OTHER');
create type gateway_provider as enum ('NEWEBPAY','ECPAY');

create table tenant_payment_methods (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  method_type           payment_method_type not null,
  display_name          text not null default '',
  qr_image_url          text not null default '',
  config                jsonb not null default '{}',
  gateway_provider      gateway_provider,
  gateway_merchant_id   text not null default '',
  gateway_hash_key_enc  text not null default '',
  gateway_hash_iv_enc   text not null default '',
  gateway_verified_at   timestamptz,
  active                boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now()
);
```

端點：`GET/POST /api/payment-methods`、`PUT/DELETE /api/payment-methods/:id`、
`toggle-active`、`test-connection`、`test-charge`。秘密欄位遮罩與空字串不覆蓋規則同 LINE。

- 線上刷卡支援 ECPAY／NEWEBPAY，依租戶所選金流商產生表單。
- QR 類型在 checkout 顯示 QR 圖＋人工回報付款。
- 綠界 callback 必須驗 CheckMacValue、冪等，並回綠界要求的純文字格式。
- 匯款：旅客填後五碼，導遊後台確認收款。
- 退款由導遊人工處理，後台只記 `REFUNDED`；平台不經手款項。

---

## 5. 後台管理端點與頁面

| 端點 | 說明 |
|---|---|
| GET/POST `/api/trips`、GET/PUT/DELETE `/api/trips/:id` | 行程 CRUD；有訂單時 DELETE 改 ARCHIVED |
| POST `/api/trips/:id/publish‖unpublish` | DRAFT↔PUBLISHED |
| POST `/api/trips/:id/request-midao-listing` | NONE/REJECTED→PENDING；Midao 審核見 11 分冊 |
| GET/POST `/api/trips/:id/plans`、PUT/DELETE `/api/trip-plans/:id` | 方案 CRUD；方案不綁導遊 |
| GET/POST `/api/trips/:id/departures`、batch、PUT/DELETE `/api/trip-departures/:id` | 團次與人員指派；capacity 不得低於已售 |
| GET/POST `/api/trips/:id/addons`、PUT/DELETE `/api/trip-addons/:id` | 行程加購目錄 CRUD |
| GET `/api/tour-orders`、GET `:id` | 訂單列表／詳情 |
| POST `/api/tour-orders/:id/confirm-payment‖complete‖cancel` | 狀態動作；cancel 釋放名額 |
| POST `/api/tour-orders/manual` | 導遊代旅客建單 |
| POST/DELETE `/api/tour-orders/:id/addons`（實際路徑於 04 分冊定案） | 訂單加購快照與 C+ 歸戶 |
| POST `/api/trips/import`、GET `/api/trips/:id/export` | tour-platform JSON 匯入／匯出 |

新頁面：

1. `/tenant/trips` 行程列表
2. `/tenant/trips/[id]` 行程／方案／加購編輯
3. `/tenant/trips/[id]/departures` 團次月曆與人員指派
4. `/tenant/tour-orders` 旅遊訂單列表／詳情

### 5.1 團次建立與修改 UI

團次 Modal 必須包含：

```text
方案／日期／時間／名額
主導遊（OPEN 新團必填）
協同導遊（可複選）
備註
```

選好方案、日期、時間後才載入人員狀態：

```text
✅ 小王  可帶團
❌ 小美  09:00–12:00 已有預約
❌ 阿杰  今日未排班
✅ Amy   可帶團
```

忙碌人員可顯示但不可儲存；錯誤必須說明衝突來源與時間，不只回「409」。
前端只做提示，後端儲存前必須再次檢查，以防兩個管理者同時操作。

### 5.2 批次開團

第一版不做 AI 自動分派。管理者先選 PRIMARY／ASSISTANT，後端逐日驗證。
回應擴充：

```ts
type DepartureConflict = {
  date: string;
  staffId: string;
  staffName: string;
  reason: 'SHIFT' | 'BOOKING' | 'BLOCK' | 'DEPARTURE';
  conflictStart?: string;
  conflictEnd?: string;
};
```

預設語意：可用日期建立、衝突日期跳過並回 `conflicts[]`。不得默默建立成未指派團次，
畫面必須分開顯示 `created / skipped / conflicts` 的真實數字。

### 5.3 共用人員可用性引擎

建議抽成 `src/server/staff-availability.ts`，由以下三處共同使用：

- `/api/bookings/available-slots`
- 團次單筆 create／update
- 團次 batch create

候選人必須同時滿足：

1. `staff.active=true` 且 `bookable=true`。
2. 當日有 shift 資料時，該員工班段涵蓋完整團次；租戶當日完全沒有 shift 時，沿用既有慣例視為可排。
3. 不與個人／全店 `block_times` 重疊。
4. 不與該員工 PENDING／CONFIRMED 一般 `bookings` 重疊。
5. 不與該員工其他非 CANCELLED 團次重疊。
6. 外部行事曆尚未正式實作前不假裝已納入；日後 EXTERNAL 上線時加入同一引擎。

時間區間：

- 有 `start_time`：`start = departs_on + start_time`；`end = start + plan.duration_minutes`。
- 無 `start_time`：該日整日忙碌。
- PRIMARY 與所有 ASSISTANT 都占用時間。
- CANCELLED 團次釋放時間。

### 5.4 一般預約與團次雙向防撞

- 一般預約已占用小王 → 重疊團次不可再指派小王。
- 小王已被團次指派 → `/api/bookings/available-slots` 不得回小王。
- 未被該團指派的其他員工不受影響，**不得使用全店粗略封鎖**。
- 團次改派後，原人員立即釋放，新人員立即占用。
- 人員、團次、預約皆須驗證同租戶；跨租戶 ID 一律拒絕。

### 5.5 行事曆整合（團次會、方案不會）

只有「有日期」的東西上行事曆：

| 對象 | 上行事曆 | 呈現 |
|---|---|---|
| 團次 | ✅ | 行程 · 方案、日期／時間、報名數、主／協同導遊 |
| 方案 | ❌ | 沒有日期，從行程編輯頁查看 |
| 旅遊訂單 | ❌（獨立列） | 掛在團次下，點團次展開報名名單 |

三個落點：

1. `GET /api/calendar` 合併 BOOKING＋DEPARTURE。DEPARTURE 帶：
   `primaryStaffId/Name`、`assistantStaffIds/Names`。
2. ICS feed 同時含一般預約與團次；團次 DESCRIPTION 至少含主導遊，協同導遊存在時一併列出；取消團標 `STATUS:CANCELLED`。
3. `/api/bookings/available-slots` 依 `trip_departure_staff` 精準排除被指派人員的團次時段。

### 5.6 加購業績 C+

#### 一般 `booking_addons`

- 指定 `staff_id` → 業績算該人。
- 未指定 → 繼承 `bookings.staff_id`。
- 必須補明確「不計個人業績」語意，不能讓 `null` 同時代表「繼承」與「NONE」。
- 此規則取代舊 0020 migration 註解中「staff_id 不參與業績、全部算主服務人員」的裁示。

#### 旅遊 `tour_order_addons`

- 預設 `PRIMARY`。
- 可 `SPECIFIC_STAFF`。
- 可 `NONE`。
- 訂單 COMPLETED 時凍結 `performance_staff_id / performance_amount`。
- 個人業績報表只算已完成且有歸戶的快照；NONE 只進店家營收。

---

## 6. LINE 流程延伸

### 6.1 目錄與問答

導遊模組新增內建關鍵字組，只在租戶有 `TOUR_MODULE` 時顯示：

| key | 標籤 | 觸發字 | Bot 回應 |
|---|---|---|---|
| `TRIP` | 行程 | 行程、有什麼行程、報名、揪團、出團 | PUBLISHED 行程 Flex 輪播 |
| `DEPARTURE` | 出團日期 | 哪天出團、還有位子嗎、剩幾位 | 未來 14 天 OPEN 團次與即時餘額 |

`BOOKING` 在服務與行程都有的店先詢問「想預約服務還是行程？」；`MY_BOOKING`／`ORDER`
合併回傳一般 bookings 與 tour_orders。

AI 客服 system prompt 必須包含行程、方案價格、未來 14 天團次與即時剩餘名額。

### 6.2 LINE 內下單

v1：行程卡片「我要預約」開商店頁 checkout。

v2：postback 流程：選方案 → 選團次 → 輸入人數 → 確認 → RPC 建單佔名額 → 付款指示。
名額只在最後建單時鎖定；若剛好額滿，回 `TOUR_001` 並要求改選日期。

---

## 7. 必測情境

1. 小王 09:00–12:00 已有一般預約，建立 08:00–18:00 團次指派小王 → 409，團次／指派零半成品。
2. 小王已有 08:00–18:00 團次，一般服務查 10:00 → 小王不得出現在 `staffIds`。
3. 小王已有 A 團 08:00–18:00，再建立 B 團 17:00–20:00 → 409。
4. A 團 CANCELLED → 同時間可重新指派。
5. ASSISTANT 也占用時間。
6. 無 `start_time` 團次 → 被指派人員整日不可再排。
7. batch 8 日中 2 日衝突 → 只建 6 日，回 conflicts 2 筆，畫面不得宣稱建 8 團。
8. 跨租戶 staffId／departureId 一律拒絕。
9. 加購 PRIMARY／SPECIFIC_STAFF／NONE 三種歸戶正確，完成後歷史不漂移。
10. 0 元加購可建立並留紀錄；負數拒絕。
11. 兩個並發 checkout 搶最後一席，恰好一成一敗。
12. calendar／ICS 顯示主／協同導遊，改派後反映最新值。

完整清單見 `docs/integration/10-TOUR-DOMAIN-CHECKLIST.md`。

---

## 8. 遷移與安全門檻

- 新增能力，不把 `services` 與 `trips` 合併。
- 不把方案綁人。
- 既有團次可暫時未指派，但 UI 必須誠實顯示。
- #8-A 的 `0021_issue_8_tour_integrity.sql` 以 tenant-aware composite FK
  鎖住 `TripPlan／TripAddon → Trip` 與 `TripDeparture → Trip／TripPlan`，並在
  migration 前 fail-closed 檢查既有資料；它不建立 `tour_orders`、名額 RPC、
  人員指派或 availability。
- core mutation API 必須同時通過 `MANAGER` 與 `TOUR_MODULE`；資料庫 RLS
  仍沿用 `is_tenant_member(tenant_id)`。把直接 Supabase REST 寫入再收緊成
  role-aware ACL 是獨立的 system／Owner decision，本冊不自行推論。
- Plan 的 `DEPOSIT_PERCENT` 為 1–100；`DEPOSIT_FIXED` 為正數且不得超過
  方案每人價格；`NONE／FULL` 的 `deposit_value` 必須為 0。訂單總額與
  rounding 快照留在後續 checkout／order slice。
- 新 migration 先 source review、TEST、整合測試；**Production DDL 需 Owner 明確授權**。
- mock 模式必須維持；型別擴充只新增 optional 相容欄位。
- 正式環境部署與會改變 runtime 的 main merge 仍需 Owner 明確授權。

---

## 本冊驗收摘要

- [ ] 行程／方案／團次／訂單／加購的 CRUD 與狀態機全綠
- [ ] 名額並發最後一席恰好一成一敗
- [ ] 團次 PRIMARY／ASSISTANT 指派與跨租戶隔離全綠
- [ ] 一般預約 ↔ 團次雙向撞班全綠
- [ ] batch 部分衝突真實回報
- [ ] `tour_order_addons` C+ 歸戶、0 元／負數邊界全綠
- [ ] 綠界／匯款／過期釋放名額流程全綠
- [ ] calendar／ICS 含團次與人員，CANCELLED 正確
- [ ] LINE 行程目錄與即時名額正確
- [ ] mock、typecheck、build、unit、integration、e2e 全綠
