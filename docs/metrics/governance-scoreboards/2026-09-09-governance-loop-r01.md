# Governance Scoreboard：2026-09-09-governance-loop-r01

- Metric data quality: **68.4%** (13/19)
- Comparison eligible: **NO**
- Sol flow (ledger → evidence): **0/0 → 4/2**
- Model review identity coverage (provider verified): **0%**
- Assigned/attested identity coverage: **33.3%**

## Model review evidence

- total reviews: 6
- Sol audit touches: 4
- unique Sol subjects: 2
- Final Risk touches: 2
- provider verified: 0
- operator attested: 2
- identity unknown: 4

## Missing core metrics

- quality.acceptanceEvidenceCoveragePercent
- quality.auditFirstPassRatePercent
- flow.waitTimeConvertedPercent
- auditability.evidenceFieldsCompletePercent
- auditability.exactHeadTestCoveragePercent
- auditability.preciseBlockersPercent

## Observations

- ledger Sol flow is 0/0, durable review evidence is 4/2
- 此報表是歷史 reconciliation，不回寫已關閉的 r01 ledger，也不把缺值補成 0 或估算值。
- r01 因核心 metrics 不完整且 flow ledger 與 durable review evidence 不一致，維持 historical non-comparable；不補造一個事後分數。

---

`MODEL_REVIEW_VERIFIED` 僅代表 provider-verified model identity。`OPERATOR_ATTESTED` 仍是獨立證據類別，並可能依現行 Final Risk merge policy 被接受；本 Scoreboard 不修改 merge policy。
