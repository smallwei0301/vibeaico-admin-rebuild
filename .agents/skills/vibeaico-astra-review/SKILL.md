---
name: vibeaico-astra-review
description: Review high-risk PRODUCT_MAINLINE changes with Astra/Fable after Sol and test evidence are ready. MODEL_GOVERNANCE is explicitly excluded by the 2026-09-10 Owner workstream decision and stays Sol-only.
---

# Astra / Fable 最後風險評估

## 先判斷 workstream

這個 skill **只適用 `WORKSTREAM: PRODUCT_MAINLINE`**。

若 Issue / PR 是：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

則立即停止本 skill，不建立 Astra/Fable reviewer、不要求 attestation、不要求 `/astra-review-check`。模型路由、Agent orchestration、WIP / Final Risk guard、治理 metrics / scoreboard、PR lifecycle、治理型 CI / template 等純模型治理工作，依 2026-09-10 Owner 決策固定由 **GPT-5.6 Sol 對話模式**直接規劃、施工、驗證與收尾。

MODEL_GOVERNANCE 必須同時保持純治理範圍。若變更混入 Product runtime、schema/migration、payment/refund、LINE/provider、tenant product data flow 或 Production deploy behavior，先拆 PR；不能安全拆分就重新分類為 `PRODUCT_MAINLINE`，再依本 skill 做 Product 風險判斷。不得用 workstream 標記逃避產品風險。

從 trusted main 讀 `docs/MODEL-ROUTING.md`、`scripts/agents/model-routing.json` 與最新 Owner Final Risk 決策；模型 ID、trust root 與風險判準以 trusted main 為準。保留 `docs/AGENT-EXECUTION.md` 的授權與 Sol 結案門檻。

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
2. 必要測試與 Sol diff 審核後，整理 repository、base/head、policy、TEST/schema 基線、diff、測試證據與未驗證事項。
3. 使用 allowlist 模型建立獨立唯讀風險評估，要求具體反例與阻塞項目。
4. 將結果保存於 GitHub，由 write-capable actor 或 trusted Agent bot 提交 canonical review。
5. 提交／編輯／撤銷後刷新 guard，合併前確認 current required status。

## 純換底不得重跑 semantic Final Risk

Product Final Risk 預設是每個 semantic `changeDigest` 一次，不是每顆 commit 一次。

若 main 只是由其他環境前進，rebase／merge-main 後所有 changed-file blob 不變、`changeDigest` 相同：

- 不要重新委派 Fable/Astra。
- 保留 reviewer 當時實際採用的 `testBaseline` / `schemaBaseline`。
- 新 head 重跑 required exact-head CI；新的 CI run id 放 completion evidence／closeout。
- `baseSha` / `headSha` 是稽核紀錄；`changeDigest` 才是 semantic content 綁定。

只有 changed-file blob / `changeDigest` 改變、schema baseline 實質改變、Final Risk policy 變更，或 trusted 最新 review 為 FIX_REQUIRED／CHANGES_REQUESTED／DISMISSED 時才重跑。

Astra/Fable 不替代測試、實機驗收、正式操作授權或 Sol 關閉議題權限。Production DDL/DML/migration、manual promote、真實付款/退款/通知仍需各自既有授權。
