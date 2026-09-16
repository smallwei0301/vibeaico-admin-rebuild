# Product Scorecard Live Readiness

> #460 / PR #461 已建立 current `OBSERVED_V1` Scorecard。本文不是第三套分數，也不改 100 分公式；它只負責在 Product Run 還進行中時，確認 durable raw events 沒有漏記或互相矛盾。

## 為什麼還需要 readiness

`OBSERVED_V1` 已經解掉「人工百分比缺一格 → 整輪 NOT_GRADED」的根因，但它仍需要真實 raw evidence。若一輪工作有 CI、委派、closure sweep，ledger 卻沒有對應 task / counter / Completion Truth，terminal 時仍無法誠實評分。

因此現在只有一套分數、兩個時點：

```text
LIVE READINESS
→ active Run 的 raw-event capture health
→ 只輸出 LIVE_CAPTURE_READY / NEEDS_CAPTURE
→ 不產生百分比、不參與跨 Run 比較

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

`--strict-live` 只會因 ledger invalid、raw capture gap 或有明確不變量的 counter inconsistency 非零退出；active Run 尚未有 `endedAt`、`main.endSha`、terminal Completion Truth 是正常狀態，不因此失敗。

## 現在檢查什麼

### 1. Raw task evidence

當 ledger 已記錄實際施工／CI／closure activity 時，`modelUsage.tasks` 不可以仍是空陣列。這是 OBSERVED_V1 最基本的「這輪真的有觀測」證據。

### 2. Durable counter consistency

只有 repo 已明確定義成同一件事、可從 `modelUsage.tasks` 機械推導的 counters 才做 strict equality：

- `flow.lunaTasks`
- `flow.lunaAccepted`

`flow.solTouches` 的 canonical 語意是 triage / audit touches，不保證等於 Sol task record count，所以 readiness **只並列顯示，不宣告兩者必須相等**。

此外，以下不變量會 fail closed：

- `ci.invalidReruns <= ci.fullCiRuns`
- `inventory.closureAdvancedOrClosed <= inventory.closureSweeps`
- verified `ISSUE_CLOSED` subjects 與 `delivery.issuesClosed`：只要任一側非 0，就必須精確相等

最後一條同時抓兩個方向：不能「claim 關了但 counter 沒記」，也不能「counter 說關了但 Completion Truth 沒證據」。

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

如果 deterministic metadata 到 remote CI 才第一次被抓到，先區分兩種情況：

1. **preflight 沒跑**：修執行順序。
2. **preflight 跑了仍漏掉**：才是 preflight coverage gap，補 shared parser / validator。

兩者都不得用 no-op commit 或 blind rerun 猜合法值。

PR #463 第一輪就是第 1 類：現行 preflight 本來已會檢查 Astra classification，但本 session 因沒有可執行的本機 repo 就直接開 PR，結果 `Agent WIP Policy` 在 source CI 前因 `ASTRA_RATIONALE` 太抽象退件。正確教訓是 **preflight-first 必須成為真正執行順序**，不是再新增另一支重複 validator。

## 與 #461 OBSERVED_V1 的邊界

- `score-run-current.mjs` 決定 final score / profile。
- `scorecard-readiness.mjs` 只檢查 active Run 的 raw capture health，輸出類別狀態，不輸出另一個分數或百分比。
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

## `docs/AGENT-EXECUTION.md` 已納入的核心規則

- 新 Product Run 以 `score-run-current.mjs` 的 `OBSERVED_V1` 為 current scoring truth；legacy manual percentages 不再是新 Run 的 grading gate。
- Active Run 使用 `scorecard-readiness.mjs` 檢查 durable raw events 與有定義的不變量，不產生分數或百分比。
- 固定 checkpoint：Run start、每次 observable event 後、每次 delivery stage change 後、pre-closeout。
- Pre-closeout 必須 `rawCaptureGaps=[]` 且 `consistencyWarnings=[]`；terminal-only pending 在 active Run 不算失敗，也不得為了變綠事後猜值。
- Deterministic metadata preflight-first；remote CI 不作規格查詢器，不堆 no-op commit，不 blind rerun。

## Required path 與 shared helper（#538，承接 #531／#532）

`scorecard-required-gate.mjs` 只轉接既有 schema validators 與 `analyzeScorecardReadiness`，不建立第二套 counters／評分規則。變更中的 v2 `IN_PROGRESS`／`CLOSURE_RECOVERY` ledger 必須通過 raw-capture consistency；未變更的歷史 ledger 不讀、不回寫。

完整 `agent-wip-preflight.mjs` CLI 必須提供 `--body` 與完整 `--changed-files` 清單，讀取本機實際檔案。相容的 metadata-only API 呼叫會回報 `rawCaptureChecked=false`，不能當成完整 capture PASS。

Remote `Agent WIP Policy` 使用 trusted-main helper，從完整分頁的 live PR file inventory 取得 immutable blob SHA，核對 bytes／size／hash 後以同一 helper 驗證。缺頁、缺檔、壞 JSON、錯誤 blob、raw gap／counter contradiction 均 fail closed；不執行候選分支程式，不相信本文宣告的 PASS。獨立 scorecard workflow 仍保留格式、報表重現與 strict-live 檢查，不以它取代 required status。

Raw capture errors 只阻擋當前 PR 與 TEST dispatch，不混入 workstream scope errors，也不使純 Governance 占用 Product WIP。只有 metadata／scope 已合法的純治理才適用既有隔離。這不授權 TEST／Production 寫入、放寬 Final Risk、調高 WIP，或把 source merge 算成產品出貨。
