# 2026-09-09 Owner 裁示：`chore/raise-candidate-cap` 的治理範圍預算例外

GOVERNANCE_SCOPE_EXCEPTION: APPROVED
GOVERNANCE_SCOPE_BRANCH: chore/raise-candidate-cap

## 裁示

Owner 於 2026-09-09 在 Session `session_01ShZ9MbNvP457dMwTNoMDmf` 中，就 Agent 明列的三個決策項逐項回覆，第一項為「**一、同意例外**」——即同意 PR #304（分支 `chore/raise-candidate-cap`）豁免
`scripts/agents/governance-scope-budget.mjs` 的 `GOVERNANCE_SCOPE_BUDGET`（8 檔 / 800 行）。

本例外**只**適用於這一條分支。它不放寬預算本身，也不適用於任何其他 PR。

## 為什麼需要例外

同一個「Product candidate 上限」數字原本硬編碼在**九處**，分屬三類：

| 類別 | 位置 |
|---|---|
| 擋 PR（活） | `scripts/agents/dual-terra-wip-policy.mjs` 的 `validateGlobalWip` |
| 顯示（活） | `agent-wip-guard.yml` 的摘要表格、PR 留言、`candidate:active` label 描述 |
| 評分（活，CI 每次都跑） | `score-run.mjs` 三處（`wipHealthy`、建議文字、報告「目標 ≤2」）、`score-run-v2.mjs` 一處 |
| CI 內死碼 | `scripts/agents/agent-wip-policy.mjs` 的同名檢查 |

收斂成單一常數 `MAX_ACTIVE_CANDIDATES` 必然同時觸及兩支 policy 模組、一支 workflow、兩支 scorer、其引用文件，以及**兩份必須依腳本重新產生的 legacy 報告**（`agent-run-scorecard.yml` 對 schema v1 帳本跑 `score-run.mjs --check`，那是逐字字串比對，不重產 CI 會紅）。合計 21 檔 / 408 行。

拆成多個 PR 會產生「常數說 3、某處仍說 2」的中間 commit —— 那正是這個 PR 要消滅的失效型態，也正是該 PR 第三輪風險評估判 `FIX_REQUIRED` 的理由。因此 Owner 選擇維持單一原子 PR 並簽發本例外。

## 為什麼由 Owner 簽而不是 Agent 自行放行

`governance-scope-budget.mjs` 要求例外檔必須**已存在於受信任的 main**，且逐字指名分支。Agent 具備寫入 main 的技術能力（docs-only 直推，見 `docs/DOCUMENTATION-GOVERNANCE.md` §2.1），但 Owner 先前的裁示只涵蓋「候選上限由 2 調整為 3」，未涵蓋「該 PR 可超出範圍預算」。Agent 於 2026-09-09 將此列為決策面問題停止並上報，Owner 逐項回覆後才建立本檔。

**這個先例本身是規則的一部分：Agent 不得自行簽發豁免自己所受閘門的例外。**

## 適用條件與到期

- 僅限分支 `chore/raise-candidate-cap`。該分支合併或關閉後，本檔轉為歷史紀錄。
- 不改變 `GOVERNANCE_SCOPE_BUDGET` 的 8 檔 / 800 行預設值。
- 不構成 Production DDL、Production 部署或任何寫入正式環境的授權。

## 相關

- PR #304 `chore(governance)：Product candidate 上限 2 → 3，九處硬編碼收斂成單一事實來源`
- `docs/OWNER-DECISIONS.md` 2026-09-09 列（候選上限 2 → 3）
- `scripts/agents/governance-scope-budget.mjs`
