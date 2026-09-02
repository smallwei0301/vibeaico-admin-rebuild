# Delivery Outcome v2：把成品與半成品分開

> 追蹤：Issue #113
>
> v1 報告保留為歷史，不重寫舊分數，也不和 v2 直接比較。

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

## v2 的兩本帳

### 真正出貨 `shipped_units`

```text
live-verified CLOSED Issue × 1.0
```

只有它能當「每件真正成品 usage」的分母。

### 自主完成 `autonomous_outcome_units`

```text
live-verified CLOSED Issue × 1.0
+ live-verified complete OWNER_BLOCKED × 0.75
```

`OWNER_BLOCKED` 必須證明 Agent 能做的都做完，只剩精確的 Owner、Production 或外部供應商動作。它有價值，但不冒充已出貨。

### 在製品 `wip_inventory`

以下只列數量，不再折算成品：

```text
Audit Ready
exact-head CI only
commit only
unfinished carryover
```

## 什麼時候可以算分

只有 `BASELINE`、`COMPLETE`、`OWNER_BLOCKED` 且資料完整、Completion Truth 驗證通過的 schema v2 Run 才算分。

```text
IN_PROGRESS / CLOSURE_RECOVERY → NOT_GRADED
缺 end SHA 或結束盤點        → NOT_GRADED
缺必要百分比                 → NOT_GRADED，不補 50 分
完成宣稱與 live state 衝突    → F-HARD
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

特別規則：GitHub job 顯示 `skipped` 時，不能宣稱 local TEST green；PR 只有 open／closed 也不能宣稱 merged。

## 指令

```bash
npm run agent:run:init
npm run agent:run:validate -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:score -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:review -- docs/metrics/agent-runs
```

舊 v1 工具保留為 `agent:run:legacy:*`，只用於重現歷史報告。
