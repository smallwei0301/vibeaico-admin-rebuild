# 產品改善：#218 點數一致性與跨會話分工

狀態：READY_FOR_PROMOTION（僅原始碼候選）；不是已驗收、已合併或已出貨。
Owner：2026-09-07 要求開始產品審查改善，明確提醒另一個 Agent 同步修主線，避免衝突。
開工 main：`629f41c8a72f8efb74030c1e67702b18535cd52f`。
本會話分支：`product/issue-218-points-atomic-current`。
追蹤：[#218](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/218)。

## 分工與邊界

| 工作 | 即時觀察 | 本會話處置 |
|---|---|---|
| #33 商品訂單與預約票券 | PR #216；apply-coupon、server/coupons、商品頁、types/mappers；migration 0081 | 另一個主線持有，不修改 |
| #33 預約匯出 | PR #217；匯出 routes/helper/test | 不修改 |
| #33 營業時間自動封鎖 | PR #219；settings API/UI/service | 不修改；行事曆 token 修正也避開同一 settings 頁 |
| #176 活動誠實標示 | PR #220；campaigns UI/i18n/test | 已有實作候選，不重做 |
| #35 票券/會員欄位 | PR #93 已進開工 main | 不沿用審查時 b2c0717 的舊頁面版本 |
| #218 預約點數折抵 | 本會話唯一 source-only 候選 | 獨立 route、新 migration、專用測試與本文件 |
| 核心表角色邊界 | #221 已完成線上 metadata 唯讀核實 | 尚未修改權限；須獨立盤點合法員工操作與共用表影響 |
| 行程/團次保存、旅遊訂單、收款、自助旅程 | 既有 #8/#9/#10/#12/#41/#42/#46 與保留分支 | 後續依主線 ownership 接續，不複製第二套系統 |
| 商品取消回補庫存 | 前輪發現，會與商品訂單主線共享資料 | 後續獨立切片，先等 #216 定版 |

不重設、改寫、合併或關閉其他代理的分支/PR；不編輯另一會話的 Run ledger。
沒有將 legacy Run 3 的既有 IN_PROGRESS 記錄當成本會話的完成證據。

Sol TRIAGE 核實：PR #216 完成 source，進 TEST_VALIDATION；本候選可作單一
RESERVE source-only 預備工作。不得以既有未符合條件的雙 Terra metadata 宣稱 qualified。
本候選最多一筆 commit，`ACTIVE_CANDIDATE=false`、`TEST_LANE_REQUIRED=false`。
不建立 active PR、不使用 shared TEST、不進早期/最後放行 Audit。Promotion 前重新盤點。

## #218 修正契約

保留 `POST /api/bookings/:id/apply-points` 的 `{points}` 輸入，以及
`{finalPrice, customerPoints}` 回應；依 canonical §B-1，1 點折抵 1 元。

舊流程讀預約價格，另行扣點、寫帳本、改價。新流程須在單一資料庫交易裡：

1. 核對身分、選定店家與 POINT_SYSTEM 功能權益。
2. 鎖住該店預約，然後鎖住該店/該預約的顧客；統一鎖定順序。
3. 從鎖定後的真值檢查點數及金額足夠。
4. 扣除顧客點數、寫一筆 REDEEM_BOOKING 帳本、同步降低 final_price。
5. 任一步失敗皆一起撤回，不能退回舊的三段寫入方式。

不得信任 client 傳入其他店家、價格或扣點後餘額。新 RPC（資料庫操作入口）也需維持
租戶與功能權益邊界，不能只在 HTTP route 檢查卻放任直接呼叫繞過。

本切片只修單次交易完整性及各次合法折抵的並發序列化。現有契約沒有 request id，
不得將兩次相同 `{points}` 自動視為同一次操作，也不得宣稱已具跨網路重送的冪等保證。
跨 route（票券/改價/其他點數異動）仍須在整合階段核對共同鎖與計算契約。

## 驗收案例與尚未執行的關卡

- 正常：100 元、100 點，折抵30後為70元、70點，帳本只有本次一列。
- 同預約並發：兩次各30，最終40元、40點、兩筆扣點紀錄。
- 同顧客不同預約：共享點數不足時不可透支；每筆價格與成功扣點一致。
- 故障注入：帳本或最後改價失敗，三處資料均恢復原值。
- 不合法：非正整數、超過金額、點數不足、預約/顧客不存在。
- 邊界：未登入、跨店、權益未開通、繞過HTTP直接呼叫資料庫入口。
- Promotion 時以新建隔離資料庫與唯一 canonical TEST holder 實跑上述情境。
- source-only 的 route mock 單元測試只能證明接線及錯誤回應，不能證明資料庫交易或並發。
- 必要測試完成後才依 exact head 做 Sol 與 Astra 最後評估。
- 正式資料庫更新及發布未執行；不得把保存候選分支算成產品出貨。

## #221 線上權限核實

使用 Supabase 連線工具先確認 Vibe Ai backend 與 Vibe Ai test 身分。只在正式 backend
執行 `BEGIN TRANSACTION READ ONLY` 的系統目錄查詢，未讀取顧客、訂單內容或任何秘密，
未做測試寫入。

查詢 `pg_class`、`pg_policies`、`pg_trigger`、`pg_proc` 得到：

| 表 | RLS | authenticated INSERT/UPDATE/DELETE | policy | 自訂 trigger |
|---|---|---|---|---|
| bookings | 開啟 | 全部允許 | PERMISSIVE ALL，is_tenant_member(tenant_id) | 無 |
| customers | 開啟 | 全部允許 | 同上 | 無 |
| products | 開啟 | 全部允許 | 同上 | 無 |
| product_orders | 開啟 | 全部允許 | 同上 | 無 |
| coupon_instances | 開啟 | 全部允許 | 同上 | 無 |
| customer_point_logs | 開啟 | 全部允許 | 同上 | 無 |

`is_tenant_member` 只核對 tenant_users 的 tenant_id/user_id，不檢查角色。
因此「線上過寬設定」已確認，但未用STAFF實際改價、未聲稱發生攻擊或財務損失。
修正需保留 canonical 允許的 STAFF 動作，不能把所有表簡單改成只有 MANAGER 可寫。
既有寬鬆 policy 必須真正移除/收緊；加一條新的 PERMISSIVE policy 不會取代它。
依據：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 證據與交接

- 前輪產品靜態審核：Sol `gpt-5.6-sol`、Astra `gpt-6-astra`。
- 本輪 TRIAGE：`gpt-5.6-sol`；source-only 施工：`gpt-5.6-terra`。
- 本輪最後 Audit：NOT_RUN（RESERVE 不進放行）。
- 實際 token/成本：未提供，不推估。
- `npm test`：85 檔、848 項通過（含本切片 11 項）；`npm run typecheck` 通過。
- `npm run build`：通過（exit code 0）；Next.js 仍輸出既有 metadata themeColor 警告。
- 整合測試草稿尚未執行；故障注入回滾案例仍為 todo，升格後需補齊並驗證。
- 本版以最新 main `629f41c8a72f8efb74030c1e67702b18535cd52f` 重建；主線已使用 0082/0083，點數 migration 順延為 0084，新增匯出與營業時間變更，與本候選檔案無重疊；本版 current-main 組合已重新跑上述本機檢查；資料庫整合仍未執行。
- 未安裝 Supabase CLI；migration 使用 repo 四位流水號 0084，未套用任何資料庫。
- DB integration / E2E / shared TEST / Production DDL/DML / 真實付款通知：NOT_RUN。
