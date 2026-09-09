# Governance Scoreboard

本文件定義治理 Run 的可比較性、模型審查身分證據與 Scoreboard 完整度。它不改變 Product 規格，也不改變現行 Final Risk merge policy。

## 1. 三種模型身分證據必須分開

治理報表不得把「有指派模型」寫成「模型身分已被供應商證明」。

| 分類 | 定義 | 可標 `MODEL_REVIEW_VERIFIED` |
|---|---|---|
| `PROVIDER_VERIFIED` | 有 provider / platform 可驗證的 served-model execution reference，且 `actualModel` 已知 | 是 |
| `OPERATOR_ATTESTED` | 操作者具名背書實際委派到某模型，但 provider served-model telemetry 不可獨立驗證 | 否，只標 `MODEL_REVIEW_ATTESTED` |
| `UNKNOWN` | `actualModel=unknown`，或沒有足以支持實際模型身分的證據 | 否，標 `MODEL_REVIEW_IDENTITY_UNKNOWN` |

現行 Final Risk guard 是否接受 `OPERATOR_ATTESTED` 由 `docs/MODEL-ROUTING.md` 與 `scripts/agents/astra-review-policy.mjs` 決定。本 Scoreboard **不放寬也不收緊 merge gate**，只確保複盤與 metrics 不把 attestation 冒充 provider verification。

## 2. Durable review evidence contract

每一筆計入治理 Scoreboard 的 Sol / Final Risk review 至少要有：

- `role`: `SOL_AUDIT` 或 `FINAL_RISK`
- `requestedModel`
- `actualModel`
- `identityEvidence`
- durable `executionRef`
- `reviewedSha` 或 `changeDigest`
- `verdict`

這裡的 `executionRef` 是「這次審查在 GitHub／治理記錄中的可追溯 reference」，例如一筆 PR review；**它不是 provider served-model execution id，也不能拿來證明模型身分**。只有 `identityEvidence=PROVIDER_VERIFIED` 時，才另外要求 `providerExecutionRef`，而 Scoreboard 的 `MODEL_REVIEW_VERIFIED` 也只計這一類。換句話說，GitHub review 證明「有留下這次審查紀錄」，provider evidence 才能證明「實際由哪個模型服務」。

證據檔放在：

`docs/metrics/review-evidence/<runId>.json`

同一筆 review 不得重複計數。純 attestation 修正若沒有重新執行 review，不應被當成新的 review touch。

## 3. Sol flow 不再靠人工回憶

`flow.solTouches` 與 `flow.solIssues` 必須能由 durable review evidence 重建：

- `solTouches` = `SOL_AUDIT` review records 數量
- `solIssues` = 有 `SOL_AUDIT` 的 unique PR subjects 數量

新 terminal Run 若 ledger 與 durable evidence 對不上，視為 Scoreboard contract failure。

歷史已關閉 Run 不回寫。若發現 mismatch，只新增 reconciliation scoreboard，清楚標示 historical non-comparable。

## 4. Metric data quality

`metricDataQualityPercent` 由 `scripts/metrics/governance-scoreboard.mjs` 對核心 19 個欄位計算，不接受人工填一個漂亮百分比取代原始資料。

自 `docs/metrics/governance-scoreboard-policy.json` 的 `effectiveAt` 起，新 terminal Run 必須：

1. 核心 metric data quality >= 95%。
2. `auditability.scoreInputsCompletePercent` 與程式實算值一致。
3. Sol flow 與 durable review evidence 一致。

否則 required `check` 裡的 unit gate 必須轉紅，該 Run 不得被稱為可比較 terminal scoreboard。

Token / weekly usage若平台拿不到，維持 unknown，不納入這個 completeness 分母，也不得估算。

## 5. 低風險工作不被強迫升級審查

Scoreboard evidence contract 不等於「每張 PR 都要 Final Risk」。

低風險、沒有 Sol / Final Risk requirement 的 Run 可以使用空的 `records: []`，只要 ledger flow 也誠實為 0/0。是否需要 Sol / Final Risk 仍由現行 risk routing 決定。

## 6. 歷史 r01 reconciliation

`2026-09-09-governance-loop-r01` 保留原 ledger 不改寫。依 durable GitHub review evidence重建後：

- ledger Sol flow: 0 touches / 0 subjects
- durable evidence: 4 Sol touches / 2 subjects
- total model reviews: 6
- provider-verified identity: 0
- operator-attested: 2
- identity unknown: 4
- metric data quality: 68.4% (13/19)

因此 r01 的工作流程完成證據仍有效，但其 Scoreboard **不可拿來和未來完整 Run 做量化優劣比較**。

## 7. Review / closeout 問句

結案前至少回答：

1. Sol / Final Risk 實際做了幾次？durable records 能不能重建？
2. `actualModel=unknown` 是否被錯算成 verified？
3. operator attestation 是否與 provider verification 分開？
4. ledger 的 Sol flow 是否與 review evidence 一致？
5. 核心 metrics 缺值率是多少？是否達到 policy 門檻？
6. 若資料不足，是否誠實標示 non-comparable，而不是補 0、平均值或推估？
