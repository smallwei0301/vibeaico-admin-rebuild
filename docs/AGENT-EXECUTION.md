# Agent 常駐自主執行規則

> Owner 首次裁示：2026-08-28  
> 最近更新：2026-09-15  
> 本文件是本 repo **唯一的日常 Agent 執行入口**。產品規格仍以 `docs/integration/**` 為準；
> Owner Decision 保存裁示原因；其他治理文件、Skill、Playbook 都改為**依任務觸發才讀**，
> 不得再把整個治理書架當成每輪 mandatory start。

## 0. 最小開工路徑：先做事，再按風險展開文件

每次接手只先做四件事：

1. `git fetch origin --prune`，重新取得 current `origin/main`。
2. 讀 live GitHub：current main、目標 Issue／PR、exact head、required checks、目前 lane／holder。
3. 讀**本文件**。
4. 讀這張 Issue 直接指定的 canonical `docs/integration/**`、必要的最新 Owner Decision。

做到這裡就可以分類 Workstream 與下一步。**不要因為「可能有用」就先讀完 AGENTS、CLAUDE、
MODEL-ROUTING、B+ 歷史決策、Documentation Governance、全部 Playbook、全部 Run ledger。**

### 0.1 只有命中 trigger 才多讀

| 任務情境 | 再載入 |
|---|---|
| Product 模型分工、Sol／Terra／Final Risk | `docs/MODEL-ROUTING.md` |
| 長程 `/goal`、多 Agent、Closure、TEST handoff | `.agents/skills/vibeaico-agent-orchestration/SKILL.md` |
| Owner 說「復盤／複盤」 | `.agents/skills/vibeaico-agent-retrospective/SKILL.md` |
| LOCAL_ISOLATED／shared TEST／Issue #104 | `.agents/skills/vibeaico-isolated-test-orchestration/SKILL.md` + `docs/integration/12-TESTING-TDD.md` |
| Production DB release | `docs/PRODUCTION-DB-RELEASE-WORKFLOW.md` + 最新 Production DB Owner Decision |
| 新增／搬移 canonical 文件或治理文件 | `docs/DOCUMENTATION-GOVERNANCE.md` |
| 已知錯誤、CI 症狀、migration／TEST 陷阱 | 以 Issue／錯誤碼搜尋 `docs/AGENT-PLAYBOOK.md`，只讀命中條目 |
| 需要裁示背景／歷史理由 | 精確讀對應 `docs/decisions/**`，不全量重播 |
| GUIDE UX／手機／LINE／付款等產品領域 | 該 Issue 指定的 integration 分冊 |

**安全規則不因少讀文件而放寬。** 若任務進入 TEST、Production DB、付款、LINE、跨租戶、
不可逆資料或跨 repo contract，就依上表自動展開對應 guard。

## 1. Current Truth 與 Workstream

舊 ChatGPT／Claude session、舊 PR body、舊 Issue checklist、branch-only 文件都只當線索。
判斷現況時優先順序：

```text
live provider / live DB / live GitHub
→ current origin/main canonical docs
→ exact-head CI / durable evidence
→ Issue / PR prose
→ 舊對話與歷史快照
```

所有新 Issue／PR 必須只有一個 Workstream：

```text
WORKSTREAM: PRODUCT_MAINLINE
```

或：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

- 使用者可見功能、API/runtime、schema/migration、tenant data、付款／退款、LINE/provider、
  Product deployment、跨 repo Product contract → `PRODUCT_MAINLINE`。
- Agent orchestration、WIP／PR lifecycle、governance CI、scoreboard、model routing、治理證據 →
  `MODEL_GOVERNANCE`。
- 混合範圍優先拆 PR；拆不開且碰 Product runtime／schema／付款／LINE／部署／跨 repo
  Product contract 時，整張按 Product 處理。

### 1.1 Owner 控制訊號

`/goal`、`/steer`、「繼續」不是重建工作線的理由。模型／Session 切換後保留 branch、PR、
exact head、TEST lane、RUN_ID 與 stage；先重讀 live truth，再接續。

## 2. Branch 與 base freshness

- 新工作從 current main，或已具備必要 canonical decision 的指定 integration branch 開始。
- 分支建立後，**不得只因無關 main 前進就 rebase／重建**。
- 只有 migration ledger／prefix collision、真 merge conflict、共享 contract／acceptance precondition
  改變，或 CI 證明新 base 會實質影響候選時才 re-align。
- `HEAD^ == origin/main` 不是全域 invariant。
- baseline manifest 若 pin 到特定 commit，合併策略必須讓該 commit 在 main ancestry 保持 reachable；
  合併後重新驗 ancestry 與 migration tree，不把「檔案內容一樣」冒充「pin 仍有效」。
- 不 reset、force-push 或重做已完成 migration／測試。

## 3. 權限與不可跨越邊界

| 動作 | 預設 | 條件 |
|---|---|---|
| 讀 repo／Issue／PR／CI／provider／報告 | 允許 | 使用 live 狀態，不洩漏秘密 |
| 修改 source／tests／docs；branch／commit／PR | 允許 | Workstream、Issue scope、required checks 成立 |
| 更新 Issue／PR 證據與 labels | 允許 | 只寫 exact-head / live truth |
| 關閉 Issue | 允許 | 對應 Workstream 的完成證據成立 |
| TEST Supabase | 允許 | 僅 canonical TEST，且取得唯一 TEST lane |
| Vercel Preview | 允許 | 不提升 Production |
| Production DB DDL／DML／migration | staged policy gate | 見 §8 |
| Production deployment／promote／traffic | 禁止 | 需獨立授權 |
| 真實付款、退款、真訂單、顧客通知 | 禁止 | 只用 sandbox/mock/安全接收者 |
| Production reset／seed／災難性刪除 | 禁止 | 不可用人工同意繞過 |
| token、密碼、key、完整 `.env` 進 repo／回覆 | 禁止 | 秘密只在執行環境短暫使用 |

## 4. Product B+：角色、WIP 與最低必要 metadata

本節只適用 `PRODUCT_MAINLINE`。純治理走 §5。

```text
Luna / scout  → 真實盤點、Closure、CI 摘要、文件／Metrics
Terra / build → Product 施工
Sol / audit   → TRIAGE、模糊 CI、高風險設計、early/final audit
```

現行模型層級細節只在需要派工時讀 `docs/MODEL-ROUTING.md`。不要為了日常 CRUD 或文件更新
重載整份模型治理。

### 4.1 WIP 上限

```text
TERRA_BUILD      預設 1；dual-Terra executable guard 同時放行時最多 2
TERRA_RESERVE    單 Terra 時最多 1；雙 Terra 時 0
LUNA_CLOSURE     最多 1
TEST_VALIDATION  最多 1
ACTIVE_CANDIDATE 最多 3
LUNA_TASKS       default 4，最多 6，另有 1 Aggregator
FINAL_SOL_AUDIT  最多 1
Merge            最多 1
```

雙 Terra 是條件入口，不是配額。兩張候選需同 `RUN_ID`、不同 `TERRA_SLOT`／Issue／
`TEST_ENV_ID`、零重疊 `FILE_OWNERSHIP`、各自 local slot 健康；任一失敗就回單 Terra。

### 4.2 Luna 任務要窄，不要複製整個上下文

每個 scout 任務只回答一題，至少帶：

```text
TASK_ID
ISSUE / PR
EXACT_HEAD
QUESTION
READ_ONLY_PATHS
OUTPUT_MAX_LINES
```

不要把完整舊 session 或全 repo 交給每位 scout；不要讓兩位 scout 重做同一盤點；
Aggregator 只去重與壓縮，不發明新事實。

### 4.3 MAIN 出口

MAIN 需走到以下之一：

```text
CLOSED
AUDIT_READY
OWNER_BLOCKED（完整且精確）
```

`PR 已開`、`CI 綠`、`等待 Preview` 都不是出口。

## 5. MODEL_GOVERNANCE：bounded flow

純治理不啟動 Product Terra／Reserve／shared TEST，也不要求 Product Final Risk。

```text
current truth
→ bounded governance implementation
→ source CI / focused regression
→ exact-diff + counterexample review
→ merge / closeout
```

- 預設最多 8 files / 800 changed lines；超過就拆。
- 不指定執行模型；`requested=not_requested`，沒有可靠來源時 `actual=unknown`。
- 不因純治理改動就跑 shared TEST/E2E。
- 治理 PR 不得偷偷改 Product runtime、schema、付款、LINE、Production deployment。
- 治理成功標準是**降低摩擦、提高可驗證性**，不是新增更多 mandatory 欄位。

## 6. CI 與 TEST：綠燈必須代表它真的跑過

- docs-only 不安裝 npm、不讀 TEST secret、不跑 Chromium。
- runtime PR 可跑 typecheck／unit／build；不是唯一 `TEST_VALIDATION` holder 時，remote
  integration／E2E 只能 `POLICY_SKIP`，不得碰 shared TEST。
- `conclusion=success` 不等於測試已執行；宣稱 integration/E2E 通過時必須看到實際 suite/case 證據。
- canonical TEST project 固定：`nmwhwngojosmagjuvxol`。
- **任何會改 canonical TEST 狀態的動作**，包括 E2E insert/delete、reset、seed、migration、
  一次性排查 DML，都必須先取得唯一 TEST lane；「會清理」不是豁免。
- 同 exact head、同環境、同命令不盲重跑；環境錯誤連續兩次就換診斷路徑。
- metadata／PR body 錯誤先跑 repo 既有 preflight；不要拿 CI 當表單驗證器。
- source-only PR 不得把 skipped integration 包裝成「完整測試綠」。

Git Data／遠端 tree 重建後的最低 source gate：

```text
npm run guard:repo-integrity
npm ci
npm run typecheck
npm test
npm run build
```

依 changed-file profile 可由 CI 正式 policy 合法跳過不相關步驟，但手工回報不得把 skip 寫成 pass。

## 7. Review 與 Final Risk

一般 Product Issue：TRIAGE 一次、final Audit 一次；只有 Auth、DB、付款、權限、跨租戶、
安全、模糊 CI 或重大 collision 才加一次 Diagnose／Early review。

- Early review 只能 `FIX_REQUIRED`／建議，不能 `CLOSE_APPROVED`。
- final review 綁 final exact head；head 實質改變後不能拿舊 PASS 放行。
- Product 高後果範圍才進 Final Risk，例如付款一致性、tenant auth、不可逆資料、跨 repo contract、
  Production DB release。
- 一般 UI／文案／小型接線不因是 Product 就自動加高風險審查。
- 最新 `FIX_REQUIRED`／`CHANGES_REQUESTED` 不得被較舊 PASS 蓋掉。
- 純 `MODEL_GOVERNANCE` 不要求 Astra/Fable Final Risk。

## 8. Production DB：只讀平常做，寫入只走 machine policy gate

Project 固定：`egehnijjpgijmccagxac`。

```text
AUTHORIZATION_MODE: POLICY_APPROVED_AUTOMATION_PENDING
TARGET_MODE: POLICY_GATED_ACTIVE
PER_RUN_OWNER_APPROVAL: REQUIRED_UNTIL_AUTOMATION_READY
```

詳細唯一流程：`docs/PRODUCTION-DB-RELEASE-WORKFLOW.md`。日常 Agent 不必每輪讀它，只有準備
Production DB release 才載入。

寫入前 G0–G7 仍全部有效：

1. release plan / exact main SQL / digest / rollback 鎖定。
2. source + exact-head CI。
3. TEST／Production／rebuild schema、ACL、ledger、依賴差異可解釋。
4. 真實 TEST 正反例與 cleanup，不接受 `POLICY_SKIP`。
5. 備份／復原證據。
6. 獨立高風險 review。
7. writer 當下 project／lock／receipt／baseline recheck。
8. apply 後 live readback，才可 `APPLIED_VERIFIED`。

`AUTOMATION_READY=false` 時維持 bootstrap Owner gate；只有 trusted-main executable evidence 真的證明
`AUTOMATION_READY=true` 後，才自動切成 `POLICY_GATED_ACTIVE`。候選 branch 不能核准自己。

## 9. PR lifecycle、Completion Truth 與 shipped truth

### 9.1 `CLOSED` 不等於 shipped

Product Slice 必須五階全成才算 `shipped_unit`：

```text
SOURCE_VERIFIED
→ MERGED_TO_MAIN
→ AUTO_VERCEL_DEPLOYED
→ PRODUCTION_SCHEMA_READY
→ AUTHENTICATED_PRODUCTION_ACCEPTED
```

沒有 schema 需求時 `PRODUCTION_SCHEMA_READY=not_required` 可成立，但仍要有 live evidence。
缺最後幾階的 closed Issue 是 `PRODUCTION_PENDING`，**不是錯誤資料，也不應讓整輪 Scorecard 作廢**；
它只是尚未 shipped。

### 9.2 Completion Truth

宣稱 merge、close、CI 全綠、migration、deployment 或 main 落地前，都要重新讀外部狀態。

`MERGED_TO_MAIN` 至少要有：

```text
PR merged=true / merged_at
merge_commit_sha
current main head
merge commit 對 main 可達
after-merge ref=main 關鍵檔案重讀
```

只送出 API 或看到 branch commit 只能記 `*_REQUESTED_UNVERIFIED`。

### 9.3 Janitor / parked

- 同一 Issue 只保留一張 active implementation；必要時一張短命 validation。
- `PARKED` 不派 Agent、不 push、不 rerun、不輪詢。
- 自動關閉需要 explicit supersedes + ancestry／patch coverage + close evidence；不確定就 `JANITOR_REVIEW`。

## 10. Run Ledger 與 Scorecard：raw first、machine derived

每個 Product Run 維持兩檔：

```text
docs/metrics/agent-runs/<RUN_ID>.json   # 原始帳本
docs/metrics/agent-runs/<RUN_ID>.md     # 由 score tool 產生
```

初始化／驗證：

```text
npm run agent:run:init -- --run-id <RUN_ID> --closeout-owner PRODUCT_MAIN_SESSION
npm run agent:run:validate -- <run.json>
```

目前**唯一 Scorecard 入口**：

```text
npm run agent:run:score -- <run.json>
npm run agent:run:review -- docs/metrics/agent-runs
```

`agent:run:score` 會自動選 profile，不要求 Agent 手動選版本：

```text
已在 2026-09-15T00:00:00Z 前結束的歷史 terminal Run → LEGACY_V2 原樣重播
2026-09-15T00:00:00Z 起結束的新 v4 Product Run           → OBSERVED_V1
```

歷史 ledger／score 不回寫，不因新公式變漂亮。

### 10.1 必須即時記的是「原始事件」，不是人工百分比

事情發生當下記：

- `modelUsage.tasks`
- Luna／Terra／Sol 實際任務與 accepted 狀態
- `ci.fullCiRuns`、`ci.invalidReruns`、shared TEST collision
- Issue start／close、carryover
- closure sweep／advance
- active-candidate／Terra／shared-TEST peak
- duplicate scan/task、ownership collision、reopen／regression／safety event
- Completion Truth claims 與 durable evidence ref

**不要在收尾時回想並填「大概 80%」**。

以下 legacy 百分比保留為 supplemental telemetry，能直接觀測才填；沒有 denominator 就留 `null`：

```text
modelUsage.weightedUsageImprovementPercent
ci.firstPassRatePercent
quality.acceptanceEvidenceCoveragePercent
quality.auditFirstPassRatePercent
flow.lunaDelegationRatePercent
flow.waitTimeConvertedPercent
auditability.evidenceFieldsCompletePercent
auditability.exactHeadTestCoveragePercent
auditability.preciseBlockersPercent
auditability.scoreInputsCompletePercent
```

它們**不再是新 Run 的 grading hard gate**，也不得用預設 0／50／100 補猜。

### 10.2 OBSERVED_V1 怎麼得到真實數字

新 terminal Product Run 只從 durable raw facts 衍生：

- cycle time = `startedAt → endedAt`
- Luna 採用率 = `lunaAccepted / lunaTasks`
- closure conversion = `closureAdvancedOrClosed / closureSweeps`
- Production stage coverage = verified closed Issue 的五階完成比例
- claim evidence coverage = Completion Truth 中有 durable evidence 的 verified claims 比例
- completion = shipped / owner-blocked / carryover 的真實 outcome，不把 PR merge 當 shipped
- waste = invalid rerun、duplicate scan/task、full context replay、ownership collision
- quality = P0/P1、reopen、post-merge regression、safety violation

所以「沒有人工百分比」不再等於「沒有分數」。

### 10.3 仍然 fail closed 的條件

下列任一成立，新 Run 仍 `NOT_GRADED` 或 `F-HARD`：

- Run 尚未 terminal；
- v4 closeout 不完整（endedAt、main end SHA、結束 inventory、durable closeout evidence 缺失）；
- `completionTruth.status != VERIFIED`；
- 缺 verified `RUN_COMPLETE`；
- 新 Run `modelUsage.tasks=[]`，代表沒有事件時埋點；
- verified claim 沒有可用 evidence／Issue identity 不一致；
- claimed state 與 live observed state 矛盾；
- safety violation 或 hard-fail reason。

**Production pending 不再等於 Scorecard 不可用。** 它會降低 completion／stage coverage，但可以被真實量化。

### 10.4 Governance Scoreboard 是另一張表

Product Delivery Score 與 Governance Scoreboard 分開。純治理仍依
`docs/GOVERNANCE-SCOREBOARD.md`／policy 與 durable governance review evidence 評估；不得把 Product
Observed Score 冒充 Governance 分數，也不因 Product 有分數就跳過治理 evidence。

## 11. 復盤與下一輪調整

Owner 說「復盤／複盤」時載入 retrospective skill。復盤優先回答：

1. Completion Truth 是否可信。
2. 最新 terminal Product Runs 是否可用 `agent:run:review` 比較。
3. Governance Scoreboard 是否有合格治理 Run。
4. provider／Production／TEST 是否與 GitHub 敘述一致。
5. 哪些摩擦沒有增加產品安全。

每輪最多提出 1～2 個治理調整；不要因一次復盤再造一套新流程。

## 12. 停止條件

只有以下情況可送終止性 final：

1. 所有本 scope 可自主完成工作已完成、合併、按 Workstream 驗證；或
2. 剩餘只是真 Owner／外部／Production／合法 final gate，且沒有其他可安全推進的 MAIN、Closure、
   TEST handoff、backlog 或 active governance work；或
3. 平台確實無法繼續，且留下 exact branch/head/PR/error/next step checkpoint。

結束前重查 open Issue／PR、current main、required CI、TEST holder、Owner blockers、active governance、
Run closeout。**status update 不是停止條件。**

---

### 操作原則摘要

```text
少讀重疊文件，不少做安全檢查。
記原始事件，不手填漂亮百分比。
Scorecard 缺真相就不打分；缺可推算百分比不再整輪報廢。
CLOSED 是進度，Production accepted 才是 shipped。
治理的成功是減少摩擦，不是增加欄位。
```
