# Delivery Outcome v2.2：把成品、半成品、Epic 與重複收據分開

> 第一階段追蹤：Issue #113
>
> 唯一身分 hardening：Issue #122
>
> Delivery Slice 邊界：Issue #143
>
> `schemaVersion` 仍是 `2`。v2.2 是計數、Issue 大小與驗證規則變嚴，不重寫 v1／v2.1 歷史分數，也不和 v1 直接比較。

## 為什麼要改

舊的 Delivery Unit 把以下工作都加成「成品」：

```text
Issue closed            1.00
Audit Ready             0.80
完整 Owner-blocked      0.50
只有 exact-head CI      0.25
只有 commit             0.10
```

這會讓兩個車門與半顆引擎，看起來像一台車。更麻煩的是，未完成 Run 只有 `0.1` 時，usage 除以小分母會被放大，產生「效率惡化數倍」的假象。

v2 第一階段已把成品與半成品分帳；v2.1 再補一個漏洞：同一張 Issue 若重複貼兩筆 claim（完成證據列），不能被算成兩件出貨。就像同一張發票影印兩次，仍只買了一台冰箱。

v2.2 再處理另一個反方向問題：#28、#42、#43、#8、#120 這類大型 Issue 包含多個可獨立使用的功能。如果只有整張大 Issue 關閉才算成品，已上線的小功能會長期卡在 WIP；如果父 Issue 與每個小功能都算，又會重複灌水。因此改用 Epic（大主題）＋Delivery Slice（可獨立交付的小功能）。

## v2.2 的 Delivery Unit

一個 Delivery Unit 必須同時具備：

```text
唯一主體    = 一張 canonical primary Issue
唯一狀態    = CLOSED 或 OWNER_BLOCKED_COMPLETE，不能同時
可獨立使用  = 一個使用者看得見、可操作或可持久化的完整小結果
總體核准    = completionTruth.status=VERIFIED
即時證據    = verification=VERIFIED，且 evidenceRef 指回同一張 Issue
計數上限    = 同一 Issue 在同一 Run 最多 1 次
```

支援的 Issue subject（主體）格式會先標準化為 `issue#<number>`：

```text
issue#10
Issue: 10
#10
https://github.com/<owner>/<repo>/issues/10
https://api.github.com/repos/<owner>/<repo>/issues/10
```

`pull#10`、空白、`TBD`、Issue 0 或無法辨認的文字不算 Delivery Unit。

`evidenceRef` 也必須能整理成同一個 Issue 身分，例如：

```text
subject: issue#10
證據可用: github:issue#10
證據可用: https://github.com/<owner>/<repo>/issues/10
證據不可用: github:issue#11
```

最後一例不是少一張附件而已，而是拿 11 號案件的收據來證明 10 號案件；這種已標成 VERIFIED 的錯配會 `F-HARD`。

## Epic、Delivery Slice 與 standalone Issue

### Epic（大主題）

符合任一條件就應視為 Epic：

- 同時包含兩個以上可各自上線、各自驗收的使用者結果；
- 驗收跨越多個獨立狀態機，例如方案 UI、付款、通知與管理者代建；
- 一張 Issue 需要多張互不相依的 Product PR 才能完成。

Epic 用來導航範圍、依賴與最終完整性，通常保持 open。它本身不是每個子成果的交付收據。當已計數的 Delivery Slice 全部完成後，最後關閉 Epic只是專案整理，**不得再增加 shipped unit**。

Epic 的 Completion Truth 關閉紀錄使用 `OTHER` 或等價非交付 claim，不寫進 `delivery.issuesClosed`。

### Delivery Slice（小交付單位）

一張 Delivery Slice 必須：

1. 只對應一個主要使用者結果；
2. 不依賴同一 Epic 的其他 Slice 才能被使用；
3. 有明確的真實資料／API／持久化結果，不能只有畫面或假成功；
4. 有自己的驗收、exact-head 證據與安全邊界；
5. 合併並從 `main` 重讀後，能在同一 Run 內關閉；
6. 在 body 標記：

```text
DELIVERY_UNIT_TYPE: SLICE
PARENT_EPIC: #number | none
COUNT_IN_DELIVERY_OUTCOME: true
```

父 Epic 保持 open 不妨礙一張已驗證 Slice 關閉並計入 shipped unit。

### Standalone Issue（本來就夠小）

若 Issue 從一開始就只有一個完整結果，可使用：

```text
DELIVERY_UNIT_TYPE: STANDALONE
PARENT_EPIC: none
COUNT_IN_DELIVERY_OUTCOME: true
```

它與 Delivery Slice 的計數方式相同。

### 禁止事後灌水

已合併很久才補建的追蹤 Issue 必須標示：

```text
RETROACTIVE_TRACKING_MIGRATION: true
COUNT_IN_DELIVERY_OUTCOME: false
```

它可以整理歷史，但不得回寫舊 Run，也不得冒充本輪新出貨。父 Epic 與已計數子 Slice、同一成果的 replacement／superseded Issue，也都不能重複計分。

## 開工與收尾規則

- TRIAGE 發現一張 Issue 有兩個以上獨立成果時，先建立 Delivery Slice，再開始 Product BUILD。
- Product PR 的 lifecycle `issue:` 指向 Slice／standalone Issue；父題另填 `PARENT_EPIC`。
- 同一 Slice 同時只能有一張 active implementation PR。
- 合併後同一輪完成 Issue live close、main reachability、`ref=main` 重讀與 Completion Truth。
- 沒有關閉目前 Slice 前，不因「還有容量」無限制開第三件半成品。
- 歷史大型 Issue 不必一次拆完；只在下一個要施工的成果開工前建立對應 Slice。

## v2.2 的兩本成果帳與一本在製品帳

### 真正出貨 `shipped_units`

```text
不重複、live-verified、COUNT_IN_DELIVERY_OUTCOME=true 的 CLOSED Delivery Slice／standalone Issue × 1.0
```

只有它能當「每件真正成品 usage」的分母。即使個別 claim 寫著 VERIFIED，只要整體 `completionTruth.status` 還是 `NOT_CHECKED` 或 `FAILED`，`shipped_units` 就先保持 0，不提前顯示成品。

Epic、retrospective migration、純治理整理與同一成果的重複 Issue 不進 shipped account。Completion Truth 產生者必須先讀 Issue body 的 `DELIVERY_UNIT_TYPE` 與 `COUNT_IN_DELIVERY_OUTCOME`，只有合格 Slice／standalone 才建立 `ISSUE_CLOSED` delivery claim。

### 自主完成 `autonomous_outcome_units`

```text
不重複、live-verified 的合格 CLOSED Issue × 1.0
+ 不重複、live-verified 的 complete OWNER_BLOCKED Issue × 0.75
```

`OWNER_BLOCKED` 必須證明 Agent 能做的都做完，只剩精確的 Owner、Production 或外部供應商動作。它有價值，但不冒充已出貨。

同一張 Issue 若同時被驗證為 `ISSUE_CLOSED` 與 `OWNER_BLOCKED_COMPLETE`，視為互相矛盾的完成宣稱，結果是 `F-HARD`；OWNER_BLOCKED 那一側也不會再加 0.75。

### 在製品 `wip_inventory`

以下只列數量，不再折算成品：

```text
Audit Ready
exact-head CI only
commit only
unfinished carryover
```

## 手填數字只是對帳欄，不再主導成果

為了相容既有 ledger（執行紀錄），以下欄位暫時保留：

```text
delivery.issuesClosed
delivery.ownerBlockedComplete
```

Final Run 中，它們必須精確等於 Completion Truth 裡「不重複、已驗證、格式正確、證據指回同一 Issue，而且符合 Delivery Slice／standalone 計數資格」的數量：

```text
issuesClosed: 2 + issue#10 + #10
→ 只有 1 個唯一 Issue
→ shipped_units = 1
→ NOT_GRADED（手填 2 與真實證據 1 不一致）

issuesClosed: 2 + issue#10 + issue#11
→ 2 個唯一合格 Issue
→ shipped_units = 2
→ 可繼續進入評分
```

多貼相同 claim 不會增加分數；少填或多填手動總數，也都會讓該 Run 暫不評分，直到帳目一致。

## 什麼時候可以算分

只有 `BASELINE`、`COMPLETE`、`OWNER_BLOCKED` 且資料完整、Completion Truth 驗證通過的 schema v2 Run 才算分。

```text
IN_PROGRESS / CLOSURE_RECOVERY → NOT_GRADED
缺 end SHA 或結束盤點        → NOT_GRADED
缺必要百分比                 → NOT_GRADED，不補 50 分
Completion Truth 未 VERIFIED  → NOT_GRADED，且成果數先為 0
唯一 Issue 數與手填總數不符  → NOT_GRADED
證據不是 Issue 或只是占位文字 → NOT_GRADED
完成宣稱與 live state 衝突    → F-HARD
證據指向另一張 Issue          → F-HARD
同一 Issue 宣稱兩種完成狀態   → F-HARD
Epic／retroactive 被列為出貨  → NOT_GRADED，移出 delivery claim 後重算
```

`weighted_usage_per_shipped_unit` 只在 `shipped_units >= 1` 時計算。沒有真正出貨就顯示「資料不足」，不拿 0.1 顆螺絲反推整台車成本。

## Completion Truth

每個 v2 Run 必須有：

```json
{
  "completionTruth": {
    "status": "NOT_CHECKED | VERIFIED | FAILED",
    "checkedAt": null,
    "claims": []
  }
}
```

可驗證宣稱包含 Issue closed、完整 Owner-blocked、PR merged、CI green、local TEST green 與 Run complete。每筆 `VERIFIED` 必須有 live evidence reference。

特別規則：GitHub job 顯示 `skipped` 時，不能宣稱 local TEST green；PR 只有 open／closed 也不能宣稱 merged；`evidenceRef` 為空、`TBD`、`UNKNOWN`、不是 Issue，或指向另一張 Issue 時，不能覆蓋交付數字。

對 delivery claim 還要先讀 live Issue body：

- `DELIVERY_UNIT_TYPE` 必須為 `SLICE` 或 `STANDALONE`；
- `COUNT_IN_DELIVERY_OUTCOME` 必須為 `true`；
- `RETROACTIVE_TRACKING_MIGRATION` 不得為 `true`；
- Epic 關閉只作專案整理，不產生 `ISSUE_CLOSED` delivery claim。

## 指令

```bash
npm run agent:run:init
npm run agent:run:validate -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:score -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:review -- docs/metrics/agent-runs
```

舊 v1 工具保留為 `agent:run:legacy:*`，只用於重現歷史報告。

## v2.3：Product Delivery Truth Ladder

Issue #163 起，新建立的 schema v2 ledger 會加上：

```json
{ "deliveryTruthVersion": 3 }
```

舊的 v2.2 完成輪次沒有此欄位時維持原計分語意，不回寫歷史。v3 的一張 Delivery Slice 只有依序取得以下五種 live evidence，才可建立一件 `shipped_unit`：

```text
SOURCE_VERIFIED                    exact PR head 的 ci 成功
MERGED_TO_MAIN                     merge SHA 可由 current main 到達
AUTO_VERCEL_DEPLOYED               同一 merge SHA 的 Vercel 狀態為 READY
PRODUCTION_SCHEMA_READY            已驗證套用，或實際沒有 migration 而 NOT_REQUIRED
AUTHENTICATED_PRODUCTION_ACCEPTED  登入正式站後完成真實操作與持久化驗收
```

`CANCELED_IGNORED` 只表示純文件／治理變更被 Vercel 提早停止，不能當 Product deployment。App 已部署也不能證明 Production schema 已準備；TEST migration、匿名 HTTP 200 或成功 toast，也不能取代登入正式站後的驗收。

### v3 claim

五階段 claim 都以同一個 `issue#<number>` 為 subject，且需要可追溯的 evidenceRef：

```text
SOURCE_VERIFIED
MERGED_TO_MAIN
AUTO_VERCEL_DEPLOYED
PRODUCTION_SCHEMA_READY
AUTHENTICATED_PRODUCTION_ACCEPTED
```

成功狀態分別是：

```text
success
merged
ready
ready | not_required
accepted
```

一張 Issue 已關閉但缺少任何階段時，列入 `productionPendingUnits`，結果 `NOT_GRADED`，不拿來當 usage 分母。若只剩 Owner 的 Production migration、憑證或真實帳號驗收，Issue 應保持 open 並使用 `OWNER_BLOCKED_COMPLETE`，而不是先關閉再冒充 shipped。

### PR 完成欄位

Product PR 必須分開填寫：

```text
MANUAL_PRODUCTION_PROMOTE
AUTO_VERCEL_PRODUCTION_DEPLOY
PRODUCTION_SCHEMA_STATUS
PRODUCTION_SCHEMA_EVIDENCE
AUTHENTICATED_PRODUCTION_ACCEPTANCE
AUTHENTICATED_PRODUCTION_EVIDENCE
```

禁止再用單一句 `Production deploy: NOT_RUN` 同時代表「沒有手動 promote」與「沒有 Vercel 自動部署」。Completion Truth 會從 GitHub 的 Vercel commit status 讀取自動部署狀態，並從 GitHub 實際 changed-file list 判斷是否碰到 `supabase/migrations/`；migration 變更卻宣稱 `NOT_REQUIRED`，或宣稱 `VERIFIED` 卻沒有 evidence，會 fail closed。
