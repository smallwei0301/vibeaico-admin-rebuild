# Agent 常駐自主執行規則

> Owner 首次裁示：2026-08-28
>
> 最近更新：2026-09-14
>
> 現行 Product B+ 以本文件為單一操作入口。歷史基線見
> `docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`；後續已收斂裁示包含：
> 2026-09-07 交付完成／v4 結案／條件雙 Terra、2026-09-09 active candidate 上限、
> 2026-09-10 lane 對應模型層級／多環境 base freshness／Product Final Risk，以及
> 2026-09-11 雙 Workstream 與純治理模型解綁。
>
> 最新 Production DB 授權裁示：`docs/decisions/2026-09-14-owner-production-db-policy-gate.md`；見 §3.2。
>
> 本文件是本 repo 的 Agent 執行方式唯一正式版本。產品規格仍以各
> `docs/integration/**` 分冊為準；Owner Decision 保留「為什麼改」，本文件負責「現在怎麼做」。
>
> **產品交付鏈路**（每一關要抓什麼、通過的證據長什麼樣）另見 `docs/DELIVERY-CHAIN.md`：
> 本文件規範**執行模式與 WIP 上限**，該文件規範**交付流程與證據標準**，兩者互補。

## 1. 預設工作模式

- 主 Agent 是專案主導者，不只是回報者。收到 Issue、`/goal` 或「繼續」後，持續完成
  所有安全且可自主施工的工作，直到符合 §11 停止條件。
- CI、TEST、Preview、Agent 或外部讀取正在等待，不代表整個 goal 暫停；但也不得因此
  再開第二條完整大型 Terra 工地。
- 每次接手先讀 live GitHub：current `main`、open Issue、open PR、exact head、CI、
  shared TEST holder 與最新 scorecard。舊對話只當線索。
- 優先接續既有可用 branch／PR，不 reset、force-push 或重做已完成的 migration／測試。

### 1.1 Owner 控制訊號

```text
OWNER_MODEL_SWITCH    Owner 為切換模型速度、深度或角色而重送 /goal
OWNER_STEER           Owner 改變限制、授權或方向
OWNER_CONTINUE        Owner 要求同一工作繼續
AGENT_PREMATURE_STOP  Agent 明確終止，但當時仍有可施工工作
UNKNOWN_CONTROL_EVENT 證據不足
```

Owner 重送 `/goal`、`/steer` 或「繼續」本身不等於前一位 Agent 提早停止。模型切換後保留
branch、PR、exact head、TEST lane、Run ID 與目前 stage。

### 1.2 先分 Workstream，再選流程

所有新 Issue／PR 必須有且只有一個：

```text
WORKSTREAM: PRODUCT_MAINLINE
```

或：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

- 使用者可見功能、API/runtime、schema/migration、tenant data、payment/refund、
  LINE/provider、Product deployment、跨 repo Product contract → `PRODUCT_MAINLINE`。
- 模型治理、Agent orchestration、WIP／PR lifecycle、governance CI、scoreboard、
  model routing、governance evidence → `MODEL_GOVERNANCE`。
- 混合範圍優先拆 PR；拆不開且碰 Product runtime／schema／付款／LINE／部署／跨 repo
  Product contract 時，整張按 `PRODUCT_MAINLINE` 處理。
- `PRODUCT_MAINLINE` 走 Product B+。
- `MODEL_GOVERNANCE` 不啟動 Product Terra／Reserve／dual-Terra，也不要求 Product Final Risk；
  改走 bounded governance flow：

```text
current truth
→ bounded governance implementation
→ source CI / regression tests
→ final exact-diff verification / counterexample review
→ merge / closeout
```

純治理依 2026-09-11 #360 不指定執行模型；`requested=not_requested`，沒有可靠來源時
`actual=unknown`。取消模型門檻不代表取消驗證。

## 2. 強制開工順序

1. `git fetch origin --prune`。
2. 從 `origin/main` 讀 `AGENTS.md`、`CLAUDE.md`、本文件、`docs/MODEL-ROUTING.md`、
   `docs/AGENT-BPLUS-DELIVERY-LOOP.md`、`docs/DOCUMENTATION-GOVERNANCE.md`、
   `docs/OWNER-DECISIONS.md` 與比本文件更新的 Owner Decision。
3. 先確認 `WORKSTREAM`；只有 `PRODUCT_MAINLINE` 才套 Product B+ lane／model／Final Risk 規則。
4. 讀 Issue 指定的 canonical 文件與 `docs/integration/12-TESTING-TDD.md`；Playbook 只搜尋
   直接相關錯誤或領域，不全量重讀。
5. 讀最新 1～3 份 `docs/metrics/agent-runs/*.json`／`.md`，確認上一輪建議與尚未修正問題。
6. Product Run 建立或接續 `RUN_ID`，記錄 main、open Issue／PR、lane、TEST holder 與 usage 基準。
7. Product B+ 由多位 Luna 做窄範圍盤點，再由一位 Luna Aggregator 去重。
8. Sol 只根據精簡包選 MAIN、可選 RESERVE 與 Closure target；雙 Terra 只能在 Guard 對兩條候選都判定 qualified 後啟動。

### 2.1 Branch base freshness 現行規則

- 新施工從當下 current `main`，或已具備必要 canonical decisions 的指定 integration branch 開始。
- 工作分支建立後，不得只因無關的 main 前進就 rebase／重建。
- 只有 material migration-ledger change／prefix collision、實際 merge conflict、
  shared contract 或 acceptance precondition 改變，或 CI 證據顯示新 base 會實質影響候選時，
  才 re-align。
- `HEAD^ == origin/main` 不是全域必要條件。

## 3. 長期授權與禁止事項

| 動作 | 預設權限 | 必要條件 |
|---|---|---|
| 讀 repo、Issue、PR、CI、Preview、報告 | 允許 | 使用 live 狀態，不洩漏秘密 |
| 修改程式、測試、文件；建立 branch、commit、PR | 允許 | 遵守 Workstream、B+／治理流程、Issue 範圍與文件治理 |
| 更新 PR／Issue 證據與標籤 | 允許 | 必須是 exact-head 真實證據 |
| 關閉 Issue | 允許 | 最終分支含實作，且依所屬 Workstream 的驗收／review 成立 |
| TEST Supabase 操作 | 允許 | 僅限 §3.1 TEST project，且持有唯一 TEST lane |
| Vercel Preview 驗證 | 允許 | 不提升 Production |
| docs-only 輕量路徑 | 允許 | 只在文件治理白名單內；**不得繞過 live branch protection**，若 main 要求 PR／required checks 就正常走 PR |
| 程式／workflow／skill 合併 main | 需明確任務授權 | CI、Audit、安全邊界成立；不得偷渡產品發布 |
| Production DDL／DML／migration | **staged policy gate** | §3.2；`AUTOMATION_READY` 前沿用現行逐次 Owner gate，ACTIVE 後改由機器關卡放行，不需逐次人工批准 |
| Production reset／seed／災難性刪除 | **禁止** | 不在 §3.2 允許範圍，不能藉人工同意跳過關卡 |
| Production deployment／promote／流量切換 | **禁止** | 需新授權 |
| 真實付款、退款、訂單或顧客通知 | **禁止** | 測試只用 sandbox、mock 或明確安全接收者 |
| 輸出或提交 token、密碼、key、完整 `.env` | **禁止** | 秘密只在執行環境短暫使用 |

### 3.1 TEST Supabase 長期授權

僅限 project ref：`nmwhwngojosmagjuvxol`。

每次必須：

1. 重新確認 project ref。
2. 記錄 migration／schema 基線與 exact head。
3. API schema 變更後刷新 PostgREST cache 並跑真實目標查詢。
4. reset／seed 只清 TEST 測試資料。
5. 不呼叫真實付款或通知。
6. 全 repo 同時只有一位 `TEST_VALIDATION` holder。

### 3.2 Production 資料庫：Machine Policy Gate（分階段啟用）

Owner 2026-09-14 裁示見 `docs/decisions/2026-09-14-owner-production-db-policy-gate.md`。
唯一詳細流程是 `docs/PRODUCTION-DB-RELEASE-WORKFLOW.md`；本節是日常操作入口，不維護第二份不同的門檻。

```text
AUTHORIZATION_MODE: POLICY_APPROVED_AUTOMATION_PENDING
TARGET_MODE: POLICY_GATED_ACTIVE
PER_RUN_OWNER_APPROVAL: REQUIRED_UNTIL_AUTOMATION_READY
PRODUCTION_PROJECT_REF: egehnijjpgijmccagxac
PRODUCTION_FINAL_RISK_REQUIRED: true
```

只授權本 repo 明確範圍內的相容式 migration、結構／權限修復及可復原的有界非金流資料回填。
正式庫套用、資料修復與執行器接線屬 `PRODUCT_MAINLINE`，不能借純治理免審查規則放行。
其他 Production 專案、網站發布、真實付款／退款、顧客通知與 LINE 仍依原本領域授權。
正式庫 reset／seed、災難性刪除、不可復原的資料變更不在本政策允許範圍。

| 關卡 | 沒有此證據就停止 |
|---|---|
| G0 計畫鎖定 | 唯一 release ID、精確 main SQL 與 digest、相依、對象、筆數上限、復原及副作用範圍 |
| G1 來源與 CI | canonical migration 已在 current main；實際 SQL 相同；必要 CI／schema tests 真正執行 |
| G2 資料庫一致性 | 重建標準、TEST、Production 的結構／權限／帳本及依賴逐項比對；未解釋差異為零 |
| G3 真實 TEST | 空白重建、正式庫形狀升級、正反例、必要 API／E2E、重跑及清理證據；不是 POLICY_SKIP |
| G4 備份與復原 | 可用且涵蓋範圍正確的備份、復原演練、線上相容與健康檢查 |
| G5 高風險審查 | 獨立執行允許模型，對本次操作計畫與正式庫基線留下可驗證 PASS |
| G6 寫入前再次檢查 | trusted-main 機器驗證、單次限時回執、正確 project、跨工具互斥鎖與基線重查 |
| G7 套用後回讀 | 實際結構、權限、資料／帳本及安全通路驗證相符，才能 APPLIED_VERIFIED |

在 `AUTOMATION_READY` 前，G0–G6 全成仍保留現行逐次 Owner gate，作為 bootstrap safety。當 trusted-main executable policy 證明 `AUTOMATION_READY=true` 且 `PRODUCTION_DB_AUTHORIZATION_MODE=POLICY_GATED_ACTIVE` 後，G0–G5 及寫入當下 G6 全成即可由受控執行器套用，不需再等 Owner 逐次「同意」。此切換不需要 Owner 第二次啟用裁示。
一個 observer MATCH、main merge、CI 綠燈、人工 checkbox 或舊 source review 都不能單獨授權。
精確的待套用差異／受審查修復走詳細流程，不要求「先完全一樣才能修」，也不允許籠統豁免。
缺證據、審查、備份或執行器時，分別記 EVIDENCE_BLOCKED、REVIEW_BLOCKED、
RECOVERY_BLOCKED、IMPLEMENTATION_BLOCKED／EXECUTION_BLOCKED。automation pending 期間若其餘技術關卡已全成，才可如實記 `BOOTSTRAP_OWNER_GATE_PENDING`；ACTIVE 後不得再把逐次 Owner approval 列成常態 blocker。

遠端只套 main SQL 的規則不變。新 schema 使用「資料庫準備」與「功能啟用」兩段：
先隔離演練與必要 source review／CI，再合併不會啟用相依程式的 schema 準備，
之後套 canonical TEST 並驗收，再走正式庫關卡；正式 schema ready 後才啟用相依功能。
一般 Product 驗收不變；既有 guard 不支援安全分段時先補接線，不繞過檢查。

**政策制定不等於自動化已上線。** 本文件不建立生產排程、憑證或可寫工作；
完整 gate／writer／備份／審查／互斥鎖未經實作驗證前，不得宣稱 AUTOMATION_READY 或直接套用。
所有舊文件的逐次人工 DB 授權敘述，在 automation pending 期間仍是 bootstrap safety；trusted-main 證明 ACTIVE 後，才在上述精確範圍內由新裁示自動取代。

## 4. Product B+ 角色與模型路由

本節只適用 `PRODUCT_MAINLINE`。

```text
LUNA_FAN_OUT → LUNA_FAN_IN → SOL_TRIAGE
                         ↓
               MAIN_TERRA BUILD（條件雙 Terra）
                         ↓
                 EARLY_SOL_DIFF_AUDIT
                         ↓
                  TEST_VALIDATION
                         ↓
                 FINAL_SOL_AUDIT
                         ↓
              LUNA_CLOSEOUT + METRICS
                         ↓
                     NEXT LOOP
```

| 角色 | 主要工作 | OpenAI | Anthropic | 禁止事項 |
|---|---|---|---|---|
| Luna / scout | 真實盤點、Closure、CI 摘要、Janitor、文件、QA、Metrics | `gpt-5.6-luna` | `claude-haiku-4-5` | 不做產品／安全決策，不展開大型 code |
| Terra / build | Product 施工（MAIN／RESERVE） | `gpt-5.6-terra` | `claude-sonnet-5` | 不擴大驗收、不自行關 Issue |
| Sol / audit | TRIAGE、早期 diff audit、模糊 CI、高風險設計、final Audit | `gpt-5.6-sol` | `claude-opus-5` | 不做 grep、輪詢、一般 CRUD、完整舊對話重讀 |

Product lane 決定層級，層級決定模型。Terra 一律使用 build 層；拿 audit 層模型施工或 scout
層模型施工都要如實記為 routing violation。平台無法證明 actual model 時填 `actual=unknown`，
不得由 lane 名稱推定。

## 5. 全域 B+ WIP 上限

```text
MAIN_TERRA       預設 max 1；Guard 對兩條完整候選皆 qualified 時 max 2 → AGENT_LANE=TERRA_BUILD
RESERVE_TERRA    max 1；雙 Terra 時固定 0 → AGENT_LANE=TERRA_RESERVE
LUNA_CLOSURE     max 1 → AGENT_LANE=LUNA_CLOSURE
TEST_VALIDATION  max 1 → AGENT_LANE=TEST_VALIDATION
ACTIVE_CANDIDATE max 3 → 通常 MAIN + Closure，第三張留給併行的第二條產品線
LUNA_TASKS       default 4，max 6，另有 1 位 Aggregator
```

### 5.1 MAIN_TERRA

- 預設唯一可完整施工、進 shared TEST、修明確 CI、交 Sol audit 的中大型 Issue。
- 雙 Terra 是條件例外：同一 `RUN_ID` 的兩張候選必須有不同 primary Issue、`TERRA_SLOT` 1／2、
  `TEST_ENV_ID`、零重疊 `FILE_OWNERSHIP`、各自健康的 local isolated 證據，且 Guard 在啟動前
  判定 qualified；任一項失敗立即回到一條。雙 Terra 時 Reserve 固定為 0。
- 必須一路做到 `CLOSED`、`AUDIT_READY` 或完整 `OWNER_BLOCKED`。
- `PR 已開`、`CI 綠`、`正在等 Preview` 不是完成。
- MAIN 未抵達出口前，不啟動第二條完整 BUILD，除非上述 Guard 已同時放行雙 Terra。

### 5.2 RESERVE_TERRA

- 只有 MAIN 正在等 CI、TEST、Preview 或外部唯讀結果，且 MAIN 沒有可繼續的 source 工作時
  才可啟動。
- 必須明寫 `RESERVE_BOUNDARY`。
- 只做必要規格、紅燈測試、獨立 source slice、unit／typecheck／build、最多一個原子 commit。
- 不得持有 TEST lane、進 Sol Audit、開第二輪 full CI、碰 MAIN hot files或吸入鄰近問題。
- 完成後停在 `READY_FOR_PROMOTION`；MAIN 進入出口後由 Sol 決定升格或 Park。

### 5.3 LUNA_CLOSURE

- 每輪固定執行；優先掃 open PR、近期 CI、上一輪 closeability ≥3 候選，先限 5 個。
- 可整理 exact-head 證據、checkbox、Preview、Janitor、機械 closeout。
- 沒有候選必須輸出 `EMPTY_WITH_SCAN` 和已檢查清單。

### 5.4 ACTIVE_CANDIDATE

- 全 repo 最多 3 張（Owner 2026-09-09 由 2 調整），通常是 MAIN、Closure，第三張留給併行的第二條產品線。
- RESERVE、TEST、Parked、Historical、Owner-blocked 不得標 active candidate。
- 舊 Mode C PR 不是因為 open 就自動 active；必須經 B+ TRIAGE 重新分配。

## 6. Luna 小隊與 Token 節流

預設可並行：

```text
LUNA_TRUTH
LUNA_CLOSURE
LUNA_CI
LUNA_JANITOR
LUNA_DOCS
LUNA_QA
LUNA_METRICS
```

每個 Luna 任務必須包含：

```text
TASK_ID
ISSUE / PR
EXACT_HEAD
單一 QUESTION
READ_ONLY_PATHS
DO_NOT_READ
OUTPUT_MAX_LINES（預設 15）
ALLOWED_RESULT
```

- 不把完整舊 Session 或全 repo 複製給每位 Luna。
- 不讓兩位 Luna 重做同一盤點。
- 一位 Luna Aggregator 把結果壓成最多 30 行再交 Sol。
- Luna 發現新問題只分類為 blocking／backlog／duplicate／Owner-blocked／needs-triage；不得
  自行把所有問題塞進 MAIN PR。

## 7. Sol 使用上限與 Product Final Risk

一般 Issue：

```text
TRIAGE 1 次
AUDIT  1 次
```

只有 Auth、DB、付款、權限、跨租戶、安全、模糊 CI 或重大 collision 才允許一次額外
DIAGNOSE。平台不能證明實際 delegated model 時記 `actual=unknown`，不得冒充。

TRIAGE 固定輸出：

```text
RUN_ID
MAIN_TERRA
RESERVE_TERRA
CLOSURE_TARGET
CLOSEABILITY_SCORE
SELECTION_REASON
DEPENDENCIES
OWNER_OR_EXTERNAL_BLOCKER
TEST_REQUIRED
RESERVE_BOUNDARY
RISK
ACCEPTANCE_GATES
WHY_NOT_CLOSER_CANDIDATE
```

Closeability：5 幾乎可關；4 差一步；3 最多兩步可 Audit；2 需明顯施工；1 主要外部或
大型依賴；0 stale／duplicate／superseded。

### 7.1 Early Sol 與 final Sol 不可混用

- Terra 有可審完整 diff 後可做一次 early Sol diff audit。
- early audit 只能給建議或 `FIX_REQUIRED`，不得 `CLOSE_APPROVED`。
- 必要修正、local isolated／canonical TEST 完成後，final Sol 必須對 final exact head 重讀。
- head 真正改變時不得拿 early verdict 當放行。

### 7.2 Product Final Risk

Product 高後果範圍才需要 Final Risk，例如：

- `PAYMENT_CONSISTENCY`
- `TENANT_AUTH_BOUNDARY`
- `IRREVERSIBLE_DATA`
- `CROSS_REPO_CONTRACT`
- 不可拆的 `GOVERNANCE_GATE`
- `UNRESOLVED_HIGH_RISK`

現行預設 `claude-fable-5-1`；allowlist 另含 `gpt-6-astra`，實際值永遠以 trusted-main
`scripts/agents/model-routing.json` 為準。

- 一般 UI、文案、小型接線不因是 Product PR 就自動要求 Final Risk。
- 正式庫寫入是 §3.2 的獨立操作關卡：本次 Production DB release 一律要高風險審查，不能只沿用 source PR 的免審分類。
- Final Risk 綁 `changeDigest`／實質 changed-file blobs，不因無關 main 前進或純 rebase 自動重跑 semantic review。
- 最新 `FIX_REQUIRED`／`CHANGES_REQUESTED`／`DISMISSED` 不得被較舊 PASS 蓋掉。
- 純 `MODEL_GOVERNANCE` 不要求 Astra/Fable Final Risk。

## 8. CI 與 shared TEST

- docs-only 不安裝 npm、不讀 TEST secret、不跑 Chromium。
- 一般 runtime PR 跑 typecheck／unit／build，但若不是唯一 Active `TEST_VALIDATION` holder，
  integration／E2E 留下成功的 `POLICY_SKIP`，不得碰 shared TEST。
- 只有唯一 TEST holder 與 `main` push 可以使用 TEST secrets 並進
  `shared-test-supabase-integration`。
- Branch 手動 full CI 必須證明 exact PR、exact branch、exact SHA 與唯一 holder。
- 同一 exact head、同一環境、同一命令不盲目重跑。
- 環境錯誤連續兩次後停止該路徑，保存證據並切其他安全工作。
- 任何 Git Data API／遠端 tree 重建完成後，必須先驗證 exact head：
  `npm run guard:repo-integrity` → `npm ci` → `npm run typecheck` → `npm test` →
  `npm run build`。前一步未通過，不得更新 `preview/**`、不得把 Vercel build 當第一道語法檢查，
  也不得用另一個 no-op commit 重試。
- 完整性閘門至少驗證 `package.json`、`package-lock.json`、`src/app/`、`src/server/` 仍存在，
  刪檔量未超過安全上限，且受控程式檔沒有單獨一行的 40 碼 Git SHA。
- 相依套件只接受 lockfile 可重現的版本；`package.json` 與 `package-lock.json` 一起改，乾淨
  `npm ci` 是必要證據。不存在的版本、peer 衝突或 lockfile 不一致都在 Preview 前停止。

CI 失敗由 Luna 先壓縮：exact head、job／step、suite／case、錯誤碼、重現性、TEST holder、
環境變化。明確 code bug 交 MAIN Terra；模糊或高風險才交 Sol。

## 9. PR、Janitor、Completion Truth 與交接

- 一個 Issue 只保留一張 ACTIVE implementation；必要時一張短命 VALIDATION。
- `PARKED` PR 不派 Agent、不 push、不 rerun、不輪詢；重新啟動前先依所屬 Workstream 重新 TRIAGE。
- Janitor 只有 explicit supersedes、同 Issue、同 repo、ancestry／patch coverage 與 mutation
  前重新驗證都成立才自動關；否則 `JANITOR_REVIEW`。
- 交接只傳 Issue、stage、lane、base/head、PR、scope、changed、evidence、latest error、
  TEST、risk、unproven、next、requested／actual model、RUN_ID 與 scorecard path。
- 不貼整份 CI log，不複製完整舊對話。

### 9.1 `CLOSED` 不等於 shipped

Product Issue 只有以下五階全部成立，才可計為 `shipped_unit`：

```text
SOURCE_VERIFIED
→ MERGED_TO_MAIN
→ AUTO_VERCEL_DEPLOYED
→ PRODUCTION_SCHEMA_READY
→ AUTHENTICATED_PRODUCTION_ACCEPTED
```

最後一階必須是登入正式站後的真實接受測試。缺任一階就是 `PRODUCTION_PENDING` 或其他未完成狀態；
PR merged、CI 綠、Issue closed 都不能單獨冒充已出貨。

涉及新資料庫依賴時，§3.2 的安全執行順序優先：先 PRODUCTION_SCHEMA_READY，再啟用相依程式。
上列五項交付證據仍全數必要，不授權網站先啟用、之後才補資料庫；歷史帳本與評分不回寫。

### 9.2 Completion Truth

宣稱 merge、close、CI 全綠、migration 套用、部署或檔案已進 main 前，必須重新讀外部狀態。
宣稱 `MERGED_TO_MAIN` 至少包含：

```text
PR merged=true / merged_at
merge_commit_sha
current main head
merge commit 對 main 可達
after-merge ref=main 關鍵檔案重讀
```

只送出 API 或只看到工作分支，只能記 `*_REQUESTED_UNVERIFIED`；不得把請求成功當成完成。

## 10. Ledger、Scorecard 與復盤

每輪提交：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

JSON 是原始帳本，Markdown 必須由既有 `scripts/agents/score-run-v2.mjs` 重算。新 Run 用既有
`scripts/agents/run-ledger-v2.mjs init --closeout-owner ...` 建立 schema v2／`deliveryTruthVersion: 4`；
schema v1 與歷史 DeliveryTruth v2／v3 僅可唯讀重算，不得改寫。final v4 Run 必須依腳本通過
`closeout.state=CLOSED`、`closedAt=endedAt`、main end SHA、結束 inventory 與 durable evidence 的驗證。

以下量必須在事件發生時即時寫入，不在 closeout 時倒推：

- `modelUsage.tasks`
- `flow` 的 Luna／Sol／Terra 委派計數
- `ci.fullCiRuns`
- `delivery.issuesStarted` / `delivery.issuesClosed`

至少記錄：

- main、open Issue／PR 起訖；
- MAIN／RESERVE／candidate／TEST 峰值；
- requested／actual Luna、Terra、Sol 任務與上下文大小；
- 實際 token／週 usage，或明確 `unavailable`；
- internal weighted usage（Luna=1、Terra=3、Sol=6，非官方換算）；
- `CLOSED`、AUDIT_READY、完整 OWNER_BLOCKED、carryover，以及 `CLOSED` 但仍 `PRODUCTION_PENDING` 的數量；`CLOSED` 不得單獨計入 shipped units；
- full CI、invalid rerun、品質、安全、Luna 採用率、Sol touches；
- 100 分 scorecard 與最多 2 項下一輪調整。

Owner 說「復盤」或「複盤」時，載入
`.agents/skills/vibeaico-agent-retrospective/SKILL.md`，驗證並比較最近 3 輪；資料不足則讀全部。
只提出一到兩項最有影響的治理改良，不在復盤時順便改產品。

## 11. 停止條件

只有以下情況可送終止性 final：

1. 所有 open Issue 都完成、合併到要求分支並依各自 Workstream 正確關閉；或
2. 剩餘項目只缺 Owner／外部人類／Production／合法 final gate，且 Product MAIN、RESERVE、
   Closure、TEST、可施工 backlog 與 active governance work 都已處理；或
3. 平台無法繼續，且已留下可直接接手的 exact checkpoint 與本輪 IN_PROGRESS report。

結束前重新查 open Issue、open PR、CI、MAIN、RESERVE、Closure、TEST holder、Owner blockers、
active governance work 與本輪 scorecard。最終報告不得只寫「目前進度」。
符合 §3.2 的 DB 變更在 `POLICY_GATED_ACTIVE` 後不再以逐次人工批准為停止理由；automation pending 期間保留 bootstrap gate，技術關卡未過則保留其真實阻塞。
