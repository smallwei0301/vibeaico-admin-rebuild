# Governance Scoreboard Current Observation

> 這不是第三套 Scorecard。它是既有 Governance Scoreboard 的 **current observation layer**：正式 historical v1/v2 replay 與 blocking-finding reconciliation 完全保留；本層只負責讓每次複盤即使沒有 comparison-eligible Governance Run，也能拿到當期可重建的真實治理數字。

## 為什麼需要

過去正式 Governance Scoreboard 依賴獨立 Governance Run 內的 17 個 core metrics，其中多個是人工百分比。低風險治理 PR 通常不會另建一本治理 ledger，因此複盤常只得到 `NOT_GRADED`；事後補百分比又會把推算冒充觀測。

Current observation 改從 GitHub durable facts 直接重建。**沒有足夠歷史可以不做 trend，但不能因此沒有當期數字。**

## Command

預設看最近 24 小時：

```bash
node scripts/metrics/governance-observation.mjs
```

指定複盤窗口：

```bash
node scripts/metrics/governance-observation.mjs \
  --repo smallwei0301/vibeaico-admin-rebuild \
  --since 2026-09-14T00:00:00Z \
  --until 2026-09-15T00:00:00Z
```

Machine-readable JSON：

```bash
node scripts/metrics/governance-observation.mjs --since <ISO> --until <ISO> --json
```

Public repo 在 GitHub API rate limit 允許時可匿名讀；若執行環境有 `GITHUB_TOKEN`，collector 只把它放在 Authorization header，**不得輸出 token**。

## Workstream 判定

Collector 不能只相信 label，也不能只相信 PR body：

```text
body: WORKSTREAM: MODEL_GOVERNANCE
OR
label: workstream:model-governance
→ 收進 observation
```

body / label 不一致時仍收進來，但增加 `workstreamMismatches`。這是治理資料品質訊號，不是把該 PR 靜默丟掉。

## Current raw metrics

- governance PR：total / merged / open；
- open inventory：ACTIVE / PARKED / OWNER_BLOCKED / UNKNOWN；
- merged PR cycle time：樣本數 + median minutes；
- body / label workstream mismatch；
- governance scope budget violation：`changed_files > 8` 或 `additions + deletions > 800`；
- terminal PR lifecycle metadata stale / unknown；
- final-head `ci` attempts；
- same-final-head redundant reruns；
- final-head first-pass CI：**numerator / denominator / derived percent**；
- Agent WIP / WIP guard 在同一 final head 出現 failure 後 success 的 PR 數，作為 deterministic metadata preflight miss 的 proxy。

不同 SHA 的 CI 不算 same-head rerun。

## Unknown 不等於 0

若 GitHub Actions history endpoint 對任一 governance PR 無法讀取：

- workflow-derived metrics 使用 `null`；
- `unavailableMetrics[]` 明確列出缺口；
- PR count、inventory、cycle time、budget/lifecycle 等仍照常輸出；
- 不因一組 provider evidence unavailable 就把整份 observation 變成空白。

`comparisonEligible=false` 只代表本 snapshot 不適合拿來做正式趨勢比較，**不會隱藏當期 raw numbers**。

## 與正式 Governance Scoreboard 的關係

```text
CURRENT OBSERVATION
→ live GitHub raw facts
→ 每次復盤都要有
→ 沒有 0–100 分數

HISTORICAL GOVERNANCE SCOREBOARD v1/v2
→ existing governance-run + review-evidence contract
→ historical replay / comparison eligibility / blocking reconciliation
→ 不被本 collector 改寫
```

Product Delivery Score / Trend 仍是另一個 score surface，兩者不得互相代替。

## 複盤規則

每次 `復盤` / `複盤`：

1. 先固定時間窗口。
2. 跑 current governance observation，報 raw numbers 與 unavailable metrics。
3. 再重播正式 historical Governance Scoreboard；有足夠 comparable history 才下 trend 結論。
4. 若 historical comparison `NOT_GRADED`，仍必須保留 current observation 數字，不能把整個 Governance 章節縮成「資料不足」。
5. blocking finding reconciliation、Completion Truth 與 Product safety gate 的既有 fail-closed 規則不變。
