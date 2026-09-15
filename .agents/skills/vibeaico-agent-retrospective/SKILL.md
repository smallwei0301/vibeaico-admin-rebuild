---
name: vibeaico-agent-retrospective
description: "Trigger when the Owner says 復盤 or 複盤, asks to review Product delivery, governance quality, CI waste, completion truth, provider incidents, Scorecard quality, or asks to optimize the B+ loop. Uses live truth, the current Product Scorecard entry and the separate Governance Scoreboard without inventing missing metrics."
metadata:
  author: smallwei0301
  version: "1.6.0"
---

# VibeAI Agent Loop 復盤

## 1. 語意

- `復盤`／`複盤`：**唯讀**，不得順手改 Product、DB、Production 或治理文件。
- `復盤並優化`／`複盤並改善`：先唯讀復盤，再最多實作 **2 項 bounded governance 改良**。
- Product 與 Governance 是兩張分開的成績單，不互相冒充。

## 2. 最小載入，不全量回播

1. fetch current `origin/main`。
2. 讀 `docs/AGENT-EXECUTION.md`。
3. 讀本次時間窗涉及的 Product Run JSON／Markdown、live GitHub、required CI。
4. 讀最新 Governance Scoreboard policy 與相關 governance run/evidence。
5. 只有需要解釋特定規則時，才精確讀相關 Owner Decision／Playbook 條目。
6. provider 被碰過才查對應 live provider；Gmail 可用時查同時間窗的 provider incident 通知。

不要為了復盤重讀所有歷史 Decision、全部 Playbook、全部 Issue 或整段舊對話。

## 3. Completion Truth 先於分數

任何重要完成主張先 live 驗：

### PR merged

至少需要：

```text
merged=true / merged_at
merge_commit_sha
current main
merge SHA 對 main reachable
after-merge ref=main 關鍵檔案重讀
```

### CI green

必須是 exact head；宣稱某 suite 執行過時，要看實際 job/suite/case 證據。
`POLICY_SKIP` / skipped / old SHA 不能寫成測試通過。

### DB / deployment / provider

必須對 exact project/environment 讀 live state。TEST 不證明 Production；Vercel READY 不等於登入後 Product acceptance。

如果 ledger/對話說完成但 live state 反駁：

```text
AUDIT_DATA_INVALID
safety violation
F-HARD / comparison ineligible
```

不回寫歷史把它修漂亮。

## 4. Product Scorecard：永遠走單一 current entry

```text
npm run agent:run:validate -- <run.json>
npm run agent:run:score -- <run.json>
npm run agent:run:review -- docs/metrics/agent-runs
```

`agent:run:score` 自動選 profile：

```text
歷史 terminal Run（endedAt < 2026-09-15T00:00:00Z） → LEGACY_V2
新 v4 Product terminal Run                                → OBSERVED_V1
```

### OBSERVED_V1 的原則

分數只從 durable raw facts 衍生，例如：

- `modelUsage.tasks`
- Luna accepted/tasks
- CI runs / invalid reruns / collisions
- closure sweep / advanced-or-closed
- WIP peaks / carryover
- Issues started / verified closed / owner-blocked
- Completion Truth claims + evidence refs
- Production five-stage coverage
- reopened / regressions / P0/P1 / safety events
- startedAt / endedAt

以下 legacy 百分比仍可顯示，但沒有可靠 denominator 就保持 `null`，**不補猜，也不再是新 Run 的 grading gate**：

```text
weightedUsageImprovementPercent
firstPassRatePercent
acceptanceEvidenceCoveragePercent
auditFirstPassRatePercent
lunaDelegationRatePercent
waitTimeConvertedPercent
auditability percentages
```

新 terminal Run 若 `modelUsage.tasks=[]`、Completion Truth 未 VERIFIED、terminal facts 缺失，仍 `NOT_GRADED`。
Completion Truth 矛盾或 safety violation 仍 `F-HARD`。

**Production pending 可以被評分，但不能算 shipped。** 它會反映在 production-stage coverage、completion 與 WIP，不能因缺最後一階就讓整輪數據消失。

## 5. Product trend

比較最近最多 3 個 `comparisonEligible=true` 的 Product terminal Run。

重點比較：

```text
score profile / total
shipped_units
autonomous_outcome_units
production_pending
carryover
weighted usage / shipped（有 shipped 才算）
cycle time（直接由時間戳衍生）
Luna acceptance
closure conversion
invalid reruns / collisions / duplicate work
P0/P1 / reopened / regressions / safety
Completion Truth / Production stage coverage
```

少於 2 個 eligible Run 時不宣稱「改善 X%」；仍可報最新一輪的**絕對 observed score**與缺口。
少於 3 輪不再等於「完全沒有真實數據」，只是「趨勢樣本不足」。

## 6. Governance Scoreboard 仍是獨立 surface

依：

```text
docs/GOVERNANCE-SCOREBOARD.md
docs/metrics/governance-scoreboard-policy.json
scripts/metrics/governance-scoreboard.mjs
```

MODEL_GOVERNANCE 不分析或比較使用哪個模型。看的是：

- metric data quality / comparison eligibility
- CI / PR / WIP waste
- Completion Truth failures
- review evidence integrity / blocker reconciliation
- duplicate work / ownership collision / stale inventory
- provider incident evidence
- 治理是否降低摩擦而沒有降低 Product safety

如果沒有新的 terminal governance run，就明確寫 `GOVERNANCE_TREND: SAMPLE_INSUFFICIENT`；
不得拿 Product Run 充當 governance sample，也不得為了產生 Scoreboard 人工開一輪治理工作。

## 7. Provider / Gmail

時間窗內若碰 Vercel、GitHub Actions、Supabase、LINE、Resend/Email 等，優先讀 live provider。
Gmail 可用時，用相同時間窗搜尋 provider 通知；完整訊息優於 snippet。

證據優先序：

```text
live provider API/dashboard
→ provider full email/thread
→ GitHub provider bot/status
→ PR/Issue prose
```

Gmail 搜尋為 0 只能說「該 query 找不到通知」，不能說 provider 沒事故。
Gmail 不可用則寫 `GMAIL_EVIDENCE_UNAVAILABLE`。

## 8. 根因與改良

優先找這些形狀：

- 有 source output、沒有 Production acceptance → Delivery Truth / last mile。
- CI rerun 多但沒有安全收益 → metadata/preflight friction。
- 有 tasks、Scorecard 卻缺分 → 看 score gate 是否依賴人工欄位，而不是補猜數字。
- scout 結論錯 → 檢查 evidence source 是否用了工作樹、grep 格式或 checkbox 代理指標。
- Product 等太久 → 看 WIP、shared TEST、provider、跨 repo blocker 是否已過期。
- governance 工作比 Product 多 → 停止新增框架，優先收斂現有 guard／tooling。

`復盤並優化` 時，每輪最多改 1～2 個高槓桿點；預設 <= 8 files / 800 lines；不重寫歷史 score。

## 9. 必要輸出

用白話中文，至少回答：

1. cutoff / current truth
2. Completion Truth 是否可信
3. Product Scorecard / trend（profile 要寫出來）
4. Governance Scoreboard / sample 狀態
5. Production／TEST／provider 與 GitHub 是否一致
6. 真正變好的 Product outcome
7. 純忙碌或摩擦在哪裡
8. 最多 3 個根因
9. 下一輪最多 2 個治理調整
10. 還缺哪些資料，為什麼不能猜

不要因為趨勢樣本不足就把整份復盤寫成 `NOT_GRADED`；如果最新 terminal Run 已符合 OBSERVED_V1，
先報它的真實絕對分數，再誠實標示 trend sample 不足。
