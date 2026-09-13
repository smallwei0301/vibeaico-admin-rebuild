# Governance Scoreboard

本文件定義 `MODEL_GOVERNANCE` Run 的可比較性、治理證據完整度與 Scoreboard contract（評分板契約）。
它不改變 Product 規格，也不改變 `PRODUCT_MAINLINE` 的 builder／audit／Final Risk 模型政策。

2026-09-11 Owner 最新決策：**MODEL_GOVERNANCE 不指定模型，也不分析使用哪個模型。**

因此 Governance Scoreboard 下一版的核心問題是：

> 治理工作是否留下可重建、可比較、沒有假完成的證據，而且是否真的降低工程摩擦而沒有削弱 Product 安全門？

而不是：

> 是哪個模型做的？Sol／Opus／Astra／Fable 用了幾次？

## 1. Contract v2：model-agnostic governance

自 `docs/metrics/governance-scoreboard-policy.json` 的 v2 `effectiveAt` 起，新 terminal Governance Run 使用 contract v2。在 policy v2 尚未合併生效前，現有 contract v1 只作歷史／相容重播，不作新的治理模型分析。

v2 **不要求也不評分**：

- `requestedModel`
- `actualModel`
- `identityEvidence`
- `providerExecutionRef`
- provider-verified model coverage
- operator-attested model coverage
- Sol／Opus／Terra／Astra／Fable utilization

PR metadata 若仍保留模型紀錄欄，未指定與無可靠實際型號證據時如實記：

```text
REQUESTED_MODEL / ACTUAL_MODEL: requested=not_requested; actual=unknown
```

這是 truth record（真實紀錄），不是模型要求，也不得被當成模型執行證據或 Scoreboard coverage。

`PRODUCT_MAINLINE` 的模型路由與 Final Risk 完全不受本節影響。

## 2. Durable governance review evidence contract v2

每一筆計入 Governance Scoreboard v2 的 review evidence（治理審查證據）至少要有：

- `role`: `GOVERNANCE_REVIEW`
- durable `executionRef`
- `subject`，例如 `pr#123`
- `reviewedSha` 或 `changeDigest`
- `verdict`: `PASS | FAIL | FIX_REQUIRED | PENDING`

證據檔仍放在：

`docs/metrics/review-evidence/<runId>.json`

v2 例子：

```json
{
  "contractVersion": 2,
  "runId": "2026-09-11-governance-r01",
  "finalReviewedSha": "<40-char sha>",
  "records": [
    {
      "id": "github:pr#123/review#final",
      "subject": "pr#123",
      "role": "GOVERNANCE_REVIEW",
      "executionRef": "github:pr#123/review#final",
      "reviewedSha": "<40-char sha>",
      "changeDigest": null,
      "verdict": "PASS"
    }
  ]
}
```

同一筆 review 不得重複計數：

- `id` 必須唯一；
- `executionRef` 必須唯一；
- 換一個 record id 但指向同一個 executionRef，仍是同一筆 evidence；
- 純 metadata 修正、沒有重新執行 review，不得增加 review touch。

低風險 Governance Run 可以 `records: []`。Scoreboard 不會為了填數字強迫多做一次 ceremony review（形式審查）。

## 3. Blocking finding 必須對 final head 做 reconciliation

`FAIL` / `FIX_REQUIRED` 不會因為後面出現另一筆 PASS 就自動消失。

若同一 evidence packet 存在 blocking review，terminal closeout 必須：

1. packet 提供 `finalReviewedSha` 或 `finalChangeDigest`；
2. 每一筆 blocking review 加上：

```json
{
  "reconciliation": {
    "status": "RESOLVED_ON_FINAL_HEAD",
    "byRecordId": "github:pr#123/review#final-pass"
  }
}
```

3. `byRecordId` 必須指向同一 PR subject、同一 review role 的 `PASS` record；
4. 該 PASS 的 `reviewedSha` / `changeDigest` 必須與 packet 的 final anchor 相同。

這條保留，因為它是在驗證「問題真的修到最後版本」，與使用哪個模型無關。

## 4. Metric data quality：v2 使用 17 個 model-neutral core metrics

Governance Scoreboard v2 的 core metrics 排除舊 v1 的：

- `flow.solTouches`
- `flow.solIssues`

因為它們把治理品質綁到特定模型角色。

v2 的 17 個核心欄位是：

```text
delivery.cycleTimeMinutes
ci.fullCiRuns
ci.invalidReruns
ci.firstPassRatePercent
quality.acceptanceEvidenceCoveragePercent
quality.auditFirstPassRatePercent
quality.unresolvedP0
quality.unresolvedP1
quality.reopenedIssues
quality.postMergeRegressions
quality.safetyViolations
flow.duplicateAgentTasks
flow.ownershipCollisions
flow.waitTimeConvertedPercent
auditability.evidenceFieldsCompletePercent
auditability.exactHeadTestCoveragePercent
auditability.preciseBlockersPercent
```

`metricDataQualityPercent` 必須由 `scripts/metrics/governance-scoreboard.mjs` 實算，不接受人工填漂亮百分比。

新 terminal v2 Run 必須：

1. core metric data quality >= policy 門檻，現行目標為 95%；
2. `auditability.scoreInputsCompletePercent` 與程式實算值一致；
3. terminal `run.startedAt` 可解析；
4. policy `effectiveAt` 可解析；
5. 若存在 blocking review，完成 §3 final-head reconciliation；
6. review evidence v2 schema 合法且 executionRef 不重複。

時間戳缺失／格式錯誤必須 fail closed（失敗即阻擋），不得利用壞 timestamp 靜默跳過 enforcement。

Token／weekly usage 若平台拿不到，維持 unknown/null，不估算。

## 5. Scoreboard v2 要呈現什麼

v2 報表至少呈現：

```text
Metric data quality
Comparison eligible
Review evidence records
Unique reviewed subjects
Blocking findings / reconciliation status
Missing core metrics
Comparison blockers
Contract errors
```

不要呈現 MODEL_GOVERNANCE 的：

```text
requested / actual model
provider model identity coverage
operator-attested identity coverage
Sol touches / Sol issues
Final Risk model touches
model utilization ranking
```

Governance Retrospective 可以分析 CI 浪費、WIP、PR lifecycle、completion truth、provider incidents 與 evidence 品質，但不分析治理模型選擇。

## 6. Retrospective 必須同時讀 Product 與 Governance 兩張成績單

`復盤／複盤` 不得因 Product Run 不足三輪就跳過 Governance Scoreboard。

正確輸出：

```text
PRODUCT DELIVERY SCORE / TREND
→ 如果不足 3 個 terminal + truth-verified + comparable Product Runs：NOT_GRADED

GOVERNANCE SCOREBOARD
→ 照樣重算、照樣報告 data quality / comparison eligibility / evidence gaps
```

這兩張表彼此獨立。

## 7. Historical contract v1 保留、不可改寫

Contract v2 生效前的 Governance Scoreboard v1 與 review evidence 全部維持 read-only history。

例如 `2026-09-09-governance-loop-r01`：

- metric data quality 68.4% (13/19)
- historical comparison eligible: NO
- ledger 與 durable evidence 曾存在 flow mismatch

這些歷史事實不回寫、不補 0、不事後修成漂亮分數。

v1 曾記錄模型身分欄位，程式仍保留**重建歷史報告**的能力，但新的 retrospective 不得把歷史 model identity coverage 拿來做 MODEL_GOVERNANCE 品質趨勢或模型優劣結論。

簡單說：

> 歷史可以重播，但舊的模型指標不再指揮未來治理。

## 8. Review / closeout 問句

新 Governance Run 結案前至少回答：

1. core metrics 完整度是多少？是否 >= policy 門檻？
2. evidence packet 能否由 durable executionRef 重建？有沒有重複計數？
3. `startedAt` / `effectiveAt` 是否有效？
4. 是否曾有 `FAIL` / `FIX_REQUIRED`？每一筆是否 reconciliation 到 final-head PASS？
5. exact-head required CI / tests 是否真的執行，而不是 `POLICY_SKIP` 看起來 success？
6. Completion Truth 是否重新讀 live PR/main/file 驗證？
7. 是否產生 invalid rerun、metadata trial-and-error、stale PR 或多餘 WIP？
8. 如果資料不足，是否誠實標 `non-comparable`，而不是補 0、平均值或推估？
9. 本輪治理是否減少工程摩擦，且沒有削弱 Product safety gate？

**不需要回答「這輪治理是由哪個模型做的」。**
