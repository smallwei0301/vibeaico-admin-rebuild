# Agent 常駐自主執行規則

> Owner 首次裁示：2026-08-28
>
> 最近更新：2026-09-01
>
> 最新 WIP 拓撲：`docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`（B+）。
>
> 本文件是本 repo 的 Agent 執行方式唯一正式版本。產品規格仍以各
> `docs/integration/**` 分冊為準。
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

## 2. 強制開工順序

1. `git fetch origin --prune`。
2. 從 `origin/main` 讀 `AGENTS.md`、`CLAUDE.md`、本文件、
   `docs/AGENT-BPLUS-DELIVERY-LOOP.md`、`docs/DOCUMENTATION-GOVERNANCE.md`、
   `docs/OWNER-DECISIONS.md` 與最新 Owner Decision。
3. 讀 Issue 指定的 canonical 文件與 `docs/integration/12-TESTING-TDD.md`；Playbook 只搜尋
   直接相關錯誤或領域，不全量重讀。
4. 讀最新 1～3 份 `docs/metrics/agent-runs/*.json`／`.md`，確認上一輪建議與尚未修正問題。
5. 建立或接續 `RUN_ID`，記錄 main、open Issue／PR、lane、TEST holder 與 usage 基準。
6. 由多位 Luna 做窄範圍盤點，再由一位 Luna Aggregator 去重。
7. Sol 只根據精簡包選 MAIN、可選 RESERVE 與 Closure target。

## 3. 長期授權與禁止事項

| 動作 | 預設權限 | 必要條件 |
|---|---|---|
| 讀 repo、Issue、PR、CI、Preview、報告 | 允許 | 使用 live 狀態，不洩漏秘密 |
| 修改程式、測試、文件；建立 branch、commit、PR | 允許 | 遵守 B+、Issue 範圍與文件治理 |
| 更新 PR／Issue 證據與標籤 | 允許 | 必須是 exact-head 真實證據 |
| 關閉 Issue | 允許 | 最終分支含實作、驗收成立、Sol 回覆 `CLOSE_APPROVED` |
| TEST Supabase 操作 | 允許 | 僅限 §3.1 TEST project，且持有唯一 TEST lane |
| Vercel Preview 驗證 | 允許 | 不提升 Production |
| docs-only 直進 main | 允許 | 只在文件治理白名單內 |
| 程式／workflow／skill 合併 main | 需明確任務授權 | CI、Audit、安全邊界成立；不得偷渡產品發布 |
| Production DDL／DML／migration／reset／seed | **禁止** | 需針對精確專案與範圍的新授權 |
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

## 4. B+ 角色路由

```text
LUNA_FAN_OUT → LUNA_FAN_IN → SOL_TRIAGE
                         ↓
                  MAIN_TERRA BUILD
                  RESERVE_TERRA source-only
                         ↓
                  TEST_VALIDATION
                         ↓
                    SOL_AUDIT
                         ↓
              LUNA_CLOSEOUT + METRICS
                         ↓
                     NEXT LOOP
```

| 角色 | 主要工作 | 禁止事項 |
|---|---|---|
| Luna | 真實盤點、Closure、CI 摘要、Janitor、文件、QA、Metrics | 不做產品／安全決策，不展開大型 code |
| Sol | TRIAGE、模糊 CI、高風險設計、最終 Audit | 不做 grep、輪詢、一般 CRUD、完整舊對話重讀 |
| MAIN Terra | 唯一完整中大型出貨線 | 不擴大驗收、不自行關 Issue |
| RESERVE Terra | 一個 source-only 預備切片 | 不碰 TEST、不進 Audit、不超過一個原子 commit |

## 5. 全域 B+ WIP 上限

```text
MAIN_TERRA      max 1  → AGENT_LANE=TERRA_BUILD
RESERVE_TERRA   max 1  → AGENT_LANE=TERRA_RESERVE
LUNA_CLOSURE    max 1  → AGENT_LANE=LUNA_CLOSURE
TEST_VALIDATION max 1  → AGENT_LANE=TEST_VALIDATION
ACTIVE_CANDIDATE max 2 → 通常 MAIN + Closure
LUNA_TASKS      default 4，max 6，另有 1 位 Aggregator
```

### 5.1 MAIN_TERRA

- 唯一可完整施工、進 shared TEST、修明確 CI、交 Sol Audit 的中大型 Issue。
- 必須一路做到 `CLOSED`、`AUDIT_READY` 或完整 `OWNER_BLOCKED`。
- `PR 已開`、`CI 綠`、`正在等 Preview` 不是完成。
- MAIN 未抵達出口前，不啟動第二條完整 BUILD。

### 5.2 RESERVE_TERRA

- 只有 MAIN 正在等 CI、TEST、Preview 或外部唯讀結果，且 MAIN 沒有可繼續的 source 工作時
  才可啟動。
- 必須明寫 `RESERVE_BOUNDARY`。
- 只做必要規格、紅燈測試、獨立 source slice、unit／typecheck／build、最多一個原子 commit。
- 不得持有 TEST lane、進 Sol Audit、開第二輪 full CI、碰 MAIN hot files 或吸入鄰近問題。
- 完成後停在 `READY_FOR_PROMOTION`；MAIN 進入出口後由 Sol 決定升格或 Park。

### 5.3 LUNA_CLOSURE

- 每輪固定執行；優先掃 open PR、近期 CI、上一輪 closeability ≥3 候選，先限 5 個。
- 可整理 exact-head 證據、checkbox、Preview、Janitor、機械 closeout。
- 沒有候選必須輸出 `EMPTY_WITH_SCAN` 和已檢查清單。

### 5.4 ACTIVE_CANDIDATE

- 全 repo 最多 2 張，通常是 MAIN 和 Closure candidate。
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

## 7. Sol 使用上限

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
  `npm run build`。前一步未通過，
  不得更新 `preview/**`、不得把 Vercel build 當第一道語法檢查，也不得用另一個 no-op commit 重試。
- 完整性閘門至少驗證 `package.json`、`package-lock.json`、`src/app/`、`src/server/` 仍存在，
  刪檔量未超過安全上限，且受控程式檔沒有單獨一行的 40 碼 Git SHA。
- 相依套件只接受 lockfile 可重現的版本；`package.json` 與 `package-lock.json` 一起改，乾淨
  `npm ci` 是必要證據。不存在的版本、peer 衝突或 lockfile 不一致都在 Preview 前停止。

CI 失敗由 Luna 先壓縮：exact head、job／step、suite／case、錯誤碼、重現性、TEST holder、
環境變化。明確 code bug 交 MAIN Terra；模糊或高風險才交 Sol。

## 9. PR、Janitor 與交接

- 一個 Issue 只保留一張 ACTIVE implementation；必要時一張短命 VALIDATION。
- `PARKED` PR 不派 Agent、不 push、不 rerun、不輪詢；重新啟動前先 Sol TRIAGE。
- Janitor 只有 explicit supersedes、同 Issue、同 repo、ancestry／patch coverage 與 mutation
  前重新驗證都成立才自動關；否則 `JANITOR_REVIEW`。
- 交接只傳 Issue、stage、lane、base/head、PR、scope、changed、evidence、latest error、
  TEST、risk、unproven、next、requested／actual model、RUN_ID 與 scorecard path。
- 不貼整份 CI log，不複製完整舊對話。

## 10. Ledger、Scorecard 與復盤

每輪提交：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

JSON 是原始帳本，Markdown 必須可由 `scripts/agents/score-run.mjs` 重算。至少記錄：

- main、open Issue／PR 起訖；
- MAIN／RESERVE／candidate／TEST 峰值；
- requested／actual Luna、Terra、Sol 任務與上下文大小；
- 實際 token／週 usage，或明確 `unavailable`；
- internal weighted usage（Luna=1、Terra=3、Sol=6，非官方換算）；
- CLOSED、AUDIT_READY、完整 OWNER_BLOCKED、carryover；
- full CI、invalid rerun、品質、安全、Luna 採用率、Sol touches；
- 100 分 scorecard 與最多 2 項下一輪調整。

Owner 說「復盤」或「複盤」時，載入
`.agents/skills/vibeaico-agent-retrospective/SKILL.md`，驗證並比較最近 3 輪；資料不足則讀
全部。只提出一到兩項最有影響的治理改良，不在復盤時順便改產品。

## 11. 停止條件

只有以下情況可送終止性 final：

1. 所有 open Issue 都完成、合併到要求分支並關閉；或
2. 剩餘項目只缺 Owner／外部人類／Production／`SOL_GATE_PENDING`，且 MAIN、RESERVE、
   Closure、TEST 與可施工 backlog 都已處理；或
3. 平台無法繼續，且已留下可直接接手的 exact checkpoint 與本輪 IN_PROGRESS report。

結束前重新查 open Issue、open PR、CI、MAIN、RESERVE、Closure、TEST holder、Owner blockers
與本輪 scorecard。最終報告不得只寫「目前進度」。
