# 模型分工與雙 Workstream 路由

模型與治理工作固定分成兩軌。MODEL_GOVERNANCE 的最新 Owner 決策：
`docs/decisions/2026-09-11-owner-model-governance-model-agnostic.md`。

模型 ID、PRODUCT_MAINLINE 的 builder／audit／Final Risk allowlist 與 trust root 由
`scripts/agents/model-routing.json` 維護。本文件負責說明兩條 workstream 的執行邊界與 Product model routing。

## 先分類，再工作

所有新 Issue / PR 建立時必須有且只有一個：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

或：

```text
WORKSTREAM: PRODUCT_MAINLINE
```

空白、拼錯或 invented third value 都是不合法分類。既有 open work 在下一次被接手施工、promote、rebuild 或 closeout 前先補分類；不為了回填分類重寫歷史 commit。

## MODEL_GOVERNANCE：不指定模型

模型路由政策、Agent orchestration、WIP / lane、Final Risk guard 自身治理、governance metrics / scoreboard、PR lifecycle、治理型 CI / templates 與其 regression tests，使用：

```text
WORKSTREAM: MODEL_GOVERNANCE
AGENT_LANE: GOVERNANCE
REQUESTED_MODEL / ACTUAL_MODEL: requested=NOT_APPLICABLE; actual=NOT_APPLICABLE
ASTRA_RISK: NONE
FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY
```

`NOT_APPLICABLE` 是 PR parser 相容期的**非模型 sentinel（不適用標記）**，不是模型名稱，也不能被當成模型執行證據。

### Owner 決定，2026-09-11

MODEL_GOVERNANCE 改為 **model-agnostic**：

- 不要求 Sol、Opus、Terra、Astra、Fable 或任何特定模型；
- retrospective／scoreboard 不分析 MODEL_GOVERNANCE 的 requested model、actual model 或 provider model identity coverage；
- 任何可執行 repo governance 的 Agent／Session 都可以在 `AGENT_LANE: GOVERNANCE` 下完成 bounded governance work；
- 不因模型不同而判定治理工作合規或不合規；
- PRODUCT_MAINLINE 的模型路由與 Final Risk 規則完全不受影響。

目前 trusted-main PR parser 仍會讀 `REQUESTED_MODEL / ACTUAL_MODEL`。因此新治理 PR 在相容期填 `NOT_APPLICABLE`；為避免切換時把既有在途治理 PR 全部打紅，`model-routing.json` 暫時 grandfather 舊的 `gpt-5.6-sol`／`claude-opus-5` metadata。這只是 parser 相容，不代表治理仍指定模型。

治理執行流程：

```text
current truth
→ bounded governance implementation
→ source CI / regression tests
→ final exact-diff verification
→ Completion Truth
→ merge / closeout
```

這一軌：

- 不佔 Product Terra / Reserve Terra slots；
- 不啟動 Product dual-Terra；
- 不因純治理範圍委派 Astra / Fable Product Final Risk；
- 不要求 `astra-review` attestation；
- 不要求 `/astra-review-check` 作為治理放行前提；
- 不加入 Product Delivery Run 來製造 Product throughput；
- 不宣稱使用者可見 shipped Product output。

model-agnostic 不等於跳過驗證。source CI、必要 regression tests、final diff reread、current-main verification 與 Completion Truth 仍必須存在。

### MODEL_GOVERNANCE 不能拿來偷渡產品變更

這裡的「混合範圍」採 fail-safe 分類。如果同一張工作碰到 Product runtime、schema / migration、tenant product data flow、payment / refund、LINE/provider、Production deploy 行為或跨 repo Product contract：

1. 優先拆 PR；
2. 無法安全拆分時整張改為 `PRODUCT_MAINLINE`；
3. 不得靠 `WORKSTREAM: MODEL_GOVERNANCE` 或 `ASTRA_RISK: NONE` 逃避產品安全門。

## PRODUCT_MAINLINE：維持 Product B+ 與風險路由

使用者可見功能、API/runtime、schema/migration、tenant data、payment/refund、LINE/provider、Product deployment 與跨 repo Product contract 都歸：

```text
WORKSTREAM: PRODUCT_MAINLINE
```

Product 仍走既有 B+ topology：Luna 窄盤點 → Sol TRIAGE → Product builder / Terra lane → 必要 TEST → Sol audit → 需要時 Product Final Risk → closeout。

`models.build = gpt-5.6-terra` 是 OpenAI Product builder 預設。其他 provider 的 Product 主 Session 可依其可用模型執行等價 builder，但 Product PR 必須據實記錄 requested / actual model，不能從 lane 名稱推論模型真的跑過。

## PRODUCT_MAINLINE Lane 對應的模型層級

以下只適用 `PRODUCT_MAINLINE`，不適用 `MODEL_GOVERNANCE`。

lane 決定層級，層級決定模型：

| Lane | 職責 | OpenAI | Anthropic |
|---|---|---|---|
| `scout` / Luna | 窄盤點、Closure、CI 摘要、文件、QA、Metrics | `gpt-5.6-luna` | `claude-haiku-4-5` |
| `build` / Terra | **施工**（Product builder lane） | `gpt-5.6-terra` | **`claude-sonnet-5`** |
| `audit` / Sol | TRIAGE、高風險設計、最終 AUDIT、結案判定 | `gpt-5.6-sol` | `claude-opus-5` |

機器可讀來源是 `scripts/agents/model-routing.json` 的 `anthropicEquivalents`；本表與它必須一致。model ID 逐字取自目前專案 canonical 型號表，本身即完整，不得自行附加日期後綴。

**Terra 一律用 Sonnet。** 拿 audit 層的 Opus 做 Product build 是超規；拿 scout 層的 Haiku 做 Product build 則是不足。兩個方向都不由執行者自行裁量。

因此 `AGENT_LANE: TERRA_BUILD` 的 Product PR，其 `REQUESTED_MODEL / ACTUAL_MODEL` 必須宣告 build 層級模型。`actual=claude-opus-5` 出現在 `TERRA_BUILD` 上仍是 Product 路由違規。

平台無法證明 Product 實際執行模型時，`actual=unknown` 仍是誠實值（見 `docs/AGENT-EXECUTION.md`），但它不是規避 Product lane 宣告層級的方式。Product scorecard 的 requested／actual 必須記錄實際 served model，不得以 lane 名稱推定。

本節與 Final Risk 彼此獨立。施工層正確不免除 Final Risk，Final Risk 通過也不使施工層變得正確。

`scripts/agents/model-routing.json` 的頂層 `version` 不因 MODEL_GOVERNANCE 改成 model-agnostic 而 bump。`evaluateAstra()` 以頂層 policy version 綁定既有 Product attestation；無關的治理 routing 變更不應使在途 Product Final Risk evidence 全部失效。workstream policy 由自己的 `workstreams.version` 追溯。

## PRODUCT_MAINLINE 的 Final Risk

以下規則只適用 Product mainline，不適用純 MODEL_GOVERNANCE。

目前預設 Final Risk model 是 `claude-fable-5-1`；allowlist 另含 `gpt-6-astra`。Astra/Fable 是 reviewer **模型選擇**，不是 plugin、connector、MCP 或外部 reviewer channel。

Product 高後果類型維持：

- `PAYMENT_CONSISTENCY`
- `TENANT_AUTH_BOUNDARY`
- `IRREVERSIBLE_DATA`
- `CROSS_REPO_CONTRACT`
- `GOVERNANCE_GATE`，僅當不可拆的 Product scope 同時修改 admission / bypass semantics
- `UNRESOLVED_HIGH_RISK`

`GOVERNANCE_GATE` 指會**擴大可接受／可放行候選集合**、降低既有 gate、增加 bypass／waiver／exception，或把原本 failure/pending 變成 success/approval 的不可拆 Product 治理變更。純 fail-closed hardening 若**只增加拒絕條件**、證據完整度、reconciliation 或 observability，且不形成 Product 風險，仍依既有 Product 分類處理。

一般文案、UI、小型接線不因存在於 Product PR 就自動要求 Final Risk。Product classifier 與 `model-routing.json.sensitivePaths` 仍 fail closed。

**Scoreboard evidence contract 不等於「每張 PR 都要 Final Risk」**。歷史 Governance Scoreboard **contract v1** 的 evidence 欄位只用於重播舊資料，不會把新的 MODEL_GOVERNANCE 工作重新綁回特定 reviewer；PRODUCT_MAINLINE 是否需要 Final Risk 仍由本節風險分類決定。

## Product Final Risk model dispatch

需要 Product Final Risk 時：

1. 讀 trusted-main `model-routing.json` 的 `models.finalRisk` / `models.finalRiskAllowedModels`。
2. 透過 Agent / sub-agent model selector 指定 allowlist 模型。
3. reviewer 名稱不等於模型身分；只有實際指定並執行的模型才能填 `actualModel`。
4. 不搜尋所謂 Astra plugin / connector，也不要求 Owner 開外部審查通道。
5. 只有 runtime 確實無 model delegation 或所有 allowlist models 被明確拒絕，才可記 `MODEL_EXECUTION_UNAVAILABLE`。

簡單說：**先改派模型，再談 unavailable。** 對 Product Final Risk，不能把「主 Session 不是 Astra/Fable」誤報成需要外部 reviewer 通道。

## trusted Agent 提交 Product Final Risk evidence

trusted-Agent Final Risk 只保留給 Product mainline。正常 Product Agent 路徑 **Owner action NOT_REQUIRED**。

可信 submitting actor 可以是 write / maintain / admin actor，或 `model-routing.json.finalRiskTrust.trustedAgentBots` 中 login + immutable user id + `type=Bot` 全部吻合的 Agent bot。現行 trusted Agent bot 是 `claude[bot]`，immutable user id `209825114`，`type=Bot`；正式機器來源仍以 `model-routing.json` 為準。

正常 Product Agent 可自己提交完整 `astra-review` COMMENT review 並 refresh guard，不要求 Owner 把同一份 Fable/Astra evidence 再貼一次。

`OPERATOR_ATTESTED` 代表 trusted submitting actor 對 Product model dispatch 事實背書，不等於 provider-signed telemetry。

## Product semantic review reuse

Final Risk 綁 `changeDigest`，不是單純綁 commit SHA。若 main 由其他環境前進，而 PR changed-file blobs、schema baseline、Final Risk policy 與最新 verdict 都沒有實質改變：

- 不重跑 semantic Final Risk，也不因純 rebase / unrelated main advancement 重跑 semantic Astra/Fable；
- 新 head 仍跑 required exact-head CI；
- `testBaseline` 保留 reviewer 當時實際採用的證據；
- changed-file blob 或 `changeDigest` 真改變時舊 review 才失效；
- 最新 FIX_REQUIRED / CHANGES_REQUESTED / DISMISSED 永遠不能被較舊 PASS 蓋掉。

## Skill routing

- `WORKSTREAM: MODEL_GOVERNANCE`：讀 `.agents/skills/vibeaico-agent-orchestration/SKILL.md`，使用 model-agnostic governance path；不要載入 Astra/Fable review skill 當成必要 gate，也不要分析治理工作用了哪個模型。
- `WORKSTREAM: PRODUCT_MAINLINE` 且 Product risk classification 需要 Final Risk：再載入 `.agents/skills/vibeaico-astra-review/SKILL.md`。

## 安全與 Production 授權

兩個 workstream 的分類都不構成 Production 授權。

以下仍需既有逐次具名授權：Production DDL/DML/migration、manual promote/rollback、真實 payment/refund、LINE webhook 切換、顧客通知等高影響操作。

MODEL_GOVERNANCE 只改治理，不得因此取得上述權限；PRODUCT_MAINLINE 的 Sol/Fable/Astra PASS 也同樣不等於 Production 操作授權。
