# PR Lifecycle 與 Janitor 規則

> 現行執行與 WIP 規則：`docs/AGENT-EXECUTION.md` §1.2、§5；本文件是 PR 機械化補充。
>
> 歷史 B+ 基線：`docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`。
>
> 原 Mode C 決策保留為歷史；其「不同 Issue 可同時有多條完整 Terra BUILD」已被取代。
>
> 2026-09-15 同步既有 Workstream／條件雙 Terra 裁示；不新增 lane 配額、模型門檻或授權。

## 1. B+ PR 預算

先依 `docs/AGENT-EXECUTION.md` §1.2 分類：`PRODUCT_MAINLINE` 才使用下列 Product B+ 預算。
`MODEL_GOVERNANCE` 使用 `AGENT_LANE=GOVERNANCE`，不加入 Product Run、不占 Product Terra／Reserve／TEST lane，
也不計產品出貨。純治理仍須 source CI、final exact-diff／counterexample review 與 Completion Truth；
混合且不可拆的 Product 變更必須回到 Product 流程，不得以分類繞過 Product Final Risk。

### 全 repo Product B+ 上限

```text
MAIN_TERRA implementation PR 預設最多 1；Guard 對兩張候選皆 qualified 時最多 2
RESERVE_TERRA source-only PR 單 Terra 時最多 1；雙 Terra 時固定 0（不算 active candidate）
1 ACTIVE LUNA_CLOSURE PR
1 ACTIVE TEST_VALIDATION holder
1 FINAL_SOL_AUDIT；1 Merge（均維持單線）
最多 3 張 ACTIVE_CANDIDATE PR
```

### 每個 Issue（兩種 Workstream 都適用）

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

Lifecycle block 管「這張 PR 在它的 Issue 裡是什麼角色」；Agent lane metadata 管所屬 Workstream 的工作線。
Product 使用 MAIN／RESERVE／Closure／TEST 與 scorecard；純治理使用 GOVERNANCE，不因此建立 Product Run。兩者都要保留。

### Agent lane origin contract

`AGENT_LANE` 不是裝飾欄位；它表示這張 PR 正在宣告一條 Agent 工作 lane。因此：

- 只要 `AGENT_LANE` 有值，`WORK_ORIGIN` 必須明確是 `AGENT` 或有意識標記的 `OWNER`。
- `WORK_ORIGIN` 空白、`UNKNOWN` 或其他值，搭配非空 `AGENT_LANE` 時，trusted WIP Guard 必須 fail closed。
- 明確的 `WORK_ORIGIN: OWNER` 仍不進入 Agent WIP 計數與 Agent metadata 驗證；但不得用它掩蓋實際上由 Agent 執行的工作。

## 3. Lane 狀態

### GOVERNANCE（僅限 MODEL_GOVERNANCE）

```text
WORKSTREAM: MODEL_GOVERNANCE
AGENT_LANE: GOVERNANCE
BPLUS_MODE: false
RUN_ID: none
SCORECARD_PATH: none
ACTIVE_CANDIDATE: false
TEST_LANE_REQUIRED: false
```

不指定執行或審查模型；無可靠模型證據時使用 `requested=not_requested; actual=unknown`。
這不取消驗證：依 `docs/AGENT-EXECUTION.md` §1.2 完成有界實作、source CI、最終差異／反例檢查與回讀。
以下 MAIN／RESERVE／LUNA_CLOSURE／TEST_VALIDATION 都是 Product lane。

### MAIN_TERRA

```text
AGENT_LANE: TERRA_BUILD
LANE_STATE: ACTIVE
ACTIVE_CANDIDATE: true
```

全 repo 預設最多一張完整施工候選；只有 `docs/AGENT-EXECUTION.md` §5.1 的 executable Guard
在啟動前對兩張候選都判定 qualified，才可同時兩張。必須同一 RUN_ID、不同 Issue／slot／local 環境、
不重疊的檔案責任範圍與各自健康證據；任一契約、cleanup 或隔離條件失敗就回到一張，不能把例外當配額。

### RESERVE_TERRA

```text
AGENT_LANE: TERRA_RESERVE
LANE_STATE: ACTIVE | READY_FOR_PROMOTION
ACTIVE_CANDIDATE: false
TEST_LANE_REQUIRED: false
RESERVE_BOUNDARY: <精確範圍>
```

只在單 Terra 模式且 MAIN 真正等待時做一個 source-only 原子切片；雙 Terra 時固定 0。
不能跑 shared TEST、進 Sol Audit 或變成第二條完整工地，完成即停在 READY_FOR_PROMOTION。

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
- Product 只有 Sol TRIAGE 能重新啟動；純治理由現行治理執行者依最新 blocker／scope／證據重新判定，仍不得繞過 Owner 或外部授權。

## 4. Janitor 分類

- `ACTIVE`：所屬 Issue 目前的 implementation candidate；Product 是否占 MAIN／Closure、純治理是否占 GOVERNANCE 由 lane metadata 判定。
- `VALIDATION`：短命 canary／環境確認。
- `SUPERSEDED`：同 Issue 新候選已完整取代。
- `REBUILD_REQUIRED`：已證明需要重整或等待未來升格；依 `docs/AGENT-EXECUTION.md` §2.1 的 material-change 規則判定，不能只因無關 main 前進就重建。
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

以下角色適用 Product B+；純治理依 §3 GOVERNANCE 與 canonical execution flow 執行，不強制套用 Product 模型路由。

- 每張 qualified MAIN Terra 各自維護一個完整候選；預設一張，條件雙 Terra 最多兩張。
- RESERVE Terra 只備料，完成即停。
- Luna 做 inventory、ancestry、evidence、comment 與機械 closeout。
- Sol 只處理 canonical 候選不明、高風險差異與最終 Audit。

## 8. 量測

Product B+ 每輪至少記錄：

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
