# Product Scorecard Live Readiness

> #460 / PR #461 已建立 current `OBSERVED_V1` Scorecard。本文不是第三套分數，也不改 100 分公式；它只負責在 Product Run 還進行中時，確認 durable raw events 沒有漏記或互相矛盾。

## 為什麼還需要 readiness

`OBSERVED_V1` 已經解掉「人工百分比缺一格 → 整輪 NOT_GRADED」的根因，但它仍需要真實 raw evidence。若一輪工作有 CI、委派、closure sweep，ledger 卻沒有對應 task / counter / Completion Truth，terminal 時仍無法誠實評分。

因此現在只有一套分數、兩個時點：

```text
LIVE READINESS
→ active Run 的 raw-event capture health
→ 不產生分數、不參與跨 Run 比較

FINAL SCORE
→ scripts/agents/score-run-current.mjs
→ 新 Product Run 使用 OBSERVED_V1
→ terminal + truth verified 才真正評分
```

Legacy manual percentages 只保留歷史 / supplemental telemetry，**不是**新 Run 的 live readiness gate。

## Command

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json
```

Machine readable：

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json --json
```

Checkpoint gate：

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json --strict-live
```

`--strict-live` 只會因 ledger invalid、raw capture gap 或 counter inconsistency 非零退出；active Run 尚未有 `endedAt`、`main.endSha`、terminal Completion Truth 是正常狀態，不因此失敗。

## 現在檢查什麼

### 1. Raw task evidence

當 ledger 已記錄實際施工／CI／closure activity 時，`modelUsage.tasks` 不可以仍是空陣列。這是 OBSERVED_V1 最基本的「這輪真的有觀測」證據。

### 2. Durable counter consistency

能從 `modelUsage.tasks` 機械推導的 counters 必須相符：

- `flow.lunaTasks`
- `flow.lunaAccepted`
- `flow.solTouches`

此外：

- `ci.invalidReruns <= ci.fullCiRuns`
- `inventory.closureAdvancedOrClosed <= inventory.closureSweeps`
- verified `ISSUE_CLOSED` 數不可大於 `delivery.issuesClosed`

這些不是新的分數，它們只是避免「raw events 一套、summary counters 另一套」。

### 3. Terminal-only pending

active Run 可以、也應該暫時缺：

- `endedAt`
- `main.endSha`
- `inventory.openIssuesEnd`
- `inventory.openPrsEnd`
- closeout envelope
- `completionTruth.status/checkedAt`

readiness 會把它們列出，但不視為 active Run 的失敗。

## 四個固定 checkpoint

1. **RUN START**
   - 建立／接續 `RUN_ID`；
   - 記錄 start main SHA、open Issue / PR；
   - 跑一次 readiness，確認 ledger schema 與初始狀態可用。
2. **OBSERVABLE EVENT**
   - accepted/rejected Agent task、full CI、invalid rerun、Audit / Final Risk、TEST collision、安全事件、closure sweep 發生後；
   - 先寫 durable raw fact，再跑 readiness。
3. **DELIVERY STAGE CHANGE**
   - merge、Issue close / owner-blocked、Vercel Production READY、Production schema readiness、authenticated Production acceptance 後；
   - 立即寫 Completion Truth evidence，不等複盤再回想。
4. **PRE-CLOSEOUT**
   - `rawCaptureGaps=[]`、`consistencyWarnings=[]` 才進 terminal closeout；
   - 已失去的歷史觀測不得用推算或預設 0 補成綠色。

## 降低治理摩擦

### Default entry 只讀必要來源

日常 Product / Governance 接手應以 `docs/AGENT-EXECUTION.md` 為單一 default execution entry。其他治理文件改為 trigger-based load：

- Model routing / Final Risk 只有碰 Product lane、模型路由或高風險審查時讀。
- Documentation Governance 只有 docs scope / canonical-doc change 時讀。
- B+ 歷史背景文件只有規則衝突或追溯裁示時讀。
- Playbook 只搜尋本次錯誤／領域，不全量重讀。
- skill 只在對應任務 trigger 時載入。

安全規則沒有減少，只是不再每輪把全部背景一起塞進 context。

### Deterministic metadata preflight-first

```text
PR body / TEST_PROFILE / lane / candidate / Final Risk metadata
→ local/trusted preflight
→ PASS 才 push / dispatch remote CI
```

如果 deterministic metadata 到 remote CI 才第一次被抓到，優先判定為 **preflight coverage gap**。修 shared parser / preflight，不要教每個 Agent 背另一段散文，也不得用 no-op commit 或 blind rerun 試錯。

PR #463 第一輪就提供一個真實例子：source 尚未被檢查前，`Agent WIP Policy` 只因 `ASTRA_RATIONALE` 太抽象而退件。正確處置是修 metadata / preflight coverage，不是重跑同一 workflow。

## 與 #461 OBSERVED_V1 的邊界

- `score-run-current.mjs` 決定 final score / profile。
- `scorecard-readiness.mjs` 只檢查 active Run 的 raw capture health。
- readiness 不要求 `firstPassRatePercent`、`acceptanceEvidenceCoveragePercent`、`auditFirstPassRatePercent`、`lunaDelegationRatePercent`、`waitTimeConvertedPercent` 或 auditability legacy 百分比。
- 歷史 `LEGACY_V2` 不回寫、不重算成 OBSERVED_V1。

## 不改變的安全邊界

- Completion Truth 仍必須 VERIFIED 才能正常 final grading。
- `CLOSED` 不等於 shipped。
- Production five-stage truth 不變。
- TEST holder / shared TEST serialization 不變。
- Product Final Risk 不變。
- MODEL_GOVERNANCE 維持 model-agnostic。
- 歷史 ledger 不回填猜測值。

## 準備納入 `docs/AGENT-EXECUTION.md` 的核心文字

```md
### Live Scorecard Contract

新 Product Run 以 `score-run-current.mjs` 的 `OBSERVED_V1` 為 current scoring truth；legacy manual percentages 不再是新 Run 的 grading gate。Active Run 使用 `scorecard-readiness.mjs` 檢查 durable raw events 與 counters 是否完整一致，不產生分數。

固定 checkpoint：Run start、每次 observable event 後、每次 delivery stage change 後、pre-closeout。Pre-closeout 必須 `rawCaptureGaps=[]` 且 `consistencyWarnings=[]`；terminal-only pending 在 active Run 不算失敗，也不得為了變綠事後猜值。

Deterministic metadata 一律 preflight-first。PR body / TEST_PROFILE / lane / candidate / Final Risk metadata 若在 remote CI 才第一次被擋，視為 preflight coverage gap；修 validator / parser，不用 CI 當規格查詢器，不堆 no-op commit，不 blind rerun。
```
