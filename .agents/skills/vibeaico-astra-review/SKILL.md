---
name: vibeaico-astra-review
description: Review high-risk PRODUCT_MAINLINE changes with Astra/Fable after source and test evidence are ready. MODEL_GOVERNANCE is excluded from Product Final Risk and follows the bounded governance flow without a pinned executor model.
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

## Model dispatch，不是外部 reviewer 通道

以下只針對 `PRODUCT_MAINLINE`。

`gpt-6-astra` 與 `claude-fable-5-1` 是 Final Risk reviewer 的模型選擇，不是另一個 plugin、connector、MCP、外部服務或需要 Owner 額外開通的「審查通道」。

需要 Product Final Risk 時：

1. 從 `model-routing.json` 讀 `models.finalRisk` 與 `models.finalRiskAllowedModels`。
2. 使用執行環境既有的 Agent／子代理 model selector 明確指定預設 Final Risk 模型；預設模型不可用時再試 allowlist 內另一個模型。
3. reviewer agent 名稱不等於模型身分；只有實際指定並執行 allowlist 模型，才能寫成 `actualModel`。
4. 不得因主 Session 本身不是 Astra/Fable 就搜尋 plugin、connector 或要求 Owner 開 reviewer channel。
5. 只有 runtime 確實沒有任何可指定模型的委派能力，或 allowlist 模型均被明確拒絕，才能記 `MODEL_EXECUTION_UNAVAILABLE` 並保持 pending。

簡單說：**先改派模型，再談 unavailable。**

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
5. 使用 allowlist 模型建立獨立唯讀風險評估，要求具體反例與阻塞項目。
6. 將結果保存於 GitHub，由 write-capable actor 或 trusted Agent bot 提交 canonical review。
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

DELTA reviewer 仍必須審新的 current `changeDigest` 並留下新的 trusted verdict。它只省掉「重新理解已經審過、且沒有變的範圍」，不省掉真正的風險判斷。

若 previous PASS 的 semantic `changeDigest` 完全相同，沿用既有 semantic attestation，僅重跑 exact-head CI；這不是 DELTA review。

## Circuit breaker：熔斷 reviewer 路徑，不熔斷整個 loop

對 tooling／environment／model-dispatch／rate-limit／timeout／safety-classifier 類失敗：

1. 同類第一次失敗：只允許同模型再試一次。
2. 同類第二次失敗：對 current model 開 breaker，改派 trusted-main allowlist 另一 reviewer model。
3. allowlist 都暫時不可用：當前高風險 candidate 保持 blocked／parked，不准 merge；有 independent Product slice 就 `PARK_CURRENT_AND_REFILL_BUILD`，沒有就繼續 Closure／TRIAGE。

不得把 breaker 寫成 `STOP_RUN`。真正 reviewer finding 則不是 infra retry，直接回 source fix，修完再重算 FULL／DELTA eligibility。

可用 `scripts/agents/final-risk-workflow.mjs recover` 產生下一步，不靠 Agent 臨場猜路徑。

## 純換底不得重跑 semantic Final Risk

Product Final Risk 預設是每個 semantic `changeDigest` 一次，不是每顆 commit 一次。

若 main 只是由其他環境前進，rebase／merge-main 後所有 changed-file blob 不變、`changeDigest` 相同：

- 不要重新委派 Fable/Astra。
- 保留 reviewer 當時實際採用的 `testBaseline` / `schemaBaseline`。
- 新 head 重跑 required exact-head CI；新的 CI run id 放 completion evidence／closeout。
- `baseSha` / `headSha` 是稽核紀錄；`changeDigest` 才是 semantic content 綁定。

只有 changed-file blob / `changeDigest` 改變、schema baseline 實質改變、Final Risk policy 變更，或 trusted 最新 review 為 FIX_REQUIRED／CHANGES_REQUESTED／DISMISSED 時才重跑。

Astra/Fable 不替代測試、實機驗收、正式操作授權或 Product 關閉議題權限。Production DDL/DML/migration、manual promote、真實付款/退款/通知仍需各自既有授權。
