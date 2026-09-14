# 2026-09-14 Owner Decision — GUIDE REQUEST 接受後付款保留時間

## 決策

Owner 選擇 **B：預設 12 小時**。

但 12 小時是**預設值，不是固定不可變規則**。GUIDE 必須保留導遊依不同方案與實際接案情境調整付款保留時間的彈性。

## 適用範圍

此決策適用 `sales_mode = REQUEST`（先申請再確認）的流程：

1. 旅客送出 REQUEST 時不鎖導遊時間。
2. 導遊按「接受」時，系統原子重查 availability。
3. 時段仍可用時，才建立／啟用 PRIVATE Departure，指派 PRIMARY／必要 ASSISTANT，並開始付款保留期。
4. 預設付款保留期為 **12 小時**。

## 調整彈性

- 導遊可針對 Plan 設定自己的 REQUEST 付款保留預設。
- 接受單一 REQUEST 時可再針對該次交易覆寫保留時間。
- 實際接受時必須 snapshot 成具體截止時間，例如 `hold_expires_at`；後續修改 Plan 預設不影響已存在的 REQUEST／TourOrder。
- 12 小時不得分散硬編碼在 checkout、cron、UI 或通知文案；應由單一設定／計算來源產生實際截止時間。
- UI 必須顯示實際截止時間，讓導遊與旅客知道這一筆究竟何時到期。

## 到期與安全邊界

付款保留到期後，系統只有在鎖住該筆訂單並重新確認下列條件都成立時，才能取消並釋放資源：

- 訂單仍為等待必要付款的狀態；
- `hold_expires_at` 仍存在；
- 截止時間確實已過；
- 沒有已確認付款事實。

若 provider callback 或合法人工確認已使付款成立，逾期程序不得再取消該訂單，也不得釋放已成立的名額／導遊時間。

此流程必須重用 repo 既有的專用 expiry RPC（逾期處理的資料庫原子操作）或等價單一事實來源，不能用通用 cancel RPC 繞過重新檢查。

## 非本決策內容

- 不在此裁示各 payment provider 的 timeout。
- 不在此改變 FIXED_DEPARTURE 或 INSTANT 的付款保留規則。
- 不在此決定退款政策。
- 不執行 Production DDL／DML、正式金流、正式部署或 runtime merge。

## 關聯

- `docs/decisions/2026-08-27-tour-plan-sales-modes.md`
- `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md`
- Issue #12
- Issue #41
- Issue #46
- Issue #350（逾期 cron 專用 expire RPC 安全邊界）
