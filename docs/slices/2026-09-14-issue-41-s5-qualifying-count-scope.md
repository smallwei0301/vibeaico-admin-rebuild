# 切片備查：#41 §5「有效成團人數」——可立即開工的最小邊界

- 產出時間：2026-09-14T12:4x UTC（Owner 外出視窗末段）
- 性質：**唯讀盤點，未開工**。寫這份是因為剩餘時間不足以跑完一輪
  build + audit + Final Risk，開了只會留半成品。
- 基準：`origin/main` = `35e2e1a6`
- 規格來源：`docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §5（L189–211）、§6（L215–250）

## 為什麼 §5＋§6 整包**不是**一個切片

§6 的「系統自動」有 13 條，涵蓋原子暫占、provider callback、狀態機
`COLLECTING → FORMED / REVIEW_REQUIRED / AT_RISK`、同 transaction 建立
`GROUP_FORMED` notification event、尾款計算與期限通知、hold 過期釋放。
其中 notification event 一條**依賴 #40 的 outbox**（本輪已知不可做）。
把 §5 和 §6 綁在一起，等於把一個可驗證的計數規則綁在一條還沒有底座的通知鏈上。

## 可立即開工的最小邊界：只做 §5 的計數規則

### 要做的事

一個**純函式／伺服器模組**：給定 departure，依 §5 的表算出有效成團人數。

§5 的規則逐字是：

| `deposit_mode` | 何時計入成團 |
|---|---|
| `NONE` | 訂單依規則成立時立即計入 |
| `DEPOSIT_FIXED` | 訂金付款成功／匯款被導遊確認後 |
| `DEPOSIT_PERCENT` | 訂金付款成功／匯款被導遊確認後 |
| `FULL` | 全額付款成功／匯款被導遊確認後 |

不計入（會先占位）：剛建立正在付款的 `PENDING`、provider 未回成功 callback、
匯款只有旅客回報後五碼而導遊尚未確認。

### 這個切片為什麼現在就能做（三個前提都已成立）

1. **所需欄位都在**：`tour_orders.deposit_mode_snapshot` 與 `payment_status` 由 `0108`
   提供，`0108` 已套用正式庫與 TEST（本 Run 稍早已同步帳本）。**不需要新 migration**，
   因此完全不碰「0109 待決」那條線。
2. **helper 確實不存在**，不是我沒找到。實查：
   ```
   git grep -nE "qualifying|qualified|formationCount|countQualif|成團人數|合格人數" -- src/
   ```
   只有兩筆命中：`tour-orders/manual/route.ts:89` 的驗證訊息、
   `i18n/zh-TW/pages/dashboard.ts:69` 的標籤字串。**兩者都不是 helper。**
3. **與既有 `seats_booked` 不衝突**：§5 開宗明義「容量占用與成團計數是**兩本帳**」。
   `seats_booked`（現有 6 處讀取）是容量占用，**不可**拿來當成團計數——
   這正是這個切片存在的理由。

### 明確不在這個切片內

- 任何狀態自動推進（`COLLECTING → FORMED` 等）——屬 §6，需原子 transaction。
- 任何 notification event——依賴 #40 outbox。
- 任何尾款計算——依賴 §9 欄位，那些欄位不在 canonical。
- 任何 migration、任何環境套用。

### 建議的驗收判準（機械可執行，直接對應 PB-048 的教訓）

每一條規則都要有一筆**會被它擋掉**的 fixture：把該條件拿掉，測試必須變紅。
最低限度四組對照：`NONE` 立即計入、`DEPOSIT_FIXED` 未付款不計入、
付款成功後計入、匯款未經導遊確認不計入。

### 路由

`TERRA_BUILD` → `claude-sonnet-5`（新增 server 模組與測試＝施工）。
風險分級由 `docs/MODEL-ROUTING.md` 判定；本切片不碰租戶邊界查詢、不碰金流寫入，
預期**不觸發**高風險 Final Risk 閘門，但那是 routing 判定的事，不是我在這裡宣告的。
