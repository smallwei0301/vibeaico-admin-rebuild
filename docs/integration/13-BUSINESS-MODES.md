# 13 — 業態模式（Business Modes）

> owner 決策（2026-08-21）：不再讓導遊看到「服務項目＋行程管理」兩套並排。
> 註冊時三選一的**業態模式**決定後台的選單、名詞與預設功能 ——
> 嚮導模式的「服務項目」就是行程與方案、「訂單」就是旅遊訂單。
>
> **鐵則：模式換的是門牌，不是倉庫。** 資料表層 `services` 與
> `trips/trip_plans/trip_departures` 維持分開（10 分冊 §0 的理由不變：
> 時段×員工 與 團次×名額 是兩種庫存邏輯）。模式只作用在
> 選單佈局、名詞、預設功能包、LINE 關鍵字組、商店頁預設區塊。

---

## 1. 資料模型

```sql
-- migration 0014_business_modes.sql
create type business_type as enum ('LOCAL_SHOP','GUIDE','CLINIC');
alter table tenants add column if not exists business_type business_type
  not null default 'LOCAL_SHOP';
```

- 註冊流程（03 分冊 tenant/register）新增一步：三張卡片選業態
  （🏪 當地商店／🧭 嚮導／🏥 醫院診所），body 增加 `businessType` 欄位。
- 店家設定頁（settings#basic）可改，僅 OWNER；**換模式不刪任何資料**，
  只是切換顯示（行程資料在切回嚮導模式時原樣仍在）。
- `TenantSummary` 型別新增選填 `businessType?`（types.ts 只增不改）。

## 2. 模式決定表（單一事實來源：`src/config/modes.ts`，新檔）

| 決定項 | LOCAL_SHOP | GUIDE | CLINIC |
|---|---|---|---|
| 「服務項目」槽位 | `/tenant/services`（服務項目） | `/tenant/trips`（**行程與方案**） | `/tenant/services`（診療項目） |
| 「訂單」槽位 | `/tenant/bookings`（預約列表） | `/tenant/tour-orders`（**旅遊訂單**） | `/tenant/bookings`＋`clinic-queue` |
| 隱藏的頁 | trips、tour-orders、clinic-queue | bookings、recurring-bookings、services、block-times、shifts、clinic-queue | trips、tour-orders |
| staffTerm 預設 | 服務人員 | 導遊 | 醫師 |
| 預設功能包 | 現行免費組 | ＋`TOUR_MODULE`（隨模式贈送） | ＋看診號碼 |
| LINE 內建關鍵字組 | 現行 | ＋TRIP/DEPARTURE，隱藏 BOOKING/MY_BOOKING 的服務語境 | 現行＋掛號組 |
| 商店頁預設區塊順序 | 服務→商品→作品 | 行程→評價 | 診療→掛號 |
| AI 客服上下文 | services | trips＋departures | services＋看診資訊 |

實作規約：

- `src/config/modes.ts` 匯出 `MODE_PRESETS: Record<BusinessType, ModePreset>`，
  上表每一欄是一個欄位。**所有依模式分支的程式只准讀這個檔**，
  不准在頁面/nav/webhook 裡散寫 `if (businessType === …)`。
- `config/nav.ts` 改為 `getNav(businessType)`：同一個「店家營運」群組，
  依 preset 替換/隱藏葉節點；名詞取 preset（nav i18n 鍵拆成三組或帶參數）。
- 斜槓店家：settings 增加「加開其他模組」開關（例：嚮導也賣按摩 →
  加開後 nav 同時顯示 服務項目＋行程與方案、預約列表＋旅遊訂單）。
  模式是**預設**，不是牢籠。
- 06 分冊 webhook 與 09 §7.2 AI 上下文改讀 preset 決定要組哪些資料
  （行為與現行 TOUR_MODULE 閘門一致，只是來源收斂到 modes.ts）。

## 3. 與既有機制的關係

- `TOUR_MODULE` 功能旗標保留（Midao 端 Partner API、閘門都在用），
  GUIDE 模式在開店時自動寫入該訂閱（source='GRANTED'，永久）。
- 看診號碼模式、住宿模式等既有服務變形不動 —— CLINIC 模式只是把
  clinic-queue 提升為預設顯示。
- 行事曆、顧客、LINE 聊天、收款方式、點數、功能商店：**全模式共用，不分支**。

### 3.1 GUIDE 的「班表」能力收斂到行事曆（Owner 2026-08-27）

GUIDE 模式仍維持 `shifts`、`block_times` 側邊欄隱藏；不要把一般店家的「員工班表／封鎖時段」介面原封不動搬給導遊。

但隱藏頁面不代表刪除底層能力。GUIDE 在 `/tenant/calendar` 以導遊語境操作同一份資料：

- `shifts` → **可接案時間**。
- `block_times` → **不可接案／私人行程／休假**。
- `trip_departure_staff + trip_departures` → **已被團次占用**。
- 外部行事曆未來接入後的 busy event → 同一套 availability engine 的另一種占用來源。

不新增另一張 `guide_availability` 表，避免同一件事有兩套真相。

GUIDE 行事曆的文案與主要視圖不得沿用一般店家的「顧客預約／員工排班」，應改成導遊自然理解的「我的行程／可接案時間／團隊行程」等語境。`src/config/modes.ts` 應提供相應 mode-aware 設定，頁面不得散寫 GUIDE 判斷。

團次建立／修改時，PRIMARY 與 ASSISTANT 都必須查同一套 availability engine。前端顯示可用／忙碌原因只為 UX，後端儲存前仍需再次檢查，不能只靠畫面限制。

ICS／Google Calendar／Apple Calendar 的定位是「我已經被什麼事情占用了」，因此 GUIDE 預設**不輸出大量『可接案』空檔**；輸出實際團次、不可接案例外，以及該租戶另外啟用其他模組時的其他實際占用事件。

單導遊與多導遊團隊是否需要顯式模式開關，或由系統依實際 active/bookable 導遊數量自動適應，尚待 Owner 下一輪裁示；不得在未裁示前自行新增 `solo/team` 永久設定欄位。

## 4. 驗收（併入 08 清單 Phase 8）

- [ ] 註冊選 GUIDE → 後台選單看到「行程與方案／旅遊訂單」，看不到
      服務項目/預約列表/班表；TOUR_MODULE 已自動開通
- [ ] GUIDE 行事曆不顯示一般店家「顧客預約／員工排班」語境；能操作可接案與不可接案時間
- [ ] GUIDE 可接案時間沿用 `shifts`，不可接案沿用 `block_times`，不新增重複 availability 資料表
- [ ] GUIDE 的實際團次會占用 PRIMARY/ASSISTANT 時間；團次建立與可接案計算共用同一 availability engine
- [ ] GUIDE 的 ICS 不輸出大量可接案空檔，只輸出實際占用與不可接案例外
- [ ] 註冊選 LOCAL_SHOP → 與現行完全相同；看不到行程相關頁
- [ ] settings 換模式 → 選單即時切換；原模式資料未刪（切回可見）
- [ ] 加開其他模組 → 兩套選單並存
- [ ] LINE：GUIDE 店打「行程」有回應；LOCAL_SHOP 店打「行程」不觸發內建組
- [ ] 測試（12 分冊）：`modes.13.test.ts` —— preset 表逐模式斷言 nav 組成、
      預設功能、關鍵字組；換模式不刪資料
### #37 atomic enforcement clarification

availability engine 沒有新增 solo/team mode。前端的 0/1/2+ 導遊顯示只協助操作；所有
booking 與非 CANCELLED departure（含 CLOSED 的時間／人員調整）皆由同一 DB transaction
availability assertion 最終裁定。批次逐日衝突回傳 `conflicts[]`，不得把預覽視為寫入保證。
