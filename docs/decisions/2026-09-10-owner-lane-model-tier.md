# Owner Decision — Lane 對應的模型層級（Terra 一律用 Sonnet）

> 日期：2026-09-10
> Issue：#340（上層 workstream：#339 MODEL_GOVERNANCE）
> 來源：Owner 明確裁示 `Luna / Terra / Sol` 在 Anthropic 側的具體模型對應，並要求寫進 repo。

## 1. 核心決策

lane 決定層級，層級決定模型。**兩個方向都不由執行者自行裁量。**

| Lane | 職責 | OpenAI | Anthropic |
|---|---|---|---|
| `scout` / Luna | 窄盤點、Closure、CI 摘要、文件、QA、Metrics | `gpt-5.6-luna` | `claude-haiku-4-5` |
| `build` / Terra | **施工**（MAIN／RESERVE 完整出貨線） | `gpt-5.6-terra` | **`claude-sonnet-5`** |
| `audit` / Sol | TRIAGE、高風險設計、最終 AUDIT、結案判定 | `gpt-5.6-sol` | `claude-opus-5` |

**Terra 一律用 Sonnet。** 拿 audit 層的 Opus 施工是超規，不是謹慎——它把審核層的成本花在施工上，
並讓審核層去審自己的產出；拿 scout 層的 Haiku 施工則是不足。

model ID 逐字取自 Anthropic 官方型號表，**本身即完整，不得附加日期後綴**。

## 2. 為什麼需要成文

這條規則先前只存在於口頭。實查證據（2026-09-10）：

- `scripts/agents/model-routing.json` 只有 `gpt-5.6-*`，無任何 Anthropic 對應。
- `haiku` 與 `sonnet` 兩個字串在**整個 repo 零命中**；`opus` 僅出現在客服小幫手的產品設定
  （`src/server/ai-reply.ts`），與 Agent 路由無關。
- 因此近兩天 50 份 PR 中，`AGENT_LANE: TERRA_BUILD` 搭配 `actual=Opus 5` 的紀錄（#306、#271、
  以及 #330）在文件上讀起來完全中性——沒有任何可查文件能說它超規。
- 另有 9 份宣告 `requested=Terra; actual=unknown`。依 `docs/AGENT-EXECUTION.md`，`unknown` 是
  平台無法證明實際模型時的誠實值，既不證明有委派、也不證明沒有。

規則只寫進文件仍會漂移：分支上有一個 2026-09-03 的既有 commit 已寫過同樣的對照表，
**未開 PR、未合併，擱置一週**，且把 Haiku 4.5 寫成帶日期後綴的變體。因此本次同時放進
機器可讀的設定並加上單元測試鎖。

## 3. 影響

- `AGENT_LANE: TERRA_BUILD` 的 PR 必須宣告 build 層級的模型。`actual=Opus 5` 出現在
  `TERRA_BUILD` 上是**路由違規**，應如實記為違規，不是中性註記（#330 已據此補記）。
- 本決策與 Final Risk 閘門彼此獨立：施工層正確不免除 Final Risk，Final Risk 通過也不使
  施工層變得正確。高風險變更仍須委派 `models.finalRiskAllowedModels` 內的模型。
- scorecard 的 `requested`／`actual` 必須記錄**實際** served 的模型，不得以本表推定。
- 規則成文前已完成的施工不回頭重做：重跑不會產生新證據，只會多燒一輪 CI。

## 3.1 與兩軌分流（#339）的關係

本裁示與同日的 `docs/decisions/2026-09-10-owner-two-workstream-sol-governance.md` 相容且互補：

- 該決策把工作分成 `MODEL_GOVERNANCE`（Sol-only、不要求 Final Risk）與 `PRODUCT_MAINLINE`。
- `docs/MODEL-ROUTING.md` 的 `## PRODUCT_MAINLINE` 說「其他 provider 的 Product 主 Session 可依其
  可用模型執行等價 builder」。**本裁示定義的就是 Anthropic 側「等價 builder」是什麼**——它收窄
  該句，不與之衝突。
- 兩者共用同一條要求的兩面：該節說「不能從 lane 名稱推論模型真的跑過」，本節說「宣告的層級必須
  與 lane 相符」。

本節不擴大也不縮小 Final Risk 的適用範圍；那由 `## PRODUCT_MAINLINE 的 Final Risk` 決定。

## 4. 刻意不 bump `model-routing.json` 的頂層 `version`

`evaluateAstra()` 以 `policyVersion !== policy.version` 綁定既有 attestation
（`scripts/agents/astra-review-policy.mjs:216`）。bump 會讓所有在途 PR 的 attestation 立刻失效
並被迫重跑 Final Risk——實查：#330 的 attestation 記著 `policyVersion: 2026-09-08.4`，與現行
`main` 相同，bump 後它會直接轉紅。

而 `anthropicEquivalents` **沒有任何 runtime 讀取**，唯一消費者是新增的單元測試，語意上不改變
任何既有判定。因此不 bump，該鍵自帶 `version: 2026-09-10.1` 供本身追溯。

## 5. 已知限制

文件裡的措辭鎖是**存在性**檢查：測試斷言「Terra 一律用 Sonnet」這句在，但在其後追加例外語句
仍會通過。散文無法可靠地以 regex 鎖住；真正的鎖是設定檔中的逐字比對。此限制經變異驗證確認，
如實記在此處而非以「文件已鎖住」帶過。
