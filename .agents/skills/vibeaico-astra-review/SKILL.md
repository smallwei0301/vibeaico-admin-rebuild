---
name: vibeaico-astra-review
description: Review high-risk VibeAI admin changes with Astra after Sol and test evidence are ready; classify payment consistency, tenant authorization, irreversible data, cross-repo contracts and governance gates without escalating ordinary UI work.
---

# Astra 最後風險評估

從 trusted main 讀 `docs/MODEL-ROUTING.md`、`scripts/agents/model-routing.json` 與最新 Owner Final Risk 決策；模型 ID 與風險判準以該單一設定為準。保留 `docs/AGENT-EXECUTION.md` 的授權與 Sol 結案門檻。

## Model dispatch，不是外部 reviewer 通道

`gpt-6-astra` 與 `claude-fable-5-1` 是 **Final Risk reviewer 的模型選擇**，不是另一個 plugin、connector、MCP、外部服務或需要 Owner 額外開通的「審查通道」。

需要 Final Risk 時，執行順序固定如下：

1. 從 `model-routing.json` 讀 `models.finalRisk` 與 `models.finalRiskAllowedModels`。
2. 優先使用目前執行環境既有的 Agent／子代理委派能力，透過其 **model selector** 明確指定預設 Final Risk 模型；若預設模型不可用，再試 allowlist 內另一個模型。
3. reviewer agent 的名稱不等於模型身分；必須是該次委派真的指定並執行了 allowlist 模型，才能把它寫成 `actualModel`。
4. 不得因主 Session 本身不是 Astra/Fable，就去搜尋 plugin、connector、web provider，或要求 Owner「開啟 Astra/Fable reviewer 通道」。模型切換／改派是 Agent orchestration 的工作，不是外部整合工作。
5. 只有在目前 runtime **確實沒有任何可指定模型的 Agent／子代理委派能力**，或 allowlist 兩個模型的委派皆被 runtime 明確拒絕時，才能記 `MODEL_EXECUTION_UNAVAILABLE` 並保持 `ASTRA_PENDING`。要記錄實際能力限制或失敗，不得把「我沒有先試 model delegation」冒充成外部阻塞。

簡單說：**先改派模型，再談 unavailable。** 不建立一個叫「Astra agent」但實際跑別的模型來冒充，也不把 Astra/Fable 當成要另外安裝的服務。

## Review flow

1. 開工由 Sol 填風險分類及理由；實際變更範圍擴大時重新分類。
2. 必要測試與 Sol diff 審核完成後，整理 repo、base/head、policy、TEST/schema 基線、diff、測試連結、Sol 疑點與未驗證事項。不要搬完整對話或秘密；保留按需讀原檔能力。
3. 依上面的 Model dispatch 規則，使用 allowlist 模型建立獨立唯讀評估，要求具體反例、阻塞項目與剩餘限制。不以一般主 Agent 的回答冒稱 Astra/Fable。
4. 把實際結果記在 GitHub，操作人依 canonical 格式提交 review 背書；使用 COMMENT 可保留既有獨立 Sol approval 流程。PASS、FIX_REQUIRED、PENDING 必須如實記錄。
5. 提交／編輯／撤銷評估後留言 `/astra-review-check`，合併前也刷新並等待完成；重新查候選版本及門禁結果；基線改變即重評。正常只重審影響範圍，影響不明時擴大。

Astra/Fable 不替代測試、實機驗收、正式操作授權或 Sol 關閉議題權限。不為節省配額放過必要審核。
未知實際用量保持 unknown；不得為 Final Risk 捏造官方 token／成本倍率。
