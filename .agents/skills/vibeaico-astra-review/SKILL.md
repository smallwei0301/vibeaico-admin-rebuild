---
name: vibeaico-astra-review
description: Review high-risk PRODUCT_MAINLINE changes with one premium consultation and Owner-authorized audit/current-agent downgrade after source and test evidence are ready. MODEL_GOVERNANCE is excluded from Product Final Risk and follows the bounded governance flow without a pinned executor model.
---

# Astra / Fable 最後風險評估

## 先判斷 workstream

這個 skill **只適用 `WORKSTREAM: PRODUCT_MAINLINE`**。

若 Issue / PR 是：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

則立即停止本 skill，不建立 Astra/Fable reviewer、不要求 attestation、不要求 `/astra-review-check`。純模型治理依 2026-09-11 #360 **不指定執行模型**；使用 `requested=not_requested`，無可靠來源時 `actual=unknown`，並照 bounded governance flow 完成 source CI、exact-diff／counterexample review 與 Completion Truth。

MODEL_GOVERNANCE 必須同時保持純治理範圍。若變更混入 Product runtime、schema/migration、payment/refund、LINE/provider、tenant product data flow 或 Production deploy behavior，先拆 PR；不能安全拆分就重新分類為 `PRODUCT_MAINLINE`，再依本 skill 做 Product 風險判斷。不得用 workstream 標記逃避產品風險。

從 trusted main 讀 `docs/MODEL-ROUTING.md`、`scripts/agents/model-routing.json` 與最新 Owner Final Risk 決策；模型 ID、trust root 與風險判準以 trusted main 為準。保留 `docs/AGENT-EXECUTION.md` 的授權與 Product 結案門檻。

## Model dispatch 與 Owner #552 成本降級

只適用 Product。完整現行契約：`docs/AGENT-EXECUTION.md` §7.2 與
`docs/decisions/2026-09-17-owner-final-risk-cost-downgrade.md`。
Astra/Fable 合計最多一輪；首次要從持久歷史證明未使用，保存唯一預算紀錄再派送。
首次故障／無回應／300 秒無真正執行證據直接 Sol/Opus；已諮詢修復重審直接 Sol/Opus。
無 model selector 時使用目前 agent/model 對抗審查，不要求外部 channel 或第二次 Owner 授權。
不能靠更名假裝切換模型；CURRENT_AGENT 的 actual 不明就 unknown，執行事實與型號證據分開。
`prepare` 會附 reviewerRoute；`recover` 不再輸出昂貴同級 retry/switch。

## Trusted Agent 可以自己提交 Product Final Risk evidence

正常 Product Agent 路徑 Owner action NOT_REQUIRED。

- `model-routing.json.finalRiskTrust.trustedAgentBots` 是 trusted-main Agent attestor allowlist。
- login + immutable GitHub user id + account type 必須全部吻合；不是所有 bot 都可信。
- allowlisted Agent bot 可提交 `astra-review` COMMENT review；`OPERATOR_ATTESTED` 代表 trusted submitting actor 對 model dispatch 背書，不代表 Owner 親手貼文，也不是 provider-signed proof。
- write／maintain／admin actor 的既有路徑仍是 fallback。
- 提交 review 後，trusted Agent bot 可自行留言 `/astra-review-check`。

不要因 review author 是 Agent App 就要求 Owner 重貼同一份 attestation。

## PRODUCT_MAINLINE Review flow

1. Sol 填 Product 風險分類與理由；範圍擴大時重新分類。
2. 必要測試與 Sol diff 審核後，先跑 `scripts/agents/final-risk-workflow.mjs prepare`。只有 `READY` 才建立昂貴 reviewer；`NOT_READY` 回 cheap precheck，不算 reviewer round。
3. readiness packet 綁 repository、exact head、`changeDigest`、policy、TEST/schema 基線、bounded diff scope、測試證據與未驗證事項。
4. 第一次 semantic review 固定 `FULL`；若前一輪為 blocking finding，修復後只有工具判定 `DELTA` 才可做 finding-fix review。任何新 scope／risk／policy／hot boundary 或 reviewer 要求都回 `FULL`。
5. 依 reviewerRoute 使用單次 premium、降級 Sol/Opus 或無 selector 的 CURRENT_AGENT 做唯讀對抗審查；最後者明記不是獨立指定模型。要求具體反例、舊 finding 解法與阻塞項目。
6. 將結果保存於 GitHub，由 write-capable actor 或 trusted Agent bot 提交 canonical review。**下一輪要考慮 DELTA 時，`prepare` 必須讀 live GitHub reviews；不得把單一 Session 記憶當 previous-review evidence。**
7. 提交／編輯／撤銷後刷新 guard，合併前確認 current required status。

## Fail early：昂貴 reviewer 前的 readiness gate

不要叫 Fable/Astra 幫我們找 metadata 填錯、digest 算錯、source 還在動或一般測試沒跑完。

`final-risk-workflow.mjs prepare` 必須先確認：

- 現行 `agent-wip-preflight` PASS；
- source frozen；
- exact head + 完整 changed-file records；
- `changeDigest` 可從 blob 重算且一致；
- source CI／必要 test evidence／core regressions PASS；
- concrete test/schema baseline；
- TRIAGE／reviewer packet 沒超過 bounded context 預算。

任何一項不成立：`RETURN_TO_PRECHECK`。這是便宜失敗，不消耗 Final Risk round。

## Phase 2：DELTA review 不是舊 PASS 延命

第一輪一律 FULL。只有前一輪 reviewer 已留下 `FIX_REQUIRED`／`CHANGES_REQUESTED`，且修復後同時滿足以下條件，才可 DELTA：

- risk class、policy version 不變；
- current changed-file universe 不變；
- fix delta 由前後兩輪 changed-file blob 自動計算，不能由呼叫者自行縮小；
- 沒擴大 high-risk boundary；
- blob-derived delta 只落在 reviewer 前一輪明示的 finding paths／support files；
- core regression 重新 PASS；
- reviewer 沒要求 FULL reset。

### Canonical review 必須留下可跨 Session 重建的 DELTA 證據

既有 `astra-review` 欄位（例如 `findings` 人類可讀字串、`report`、模型身分）照舊；另外把 reviewer packet 中的以下欄位保存到**同一份 canonical `astra-review` JSON**：

```json
{
  "riskClass": "PAYMENT_CONSISTENCY",
  "changedFileRecords": [
    { "filename": "...", "previous_filename": "", "status": "modified", "sha": "<blob sha>" }
  ],
  "findingDetails": [
    { "id": "F1", "paths": ["src/..."], "summary": "blocking finding summary" }
  ],
  "supportFiles": ["src/related-file.ts"]
}
```

規則：

- `riskClass` 與 `changedFileRecords` 必須從 reviewer packet **原樣複製**，不能人工重算或少列。
- `findings` 仍保留既有的人類可讀字串，避免破壞現行 Final Risk merge guard。
- 有 blocking finding 時，`findingDetails` 每一項要有穩定 id、實際受影響 paths 與摘要；必要的唯讀相關檔可放 `supportFiles`。
- 下一輪 `prepare` 會從 live GitHub 的最新 trusted review 重建 previous state。最新 review 缺 manifest、模型不可信、structured paths 不完整或 digest 對不上時，**fail closed 回 FULL**，不去找更舊的 PASS 偷渡。

DELTA reviewer 仍必須審新的 current `changeDigest` 並留下新的 trusted verdict。它只省掉「重新理解已經審過、且沒有變的範圍」，不省掉真正的風險判斷。

若 previous PASS 的 semantic `changeDigest` 完全相同，沿用既有 semantic attestation，僅重跑 exact-head CI；這不是 DELTA review。

## Circuit breaker：首次昂貴故障即降級，不熔斷整個 loop

Owner #552 取代同模型重試／昂貴互換：dispatch request 起 300 秒沒有同 task id 的 runtime
RUNNING／token／tool 證據即降級；QUEUED／ACCEPTED／自述不算，明確無回應則立即降級。
已確認在執行的唯一諮詢可繼續，不重新開昂貴子代理。取消／隔離原超時任務後採便宜路徑。
修復重審不論 FULL／DELTA 都用 Sol／Opus；沒有 selector 就目前 agent 真實對抗審查。
新的 `astra-review` 保存 reviewerTier、costPolicyVersion、downgradeReason、downgradeEvidenceRef、
reviewLineage、executionRef、adversarialEvidence、priorFindingsReviewed、unresolvedFindingCount。
CURRENT_AGENT 另明記 modelSelectionAvailable=false 與 executionEvidence；未知型號不假造身分。

真 finding 回 source fix，任何未解問題保持 FIX_REQUIRED。便宜路徑也不可用才 park current candidate，
繼續 independent BUILD／Closure／TRIAGE。安全拒絕不得藉換模型繞過。
`final-risk-workflow.mjs recover` 給明確下一步；同一歷史不因換 head／Session 清空。

## 純換底不得重跑 semantic Final Risk

Product Final Risk 預設是每個 semantic `changeDigest` 一次，不是每顆 commit 一次。

若 main 只是由其他環境前進，rebase／merge-main 後所有 changed-file blob 不變、`changeDigest` 相同：

- 不要重新委派 Fable/Astra。
- 保留 reviewer 當時實際採用的 `testBaseline` / `schemaBaseline`。
- 新 head 重跑 required exact-head CI；新的 CI run id 放 completion evidence／closeout。
- `baseSha` / `headSha` 是稽核紀錄；`changeDigest` 才是 semantic content 綁定。

只有 changed-file blob / `changeDigest` 改變、schema baseline 實質改變、Final Risk policy 變更，或 trusted 最新 review 為 FIX_REQUIRED／CHANGES_REQUESTED／DISMISSED 時才重跑。

Astra/Fable 不替代測試、實機驗收、正式操作授權或 Product 關閉議題權限。Production DDL/DML/migration、manual promote、真實付款/退款/通知仍需各自既有授權。
