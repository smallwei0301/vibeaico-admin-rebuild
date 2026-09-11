# Owner Decision：MODEL_GOVERNANCE 不指定模型

日期：2026-09-11

來源：Owner 明確裁示：「模型治理這條工作線不需要指定模型；模型治理的部分不用分析使用哪個模型。」

## 1. 核心決策

`WORKSTREAM: MODEL_GOVERNANCE` 從本決策起改為 **model-agnostic（不指定模型）**。

這代表：

- 不要求 MODEL_GOVERNANCE 使用 Sol、Opus、Terra、Astra、Fable 或任何特定型號；
- 不以 requested model、actual model、provider model identity coverage 作為治理品質或效率指標；
- retrospective／scoreboard 在分析 MODEL_GOVERNANCE 時，不比較「用了哪個模型」；
- 任何可執行 repo governance 的 Agent／Session 都可以在 `AGENT_LANE: GOVERNANCE` 下完成 bounded governance work；
- Product model routing、Terra builder 規則與 Product Final Risk model allowlist 完全不受本決策影響。

## 2. 不等於取消治理驗證

MODEL_GOVERNANCE 仍必須驗證：

- current truth；
- scope 是否純治理；
- source CI／regression tests 是否真的執行；
- exact-head final diff；
- blocking finding 是否已在 final head reconciliation；
- Completion Truth；
- PR／WIP／CI waste／metric data quality。

換句話說：不分析「誰開車」，但仍嚴格驗證「有沒有到終點、途中有沒有撞牆」。

## 3. PR metadata 相容期

目前 trusted-main PR parser 仍有 `REQUESTED_MODEL / ACTUAL_MODEL` 欄位。為避免為本決策一次改動過多 controller 程式，新的 MODEL_GOVERNANCE PR 在相容期使用：

```text
REQUESTED_MODEL / ACTUAL_MODEL: requested=NOT_APPLICABLE; actual=NOT_APPLICABLE
```

`NOT_APPLICABLE` 是 **非模型 sentinel（不適用標記）**，不得被當成模型名稱、模型執行證據或 Scoreboard model coverage。

為避免本決策合併後把既有在途治理 PR 全部打紅，trusted main 可暫時接受舊的 `gpt-5.6-sol`／`claude-opus-5` metadata 作為 grandfathered compatibility；但新治理工作應使用 `NOT_APPLICABLE`。

後續若移除 PR schema 中這個欄位，應另開 bounded MODEL_GOVERNANCE PR，不與 Product 變更混合。

## 4. Workstream 邊界不變

MODEL_GOVERNANCE 仍只處理治理範圍，例如：model routing policy、Agent orchestration、WIP／lane、Final Risk guard 自身治理、metrics／scoreboard、PR lifecycle、治理型 CI／templates 與 regression tests。

若 PR 混入 Product runtime、schema／migration、tenant data flow、payment／refund、LINE/provider、Production deploy behavior 或跨 repo Product contract，優先拆分；無法安全拆分時整張改為 `PRODUCT_MAINLINE`。

## 5. 與舊決策的關係

本決策只 supersede（取代）2026-09-10 決策中「MODEL_GOVERNANCE 必須由 audit-tier 特定模型執行／分析模型身分」的部分。

以下仍保留：

- 雙 Workstream 分流；
- MODEL_GOVERNANCE 不佔 Product Terra slots；
- MODEL_GOVERNANCE 不因純治理範圍自動要求 Astra/Fable Product Final Risk；
- PRODUCT_MAINLINE 的模型路由與安全門；
- Production 高影響操作仍需既有具名授權。
