# Delivery Outcome：2026-09-22-product-delivery-r02

> 評分契約：**OBSERVED_V1**（startedAt 自 2026-09-15T00:00:00Z 起的新 terminal Product Run）
> 評分狀態：**NOT_GRADED**
> 分數：尚不評分

## 兩本帳

- 真正出貨 shipped_units：0
- 正式環境待驗 production_pending：0
- 自主完成 autonomous_outcome_units：0
- 在製品 WIP：Audit Ready 0、CI-only 0、commit-only 0、carryover 0
- 內部加權 usage：33（比較尺，不是官方 token）
- 每件真正出貨 usage：資料不足

## 可觀測衍生指標

- observed task events：6
- cycle time：61 分鐘（startedAt → endedAt）
- Luna 採用率：100%（直接由 modelUsage.tasks 衍生）
- closure conversion：100%
- verified claim evidence coverage：100%
- Production stage coverage：0%
- Sol touches / issue：資料不足

## Legacy supplemental telemetry（不再是 grading gate）

- weightedUsageImprovementPercent：資料不足
- firstPassRatePercent：資料不足
- acceptanceEvidenceCoveragePercent：資料不足
- auditFirstPassRatePercent：資料不足
- waitTimeConvertedPercent：資料不足

## 為什麼尚不評分

- ISSUE_CLOSED #650 evidenceRef does not identify one canonical Issue
- verified RUN_COMPLETE claim is required
- delivery.issuesClosed=1 does not match 0 unique verified ISSUE_CLOSED subject(s)

---

OBSERVED_V1 只使用 ledger 既有原始事件、Completion Truth 與可直接衍生比例；缺少 denominator 的人工百分比保持 unknown，不補猜，也不再因一格 null 讓整輪失去分數。歷史或跨 cutoff 已開始的 Run 仍由 LEGACY_V2 原樣重播。
