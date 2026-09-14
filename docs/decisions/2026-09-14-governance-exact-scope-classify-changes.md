# Owner 裁示：`scripts/ci/classify-changes.mjs` 納入 MODEL_GOVERNANCE 逐檔授權

- 日期：2026-09-14
- 裁示者：Owner
- 相關：Issue #415、PR #412、PR #416、#384／#380

## 裁示

同意將 `scripts/ci/classify-changes.mjs` 新增為 MODEL_GOVERNANCE 的**精確逐檔授權**
（`scripts/agents/model-routing.json` 的 `workstreams.modelGovernance.scopeFiles`）。

本裁示**僅增加此單一檔案**：

- **不**授權 `scripts/ci/` 目錄。
- **不**構成其他 CI 檔案自動納入治理範圍的先例。
- #384／#380 建立的「特殊治理路徑必須逐檔、不得用資料夾授權」原則**繼續有效**。

## 理由

該檔直接負責 CI 變更分類，屬 CI governance。目前已存在**可重現的缺陷**：
`docs/metrics/**` 這類實際作為測試輸入的資料被誤判為純文件，走 docs-only 輕量路線，
造成「PR CI 全綠但 `main` 測試為紅」的假綠燈。

這個缺陷在 2026-09-14 實際發生過一次：PR #412 只改了
`docs/metrics/agent-runs/**`，整組 runtime CI 因此被跳過，`main` 的
`tests/unit/governance-scoreboard.test.ts` 變紅而沒有任何 CI 檢查顯示紅燈
（詳見 Issue #415、PB-039）。

## 修正方向（本裁示同時規定）

修正必須是 **fail closed**：

- `docs/metrics/**` 改走**完整 runtime CI**。
- 一般 `docs/**` 維持既有輕量路線。
- **不得過度匹配**相似名稱，例如 `docs/metrics-overview.md` 必須仍留在文件路線。

## 為什麼需要兩支 PR

`agent-wip-guard.yml` 以 `ref: ${{ github.event.repository.default_branch }}` checkout，
因此它讀的是 **`main` 上的** `model-routing.json`，不是 PR head 的版本。授權必須先
落在 `main`，`classify-changes.mjs` 的修正才可能通過 guard。本檔與 `scopeFiles` 的
新增是第一支；分類器修正是第二支。

## 這份裁示不授權的事

- 不授權任何 Production DDL／DML、部署或資料寫入。
- 不放寬 `docs/**` 直推 `main` 的既有規則（見 `docs/DOCUMENTATION-GOVERNANCE.md`）。
- 不改變 `governance-exact-scope.test.ts` 對「逐檔、不得目錄授權、不得前綴／路徑穿越
  匹配、畸形名單一律拒絕」的既有保證；該測試只把預期檔數由三改為四。
