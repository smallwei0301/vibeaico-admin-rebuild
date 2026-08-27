# 2026-08-27 Owner Decision — 行程方案三種販售方式

## 已裁示

Owner 選擇方案 A：**每個 Trip Plan 各自決定販售方式**，支援三種模式：

1. `FIXED_DEPARTURE`：固定團次
2. `INSTANT`：自選時間，符合 availability 後可直接成交
3. `REQUEST`：先申請再確認，導遊確認後才進入付款／正式成立流程

此決策沿用 tour-platform 已驗證的 `scheduled / instant / request` 產品概念，但新後台採統一履約模型，不複製舊系統兩套資料鏈。

## 核心資料原則

- **Plan 決定「怎麼賣」**。
- **Departure 記錄「哪一天真的要執行」**。
- **TourOrder 記錄「誰買了／多少人／多少錢」**。
- `tour_orders.departure_id` 維持必填方向，不因 INSTANT／REQUEST 改成 nullable。
- 所有真正會占用導遊時間的旅遊履約，最後都必須落成 `trip_departures + trip_departure_staff`，讓行事曆、撞班、PRIMARY／ASSISTANT、ICS、加購業績共用同一套事實來源。

## 三種模式

### FIXED_DEPARTURE（固定團次）

導遊事先建立公開團次與名額。多筆 TourOrder 可以加入同一 Departure，適合併團、固定梯次、公開小團。

### INSTANT（自選時間）

旅客先選方案，再從 availability engine 算出的可售時間中選擇。成交時由系統建立一個私人 Departure，並綁定實際 PRIMARY（必要時 ASSISTANT），再建立 TourOrder。該私人團預設不再開放其他旅客加入。

### REQUEST（先申請再確認）

旅客先選方案與候選時間後送出需求，由導遊確認是否承接；確認後才進入付款／正式成立流程。此模式仍應以 Departure 作為最終履約單位。

**尚未裁示：REQUEST 在旅客剛送出申請時，是否立即暫時鎖住導遊時間，以及暫鎖多久。此題需 Owner 下一步決策。**

## 旅客 UX

沿用 tour-platform 已驗證的 Plan-first 流程：

`選行程 → 選方案 → 依該方案販售方式顯示可售日期／時間 → 填資料 → 成交或送申請`

後台對導遊顯示自然語言：

- 固定團次
- 自選時間
- 先申請再確認

不要求使用者理解 `scheduled / instant / request` 技術名詞。

## 與 availability 的關係

- FIXED_DEPARTURE：候選時間來自預先建立的 Departure。
- INSTANT / REQUEST：候選時間由方案規則 + 共用 staff availability engine 產生。
- staff 的 `DEFAULT_AVAILABLE / EXPLICIT_ONLY` 只決定是否要求 shift coverage，不自行產生 24 小時可售時段。
- 所有模式都必須排除 block_times、既有 booking、其他 Departure 與後續外部 busy event。

## 不做的事

- 不把整個 Trip 鎖成只能一種販售方式。
- 不為三種販售方式建立三套訂單資料表。
- 不讓 INSTANT／REQUEST 繞過 Departure 直接占用導遊時間。
- 不在本決策中裁示 REQUEST 的暫時保留策略。

## 後續實作

後續 source-only schema / API / UI 應以本決策與 `docs/integration/10-TOUR-DOMAIN.md` 為準；Production Supabase DDL、Production merge／部署仍需 Owner 另行明確授權。
