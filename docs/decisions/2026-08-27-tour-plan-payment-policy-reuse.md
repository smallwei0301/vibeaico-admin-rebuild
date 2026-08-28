# 2026-08-27 Owner Decision - Trip Plan 收款政策沿用 Service

## 已裁示

GUIDE 的 `TripPlan` **不另建旅遊專用訂金／線上收款設定**，直接沿用 LOCAL_SHOP `Service` 已存在的四種收款語意：

1. `NONE`：不預收
2. `DEPOSIT_FIXED`：固定金額訂金
3. `DEPOSIT_PERCENT`：百分比訂金
4. `FULL`：全額付清

固定金額／百分比的 UI 文案、欄位驗證、金額計算原則應共用既有 Service 概念，不建立第二組同義 enum 或互相分岔的設定。

## 資料與責任邊界

- `TripPlan` 決定該方案的收款政策，沿用現有 `deposit_mode + deposit_value` 方向。
- 實際可使用的收款管道仍來自租戶自己的 `tenant_payment_methods`，由 Phase 8c / Issue #9 管理；Plan 不保存金流商密鑰。
- `TourOrder` 必須保存該筆交易實際應收、已收訂金／已收金額與後續尾款所需的交易快照，不能日後因 Plan 改價或改訂金比例而回頭改舊訂單。
- 收款政策與「是否成團」是兩個不同概念：本決策只裁示如何設定預收方式，不把 `PAID`、`DEPOSIT_PAID` 等付款狀態等同 `FORMED`。
- 真正散客併團若採用，哪些訂單狀態可計入成團人數、成團後尾款如何推進、未成團／退款如何處理，需在團次成團生命週期規格另行定案。

## 實作原則

- Service 與 Trip Plan 可使用同一組 domain helper / validation schema 計算固定訂金、比例訂金與全額應收，避免兩份公式。
- `DEPOSIT_PERCENT` 必須有合法百分比邊界；`DEPOSIT_FIXED` 不得超過該筆應收總額；實際 rounding 規則由共用 helper 唯一實作。
- 前台與後台顯示自然語言「不預收／固定訂金／比例訂金／全額付清」，不要求使用者理解 enum 名稱。
- 本決策不授權 Production DDL／DML 或 runtime Production merge／部署。

## 對應

- Service 現有 UI / type：`src/app/tenant/services/page.tsx`、`src/i18n/zh-TW/pages/services.ts`
- Tour canonical：`docs/integration/10-TOUR-DOMAIN.md`
- Checkout 實作歸屬：Issue #12
- 租戶收款方式：Issue #9
