# 10 — 行程領域與導遊金流（Phase 8）

> 讓 VibeAI 成為旅遊行程的**唯一事實來源**：行程/方案/團次/名額/旅遊訂單
> 全部只存在這個資料庫。Midao 前台與 VibeAI 公開商店頁都是它的客戶端（11 分冊）。
> 本冊依賴 Phase 0–3；金流設定頁依賴 §4。
>
> 決策背景（owner 2026-08-21 拍板）：Midao 平台不再碰金流，收款由導遊自行設定
> （綠界 API 或匯款帳號）；Midao 商業模式改為 VibeAI 使用費＋前台上架費。

---

## 0. 領域模型與既有預約的關係

VibeAI 既有 `bookings` 是「時段 × 服務人員」（美髮/診所型）。旅遊是
「**團次（日期）× 方案 × 名額**」，計價按人頭。兩者並存、不互改：

```
trips（行程）─┬─ trip_plans（方案：定價/成團人數）
              └─ trip_departures（團次：日期 + 名額）──── tour_orders（旅遊訂單）
```

導遊租戶同時擁有既有全部功能（LINE、顧客、票券…）；行程是新增的一個領域，
不是 services 的變形。**名額扣減必須在資料庫層原子完成（§2），這是本冊最重要
的一條 —— 兩個前台同時下單也不可能超賣。**

---

## 1. 資料表（migration `0012_tour_domain.sql`）

RLS 樣板與 02 分冊 §0006 相同，全部套 `is_tenant_member(tenant_id)`；
公開讀取（前台看行程）走 API 層 service role + 顯式欄位挑選，不開匿名 RLS。

```sql
create type trip_status as enum ('DRAFT','PUBLISHED','ARCHIVED');
create type departure_status as enum ('OPEN','CLOSED','CANCELLED');
create type tour_order_status as enum ('PENDING','CONFIRMED','COMPLETED','CANCELLED');
create type tour_payment_status as enum ('UNPAID','PAID','REFUNDED');
create type tour_order_source as enum ('MIDAO','VIBEAI_SHOP','LINE','MANUAL');

create table trips (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  slug           text not null,                      -- 公開網址用，租戶內唯一
  title          text not null,
  summary        text not null default '',           -- 簡易行程（VibeAI 商店頁用）
  description    text not null default '',           -- 詳細行程（Midao 前台用，Markdown）
  cover_image_url text not null default '',
  gallery        jsonb not null default '[]',
  location       text not null default '',
  duration_hours numeric,
  meeting_point  text not null default '',
  includes       text not null default '',           -- 費用包含/不包含
  notes          text not null default '',
  status         trip_status not null default 'DRAFT',
  -- Midao 上架審核（與 status 互相獨立：status=PUBLISHED 控制 VibeAI 商店頁，
  -- midao_listing 控制 Midao 前台；審核權在 Midao 管理員，見 11 分冊 §4.2）
  midao_listing  text not null default 'NONE'
    check (midao_listing in ('NONE','PENDING','LISTED','REJECTED')),
  midao_listing_note text not null default '',       -- 退回原因等
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table trip_plans (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  trip_id          uuid not null references trips(id) on delete cascade,
  name             text not null,                    -- 例：標準團、包團、含接送
  description      text not null default '',
  price_per_person numeric not null,
  child_price      numeric,                          -- null = 不分
  min_party        int not null default 1,           -- 成團人數
  max_party        int not null default 10,          -- 單筆訂單上限
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
  check (seats_booked >= 0 and seats_booked <= capacity),   -- ★ 超賣的最後防線
  unique (tenant_id, plan_id, departs_on, start_time)
);
create index i_departures on trip_departures (tenant_id, trip_id, departs_on);

create table tour_orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  order_no         text not null,                    -- 'T' + yymmdd + 4 碼流水
  trip_id          uuid not null references trips(id) on delete restrict,
  plan_id          uuid not null references trip_plans(id) on delete restrict,
  departure_id     uuid not null references trip_departures(id) on delete restrict,
  customer_id      uuid references customers(id) on delete set null,  -- 自動建檔（11 分冊 §3）
  traveler_user_id uuid,                             -- 共用旅客帳號（11 分冊 §1），可為 null（LINE/手動單）
  party_size       int not null,
  unit_price       numeric not null,                 -- 下單當下快照
  total_amount     numeric not null,
  contact          jsonb not null default '{}',      -- {name, phone, email, note} 快照
  status           tour_order_status not null default 'PENDING',
  payment_status   tour_payment_status not null default 'UNPAID',
  payment_method_id uuid,                            -- → tenant_payment_methods
  payment_ref      text not null default '',         -- 綠界交易編號 / 匯款後五碼
  source           tour_order_source not null,
  hold_expires_at  timestamptz,                      -- §3 名額保留期限
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, order_no)
);
create index i_tour_orders on tour_orders (tenant_id, status, created_at desc);
create index i_tour_orders_traveler on tour_orders (traveler_user_id) where traveler_user_id is not null;
```

## 2. 名額原子扣減（禁止在應用層算庫存）

```sql
-- 下單：一句 UPDATE 完成「檢查餘額 + 扣名額」，並發也不會超賣
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
  update trip_departures set seats_booked = greatest(seats_booked - p_count, 0)
   where id = p_departure;
end; $$ language plpgsql security definer set search_path = public;
revoke execute on function reserve_seats, release_seats from anon, authenticated;
```

規約：**建立訂單與 reserve_seats 必須同一個交易**（包成 rpc `create_tour_order`，
寫法比照 09 分冊 `subscribe_feature`）；取消/過期釋放呼叫 `release_seats` 同交易改
訂單狀態。剩餘名額永遠即時算：`capacity - seats_booked`，不做任何快取。
錯誤碼新增：`TOUR_001` 名額不足（409）。

## 3. 訂單生命週期與名額保留

```
PENDING（已佔名額）──付款確認──► CONFIRMED ──出團後──► COMPLETED
   │                                  │
   └─ 過期/取消 ─► CANCELLED（釋放名額）◄─ 取消（釋放名額；已付款須人工退款，見 §4）
```

| 付款方式 | hold_expires_at | 過期處理 |
|---|---|---|
| 綠界（線上刷卡） | 下單 + 30 分鐘 | cron 釋放名額、訂單 CANCELLED |
| 匯款 | 下單 + 3 天（租戶可設定） | 同上；旅客回報後五碼 → 導遊後台按「確認收款」→ CONFIRMED |
| LINE / 手動單 | null（導遊自己管理） | 不自動過期 |

cron：`/api/cron/tour-order-expiry`（每小時，併入 07 分冊 crons 與 vercel.json）。
狀態變更走 LINE 推播 + Email 通知，開關沿用 notify 群組既有鍵（06/05 分冊機制）。

## 4. 導遊自訂金流（migration 同 0012）

**設定 UI 已存在**：`/tenant/payment-methods` 頁（含 i18n 文案）已完整支援六種
收款類型與雙金流商，資料表以該頁的欄位模型為準（不是簡化版）：

```sql
-- 對齊 src/app/tenant/payment-methods/page.tsx 的 MethodType / GatewayProvider
create type payment_method_type as enum
  ('LINE_PAY','JKOPAY','BANK_TRANSFER','CASH','ONLINE_PAYMENT','OTHER');
create type gateway_provider as enum ('NEWEBPAY','ECPAY');

create table tenant_payment_methods (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  method_type   payment_method_type not null,
  display_name  text not null default '',
  qr_image_url  text not null default '',        -- LINE Pay / 街口收款 QR
  -- BANK_TRANSFER：{bankName, bankCode, accountNumber, accountHolder, instructions}
  config        jsonb not null default '{}',
  -- ONLINE_PAYMENT（線上刷卡）：
  gateway_provider gateway_provider,             -- 綠界或藍新
  gateway_merchant_id text not null default '',
  gateway_hash_key_enc text not null default '', -- HashKey/HashIV 加密（比照 LINE secrets，01 §5.4）
  gateway_hash_iv_enc  text not null default '',
  gateway_verified_at  timestamptz,              -- 實刷測試通過時間（頁面的「開通」狀態）
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
```

- 端點即 04 §B 既列的 `/api/payment-methods`（CRUD、`test-connection`、
  `test-charge`——建 NT$1/5 實刷單走該租戶金流商 sandbox/正式、`toggle-active`）；
  秘密欄位遮罩/空字串不覆蓋規則與 LINE 相同。
- 旅遊 checkout 的線上刷卡（下文）支援 ECPAY 與 NEWEBPAY 兩家，依該收款方式的
  `gateway_provider` 產生對應表單；QR 類型（LINE Pay/街口）在 checkout 呈現
  QR 圖 + 回報付款流程（同匯款的人工確認）。
- **綠界流程（導遊需自備綠界特店帳號）**：checkout API 建單＋佔位 → 用該租戶解密後的
  HashKey/HashIV 產生 AioCheckOut 表單參數（CheckMacValue）→ 前端 form POST 到綠界 →
  綠界 server 回呼 `POST /api/payments/ecpay/{shopCode}/callback` → 驗 CheckMacValue →
  `payment_status='PAID'`、訂單 CONFIRMED（**冪等**：同交易編號重複回呼直接回 `1|OK`）。
  回呼永遠回綠界規格的 `1|OK`/`0|錯誤`，不走 ApiResponse 信封。
- **匯款流程**：checkout 回覆匯款資訊 → 旅客填後五碼（寫 `payment_ref`）→
  導遊後台「確認收款」按鈕 → CONFIRMED。
- 退款一律人工（導遊自行處理，後台僅記 `payment_status='REFUNDED'`）。平台完全不經手金流。

## 5. 後台管理端點與新頁面

端點（實作規約同 04 分冊；全部 `requireTenant`）：

| 端點 | 說明 |
|---|---|
| GET/POST `/api/trips`、GET/PUT/DELETE `/api/trips/:id` | 行程 CRUD；DELETE 有訂單→改 ARCHIVED |
| POST `/api/trips/:id/publish‖unpublish` | DRAFT↔PUBLISHED（只影響 VibeAI 商店頁可見性） |
| POST `/api/trips/:id/request-midao-listing` | 導遊申請上架 Midao：`NONE/REJECTED → PENDING`，並發 `trip.listing_requested` webhook 給 Midao（審核端點在 11 分冊 §4.2） |
| GET/POST `/api/trips/:id/plans`、PUT/DELETE `/api/trip-plans/:id` | 方案 CRUD |
| GET/POST `/api/trips/:id/departures`（支援批次建整月）、PUT/DELETE `/api/trip-departures/:id` | 團次；capacity 調低不得小於 seats_booked（409） |
| GET `/api/tour-orders`（分頁+篩選）、GET `:id` | 訂單列表/詳情 |
| POST `/api/tour-orders/:id/confirm-payment‖complete‖cancel` | 狀態動作；cancel 釋放名額 |
| POST `/api/tour-orders/manual` | 導遊代旅客下單（LINE 溝通後手動建單，source='MANUAL' 或 'LINE'） |

新頁面（**這是原 37 頁之外的擴充**，依 CONVENTIONS.md 流程：先建 i18n 字典
`src/i18n/zh-TW/pages/trips.ts` 等、service 走 `adapt(mock, real)`、nav.ts 加
「行程管理」群組，feature flag 新增 `TOUR_MODULE`——導遊型租戶才顯示）：

1. `/tenant/trips` 行程列表 ＋ `/tenant/trips/[id]` 編輯（含方案管理）
2. `/tenant/trips/[id]/departures` 團次月曆（名額管理）
3. `/tenant/tour-orders` 旅遊訂單列表

## 5.5 行事曆整合（團次會、方案不會）

**規則：只有「有日期」的東西上行事曆。** 團次（`trip_departures`）有出團日期
與時間 → 上行事曆；方案（`trip_plans`）是定價與人數規則、本身沒有日期 →
不上行事曆（季節只是「可販售期間」，也不是行事曆事件）。

| 對象 | 上行事曆 | 呈現 |
|---|---|---|
| 團次 | ✅ | 出團日期 + 出發時間，標題「行程名稱 · 方案名」，副標 `5/8 人`（滿團標紅） |
| 方案 | ❌ | 沒有日期。要看方案請進行程編輯頁 |
| 旅遊訂單 | ❌（獨立列） | 訂單掛在團次底下，點團次事件可展開該團報名名單 |

三個落點：

1. **後台行事曆頁**（`/tenant/calendar`）：資料源改為 04 分冊的統一端點
   `GET /api/calendar`，同一格月曆同時顯示服務預約與團次（用不同色票區分，
   沿用既有 `--color-*` token，不新增顏色）。點團次 → 側邊顯示該團報名名單
   （連到 `/tenant/tour-orders?departureId=`）。
2. **ICS 訂閱輸出**（`/tenant/calendar-sync` 的訂閱網址）：ICS feed **必須同時含
   團次**，導遊在自己的 Google/Apple Calendar 才看得到出團日。
   每個團次一個 `VEVENT`：`SUMMARY` = 行程 · 方案、`DTSTART/DTEND` 依出發時間
   與方案時長、`DESCRIPTION` 含目前報名人數與集合地點、`UID` = `departure-{id}@vibeai`。
   團次取消 → 該 VEVENT 標 `STATUS:CANCELLED`（訂閱端才會消失）。
3. **出團日自動忙碌**（重要，避免撞班）：導遊同時有服務項目時，
   `GET /api/bookings/available-slots` 必須把**該員工/該店在團次時段內的時間排除**
   （視同 block_time）—— 否則會發生「早上在海上帶團、系統卻讓顧客約了同一時段的服務」。
   判定範圍 = 團次 `start_time` 起算 `plan.duration_minutes`；
   未指定時間的團次視為整日忙碌。

> 現況：目前 `/tenant/calendar` 頁只讀 `listBookings`（服務預約），
> 團次尚未接入 —— 屬 Phase 8 待辦，實作時照本節規格補齊三個落點。

## 6. LINE 流程延伸（接 06 分冊）

LINE 是行程的第一線銷售通路，分兩版實作：

### 6.1 目錄與問答（與商店頁同一份資料）

**內建關鍵字組**（`/tenant/keyword-replies` 頁的「系統內建關鍵字」區，
店家可逐組開關、也可用自訂關鍵字覆蓋單一字詞）。導遊模組新增兩組，
**只在該租戶訂閱 `TOUR_MODULE` 時顯示與生效**：

| 組 key | 標籤 | 觸發字 | Bot 回應 |
|---|---|---|---|
| `TRIP` | 行程 | 行程、有什麼行程、所有行程、報名、我要報名、揪團、出團 | PUBLISHED 行程 Flex 輪播（封面/標語/最低價/「我要預約」按鈕）|
| `DEPARTURE` | 出團日期 | 出團日期、哪天出團、還有位子嗎、剩幾位、名額 | 未來 14 天可報名團次與**即時剩餘名額**清單 |

既有組不變；`BOOKING`（預約）在兩者都有的店先出快速回覆
「想預約服務還是行程？」，只有一種的店直接進該流程。`MY_BOOKING`（查詢預約）
與 `ORDER`（訂單查詢）合併回傳 bookings 與 tour_orders。
卡片資料來源 = 11 分冊的 `catalog` 端點（與商店頁共用，永遠一致）。

實作對應：i18n `src/i18n/zh-TW/pages/keyword-replies.ts` 的
`system.groups` 已含這兩組（帶 `feature: 'TOUR_MODULE'` 欄位），
頁面依租戶訂閱狀態過濾顯示；webhook 端依同一份 key 分派。
- **AI 客服（09 §7）的 system prompt 增補**：行程清單、各方案價格摘要、
  未來 14 天團次與**即時剩餘名額**（`capacity - seats_booked`）——
  顧客問「這週末賞鯨還有位子嗎」要能直接答出正確餘額。

### 6.2 LINE 內下單

**v1（Phase 8 交付）**：行程卡片「我要預約」按鈕 = 商店頁該行程網址
（LINE 內建瀏覽器開啟，走 11 分冊 checkout）。實作成本趨近於零，
商店頁完成即可在 LINE 收單。

**v2（Phase 8+，聊天內完成下單）**：postback 流程，狀態存
`chat_sessions`（tenant_id + line_user_id + step + payload jsonb，新表併入 0012）：

```
[我要預約] postback(action=trip_book&trip=…)
 → 選方案（快速回覆，每方案一顆）
 → 選團次（postback 按鈕，文案「8/23（六）09:00｜剩 3 位」，只列 OPEN 且有餘額的未來 14 天）
 → 輸入人數（驗 min/max 與餘額）
 → 確認摘要卡 → 建立 tour_order（source='LINE'，rpc 佔名額）
 → 回覆付款指示（匯款資訊 / 刷卡連結）→ 後續同 §3 生命週期（確認收款 → 推播成立）
```

規約：任一步輸入不合法 → 重新提示同一步；輸入「取消」→ 清 session；
名額在最後建單那一刻才鎖定（中途看到的餘額僅供參考，建單失敗回
TOUR_001 文案「剛剛額滿了，請選其他日期」）。

- 旅客自由文字詢問 → 既有 chat 流程；導遊談定後用 `/api/tour-orders/manual`
  建單（綁定該 line_user 對應的 customer）→ 訂單確認/提醒推播沿用 notify 機制。
- LINE「我的預約」查詢：合併回 bookings 與 tour_orders 兩種訂單。

---

## 本冊驗收

- [ ] migration 0012；兩個並發 checkout 打同一團次最後一席，恰好一成一敗（TOUR_001）
- [ ] capacity 調低於已售 → 409；團次 CANCELLED 後不可再下單
- [ ] 綠界 sandbox 全流程：下單佔位 → 付款 → callback 冪等（重送不重複入帳）→ CONFIRMED + LINE/Email 通知
- [ ] 匯款流程：30 分鐘未付的綠界單被 cron 釋放；匯款單 3 天後釋放；後五碼回報＋確認收款可走通
- [ ] 後台三個新頁在 mock 模式與真實模式都正常；非導遊租戶看不到「行程管理」選單
- [ ] 行事曆（§5.5）：`/tenant/calendar` 同時顯示服務預約與團次；ICS 訂閱
      含團次 VEVENT（取消的團標 STATUS:CANCELLED）；團次時段被
      available-slots 排除（開一團後該時段訂不到服務）
- [ ] LINE 輸入「行程」收到行程輪播
