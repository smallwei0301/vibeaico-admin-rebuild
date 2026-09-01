# PR Lifecycle 與 Janitor 規則

> 最新 Owner WIP Decision：`docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`（B+）。
>
> 原 Mode C 決策保留為歷史；其「不同 Issue 可同時有多條完整 Terra BUILD」已被取代。
>
> 本文件是 `docs/AGENT-EXECUTION.md` 的 PR 機械化補充。

## 1. B+ PR 預算

### 全 repo

```text
1 ACTIVE MAIN_TERRA implementation PR
1 ACTIVE RESERVE_TERRA source-only PR（不算 active candidate）
1 ACTIVE LUNA_CLOSURE PR
1 ACTIVE TEST_VALIDATION holder
最多 2 張 ACTIVE_CANDIDATE PR
```

### 每個 Issue

- 最多 1 張 lifecycle `ACTIVE` implementation candidate。
- 必要時最多 1 張短命 `VALIDATION`／canary。
- 第 3 張同 Issue candidate 立即 Janitor 收斂。

## 2. Lifecycle metadata

```text
<!-- pr-lifecycle
issue: 40
state: ACTIVE
supersedes: 59,72
-->
```

- `issue`：主要 Issue number。
- `state`：`ACTIVE`、`VALIDATION`、`REBUILD_REQUIRED`、`OWNER_GATED`。
- `supersedes`：被明確取代的 PR numbers。

Lifecycle block 管「這張 PR 在它的 Issue 裡是什麼角色」；Agent lane metadata 管 B+ 全域
MAIN／RESERVE／Closure／TEST 與 scorecard。兩者都要保留。

## 3. Lane 狀態

### MAIN_TERRA

```text
AGENT_LANE: TERRA_BUILD
LANE_STATE: ACTIVE
ACTIVE_CANDIDATE: true
```

全 repo 只有一張。它是唯一完整出貨線。

### RESERVE_TERRA

```text
AGENT_LANE: TERRA_RESERVE
LANE_STATE: ACTIVE | READY_FOR_PROMOTION
ACTIVE_CANDIDATE: false
TEST_LANE_REQUIRED: false
RESERVE_BOUNDARY: <精確範圍>
```

只做一個 source-only 原子切片。不能跑 shared TEST、進 Sol Audit 或變成第二條完整工地。

### LUNA_CLOSURE

```text
AGENT_LANE: LUNA_CLOSURE
ACTIVE_CANDIDATE: true
CLOSEABILITY_SCORE: 3..5
```

專門收尾、整理證據與 Janitor。若沒有候選，MAIN 寫 `EMPTY_WITH_SCAN` 或
`REPORT:<scorecard path>`。

### TEST_VALIDATION

```text
AGENT_LANE: TEST_VALIDATION
ACTIVE_CANDIDATE: false
TEST_LANE_REQUIRED: true
```

全 repo 只有一張。它可以是 MAIN 暫時切換 lane 後的同一張 PR，不應另造長命 TEST PR。

### PARKED／HISTORICAL／OWNER_BLOCKED

- 不派 Agent。
- 不 push。
- 不 rerun／輪詢 CI。
- 不持有 shared TEST。
- 只有 Sol TRIAGE 能重新啟動。

## 4. Janitor 分類

- `ACTIVE`：目前 MAIN implementation candidate。
- `VALIDATION`：短命 canary／環境確認。
- `SUPERSEDED`：同 Issue 新候選已完整取代。
- `REBUILD_REQUIRED`：需基於新 main 重建或等未來升格。
- `OWNER_GATED`：只缺 Owner、Production 或外部 provider。
- `JANITOR_REVIEW`：疑似 stale，但證據不足。

RESERVE 不必新增 lifecycle state；它通常保持 `ACTIVE` 或 `REBUILD_REQUIRED`，真正限制由
`AGENT_LANE=TERRA_RESERVE` 和 `LANE_STATE` 表達。

## 5. 自動關閉 fail-closed 規則

只有全部成立才可自動 close superseded PR：

1. source 明確列 `supersedes`；
2. source／target 不同；
3. 同一主要 Issue；
4. target 仍 open；
5. source 來自同 repo；
6. compare 為 `ahead` 或 `identical`；
7. mutation 前重新 fetch，head／state 未變；
8. 沒有 API、權限、migration、安全或 patch coverage 不確定性。

任一不確定就 `JANITOR_REVIEW`，不猜、不關。

## 6. Sweep 時機

- 新 PR、synchronize、rebuild、main merge；
- MAIN 進 Audit；
- 每個 B+ loop closeout；
- Owner 說「復盤」／「複盤」；
- 手動 `workflow_dispatch`。

## 7. 角色

- MAIN Terra 維護唯一完整候選。
- RESERVE Terra 只備料，完成即停。
- Luna 做 inventory、ancestry、evidence、comment 與機械 closeout。
- Sol 只處理 canonical 候選不明、高風險差異與最終 Audit。

## 8. 量測

每輪至少記錄：

```text
open_prs
main_terra_peak
reserve_terra_peak
active_candidate_peak
shared_test_peak
closure_sweeps
superseded_prs_closed
janitor_reviews_requiring_sol
invalid_ci_reruns
closed_issues
```
