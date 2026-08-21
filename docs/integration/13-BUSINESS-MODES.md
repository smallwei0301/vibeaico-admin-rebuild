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

## 4. 驗收（併入 08 清單 Phase 8）

- [ ] 註冊選 GUIDE → 後台選單看到「行程與方案／旅遊訂單」，看不到
      服務項目/預約列表/班表；TOUR_MODULE 已自動開通
- [ ] 註冊選 LOCAL_SHOP → 與現行完全相同；看不到行程相關頁
- [ ] settings 換模式 → 選單即時切換；原模式資料未刪（切回可見）
- [ ] 加開其他模組 → 兩套選單並存
- [ ] LINE：GUIDE 店打「行程」有回應；LOCAL_SHOP 店打「行程」不觸發內建組
- [ ] 測試（12 分冊）：`modes.13.test.ts` —— preset 表逐模式斷言 nav 組成、
      預設功能、關鍵字組；換模式不刪資料
