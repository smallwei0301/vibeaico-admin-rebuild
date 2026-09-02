# Delivery Outcome v2.1：把成品、半成品與重複收據分開

> 第一階段追蹤：Issue #113
>
> 唯一身分 hardening：Issue #122
>
> `schemaVersion` 仍是 `2`。v2.1 是計數與驗證規則變嚴，不重寫 v1 歷史分數，也不和 v1 直接比較。

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

## v2.1 的 Delivery Unit

一個 Delivery Unit 必須同時具備：

```text
唯一主體    = 一張 canonical primary Issue
唯一狀態    = CLOSED 或 OWNER_BLOCKED_COMPLETE，不能同時
即時證據    = verification=VERIFIED，且 evidenceRef 不是空白或 placeholder
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

## v2.1 的兩本成果帳與一本在製品帳

### 真正出貨 `shipped_units`

```text
不重複、live-verified 的 CLOSED Issue × 1.0
```

只有它能當「每件真正成品 usage」的分母。

### 自主完成 `autonomous_outcome_units`

```text
不重複、live-verified 的 CLOSED Issue × 1.0
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

Final Run 中，它們必須精確等於 Completion Truth 裡「不重複、已驗證、格式正確」的 Issue 數：

```text
issuesClosed: 2 + issue#10 + #10
→ 只有 1 個唯一 Issue
→ shipped_units = 1
→ NOT_GRADED（手填 2 與真實證據 1 不一致）

issuesClosed: 2 + issue#10 + issue#11
→ 2 個唯一 Issue
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
唯一 Issue 數與手填總數不符  → NOT_GRADED
完成宣稱與 live state 衝突    → F-HARD
同一 Issue 宣稱兩種完成狀態   → F-HARD
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

特別規則：GitHub job 顯示 `skipped` 時，不能宣稱 local TEST green；PR 只有 open／closed 也不能宣稱 merged；`evidenceRef` 為空、`TBD`、`UNKNOWN` 或其他 placeholder 時，不能覆蓋交付數字。

## 指令

```bash
npm run agent:run:init
npm run agent:run:validate -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:score -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:review -- docs/metrics/agent-runs
```

舊 v1 工具保留為 `agent:run:legacy:*`，只用於重現歷史報告。
