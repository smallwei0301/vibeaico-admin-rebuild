# Delivery Outcome：2026-09-17-issue-447-readiness-r01

> 評分契約：**OBSERVED_V1**（startedAt 自 2026-09-15T00:00:00Z 起的新 terminal Product Run）
> 評分狀態：**GRADED_OBSERVED_V1**
> 分數：**71 / 100（C）**

## 兩本帳

- 真正出貨 shipped_units：0
- 正式環境待驗 production_pending：1
- 自主完成 autonomous_outcome_units：0
- 在製品 WIP：Audit Ready 0、CI-only 0、commit-only 0、carryover 0
- 內部加權 usage：18（比較尺，不是官方 token）
- 每件真正出貨 usage：資料不足

## 可觀測衍生指標

- observed task events：1
- cycle time：1917.2 分鐘（startedAt → endedAt）
- Luna 採用率：0%（直接由 modelUsage.tasks 衍生）
- closure conversion：0%
- verified claim evidence coverage：100%
- Production stage coverage：0%
- Sol touches / issue：1

## Legacy supplemental telemetry（不再是 grading gate）

- weightedUsageImprovementPercent：資料不足
- firstPassRatePercent：資料不足
- acceptanceEvidenceCoveragePercent：資料不足
- auditFirstPassRatePercent：資料不足
- waitTimeConvertedPercent：資料不足

## 五面向

| 面向 | 分數 |
|---|---:|
| usage / waste | 20 / 20 |
| 完成效率 | 9 / 30 |
| 品質安全 | 30 / 30 |
| Agent 流動 | 4 / 10 |
| 證據完整 | 8 / 10 |

---

OBSERVED_V1 只使用 ledger 既有原始事件、Completion Truth 與可直接衍生比例；缺少 denominator 的人工百分比保持 unknown，不補猜，也不再因一格 null 讓整輪失去分數。歷史或跨 cutoff 已開始的 Run 仍由 LEGACY_V2 原樣重播。
