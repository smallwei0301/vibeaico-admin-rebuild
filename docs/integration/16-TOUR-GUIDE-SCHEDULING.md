# 16 — 團次導遊指派、撞班防護與加購業績歸戶

> Owner 決策日期：2026-08-27。
>
> 本文件是 `10-TOUR-DOMAIN.md` 的補充規格。若本文件與既有文件對「團次人員指派、團次佔用員工時間、行程加購業績歸戶」的描述衝突，**以本文件為準**，直到內容回併 10 分冊為止。
>
> 目標：讓 Midao 的「行程／方案／團次／導遊／訂單／加購」形成一棵一致的資料樹，避免同一位導遊同時間被服務預約與旅遊團次重複指派，並讓加購業績有可追溯的歸戶規則。

---

## 1. Owner 已裁示的產品規則

1. **方案（TripPlan）不綁導遊。** 方案代表「賣什麼、多少錢、成團／人數規則」，不是某一天由誰執行。
2. **導遊綁在團次（TripDeparture）。** 同一方案不同日期可以由不同人執行。
3. **一個團次可有多人。** 至少區分一位「主導遊 PRIMARY」與零到多位「協同導遊 ASSISTANT」。
4. **開團／改團時必須檢查人員時間。** 班表、一般服務預約、封鎖時段、其他已指派團次互相衝突時，不得建立衝突指派。
5. **反向也成立。** 某導遊已被團次佔用，`/api/bookings/available-slots` 不得再把重疊的一般服務時段提供給顧客。
6. **行程加購業績採 C+ 規則：**預設歸屬該團次主導遊，可逐筆改派其他人，或標記「不計個人業績」。只有有業績歸屬的人員才計入個人業績；其餘只計店家營收。
7. **0 元加購允許；負數禁止。** 0 元可代表招待、贈送、免費升級，仍需留下正式紀錄。

---

## 2. 正式領域層級

```text
Trip 行程
├─ TripPlan 方案
│  └─ 價格／人數／定金／可販售規則
├─ TripAddon 行程加購「目錄」
│  └─ 名稱／售價／單位／庫存
└─ TripDeparture 團次
   ├─ 日期／時間／名額／狀態
   ├─ GuideAssignments 團次導遊指派
   │  ├─ PRIMARY 主導遊（最多一位）
   │  └─ ASSISTANT 協同導遊（0..N）
   └─ TourOrder 旅遊訂單
      └─ TourOrderAddon 訂單實際選到的加購明細
         ├─ 價格／數量快照
         └─ 業績歸屬：PRIMARY／SPECIFIC_STAFF／NONE
```

**不要把導遊掛在方案。** 例如「4 人包團」9/10 可由小王帶、9/11 可由小李帶；方案如果直接綁人會把販售規則與實際排班混在一起。

`trip_addons` 仍是「這個行程可以賣什麼加購」的目錄，不是某筆訂單真正買了什麼。現況 `0026_tour_departures_addons_orders.sql` 只有 `trip_addons` 與 `tour_orders`，**沒有 `tour_order_addons` 明細表**；後續實作必須補上，否則無法可靠記錄加購金額、執行人員與業績歸戶。

---

## 3. 資料模型

### 3.1 `trip_departure_staff`：團次 ↔ 導遊

新增關聯表，不只在 `trip_departures` 塞單一 `staff_id`，以支援主導遊＋協同導遊。

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

RLS 依 02 分冊既有 `is_tenant_member(tenant_id)` 慣例。

相容策略：既有團次可以暫時呈現「未指派」；但新建或重新編輯且狀態為 `OPEN` 的團次，完成後必須有一位 PRIMARY。舊資料補指派前不得假裝已有主導遊。

### 3.2 `tour_order_addons`：訂單實際加購快照

`trip_addons` 是目錄，訂單成立後需另存交易快照：

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
    or (performance_mode <> 'SPECIFIC_STAFF')
  )
);
```

規則：
- 新增加購預設 `performance_mode='PRIMARY'`。
- 使用者可改成 `SPECIFIC_STAFF` 指定另一位人員。
- 門票、餐費、車資等只算店家營收時設 `NONE`。
- 訂單 `COMPLETED` 時解析當下真正的歸屬人員，寫入 `performance_staff_id` 與 `performance_amount` 作為歷史快照；完成後不得因日後改主導遊而回頭改歷史業績。
- 0 元加購允許，`performance_amount=0`；負數拒絕。

---

## 4. 團次佔用時間怎麼算

### 4.1 時間區間

- 有 `start_time`：`start = departs_on + start_time`。
- `end = start + trip_plan.duration_minutes`。
- 沒有 `start_time`：視為該日整日忙碌。
- PRIMARY 與 ASSISTANT 都算被團次佔用，不能在重疊時間再接一般服務或另一團。

### 4.2 指派人員的可用性來源

建立／修改團次時，候選人必須同時滿足：

1. `staff.active=true` 且 `bookable=true`。
2. 若當日有 `shifts`，該員工必須有涵蓋完整團次時間的班段；若租戶當日完全沒有任何 shift，沿用現有 `available-slots` 慣例視為可排。
3. 不與 `block_times`（個人或全店）重疊。
4. 不與該員工 `PENDING`／`CONFIRMED` 的一般 `bookings` 重疊。
5. 不與該員工已指派到的其他非 `CANCELLED` 團次重疊。
6. 外部行事曆匯入未正式實作前不假裝有這層判斷；日後 EXTERNAL calendar 上線時再納入同一個 availability engine。

前端只做提示；**後端必須再次檢查**。不能只靠下拉選單把忙碌員工藏起來，因為兩個管理者可同時操作。

---

## 5. 團次建立／修改 UI

### 5.1 單一團次

團次 Modal 從目前的：

```text
方案／日期／時間／名額／備註
```

擴成：

```text
方案／日期／時間／名額
主導遊（必填，OPEN 團次）
協同導遊（可複選）
備註
```

選好方案、日期、時間後才載入候選人狀態：

```text
✅ 小王  可帶團
❌ 小美  09:00–12:00 已有預約
❌ 阿杰  今日未排班
✅ Amy   可帶團
```

忙碌人員可顯示但不可直接儲存；錯誤訊息必須說明衝突來源與時間，不可只回「409」。

### 5.2 批次開團

第一版不做自動分派 AI。批次建立時由管理者選定一位 PRIMARY，必要時選 ASSISTANT；後端逐日驗證。

回應除了既有 `created/skipped`，擴充 `conflicts[]`：

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

有衝突的日期不得默默建立成「未指派團次」。要嘛建立可用日期並列出跳過原因，要嘛整批取消，由 API 契約明定；本規格預設採「可用的建、衝突的跳過並清楚回報」。

---

## 6. `available-slots` 必須雙向防撞

現有 `/api/bookings/available-slots` 已檢查：
- shifts
- bookings
- block_times

必須再加入：

```text
trip_departure_staff
→ trip_departures
→ trip_plans.duration_minutes
```

對每位候選員工，把其非 CANCELLED 團次展開成忙碌區間；一般服務 candidate slot 與任何團次重疊就不可回傳。

反方向，建立／修改團次也必須重用同一套 availability 規則檢查 `shifts + bookings + block_times + departures`，避免兩邊各寫一套最後漂移。

建議抽成 `src/server/staff-availability.ts`，由：
- `/api/bookings/available-slots`
- 團次單筆 create/update
- 團次 batch create
共同使用。

---

## 7. 行事曆與 ICS

`GET /api/calendar` 的 DEPARTURE 事件要能帶：
- `primaryStaffId?`
- `primaryStaffName?`
- `assistantStaffIds?`
- `assistantStaffNames?`

ICS 的團次 `DESCRIPTION` 至少包含主導遊名稱；協同導遊存在時一併列出。

`/tenant/calendar` 點團次時，可看到團次、方案、報名人數與導遊指派。人員異動後行事曆必須反映最新值。

---

## 8. 業績規則

### 一般服務預約 `booking_addons`

Owner 2026-08-27 裁示更新為 C+：
- `booking_addons.staff_id` 有指定人員 → 加購業績算該人。
- 未指定人員 → 預設繼承 `bookings.staff_id`。
- 未來 UI 應補「不計個人業績」選項；在該選項完成前，不得用 `staff_id=null` 同時表示「繼承」與「不計業績」兩種語意。
- 此規則取代 0020 migration 檔頭目前寫的「staff_id 不參與業績歸戶、全部與主服務同一人」舊裁示；實作時需同步更正文註解與測試。

### 旅遊訂單加購 `tour_order_addons`

- 預設 PRIMARY。
- 可 SPECIFIC_STAFF。
- 可 NONE。
- `COMPLETED` 時凍結 `performance_staff_id/performance_amount`，報表只讀凍結值，避免歷史業績隨人員調整漂移。

---

## 9. 必測衝突案例

1. 小王 09:00–12:00 已有一般預約，建立 08:00–18:00 團次指派小王 → 409，團次／指派不得半寫入。
2. 小王已有 08:00–18:00 團次，一般服務查 10:00 時段 → 小王不得出現在 `staffIds`。
3. 小王已有 A 團 08:00–18:00，再建立 B 團 17:00–20:00 → 衝突。
4. 小王 A 團已 CANCELLED → 同時間可重新指派。
5. 協同導遊也會佔用時間，不只是 PRIMARY。
6. 沒有 `start_time` 的團次 → 該導遊整日不可再排。
7. 批次開團 8 個日期，其中 2 日衝突 → 只建 6 日，回 conflicts 2 筆，畫面不得宣稱建了 8 團。
8. 加購預設 PRIMARY；改派小美後，完成訂單業績歸小美；NONE 只進店家營收。
9. 0 元加購可建立且保留歸戶資訊；負數拒絕。
10. 跨租戶 staffId／departureId 一律不得讀寫。

---

## 10. 遷移與相容性原則

- 這是新增能力，不修改既有 `trips`／`trip_plans` 的核心語意。
- 不把方案綁人。
- 既有團次暫時允許「未指派」，UI 必須誠實顯示；後續人工補齊。
- Migration 必須先 source review + TEST 驗證；**正式 Supabase DDL 套用仍屬 Production 寫入，需 Owner 明確授權後才執行**。
- mock 模式仍需可用，新增欄位只能向後相容。
