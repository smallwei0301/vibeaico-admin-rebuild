# 模型分工與雙 Workstream 路由

模型與治理工作依 2026-09-10 Owner Decision 固定分成兩軌。最新決策：
`docs/decisions/2026-09-10-owner-two-workstream-sol-governance.md`。

模型 ID、Product Final Risk allowlist 與 trust root 仍由 `scripts/agents/model-routing.json` 維護；本文件負責說明什麼工作會進那條 Product Final Risk 路徑，以及什麼工作固定由 Sol-only governance 處理。

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

## MODEL_GOVERNANCE：audit 層 only

模型路由、Agent orchestration、WIP / lane、Final Risk guard 自身治理、governance metrics / scoreboard、PR lifecycle、治理型 CI / templates 與其 regression tests，使用：

```text
WORKSTREAM: MODEL_GOVERNANCE
AGENT_LANE: GOVERNANCE
REQUESTED_MODEL / ACTUAL_MODEL: requested=gpt-5.6-sol; actual=gpt-5.6-sol
ASTRA_RISK: NONE
FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY
```

### 誰可以執行 MODEL_GOVERNANCE（Owner 決定，2026-09-10）

MODEL_GOVERNANCE 是 **audit 層**的工作，不是「某一個型號」的工作。audit 層在兩側各有一個模型，
兩者同層等價，**都可以執行**：

| 側 | audit 層模型 | 來源 |
|---|---|---|
| OpenAI | `gpt-5.6-sol` | `models.audit` |
| Anthropic | `claude-opus-5` | `anthropicEquivalents.audit` |

機器可讀的清單是 `scripts/agents/model-routing.json` 的
`workstreams.modelGovernance.allowedModels`，守門 (`classifyWorkstream()`) 就讀它。

三件必須一起成立的事：

1. `requested` 與 `actual` **各自**都必須落在清單內。一邊合規不能替另一邊背書。
2. 比對是**逐值**的，不是子字串比對：`gpt-5.6-sol-preview` 不算 `gpt-5.6-sol`。
3. 欄位必須記錄**實際 served 的模型**，不得以本表推定。清單放寬的是「哪些模型算合規」，
   不是「可以照抄一個合規值」。build 層（`gpt-5.6-terra` / `claude-sonnet-5`）與 scout 層
   （`gpt-5.6-luna` / `claude-haiku-4-5`）一律不得執行治理。

在此之前守門只認 `gpt-5.6-sol` 這一個字面值，於是在 Anthropic 側誠實填 `claude-opus-5` 的治理 PR
永遠過不了；而修這條規則的 PR 自己也是治理 PR、也過不了（守門是 `pull_request_target`，讀的是
`main` 上的程式）。#342 因此只能靠暫時移除必要檢查才合得進去。這條清單就是為了不再發生那件事。

執行流程：

```text
GPT-5.6 Sol conversation/session
→ current truth
→ bounded governance implementation
→ source CI / regression tests
→ Sol final exact-diff verification
→ merge / closeout
```

這一軌：

- 不派 Terra / Reserve Terra；
- 不啟動 dual-Terra；
- 不委派 Astra / Fable；
- 不要求 `astra-review` attestation；
- 不要求 `/astra-review-check` 作為治理放行前提；
- 不加入 Product Delivery Run 來製造 Product throughput；
- 不宣稱使用者可見 shipped Product output。

Sol-only 不是跳過驗證。source CI、必要 regression tests、final diff reread、current-main verification 與 Completion Truth 仍必須存在。

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

`models.build = gpt-5.6-terra` 是 OpenAI Product builder 預設。其他 provider 的 Product 主 Session 可依其可用模型執行等價 builder，但 PR 必須據實記錄 requested / actual model，不能從 lane 名稱推論模型真的跑過。

## Lane 對應的模型層級（Owner 2026-09-10 裁示）

上一節說「其他 provider 的 Product 主 Session 可依其可用模型執行等價 builder」。本節就是
**Anthropic 側「等價 builder」的定義**——它收窄該句，不與之衝突。

lane 決定層級，層級決定模型：

| Lane | 職責 | OpenAI | Anthropic |
|---|---|---|---|
| `scout` / Luna | 窄盤點、Closure、CI 摘要、文件、QA、Metrics | `gpt-5.6-luna` | `claude-haiku-4-5` |
| `build` / Terra | **施工**（Product builder lane） | `gpt-5.6-terra` | **`claude-sonnet-5`** |
| `audit` / Sol | TRIAGE、高風險設計、最終 AUDIT、結案判定 | `gpt-5.6-sol` | `claude-opus-5` |

機器可讀的來源是 `scripts/agents/model-routing.json` 的 `anthropicEquivalents`；本表與它必須一致。
model ID 逐字取自 Anthropic 官方型號表，**本身即完整，不得附加日期後綴**。

**Terra 一律用 Sonnet。** 拿 audit 層的 Opus 施工是超規，不是謹慎——它把審核層的成本花在施工上，
並讓審核層去審自己的產出；拿 scout 層的 Haiku 施工則是不足。兩個方向都不由執行者自行裁量。

因此 `AGENT_LANE: TERRA_BUILD` 的 PR，其 `REQUESTED_MODEL / ACTUAL_MODEL` 必須宣告 build 層級的
模型。`actual=Opus 5` 出現在 `TERRA_BUILD` 上是路由違規，應如實記為違規，不是中性註記——這與上一節
「不能從 lane 名稱推論模型真的跑過」是同一條要求的兩面。

平台無法證明實際執行模型時，`actual=unknown` 仍是誠實值（見 `docs/AGENT-EXECUTION.md`），
但它不是規避宣告層級的方式。scorecard 的 `requested`／`actual` 必須記錄**實際** served 的模型，
不得以本表推定。

本節與 Final Risk 彼此獨立。Final Risk 的適用範圍由下一節（`## PRODUCT_MAINLINE 的 Final Risk`）
與 `docs/decisions/2026-09-10-owner-two-workstream-sol-governance.md` 決定，本節不擴大也不縮小它：
施工層正確不免除 Final Risk，Final Risk 通過也不使施工層變得正確。

`scripts/agents/model-routing.json` 的頂層 `version` **刻意不因本節而 bump**。`evaluateAstra()`
以 `policyVersion !== policy.version` 綁定既有 attestation，bump 會讓所有在途 PR 的 attestation
立刻失效並被迫重跑 Final Risk；而 `anthropicEquivalents` 沒有任何 runtime 讀取，語意上不改變
任何既有判定。該鍵自帶 `version` 供本身追溯。

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

對 `PRODUCT_MAINLINE` 保留 #332 的既有語意：`GOVERNANCE_GATE` 指會**擴大可接受／可放行候選集合**、降低既有 gate、增加 bypass／waiver／exception，或把原本 failure/pending 變成 success/approval 的不可拆產品治理變更。純 fail-closed hardening 若只是**只增加拒絕條件**、證據完整度、reconciliation 或 observability，且不形成產品風險，仍依既有 Product 分類處理。

一般文案、UI、小型接線不因存在於 Product PR 就自動要求 Final Risk。Product classifier 與 `model-routing.json.sensitivePaths` 仍 fail closed。

## Product Final Risk model dispatch

需要 Product Final Risk 時：

1. 讀 trusted-main `model-routing.json` 的 `models.finalRisk` / `models.finalRiskAllowedModels`。
2. 透過 Agent / sub-agent **model selector** 指定 allowlist 模型。
3. reviewer 名稱不等於模型身分；只有實際指定並執行的模型才能填 `actualModel`。
4. 不搜尋所謂 Astra plugin / connector，也不要求 Owner 開外部審查通道。
5. 只有 runtime 確實無 model delegation 或所有 allowlist models 被明確拒絕，才可記 `MODEL_EXECUTION_UNAVAILABLE`。

簡單說：**先改派模型，再談 unavailable。** 對 Product Final Risk，不能把「主 Session 不是 Astra/Fable」誤報成需要外部 reviewer 通道。

## Product Agent-native attestation

#335 / #336 的 trusted-Agent Final Risk 仍保留給 Product mainline。正常 Product Agent 路徑 **Owner action NOT_REQUIRED**。

可信 submitting actor 可以是 write / maintain / admin actor，或 `model-routing.json.finalRiskTrust.trustedAgentBots` 中 login + immutable user id + `type=Bot` 全部吻合的 Agent bot。現行第一個 trusted Agent bot 是 `claude[bot]` / user id `209825114` / `Bot`。

正常 Product Agent 可自己提交完整 `astra-review` COMMENT review 並 refresh guard，不要求 Owner 把同一份 Fable/Astra evidence 再貼一次。

`OPERATOR_ATTESTED` 代表 trusted submitting actor 對 model dispatch 事實背書，不等於 provider-signed telemetry。

## Product semantic review reuse

Final Risk 綁 `changeDigest`，不是單純綁 commit SHA。若 main 由其他環境前進，而 PR changed-file blobs、schema baseline、Final Risk policy 與最新 verdict 都沒有實質改變：

- **不重跑 semantic Final Risk**，也不因純 rebase / unrelated main advancement 重跑 semantic Astra/Fable；
- 新 head 仍跑 required exact-head CI；
- `testBaseline` 保留 reviewer 當時實際採用的證據；
- changed-file blob 或 `changeDigest` 真改變時舊 review 才失效；
- 最新 FIX_REQUIRED / CHANGES_REQUESTED / DISMISSED 永遠不能被較舊 PASS 蓋掉。

## Skill routing

- `WORKSTREAM: MODEL_GOVERNANCE`：讀 `.agents/skills/vibeaico-agent-orchestration/SKILL.md`，使用 Sol-only governance path；不要載入 Astra/Fable review skill 當成必要 gate。
- `WORKSTREAM: PRODUCT_MAINLINE` 且 Product risk classification 需要 Final Risk：再載入 `.agents/skills/vibeaico-astra-review/SKILL.md`。

## 安全與 Production 授權

兩個 workstream 的分類都不構成 Production 授權。

以下仍需既有逐次具名授權：Production DDL/DML/migration、manual promote/rollback、真實 payment/refund、LINE webhook 切換、顧客通知等高影響操作。

MODEL_GOVERNANCE 只改治理，不得因此取得上述權限；PRODUCT_MAINLINE 的 Sol/Fable/Astra PASS 也同樣不等於 Production 操作授權。
