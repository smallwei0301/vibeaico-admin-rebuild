# Agent 常駐自主執行規則

> Owner 首次裁示：2026-08-28
>
> 最近更新：2026-09-15
>
> 現行 Product B+ 以本文件為單一操作入口。歷史基線見
> `docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`；後續已收斂裁示包含：
> 2026-09-07 交付完成／v4 結案／條件雙 Terra、2026-09-09 active candidate 上限、
> 2026-09-10 lane 對應模型層級／多環境 base freshness／Product Final Risk、
> 2026-09-11 雙 Workstream 與純治理模型解綁，以及
> 2026-09-15 BUILD／VERIFY 分離與 continuous refill。
>
> 最新 Production DB 授權裁示：`docs/decisions/2026-09-14-owner-production-db-policy-gate.md`；見 §3.2。
> Product throughput 裁示：`docs/decisions/2026-09-15-owner-build-verify-continuous-refill.md`；見 §5。
>
> 本文件是本 repo 的 Agent 執行方式唯一正式版本。產品規格仍以各
> `docs/integration/**` 分冊為準；Owner Decision 保留「為什麼改」，本文件負責「現在怎麼做」。
>
> **產品交付鏈路**（每一關要抓什麼、通過的證據長什麼樣）另見 `docs/DELIVERY-CHAIN.md`：
> 本文件規範**執行模式與 WIP 上限**，該文件規範**交付流程與證據標準**，兩者互補。

## 1. 預設工作模式

- 主 Agent 是專案主導者，不只是回報者。收到 Issue、`/goal` 或「繼續」後，持續完成
  所有安全且可自主施工的工作，直到符合 §11 停止條件。
- CI、TEST、Preview、Agent 或外部讀取正在等待，不代表整個 goal 暫停。Product source work
  與 VERIFY tail 分離：有第二張 qualified、非重疊候選時，應補滿可用 BUILD slot，而不是
  因另一張候選正在 CI／TEST／Final Risk／merge 就把施工線一起停住。
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
  改走 bounded governance flow。Governance PR 仍驗自己的 metadata、scope 與 regression，
  但不因其他 Product PR 的 Terra／Reserve／TEST／candidate global-WIP 錯誤被連坐阻擋；
  Product PR 的 global WIP 檢查保持完整。

```text
current truth
→ bounded governance implementation
→ source CI / regression tests
→ final exact-diff verification / counterexample review
→ merge / closeout
```

純治理依 2026-09-11 #360 不指定執行模型；`requested=not_requested`，沒有可靠來源時
`actual=unknown`。取消模型門檻不代表取消驗證。

## 2. 強制開工順序（低摩擦 default entry）

原則：**本文件是 default execution entry，不再每輪無條件重讀整套治理背景。** 安全規則沒有減少，改成依任務 trigger 載入，降低 context、時間與「讀太多反而用錯舊規則」的摩擦。

每次接手固定只做：

1. `git fetch origin --prune`，從 live GitHub 重建 current `main`、open Issue／PR、exact head、CI、shared TEST holder。
2. 從 `origin/main` 讀 `AGENTS.md`、`CLAUDE.md`、**本文件**、`docs/OWNER-DECISIONS.md` 中與本 Issue／領域直接相關的現行裁示，以及比本文件更新且命中本範圍的 Owner Decision。
3. 先確認 `WORKSTREAM`；只有 `PRODUCT_MAINLINE` 才套 Product B+ lane／model／Final Risk 規則。
4. 讀 Issue 指定 canonical 文件與直接相關的 integration／testing 章節；Playbook 只搜尋本次錯誤、Issue 或領域，不全量重讀。
5. Product Run 建立或接續 `RUN_ID`，記錄 main、open Issue／PR、lane、TEST holder 與 raw-event 基線，並跑一次 §10 Live Scorecard readiness。
6. Product B+ 由窄範圍 Luna/scout 盤點，再由一位 Aggregator 去重；Sol 只根據精簡包選 BUILD candidates、可選 RESERVE 與 Closure target。
7. 若同一 Run 有兩張候選都被 Guard 判定 qualified，`TERRA_BUILD` target occupancy 是 2；只有第二張候選不安全、不獨立或不存在時才降回 1。

以下文件改為 **trigger-based load**，不是每輪 mandatory read：

| 文件／skill | 何時載入 |
|---|---|
| `docs/MODEL-ROUTING.md` | Product lane/model routing、Final Risk、模型層級衝突 |
| `docs/AGENT-BPLUS-DELIVERY-LOOP.md` | 本文件與 B+ 背景規則有衝突、需追溯歷史裁示 |
| `docs/DOCUMENTATION-GOVERNANCE.md` | canonical docs、文件延伸、文件治理範圍 |
| `.agents/skills/**` | 對應任務真的觸發該 skill 時 |
| `docs/AGENT-PLAYBOOK.md` | 以錯誤碼／Issue／領域關鍵字搜尋直接相關條目 |
| 最近 1～3 份 Run | 接續同一 Run、做 score/retro、或需要比較上一輪建議時 |

### 2.0.1 Deterministic metadata：preflight-first

PR body、`TEST_PROFILE`、lane、candidate、Closure、Final Risk metadata 等 deterministic contract，**不得把 remote CI 當互動式表單驗證器**。

```text
填 metadata
→ local / trusted preflight
→ PASS
→ 才 push / dispatch remote CI
```

- metadata 到 CI 才第一次被擋，優先視為 **preflight coverage gap**；補 shared validator／parser，而不是再教每個 Agent 背一段 prose exception。
- metadata 修正不靠 blind rerun；workflow 若不監聽 `edited`，使用既有 `workflow_dispatch` 或下一個**真實內容變更**觸發，不堆 no-op commit。
- 同一 deterministic error 不用多輪 CI 猜合法值；先讀 validator 或讓 preflight 直接呼叫與 CI 相同的判定函式。

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
              TERRA_BUILD SLOT 1
              TERRA_BUILD SLOT 2（qualified 時）
                         ↓ source-complete
                 EARLY_SOL_DIFF_AUDIT
                         ↓
               TEST_VALIDATION / VERIFY
                         ↓
                 FINAL_SOL_AUDIT
                         ↓
              LUNA_CLOSEOUT + METRICS
                         ↓
                     NEXT LOOP
```

BUILD 與 VERIFY 是流水線，不是同一個 slot。某候選進入 VERIFY 後，釋放的 BUILD slot 立即依 §5 continuous refill；不用等該候選完成 Final Risk／merge 才選下一張安全 Product slice。

| 角色 | 主要工作 | OpenAI | Anthropic | 禁止事項 |
|---|---|---|---|---|
| Luna / scout | 真實盤點、Closure、CI 摘要、Janitor、文件、QA、Metrics | `gpt-5.6-luna` | `claude-haiku-4-5` | 不做產品／安全決策，不展開大型 code |
| Terra / build | Product source 施工（BUILD／RESERVE） | `gpt-5.6-terra` | `claude-sonnet-5` | 不擴大驗收、不自行關 Issue |
| Sol / audit | TRIAGE、早期 diff audit、模糊 CI、高風險設計、final Audit | `gpt-5.6-sol` | `claude-opus-5` | 不做 grep、輪詢、一般 CRUD、完整舊對話重讀 |

Product lane 決定層級，層級決定模型。Terra 一律使用 build 層；拿 audit 層模型施工或 scout
層模型施工都要如實記為 routing violation。平台無法證明 actual model 時填 `actual=unknown`，
不得由 lane 名稱推定。

## 5. 全域 B+ WIP 上限

```text
TERRA_BUILD      qualified 時 target 2，hard max 2；沒有第二張安全候選時 fallback 1
RESERVE_TERRA    max 1；雙 Terra 時固定 0 → AGENT_LANE=TERRA_RESERVE
LUNA_CLOSURE     max 1 → AGENT_LANE=LUNA_CLOSURE
TEST_VALIDATION  max 1；唯一 VERIFY / shared TEST holder，且仍是 active candidate
ACTIVE_CANDIDATE max 3 → 正常穩態最多 2 BUILD + 1 VERIFY
LUNA_TASKS       default 4，max 6，另有 1 位 Aggregator
```

### 5.1 TERRA_BUILD

- `TERRA_BUILD` 代表**仍允許 source mutation 的 BUILD slot**，hard max 2。
- 同一 `RUN_ID` 有兩張完整候選，且不同 primary Issue、`TERRA_SLOT` 1／2、不同 `TEST_ENV_ID`、
  零重疊 `FILE_OWNERSHIP`、各自健康 local isolated 證據並經 Guard qualified 時，**預設目標是兩個 BUILD slot 都有工作**；不是等第一張完全 merge 才把第二張當例外打開。
- 若只有一張安全候選、hot boundary 重疊或任一資格失敗，立即 fallback 為單 Terra。雙 Terra 時 Reserve 固定為 0。
- 同一 migration／migration ledger、payment／refund transaction、Auth／RLS／ACL、Production DB writer／release 或其他共享高風險 hot boundary，不得為追求吞吐量強行雙線施工。
- source 完成、可進 exact-head 驗證後，候選必須離開 `TERRA_BUILD`，轉 §5.5 VERIFY tail；不能因還在等 CI／Final Risk／merge 就占著 BUILD slot。
- `PR 已開`、`CI 綠`、`正在等 Preview` 仍不是完成；它們只是不同 pipeline stage。

### 5.2 RESERVE_TERRA

- 只在單 Terra fallback 模式下，MAIN 正在等 CI、TEST、Preview 或外部唯讀結果，且沒有第二張 qualified full BUILD candidate 時才可啟動。
- 必須明寫 `RESERVE_BOUNDARY`。
- 只做必要規格、紅燈測試、獨立 source slice、unit／typecheck／build、最多一個原子 commit。
- 不得持有 TEST lane、進 Sol Audit、開第二輪 full CI、碰 MAIN hot files或吸入鄰近問題。
- 完成後停在 `READY_FOR_PROMOTION`；MAIN 進入出口後由 Sol 決定升格或 Park。

### 5.3 LUNA_CLOSURE

- 每輪固定執行；優先掃 open PR、近期 CI、上一輪 closeability ≥3 候選，先限 5 個。
- 可整理 exact-head 證據、checkbox、Preview、Janitor、機械 closeout。
- 沒有候選必須輸出 `EMPTY_WITH_SCAN` 和已檢查清單。

### 5.4 ACTIVE_CANDIDATE

- 全 repo 最多 3 張（Owner 2026-09-09 由 2 調整）。正常滿載形狀是 **2 BUILD + 1 VERIFY**；實際少於 3 不是錯誤，但有 qualified backlog 時不應無理由留空 BUILD slot。
- `TERRA_BUILD` 與 active `TEST_VALIDATION` 都計入 Product active candidate；`LUNA_CLOSURE` 是 shared closure lane，不吃 Product candidate cap。
- RESERVE、Parked、Historical、Owner-blocked 不得標 active candidate。
- 舊 Mode C PR 不是因為 open 就自動 active；必須經 B+ TRIAGE 重新分配。

### 5.5 TEST_VALIDATION / VERIFY tail 與 continuous refill

- source-complete candidate 轉為：`AGENT_LANE=TEST_VALIDATION`、`LANE_STATE=ACTIVE`、`ACTIVE_CANDIDATE=true`、`TEST_LANE_REQUIRED=true`。它仍是 Product WIP，但**不再占 TERRA_BUILD slot**。
- 全 repo 同時最多一個 VERIFY / shared TEST holder；BUILD 與 VERIFY 必須屬同一 `RUN_ID`，避免把舊 Run 尾巴混入新 Run pipeline。
- BUILD → VERIFY 一成立，空出的 `TERRA_SLOT` 立即重新掃 qualified Product backlog；只要 active candidate 尚未達 3，就 continuous refill 下一張不重疊候選。
- VERIFY lane 是 source-freeze。`synchronize`／新 source commit 必須 fail closed；若 CI／Final Risk 找到要修的 source，先把 candidate 轉回 `TERRA_BUILD`、重新通過 WIP Guard 取得可用 BUILD slot，**之後**才 push 修正。
- VERIFY 等待不允許第二位 shared TEST holder；Final Risk、branch protection、Production DB gate 都不因 continuous refill 放寬。

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
- 只有唯一 TEST holder 與 `main` push 可以使用 TEST secrets並進
  `shared-test-supabase-integration`。
- Active `TEST_VALIDATION` 是 VERIFY source-freeze；它若收到新 commit，trusted WIP Guard 必須失敗。需要修 source 時，先回 `TERRA_BUILD` 並重新取得 BUILD slot。
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
環境變化。明確 code bug 交可用 `TERRA_BUILD`；模糊或高風險才交 Sol。

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

JSON 是原始帳本。schema v2／`deliveryTruthVersion: 4` 新 Run 用
`scripts/agents/run-ledger-v2.mjs init --closeout-owner ...` 建立；schema v1 與歷史 DeliveryTruth v2／v3 僅可唯讀重算，不得改寫。

### 10.1 Current scoring truth：OBSERVED_V1

- `scripts/agents/score-run-current.mjs` 是 current Product Scorecard dispatcher。
- `startedAt < 2026-09-15T00:00:00Z` 的歷史 Run 保持 `LEGACY_V2` replay，不因後來結案而切換算法。
- cutoff 起才開始、terminal + v4 Product closeout 的 Run 使用 `OBSERVED_V1`，直接從 durable raw events 與 Completion Truth 衍生分數。
- legacy manual percentages（如 first-pass、人工 evidence coverage 等）保留為 supplemental telemetry，**不再是新 Product Run 的 grading hard gate**；沒有可信 denominator 就維持 `null`，不得為了評分猜值。
- Completion Truth 未 VERIFIED、沒有 observed task records、矛盾 claim、safety violation／hard fail 仍 fail closed。
- `CLOSED` 但 Production pending 可以被評分，但不算 shipped。

Markdown report 必須由 current dispatcher 重算；不得手工改分數或用舊 `score-run-v2.mjs` 冒充 current profile。

### 10.2 Live Scorecard Contract（不要等複盤才發現沒資料）

Active Product Run 使用：

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json
```

它只檢查 **raw-event capture health**，不產生分數、不參與跨 Run 比較，也不要求 legacy manual percentages。

固定 checkpoint：

1. **Run start**：建立／接續 ledger 後立即跑一次。
2. **Observable event**：accepted/rejected Agent task、full CI、invalid rerun、Audit／Final Risk、TEST collision、安全事件、closure sweep 後，先寫 raw fact，再跑 readiness。
3. **Delivery stage change**：merge、Issue close／owner-blocked、Vercel Production READY、Production schema readiness、authenticated Production acceptance 後，立即寫 Completion Truth evidence，再跑 readiness。
4. **Pre-closeout**：`rawCaptureGaps=[]` 且 `consistencyWarnings=[]` 才進 terminal closeout；已失去的歷史觀測不得用推算或預設 0 補綠。

readiness 會把 `endedAt`、`main.endSha`、end inventory、closeout、Completion Truth 等 active Run 合理尚未具備的欄位列為 `terminalOnlyPending`，**不因它們 pending 而失敗**。

詳細 raw counter consistency 與操作例見 `docs/metrics/SCORECARD-LIVE-READINESS.md`。

### 10.3 事件發生時就記 raw facts

以下量必須在事件發生時即時寫入，不在 closeout 時倒推：

- `modelUsage.tasks`（含 accepted/rejected 與 count）；
- `flow` 的 Luna／Sol／Terra 委派 counters；
- `ci.fullCiRuns`、`ci.invalidReruns`；
- `delivery.issuesStarted` / `delivery.issuesClosed`；
- closure sweep count / advanced-or-closed；
- safety violation、reopen、post-merge regression、shared TEST collision；
- merge／close／Production stage 的 durable Completion Truth claims。

至少保留：

- main、open Issue／PR 起訖；
- MAIN／RESERVE／candidate／TEST 峰值；
- requested／actual Luna、Terra、Sol 任務與上下文大小；
- 實際 token／週 usage，或明確 `unavailable`；
- internal weighted usage（Luna=1、Terra=3、Sol=6，非官方換算）；
- `CLOSED`、AUDIT_READY、完整 OWNER_BLOCKED、carryover，以及 `CLOSED` 但仍 `PRODUCTION_PENDING` 的數量；`CLOSED` 不得單獨計入 shipped units；
- full CI、invalid rerun、品質、安全、Luna／Sol raw events；
- current score profile、scorecard 與最多 2 項下一輪調整。

### 10.4 復盤

Owner 說「復盤」或「複盤」時，載入
`.agents/skills/vibeaico-agent-retrospective/SKILL.md`，驗證並比較最近 3 輪；資料不足則讀全部。

- 只對 terminal + truth-verified + comparison-eligible Product Run 下效率趨勢結論。
- Active Run 可報 Live Readiness，但不得拿 readiness 百分比冒充分數。
- 若新 Run 仍因 raw evidence 缺失而 `NOT_GRADED`，復盤必須指出是**哪個 checkpoint 沒有留下資料**，而不是再用「資料不足」四字結案。
- 只提出一到兩項最有影響的治理改良，不在復盤時順便改產品。

## 11. 停止條件

只有以下情況可送終止性 final：

1. 所有 open Issue 都完成、合併到要求分支並依各自 Workstream 正確關閉；或
2. 剩餘項目只缺 Owner／外部人類／Production／合法 final gate，且 Product BUILD、RESERVE、
   Closure、VERIFY、可施工 backlog 與 active governance work 都已處理；或
3. 平台無法繼續，且已留下可直接接手的 exact checkpoint 與本輪 IN_PROGRESS report。

結束前重新查 open Issue、open PR、CI、BUILD、RESERVE、Closure、VERIFY holder、Owner blockers、
active governance work 與本輪 scorecard。最終報告不得只寫「目前進度」。
符合 §3.2 的 DB 變更在 `POLICY_GATED_ACTIVE` 後不再以逐次人工批准為停止理由；automation pending 期間保留 bootstrap gate，技術關卡未過則保留其真實阻塞。