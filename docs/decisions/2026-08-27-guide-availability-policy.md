# 2026-08-27 Owner Decision — 每位導遊的可接案策略

## 決策

GUIDE 模式的可接案策略採**每位導遊獨立設定**，不是整個租戶共用一個模式。

每位 `staff` 可選：

1. **平常可接案（DEFAULT_AVAILABLE）**
   - 當系統檢查某個候選時間時，不要求該導遊另外存在一筆 `shift` 才能被指派。
   - 仍必須通過不可接案／私人行程、既有 booking、既有團次、未來 external busy event 等衝突檢查。
   - 「平常可接案」不等於 24 小時任意產生販售時段；候選時間仍由方案的販售方式、團次時間或其他產品規則決定。

2. **僅指定時間可接案（EXPLICIT_ONLY）**
   - 候選時間必須完整落在該導遊的 `shifts` 可接案區間內。
   - 即使沒有其他衝突，只要不在明確設定的可接案時間內，就不可指派。

## 資料模型

建議在 `staff` 增加：

```sql
availability_policy text not null default 'DEFAULT_AVAILABLE'
  check (availability_policy in ('DEFAULT_AVAILABLE','EXPLICIT_ONLY'))
```

既有人員 migration 預設 `DEFAULT_AVAILABLE`，理由是向後相容，不讓既有導遊因新欄位上線突然全部變成不可排。

這是每位導遊自己的屬性。團隊可以同時存在：

- Wayne：平常可接案
- Amy：僅指定時間可接案

不得建立 `tenant.availability_policy` 強迫全團隊使用同一規則。

## UI

GUIDE 對外文案只顯示：

- `平常可接案`
- `僅指定時間可接案`

可在導遊資料與行事曆的「可接案時間」設定中修改。一般使用者不需要知道 `DEFAULT_AVAILABLE` / `EXPLICIT_ONLY` 技術值。

## Availability engine

共用 availability engine 必須先取得該 staff 的 policy，再套同一套衝突來源：

- `DEFAULT_AVAILABLE`：不要求 shift coverage。
- `EXPLICIT_ONLY`：必須有完整 shift coverage。
- 兩者都要排除 `block_times`、重疊 bookings、重疊非 CANCELLED 團次，以及未來接入的 external busy event。

固定團次、動態可預約時段與一般服務若共用同一位人員，都必須使用同一判斷，不准各自解讀 policy。

## 與其他決策的關係

- GUIDE 的班表／封鎖能力仍收斂在 `/tenant/calendar`，見 `2026-08-27-guide-availability-calendar.md`。
- 單導遊／團隊 UI 仍依 active+bookable 人數自動適應，見 `2026-08-27-guide-solo-team-auto-ui.md`。
- 團次 PRIMARY／ASSISTANT 與雙向撞班由 Issue #37 實作。

Production migration / DDL 仍需 Owner 另行明確授權。