---
name: vibeaico-astra-review
description: Review high-risk VibeAI admin changes with Astra after Sol and test evidence are ready; classify payment consistency, tenant authorization, irreversible data, cross-repo contracts and governance gates without escalating ordinary UI work.
---

# Astra 最後風險評估

從 trusted main 讀 `docs/MODEL-ROUTING.md`、`scripts/agents/model-routing.json` 與最新 Owner Final Risk 決策；模型 ID、trust root 與風險判準以 trusted main 為準。保留 `docs/AGENT-EXECUTION.md` 的授權與 Sol 結案門檻。

## Model dispatch，不是外部 reviewer 通道

`gpt-6-astra` 與 `claude-fable-5-1` 是 **Final Risk reviewer 的模型選擇**，不是另一個 plugin、connector、MCP、外部服務或需要 Owner 額外開通的「審查通道」。

需要 Final Risk 時，執行順序固定如下：

1. 從 `model-routing.json` 讀 `models.finalRisk` 與 `models.finalRiskAllowedModels`。
2. 優先使用目前執行環境既有的 Agent／子代理委派能力，透過其 **model selector** 明確指定預設 Final Risk 模型；若預設模型不可用，再試 allowlist 內另一個模型。
3. reviewer agent 的名稱不等於模型身分；必須是該次委派真的指定並執行了 allowlist 模型，才能把它寫成 `actualModel`。
4. 不得因主 Session 本身不是 Astra/Fable，就去搜尋 plugin、connector、web provider，或要求 Owner「開啟 Astra/Fable reviewer 通道」。模型切換／改派是 Agent orchestration 的工作，不是外部整合工作。
5. 只有在目前 runtime **確實沒有任何可指定模型的 Agent／子代理委派能力**，或 allowlist 兩個模型的委派皆被 runtime 明確拒絕時，才能記 `MODEL_EXECUTION_UNAVAILABLE` 並保持 `ASTRA_PENDING`。要記錄實際能力限制或失敗，不得把「我沒有先試 model delegation」冒充成外部阻塞。

簡單說：**先改派模型，再談 unavailable。** 不建立一個叫「Astra agent」但實際跑別的模型來冒充，也不把 Astra/Fable 當成要另外安裝的服務。

## Trusted Agent 可以自己提交 Final Risk evidence

正常 Agent 路徑 **Owner action NOT_REQUIRED**。

- `model-routing.json.finalRiskTrust.trustedAgentBots` 是 trusted-main 的 Agent attestor allowlist。
- 只有 login + immutable GitHub user id + account type 三者全部吻合，才算 trusted Agent bot；不是所有 bot 都可信。
- allowlisted Agent bot 可以直接提交 `astra-review` COMMENT review，`OPERATOR_ATTESTED` 在此代表「trusted submitting actor 對本次 model dispatch 背書」，不代表 Owner 親手貼文，也不是 provider-signed proof。
- 非 allowlist bot、同名但 user id 不符、一般無 write 權限帳號仍不可信。
- write／maintain／admin actor 的既有人工路徑仍保留，但它是 fallback，不是每張 Agent PR 的必經人工步驟。
- 提交 review 後，trusted Agent bot 可以自己留言 `/astra-review-check` 觸發 trusted-main gate refresh；Claude Code 自動附加 footer 也可以，第一行是命令即可。

不要因 review author 是 Agent App 就要求 Owner 把同一份 attestation 重貼一次。若 attestation 內容本身不完整、model 不符、digest stale 或 verdict 不是 PASS，才是真的 blocker。

## Review flow

1. 開工由 Sol 填風險分類及理由；實際變更範圍擴大時重新分類。
2. 必要測試與 Sol diff 審核完成後，整理 repo、base/head、policy、TEST/schema 基線、diff、測試連結、Sol 疑點與未驗證事項。不要搬完整對話或秘密；保留按需讀原檔能力。
3. 依上面的 Model dispatch 規則，使用 allowlist 模型建立獨立唯讀評估，要求具體反例、阻塞項目與剩餘限制。不以一般主 Agent 的回答冒稱 Astra/Fable。
4. 把實際結果記在 GitHub；由 write-capable actor 或 trusted Agent bot 依 canonical 格式提交 review。PASS、FIX_REQUIRED、PENDING 必須如實記錄。
5. 提交／編輯／撤銷評估後留言 `/astra-review-check`，合併前刷新並等待完成。

## 純換底不得重跑 semantic Final Risk

Final Risk 預設是 **每個 semantic `changeDigest` 一次**，不是每顆 commit 一次。

若 main 只是由其他環境前進，這個 PR rebase／merge-main 後所有 changed-file blob 不變、`changeDigest` 相同：

- **不要重新委派 Fable/Astra。**
- 保留原本 review 裡的 `testBaseline` / `schemaBaseline`，它們代表 reviewer 當時實際看過的證據，不要只是為了換新的 CI run id 去改寫它們。
- 新 head 必須重跑 required exact-head CI，新的 CI run id 放在 PR completion evidence／closeout，不要拿它去把舊 semantic attestation 自己判 stale。
- `baseSha` / `headSha` 在 attestation 中是稽核紀錄，不是純換底的失效條件；`changeDigest` 才是內容綁定。

只有以下情況才重跑 Final Risk：changed-file blob / `changeDigest` 改變、`schemaBaseline` 實質改變、Final Risk policy version 改變、或 trusted 最新 review 是 FIX_REQUIRED／CHANGES_REQUESTED／DISMISSED。不要因「main 又多一個無關 commit」白跑第四輪、第五輪。

Astra/Fable 不替代測試、實機驗收、正式操作授權或 Sol 關閉議題權限。不為節省配額放過必要審核。
未知實際用量保持 unknown；不得為 Final Risk 捏造官方 token／成本倍率。
