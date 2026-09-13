# Owner Decision — MODEL_GOVERNANCE 接受整個 audit 層（Sol 與 Opus 皆可）

> 日期：2026-09-10
> Issue：#339（MODEL_GOVERNANCE workstream）／延續 #340
> 來源：Owner 明確裁示「請改成 model governance 讓可以使用 sol、opus 兩種模型都可以」。

## 1. 核心決策

MODEL_GOVERNANCE 是 **audit 層**的工作，不是「某一個型號」的工作。audit 層在兩側各有一個模型，
兩者同層等價，**都可以執行治理**：

| 側 | audit 層模型 | 設定來源 |
|---|---|---|
| OpenAI | `gpt-5.6-sol` | `models.audit` |
| Anthropic | `claude-opus-5` | `anthropicEquivalents.audit` |

機器可讀的清單是 `scripts/agents/model-routing.json` 的
`workstreams.modelGovernance.allowedModels`，守門 `classifyWorkstream()` 直接讀它。

放寬到此為止。清單之外一律擋下——build 層（`gpt-5.6-terra`／`claude-sonnet-5`）與 scout 層
（`gpt-5.6-luna`／`claude-haiku-4-5`）都不得執行治理，`claude-fable-5-1` 也不行（它是 Final Risk
的審查模型，不是治理的施工模型）。

## 2. 為什麼需要這條決策

守門原本硬性要求 `requested/actual = gpt-5.6-sol` 這**一個字面值**。後果是一個閉環死結：

1. 在 Anthropic 側執行的治理 PR，欄位照實填 `claude-opus-5` → 永遠過不了 `Agent WIP Policy`。
2. 唯一的修法是改 `classifyWorkstream()`，但那支 PR 自己也是 MODEL_GOVERNANCE，
   也會被同一條規則擋下。
3. 而且擋它的是 **`main` 上的舊程式**——`agent-wip-guard.yml` 是 `pull_request_target`，
   checkout 的是 default branch。所以分支上修好也沒用，必須先合進 `main` 才會生效。

實際代價已經付過一次：#342 只能由 Owner 暫時把 `Agent WIP Policy` 從 `main` 的必要檢查移除、
合併、再勾回去。那段空窗期所有 PR 都少一道守門。這條決策就是為了不再需要動 branch protection。

## 3. 守門必須同時成立的三件事

1. `requested` 與 `actual` **各自**都必須落在 `allowedModels` 內。一邊合規不能替另一邊背書。
2. 比對是**逐值**的，不是子字串比對。`requested=gpt-5.6-sol-preview` 不算命中 `gpt-5.6-sol`；
   清單一有兩個值，寬鬆比對的誤判面積就會變大。
3. 欄位必須記錄**實際 served 的模型**。清單放寬的是「哪些模型算合規」，
   **不是**「可以照抄一個合規值」。`docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md` 的查證要求不變。

## 4. 為什麼不動 `routing.version`

`models.finalRisk*` 與 Product 側的 Final Risk 政策完全沒動，而既有 attestation 綁的是
`policyVersion === routing.version`（`evaluateAstra()`）。動它會讓現存 attestation 全部失效。
本次只把 `workstreams.version` 由 `2026-09-10.1` 推進到 `2026-09-10.2`——workstream 政策
本來就獨立版本化，這正是它被拆開的用意。

## 5. 已知限制

守門驗的是 PR 內文宣告與設定清單是否一致，**它證明不了哪個模型真的跑過**。
這一點與 `docs/AGENT-EXECUTION.md` 既有立場一致：平台無法舉證時，`actual=unknown` 仍是誠實值，
而 `unknown` 不在清單內、會被擋下——那是刻意的，治理工作必須能指名執行者。
