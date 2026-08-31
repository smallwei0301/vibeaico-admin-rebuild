# Agent 常駐自主執行規則

> Owner 首次裁示：2026-08-28。
>
> 最近更新：2026-08-31。
>
> 本文件是本 repo 的 agent 執行方式唯一正式版本（canonical execution policy）。
> 它規範怎麼盤點、派工、限制同時施工量、驗證、推進與停工；產品規格仍以各
> `docs/integration/**` 分冊為準。

## 1. 預設工作模式與控制訊號

- 主 agent 是專案主導者，不只是回報者。收到一個 Issue、`/goal` 或「繼續」後，
  應持續完成所有目前可施工工作，直到符合 §10 的停止條件。
- 階段性進度只能是非終止更新；更新後立刻繼續。不得把「已查到狀態」、
  「CI 還在跑」或「已建立 PR」當成任務完成。
- **長程 `/goal` 的 final 防呆**：未符合 §10 任一停止條件時，禁止送出終止性 final。
  即使完成一個 commit、測試或單一 Issue，也只能發非終止 checkpoint，並立即轉往
  下一個不衝突工作。
- 等待 CI、agent 或外部讀取時，若有不會碰撞的工作，繼續下一條工作流。
- 每次接手都重新讀 GitHub 的 open Issue、open PR、分支、最新提交與 CI；舊對話與
  Issue 內過時勾選只能當線索，不能當目前事實。
- 先接續既有可用 PR／分支，不為同一題重開平行實作。

### 1.1 Owner 控制訊號不得誤判為停工

收到新訊息時先分類：

```text
OWNER_MODEL_SWITCH    Owner 為切換模型速度、深度或角色而重送 /goal
OWNER_STEER           Owner 改變限制、授權或方向
OWNER_CONTINUE        Owner 手動要求同一工作繼續
AGENT_PREMATURE_STOP  agent 明確結束，但當時仍有安全可施工工作
UNKNOWN_CONTROL_EVENT 證據不足，不能判定
```

- Owner 重送 `/goal`、`/steer` 或「繼續」，本身不等於前一位 agent 提早停止。
- 只有找到前一位 assistant 的終止性 final、明確暫停或要求 Owner 重新啟動，且當時
  仍有可自主施工工作，才可記為 `AGENT_PREMATURE_STOP`。
- 匯出紀錄若只有 Owner 訊息，停止證據一律是 `UNKNOWN_CONTROL_EVENT`。
- 模型切換後保留 live branch、PR、exact head、TEST lane 與目前 stage；不得 checkout、
  reset 或重做已完成的盤點、commit、migration、測試與 CI 分析。

## 2. 強制開工順序

1. `git fetch origin --prune`。
2. 從 `origin/main` 讀 `AGENTS.md`、`CLAUDE.md`、本文件、
   `docs/DOCUMENTATION-GOVERNANCE.md` 與 `docs/OWNER-DECISIONS.md`。
3. 讀 Issue 指定的 canonical 分冊、驗收清單與
   `docs/integration/12-TESTING-TDD.md`；以 Issue、錯誤碼或領域關鍵字搜尋
   `docs/AGENT-PLAYBOOK.md`，只讀直接相關教訓。
4. 確認目前 base、head、既有 PR、migration 編號、CI、TEST schema 基線與誰正在
   使用共用 TEST lane。
5. 建立精簡責任表：
   `Issue → stage → lane → 指定模型 → branch/PR → 依賴 → DB 使用 → 驗證 → 狀態`。
6. 將工作分為：
   - **A：可直接施工**；
   - **B：等其他 Issue／PR，但可先做不衝突部分**；
   - **C：確實只缺 Owner 決策、外部憑證、人類操作或 Production 權限**。
7. 依 §5.3 的全域在製品上限建立 lane board，再由 Sol 依 §5.4 選題。

## 3. 長期授權與禁止事項

| 動作 | 預設權限 | 必要條件 |
|---|---|---|
| 讀 repo、Issue、PR、CI、Preview 與文件 | 允許 | 使用目前狀態，不洩漏秘密 |
| 修改程式、測試、文件；建立 branch、commit、PR | 允許 | 遵守 Issue 範圍、lane 上限與文件治理 |
| 更新 PR 描述、review 回覆、Issue 證據與標籤 | 允許 | 內容必須有可驗證證據 |
| 關閉已完成的 Issue | 允許 | 最終分支包含實作、驗收有證據，且 Sol AUDIT 回覆 `CLOSE_APPROVED` |
| 執行型別、單元、整合、E2E 與 build | 允許 | TEST 工作依 §7 序列化 |
| Vercel Preview 驗證 | 允許 | 不得提升為 Production |
| Owner 已核准的 docs-only commit 直進 `main` | 允許 | changed files 僅限文件治理白名單 |
| 將驗證完成的 PR 設為 Ready | 允許 | 驗收與必要 CI 全部有證據 |
| 合併到非 Production 的指定整合分支 | 允許 | base 正確、CI 綠、審查完成 |
| 合併會改變正式網站行為的程式到 `main` | **禁止預設執行** | `main` 會自動發布，須 Owner 明確發布授權 |
| Production Supabase DDL／DML／reset／seed／migration | **禁止** | 必須有針對精確專案與範圍的新授權 |
| Vercel Production 部署、提升 Preview、正式流量切換 | **禁止** | 必須有新授權 |
| 真實付款、退款、訂單或 LINE／Email／Telegram 顧客通知 | **禁止** | 測試只用 sandbox、mock 或明確測試接收者 |
| 輸出、提交或貼出 token、密碼、key、完整 `.env` | **禁止** | 秘密只能在執行環境短暫使用 |

### 3.1 TEST Supabase 長期授權

Owner 已長期授權在 Vibe Ai TEST 專案 `nmwhwngojosmagjuvxol` 執行完成 open Issue 所需的
schema／function／migration、DDL／DML、reset、seed、schema cache 刷新與整合／E2E；
後續新 migration 不必逐支再詢問。

每次執行仍必須：

1. 以 URL／project ref 確認目標精確等於上述 TEST 專案。
2. 記錄執行前 migration／schema 基線、預計套用檔案與執行後驗證。
3. migration 新增或修改 API 使用的表、欄位或 RPC 後，刷新 PostgREST schema cache，
   並跑真正的目標查詢。
4. reset／seed 只能清 TEST 測試資料；安全鎖不通過立即停止。
5. 不呼叫真實付款或通知服務。
6. 任何其他 Supabase project ref，包括 Production 與 Midao 專案，都不在授權內。

### 3.2 憑證取得

- 缺少憑證時，先使用已連結 Google Drive 的 `midao.md`／`midao.env` 或目前執行環境
  已安全設定的變數。
- 不把秘密複製到回覆、agent 交接、commit、PR、Issue、測試附件或 shell 輸出。
- GitHub connector、shell git、Supabase connector 與環境檔可能是不同帳號／通道；
  其中一條已連結，不代表其他通道也有權限。
- 確認憑證不存在或權限不足後，把精確缺項放入 Owner 待辦，並繼續其他工作。

## 4. 自主決策原則

- 已記在 `docs/OWNER-DECISIONS.md` 的裁示不得再次詢問，除非出現新的規格衝突、
  安全風險或 Owner 明確改判。
- 小型、可回復且不影響金流／Production 的歧義，採最新 main 文件、原站行為、
  最簡單且最少驚喜的方案，記錄成實作假設後繼續。
- 價格、付款期限、正式資料搬遷、OAuth 正式憑證、真實通知、Production 與不可回復
  行為不得自行發明。將它們整理成 Owner 決策項，但不要打斷其他工作。
- 看不到必要 canonical 文件或高順位文件互相矛盾時，只停止該路線，不得用猜測補規格。

## 5. 角色式模型路由、在製品上限與 Close-first

工作角色優先於目前對話選到的模型。標準流程固定為：

```text
SCOUT → TRIAGE → BUILD → DIAGNOSE → AUDIT → CLOSEOUT
Luna      Sol      Terra    Terra/Sol     Sol       Luna
```

### 5.1 六階段責任

| 階段 | 指定模型 | 主要工作 | 必交產物 | 禁止事項 |
|---|---|---|---|---|
| `SCOUT` | Luna | 盤點 open Issue／PR／branch／CI、依賴、TEST 占用與現有證據 | 只含事實的精簡責任表 | 不決定優先順序，不做產品／安全判斷，不關 Issue |
| `TRIAGE` | Sol | 決定下一題、依賴順序、closeability、風險與驗收閘門 | §5.4 固定輸出 | 不親自做大量施工，不重讀完整舊對話 |
| `BUILD` | Terra | 唯一 active 中大型 Issue 的端到端實作與 targeted tests | commit、變更檔、測試、未驗證項 | 不改驗收、不擴大 scope、不自行關 Issue |
| `DIAGNOSE` | Terra／Sol | 明確程式錯誤由 Terra 修；模糊 CI／環境責任由 Sol 判案 | `CODE`／`TEST`／`ENVIRONMENT`／`UNKNOWN` | 未分類前不得改 assertion、timeout 或宣稱環境問題 |
| `AUDIT` | Sol | 高風險審查與 Issue 最終驗收 | `CLOSE_APPROVED`、`FIX_REQUIRED` 或 `OWNER_BLOCKED` | 不以「大部分完成」放行，不做 close 的機械操作 |
| `CLOSEOUT` | Luna | 整理文件、證據、PR／Issue 狀態並執行關閉 | 完整證據留言與狀態更新 | 沒有 `CLOSE_APPROVED` 不得關 Issue |

### 5.2 Sol 的介入邊界

Sol 只在以下情況介入：

1. 開工選題與依賴順序。
2. 資料庫、migration、付款、登入、權限、跨租戶、安全與真實通知設計。
3. 同一 commit 前後結果不一致、跨 suite 失敗、大量 401／403、schema cache、
   共用 TEST 污染、並發或責任不明的 CI。
4. 想修改 assertion、提高 timeout、把失敗標成環境問題或跳過驗收。
5. 最後判斷 Issue 能否關閉。

一般 Issue 的 Sol 接觸目標為 **2 次**，即 TRIAGE 一次、AUDIT 一次。只有新增高風險
證據或模糊 CI 才增加 DIAGNOSE；不得讓 Sol 常駐搬運、輪詢 CI、讀完整 log 或一般施工。

### 5.3 全域在製品上限（WIP Limit）

每一輪長程 `/goal` 同時只允許以下三條 lane：

| Lane | 數量 | 模型 | 用途 |
|---|---:|---|---|
| `TERRA_BUILD` | 最多 1 | Terra | 唯一中大型施工 Issue |
| `LUNA_CLOSURE` | 固定 1 | Luna | 找到並推進最接近可關閉的既有 Issue／PR |
| `TEST_VALIDATION` | 最多 1 | Terra／Luna 執行，Sol 只判模糊結果 | 共用 TEST migration、reset、seed、integration、E2E |

硬規則：

- **全 repo 同一時間最多一條 active `TERRA_BUILD`。** 已有 active Terra 時，Sol 不得
  再啟動第二個中大型 Issue。可先做唯讀調查，但不得建立第二個 active 實作分支／PR。
- **固定保留一條 `LUNA_CLOSURE`。** 它不能被一般盤點或新功能研究取代。若掃描後確實
  沒有可收尾目標，必須輸出 `EMPTY_WITH_SCAN` 與已檢查候選，而不是悄悄消失。
- **共用 TEST 只有一條 lane。** CI 已用 `shared-test-supabase-integration` 序列化；人工或
  agent 的 TEST DDL／reset 也必須先確認沒有其他 TEST 使用者。
- 同時標成 `ACTIVE_CANDIDATE=true` 的 PR 最多 **2 張**：通常是一張 Terra Build 候選，
  加一張 Closure Sweep 候選。其他 open PR 一律標為 `PARKED`、`HISTORICAL` 或
  `OWNER_BLOCKED`，不得持續派 agent、輪詢或反覆跑 CI。
- 小型文件、唯讀稽核與治理修正可不占 Terra lane，但不得碰 active Terra 的檔案群、
  不得使用共用 TEST，也不得再開一條高成本 Sol 審查循環。
- 若 Owner 明確指定第二條大型工作，先由 Sol 決定「替換目前 Terra lane」或「park 新題」。
  沒有 Owner 明確 override，不得把 WIP 上限擴成 2。

### 5.4 Close-first TRIAGE 排序

Sol 在啟動新的 Terra Build 前，必須先對有實作跡象的 open PR／Issue 評分。不要每次
全量重讀所有 Issue，先看 open PR、近期有 commit／CI 的 Issue，以及 Closure Sweep
列出的最多 5 個候選。

`CLOSEABILITY_SCORE` 定義：

| 分數 | 定義 |
|---:|---|
| 5 | 實作已在要求的最終分支，只差證據留言、checkbox 或 close |
| 4 | 只差 1 個可自主完成的小步驟，不需中大型施工 |
| 3 | 已有 PR 與大多數測試，最多再做 2 個自主步驟可交 AUDIT |
| 2 | 仍需明顯程式施工、完整資料庫生命週期或多輪驗證 |
| 1 | 主要卡在 Owner／外部人類／Production，或依賴多個未完成大型 Issue |
| 0 | 重複、過時、已被取代，或不應作為 active candidate |

選題順序：

1. 分數 5、4、3，且沒有 Owner／外部 blocker 的候選。
2. 能解除多張 Issue 的必要依賴，但只允許占用唯一 Terra lane。
3. 顧客現場會遇到的 P0／安全／資料損失問題。
4. 其他 P1／P2。

不得因為 Issue 很重要，就同時開多張明知依賴未完成大型題目或外部人類的 Draft PR。
若選擇分數低於 3 的 Issue，而存在分數 3 以上候選，Sol 必須寫出
`WHY_NOT_CLOSER_CANDIDATE`；沒有合理證據就改選 close-ready 候選。

TRIAGE 固定輸出：

```text
NEXT:
SELECTION_REASON: CLOSE_READY | DEPENDENCY_UNLOCKER | P0_RUNTIME | OWNER_DIRECTED
CLOSEABILITY_SCORE: 0..5
REMAINING_AUTONOMOUS_STEPS:
DEPENDENCIES:
OWNER_OR_EXTERNAL_BLOCKER:
TEST_LANE_REQUIRED: true | false
ACTIVE_CANDIDATE: true | false
CLOSURE_SWEEP_TARGET:
WHY_NOT_CLOSER_CANDIDATE:
RISK:
GATES:
```

### 5.5 固定 Luna Closure Sweep

每一輪 `/goal` 都維持一條 Closure Sweep，但為了省 token 只掃：

1. 已有 open PR 的 Issue。
2. 最近有 commit、CI 或驗收證據的 Issue。
3. 上一輪分數 3 以上候選。
4. 最多 5 個候選；只有清單不足時才擴大搜尋。

Luna 可以：補 checkbox、整理 exact-head 證據、對照文件、修小型文件、確認 Preview、
執行不碰 TEST 的 targeted check、關閉已取得 `CLOSE_APPROVED` 的 Issue。

Luna 不可以：展開中大型程式施工、改產品／安全決策、把大缺口偷偷塞進 Closure Sweep，
或自行放寬驗收。若發現需要中大型 code，回傳 Sol 重新 TRIAGE，不得形成第二條 Terra。

Closure Sweep 固定輸出：

```text
CLOSURE_SWEEP_TARGET:
CLOSEABILITY_SCORE:
MISSING_GATES:
COMPLETED_THIS_SWEEP:
AUDIT_READY: true | false
RESULT: ADVANCED | CLOSED | PARKED | EMPTY_WITH_SCAN
NEXT_SAFE_ACTION:
```

### 5.6 Agent 交接包

只傳以下欄位，不傳完整舊對話，也不要求收件者全量重讀 repo：

```text
RUN_CONTROL:
ISSUE:
ISSUE_ORIGIN:
STAGE:
AGENT_LANE:
LANE_STATE:
BASE / HEAD:
ACTIVE_PR:
GOAL:
REQUIRED_DOCS:
SCOPE:
CHANGED:
ACCEPTANCE_EVIDENCE:
LATEST_ERROR:
TEST_RESULT:
CURRENT_TEST_LANE:
CLOSEABILITY_SCORE:
CLOSURE_SWEEP_TARGET:
RISK:
UNPROVEN:
NEXT_SAFE_ACTION:
CREATED_ISSUES:
REQUESTED_DECISION:
REQUESTED_MODEL / ACTUAL_MODEL:
```

- 原始 CI log 只附失敗 step、suite、案例與必要片段；不貼整份 log。
- Sol AUDIT 只讀 Issue 驗收、相關 diff、測試證據、風險與未完成項。
- 平台無法驗證 delegated model 時寫 `actual=unknown`，不得假裝已使用指定模型。

### 5.7 CI 兩層分流

1. Luna 摘錄 exact head、job／step、suite／case、錯誤碼、重現性、同時執行中的 TEST
   workflow 與最近環境變化。
2. 明確程式錯誤交 Terra；模糊、跨 suite、前後不一致、共用 TEST、Auth／DB／權限或
   想改測試標準的情況交 Sol。
3. Sol 必須輸出 `CODE`／`TEST`／`ENVIRONMENT`／`UNKNOWN` 與最小下一步；
   `UNKNOWN` 不可改寫成 `ENVIRONMENT`。
4. 同一 commit、同一環境、同一命令不得盲目重跑。只有程式、設定、權限、服務狀態、
   測試資料或其他可驗證條件改變後，才算新嘗試。

### 5.8 Scope Firewall 與 Issue 來源

新發現只有符合下列任一條件，才可成為阻塞目前 goal 的新 Issue：

- 原站或 UI 宣稱可用，但沒有真實副作用或資料不保存。
- 存在安全、跨租戶、資料損失、付款、退款、權限或真實通知風險。
- 原 Issue／canonical 文件已明定的驗收缺失。

純美化、未來想法、目前可用的效能優化與非必要重構，只進 backlog，不阻塞目前 Issue。

Agent 開新 Issue 時必須使用 `.github/ISSUE_TEMPLATE/agent-discovered.yml`，或在 API body
保留等價欄位：

```text
ISSUE_ORIGIN: AGENT_DISCOVERED
PARENT_ISSUE / PR:
DISCOVERED_STAGE:
SCOPE_FIREWALL_REASON:
WHY_SEPARATE_FROM_PARENT:
BLOCKS_CURRENT_GOAL:
EVIDENCE:
REQUESTED_MODEL / ACTUAL_MODEL:
```

只有含 `AGENT_DISCOVERED` 的 Issue 才計入 agent-created 指標。沒有標記的歷史 Issue
一律是 `owner-or-unknown`，不得依建立時間、帳號或文案風格猜來源。

### 5.9 模型不可用、Skill 與 PR WIP Hook

- 平台暫時不能派指定模型時，主 agent 先完成低風險工作；需要 Sol 閘門的 Issue 標記
  `SOL_GATE_PENDING`，不得自行關閉，但也不得因此停止其他工作。
- 目前主模型本身就是指定模型時，不另派同模型重複讀取。
- `.agents/skills/vibeaico-agent-orchestration/SKILL.md` 是執行轉接器；本文件仍是唯一
  正式規則，衝突時以最新 `origin/main` 本文件為準。
- Agent 建立或接續 PR 時，必須維護 `.github/pull_request_template.md` 定義的 lane metadata。
- `.github/workflows/agent-wip-guard.yml` 只做可觀察的護欄：檢查 active Terra、Closure
  與 candidate 數量，並標記 metadata／WIP 違規。它不能證明實際模型，也不能取代 Sol。
- Hook 發現違規時，新啟動或較新的 lane 必須 `PARKED`；不得繼續施工後再補理由。

### 5.10 成本目標與量測

初始工作量目標：

| 模型 | 目標占比 |
|---|---:|
| Sol | 10%～20% |
| Terra | 60%～70% |
| Luna | 15%～25% |

無法取得平台真實 token 時不可編造百分比。每個完成 Issue 至少記錄：

```text
owner_control_events
agent_premature_stops
active_terra_peak
active_candidate_peak
closure_sweeps
sol_contacts
full_ci_runs
invalid_reruns
agent_created_blocking_issues
owner_or_unknown_issues_created
closed_issues
```

以 10 個 Issue 為一輪觀察，目標是：Sol 一般不超過 2～3 次接觸、無效 CI 重跑為 0、
active Terra 峰值為 1、active candidate 峰值不超過 2，且 closed Issue 持續增加。

## 6. Branch、PR 與 CI 流程

1. 一個 Issue／緊密相依的小批次使用一條責任清楚的 branch；已有 PR 就優先接續。
2. 程式、migration、依賴、workflow、agent skill 與部署設定走
   feature branch → PR → CI → review。
3. Agent-origin PR 必須填 `WORK_ORIGIN`、`AGENT_LANE`、`LANE_STATE`、
   `ACTIVE_CANDIDATE`、`CLOSEABILITY_SCORE`、`SELECTION_REASON`、
   `REMAINING_AUTONOMOUS_STEPS`、`CLOSURE_SWEEP_TARGET` 與 TEST lane 需求。
4. `LANE_STATE=PARKED` 的 PR 不得再派 agent、推新 commit、手動 rerun 或輪詢；只有 Sol
   重新選為 active candidate 後才恢復。
5. migration 平行施工前先分配不重複編號；合併前核對 drift 與相依性。
6. 先跑單一失敗測試與相關型別／單元測試；有新提交或新環境證據後才跑完整 CI。
7. 完全相同的 commit 與環境失敗不得反覆 rerun 碰運氣。
8. PR 合併前核對 changed files、base/head、驗收證據、migration、秘密掃描與 CI。
9. 合併到指定整合分支後重新核對該分支；未取得 Production 授權時停在 Ready 或已驗證
   整合分支，繼續 Closure Sweep。
10. Issue 只有在要求的最終分支包含實作、驗收全部成立，且 Sol 回覆
    `CLOSE_APPROVED` 時才關閉；傘狀 Issue 不得因小段完成就關閉。

## 7. 測試與共用 TEST 資源

- 遵守 `docs/integration/12-TESTING-TDD.md` 的紅燈 → 最小實作 → 綠燈 → 回歸循環。
- 單元測試、文件核對與互不重疊的程式閱讀可平行。
- 共用 TEST 的 migration、reset、seed、integration 與 E2E 必須排成單一路線；同一時間
  只允許一個會改動共用 TEST 狀態的工作。
- TEST 忙碌時，Terra 不可再開第二個大型 Issue；Luna 轉做 Closure Sweep、文件、
  PR review 或不碰 TEST 的 targeted check。
- 整合後只跑一次必要全量；`check` 成功不代表 integration／E2E 成功。
- GitHub job 失敗時讀到精確 step、suite 與案例後才修；沒有實際執行的測試一律寫
  「未驗證」，不得用「應該會過」代替證據。

### 7.1 已知失敗模式

- 單一 401 可能是刻意驗證未登入。先看案例契約，再驗 seed 建帳號 → 登入 →
  `/api/auth/me` → 同 cookie 的受保護請求。
- migration 後的 `PGRST202` 優先視為 TEST migration／schema cache 訊號；`PGRST201`
  優先檢查同表多條外鍵造成的關聯歧義。先驗 DB，再改 route。
- seed 的 optional-table 只可略過明確「表不存在」；欄位、外鍵、權限、cache 或未知
  錯誤必須 fail closed。
- 測試沒有開始不能算綠；成功 toast 也不能證明副作用真的發生。
- 關鍵寫入不可先查再分段寫；撞班、名額、收款與狀態轉移須用 transaction／atomic RPC
  保護，並測並發。

### 7.2 CI 文件分流

- 只有完全落在 `docs/**`、`README.md`、`AGENTS.md`、`CLAUDE.md`、`.agents/**` 或
  `.claude/**` 的非空 diff 才是 docs-only；rename 舊／新路徑都要檢查。
- `workflow_dispatch`、缺 revision、空 diff、解析失敗、未知 status 或任何白名單外路徑
  一律 fail closed，走完整 runtime CI。
- 分類 job 輸出 `docs_only`、`reason`、`detail`、`changed_count`、`runtime_path`，並寫入
  Step Summary。
- docs-only 不安裝 npm、不讀 TEST secret、不碰 TEST lane、不跑 Chromium；runtime 路徑
  仍先 check，再在 `shared-test-supabase-integration` 內跑 integration → E2E，且
  `cancel-in-progress: false`。

## 8. 錯誤停止線與恢復

- 同一路徑連續兩次遇到環境錯誤就停止重試；只有權限、設定、服務狀態或其他條件真的
  改變後才重新計數。
- 停止該路線後保存最小錯誤、已試條件與下一個假設，改走其他安全工作；不得因此結束
  整個 goal。
- agent 長時間沒有提交時，要求最小 checkpoint：變更檔、commit、重現指令、阻塞與
  可推送內容。拿回後整合、換路或重新派工。
- 不以刪測試、放寬斷言、隱藏按鈕、mock 假成功或靜默略過錯誤解除阻塞。

## 9. 證據、文件與教訓

每個完成項目至少記錄：

- Issue／PR、base/head 與提交；
- 驗收對應測試、實際指令、結果與 CI；
- TEST migration 基線／套用／schema cache／目標查詢；
- 未驗證範圍、風險、環境錯誤與 Owner 待辦；
- 六階段負責模型與 requested／actual model；
- lane、closeability、Closure Sweep、Sol 接觸、full CI、無效重跑與新 Issue 來源量測。

每次造成 CI／測試失敗、環境重試、錯誤診斷、半成品、權限阻塞或 agent 停滯的事件，
都要依固定格式新增或更新 `docs/AGENT-PLAYBOOK.md`。相同根因更新原條目，不散落新檔；
若教訓改變正式做法，再同步最相關 canonical 文件。

## 10. 停止條件與最終交付

只有下列情況可結束一輪長程 goal：

1. 所有 open Issue 都有完整驗收證據、合併到要求的最終分支並關閉；或
2. 所有剩餘項目都只缺 Owner 決策、外部權限／人類操作、Production 授權或
   `SOL_GATE_PENDING`，且其他可施工項目與 Closure Sweep 已全部完成；或
3. 執行平台無法繼續，且已留下另一位 agent 可直接接手的精確 checkpoint。

送出終止性 final 前必須重新查：open Issue、open PR、active／queued CI、三條 lane、
可執行但未開始工作與 Owner-only blockers。Owner 模型切換不是停止理由。

最終報告必須包含：已關閉 Issue／合併 PR、測試與 CI、TEST migration、Production
未變更確認、剩餘阻塞與推薦決策、agent 分工、lane 峰值、Closure Sweep、環境錯誤、
playbook 更新，以及 §5.10 的模型與重工量測。不得只回報「目前進度」。
