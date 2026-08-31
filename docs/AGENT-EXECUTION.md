# Agent 常駐自主執行規則

> Owner 裁示日期：2026-08-31。
>
> 本文件是本 repo 的 agent 執行方式唯一正式版本（canonical execution policy）。
> 它規範怎麼盤點、派工、驗證、推進與停工；產品規格仍以各
> `docs/integration/**` 分冊為準。

## 1. 預設工作模式

- 主 agent 是專案主導者，不只是回報者。收到一個 Issue、`/goal` 或「繼續」後，
  應持續完成所有目前可施工工作，直到符合 §10 的停止條件。
- 階段性進度只能是非終止更新；更新後立刻繼續。不得把「已查到狀態」、
  「CI 還在跑」或「已建立 PR」當成任務完成。
- **長程 `/goal` 的 final 防呆**：未符合 §10 任一停止條件時，禁止送出 final 回覆。
  即使本回合完成一個 commit、測試或單一 Issue，也只能發非終止進度，並立刻轉往
  下一個不衝突工作。送出 final 前，必須逐項核對 §10 並記錄符合哪一項。
- 等待 CI、agent 或外部讀取時，若有不會碰撞的工作，繼續下一條工作流。
- 每次開工都重新讀 GitHub 的 open Issue、open PR、分支、最新提交、labels 與 CI；
  舊對話、舊清單與 Issue 內過時勾選只能當線索，不能當目前事實。
- 先接續既有可用 PR／分支，不為同一題重開平行實作。
- Owner 為切換模型速度、思考等級或角色而重送 `/goal`、`/steer` 或「繼續」，是控制
  訊號，不是 agent 自行停工證據。接手者依 live GitHub 與 checkpoint 原地接續。

## 2. 強制開工順序

1. `git fetch origin --prune`。
2. 從 `origin/main` 讀 `AGENTS.md`、`CLAUDE.md`、本文件、
   `docs/DOCUMENTATION-GOVERNANCE.md` 與 `docs/OWNER-DECISIONS.md`。
3. 讀 Issue 指定的 canonical 分冊、驗收清單與
   `docs/integration/12-TESTING-TDD.md`；以 Issue、錯誤碼或領域關鍵字搜尋
   `docs/AGENT-PLAYBOOK.md`，只讀直接相關教訓。
4. 長程 `/goal`、模型切換、Issue 來源、TRIAGE、TEST 排程或 closeout，依任務讀：
   - `docs/decisions/2026-08-31-agent-control-signals-and-issue-provenance.md`
   - `docs/decisions/2026-08-31-close-first-wip-lanes.md`
5. 確認目前 base、head、既有 PR、lane／candidate labels、migration 編號、CI 與 TEST
   schema 基線。
6. 建立精簡責任表：
   `Issue → 階段 → lane → closeability → 指定模型 → branch/PR → 依賴 → DB 使用 → 驗證 → 狀態`。
7. 將工作分為：
   - **A：可直接施工**；
   - **B：等其他 Issue／PR，但可先做不衝突部分**；
   - **C：確實缺 Owner 決策、外部憑證或 Production 權限**。
8. 依 §5.9 的 close-first TRIAGE 與全域 WIP 上限處理 A；C 只進待辦清單，不得卡住
   其他 A／B 工作。

## 3. 長期授權與禁止事項

| 動作 | 預設權限 | 必要條件 |
|---|---|---|
| 讀 repo、Issue、PR、CI、Preview 與文件 | 允許 | 使用目前狀態，不洩漏秘密 |
| 修改程式、測試、文件；建立 branch、commit、PR | 允許 | 遵守 Issue 範圍、§5.9 WIP 上限與文件治理 |
| 更新 PR 描述、review 回覆、Issue 證據與標籤 | 允許 | 內容必須有可驗證證據 |
| 關閉已完成的 Issue | 允許 | 最終分支包含實作、驗收有證據，且 §5 AUDIT 回覆 `CLOSE_APPROVED` |
| 執行型別、單元、整合、E2E 與 build | 允許 | TEST 資料庫工作依 §7 序列化 |
| Vercel Preview 驗證 | 允許 | 不得提升為 Production |
| Owner 已核准的 docs-only commit 直進 `main` | 允許 | changed files 僅限文件治理白名單 |
| 將驗證完成的 PR 設為 Ready | 允許 | 驗收與必要 CI 全部有證據 |
| 合併到非 Production 的指定整合分支 | 允許 | base 正確、CI 綠、審查完成 |
| 合併會改變正式網站行為的程式到 `main` | **禁止預設執行** | `main` 會自動發布，須 Owner 明確發布授權 |
| Production Supabase DDL／DML／reset／seed／migration | **禁止** | 必須有針對精確專案與範圍的新授權 |
| Vercel Production 部署、提升 Preview、正式流量切換 | **禁止** | 必須有新授權 |
| 真實付款、真實訂單、真實 LINE／Email／Telegram 顧客通知 | **禁止** | 測試只用 sandbox、mock 或明確測試接收者 |
| 輸出、提交或貼出 token、密碼、key、完整 `.env` | **禁止** | 秘密只能在執行環境短暫使用 |

### 3.1 TEST Supabase 長期授權

Owner 已長期授權在 Vibe Ai TEST 專案 `nmwhwngojosmagjuvxol` 執行完成
open Issue 所需的 schema／function／migration、DDL／DML、reset、seed、schema cache
刷新與整合／E2E 驗證；後續 Issue 的新 migration 不必逐支再詢問。

每次執行仍必須同時符合：

1. 先以 URL／project ref 確認目標精確等於上述 TEST 專案；不接受只看顯示名稱。
2. 記錄執行前 migration／schema 基線、預計套用檔案與執行後驗證。
3. migration 新增或修改 API 使用的表、欄位或 RPC 後，刷新 PostgREST schema cache，
   並跑一個真正的目標查詢。
4. reset／seed 只能清 TEST 測試資料；安全鎖不通過立即停止。
5. 不呼叫真實付款或通知服務。
6. 任何其他 Supabase project ref，包括 Production 與 Midao 專案，都不在授權內。
7. 只有持有 `lane:test-validation` 的 active candidate 可執行共用 TEST DDL、reset、seed、
   integration 或 E2E；其他候選維持 source-only。

### 3.2 憑證取得

- 任務缺少憑證時，先使用已連結的 Google Drive `midao.md`／`midao.env` 或目前
  執行環境已安全設定的變數。Owner 已授權讀取其中與本專案任務直接相關的憑證。
- 不把秘密複製到回覆、agent 交接、commit、PR、Issue、測試附件或 shell 輸出。
- 先確認 GitHub connector、shell git、Supabase connector 與環境檔是否其實是不同
  帳號／通道；其中一條已連結不代表其他通道也有權限。
- 確認憑證不存在或權限不足後，把精確缺項放入 Owner 待辦，並繼續其他工作。

## 4. 自主決策原則

- 已記在 `docs/OWNER-DECISIONS.md` 的裁示不得再次詢問，除非出現新的規格衝突、
  安全風險或 Owner 明確改判。
- 小型、可回復且不影響金流／Production 的歧義，採用符合最新 main 文件、原站行為、
  最簡單且最少驚喜的方案，記錄成實作假設後繼續。
- 價格、付款期限、正式資料搬遷、OAuth 正式憑證、真實通知、Production 與不可回復
  行為不得自行發明。將它們整理成 Owner 決策項，但不要打斷其他工作。
- 看不到必要 canonical 文件或高順位文件互相矛盾時，該路線停止；不得用猜測補規格。

## 5. 角色式模型路由與節流

**工作角色優先於目前對話選到的模型。** 目前對話模型負責保持任務不中斷、使用工具與
轉交工作，但不得跳過下列角色閘門。標準流程固定為：

```text
SCOUT → TRIAGE → BUILD → DIAGNOSE → AUDIT → CLOSEOUT
Luna      Sol      Terra    Terra/Sol     Sol       Luna
```

### 5.1 六階段責任

| 階段 | 指定模型 | 主要工作 | 必交產物 | 禁止事項 |
|---|---|---|---|---|
| `SCOUT` | Luna | 盤點 open Issue／PR／branch／CI、依賴、lanes、TEST 占用與現有證據 | 只含事實的精簡責任表 | 不決定優先順序，不做產品／安全判斷，不關 Issue |
| `TRIAGE` | Sol | 依 closeability 決定下一個 Issue、依賴順序、lane、風險與驗收閘門 | `NEXT`、`CLOSEABILITY`、`DEPENDENCIES`、`LANE_ASSIGNMENT`、`GATES` | 不親自做大量機械施工，不重讀完整舊對話 |
| `BUILD` | Terra | 全 repo 唯一中大型 BUILD lane，端到端讀必要 code、修改、跑 targeted tests、提交 | commit、變更檔、測試、未驗證項 | 不開第二條大型 BUILD，不改驗收標準，不擴大 scope，不自行關 Issue |
| `DIAGNOSE` | Terra／Sol | 明確程式錯誤由 Terra 修；模糊 CI、環境與測試責任由 Sol 判案 | `CODE`／`TEST`／`ENVIRONMENT`／`UNKNOWN` 分類與下一步 | 未分類前不得改 assertion、timeout 或宣稱環境問題 |
| `AUDIT` | Sol | 高風險設計審查與 Issue 最終驗收 | `CLOSE_APPROVED`、`FIX_REQUIRED` 或 `OWNER_BLOCKED` | 不以「大部分完成」放行，不親自做 close 的機械操作 |
| `CLOSEOUT` | Luna | 固定 Closure Sweep、補證據、文件、PR／Issue 狀態並執行關閉 | 完整證據留言、文件同步、狀態更新 | 沒有 `CLOSE_APPROVED` 不得關 Issue，不得轉成第二條 BUILD |

### 5.2 什麼時候一定要使用 Sol

- 排 open Issue 的下一題與依賴順序。
- 資料庫、migration、付款、登入、權限、跨租戶、安全、真實通知的設計或變更。
- 同一 commit 前後結果不一致、一次多個無關 suite 失敗、大量 401／403、
  schema cache、共用 TEST 污染、並發或責任不明的 CI。
- 想修改 assertion、提高 timeout、把失敗標為環境問題，或跳過驗收。
- 最後判斷 Issue 能否關閉。

一般 Issue 的 Sol 接觸次數目標為 **2 次**：TRIAGE 一次、AUDIT 一次。只有新增高風險
證據或模糊 CI 才可增加 DIAGNOSE；不得讓 Sol 常駐做搬運、讀完整 log、輪詢 CI 或
一般施工。

### 5.3 Terra 與 Luna 的硬邊界

- **全 repo 同一時間只允許一條中大型 Terra BUILD lane。** 同一 Issue 更不得多位
  Terra 重複讀、競作不同修法，或在每次狀態更新後重新接收完整背景。
- Terra 可自行修明確的型別、編譯、單一測試與可重現程式錯誤；若錯誤責任不明，
  先由 Luna 壓縮事實，再交 Sol 判案。
- **全 repo 固定保留一條 Luna Closure Sweep。** Luna 可盤點很多 open Issue／PR，
  但一次最多只可把一個 close-ready 候選提升為 active；不得被抽去啟動另一張大型 PR。
- Luna 可平行處理狀態盤點、CI 摘要、檔案核對、格式修正、文件同步與已有標準答案的
  機械修改；不得自行做產品、安全、金流、權限或 close 決策。
- 關閉 Issue 的按鈕可由 Luna 或主 agent 執行，但決策必須來自 Sol 的
  `CLOSE_APPROVED`。

### 5.4 固定交接包

agent 交接只提供以下欄位，不傳完整舊對話，也不要求收件者全量重讀 repo：

```text
RUN_CONTROL:
ISSUE:
ISSUE_ORIGIN:
STAGE:
LANE:
CLOSEABILITY:
ACTIVE_CANDIDATE_COUNT:
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
RISK:
UNPROVEN:
NEXT_SAFE_ACTION:
CREATED_ISSUES:
REQUESTED_DECISION:
REQUESTED_MODEL / ACTUAL_MODEL:
```

- 原始 CI log 只附失敗 step、suite、案例與前後必要片段；不貼整份 log。
- Sol AUDIT 只讀 Issue 驗收、相關 diff、測試證據、風險與未完成項。
- 若平台無法驗證實際 delegated model，寫 `actual=unknown`，不得假裝已使用指定模型。

### 5.5 CI 兩層分流

1. Luna 先摘錄 exact head、job／step、suite／case、錯誤碼、重現性、同時執行中的
   TEST workflow 與最近環境變化。
2. 明確的程式錯誤交 Terra；模糊、跨 suite、前後不一致、共用 TEST、Auth／DB／權限
   或想改測試標準的情況交 Sol。
3. Sol 必須輸出分類與最小下一步；`UNKNOWN` 不可被改寫成 `ENVIRONMENT`。
4. 同一 commit、同一環境、同一命令不得盲目重跑。只有程式、設定、權限、服務狀態、
   測試資料或其他可驗證條件改變後，才算新嘗試。
5. 只有 `lane:test-validation` 的持有者可進 shared TEST；其他 PR 不手動 dispatch 完整 CI。

### 5.6 Scope Firewall（範圍防火牆）

新發現只有符合下列任一條件，才可成為會阻塞目前 goal 的 Issue：

- 原站或既有 UI 宣稱可用，但實際沒有副作用或資料不會保存。
- 存在安全、跨租戶、資料損失、付款、退款、權限或真實通知風險。
- 原 Issue／canonical 文件已明定的驗收缺失。

純美化、未來產品想法、目前可正常使用的效能優化與非必要重構，只進 backlog，
不得阻塞目前 Issue，也不得讓「關 1 個、再開 2 個」成為常態。

Agent 新建 Issue 必須含 `AGENT_DISCOVERED`、父 Issue／PR、發現階段、Scope Firewall
理由、為何不能留在父題、是否阻塞 goal、證據與 requested／actual model。沒有來源標記
的歷史 Issue 一律是 `owner-or-unknown`，不得算成 Agent 新增 Issue。

### 5.7 模型不可用與 skill 邊界

- 若平台暫時不能派指定模型，主 agent 先完成不受影響的低風險工作；需要 Sol 閘門的
  Issue 標記 `SOL_GATE_PENDING`，不得自行關閉，但不得因此停止其他工作流。
- 若目前主模型本身就是指定模型，不另派同模型重複讀取。
- `.agents/skills/vibeaico-agent-orchestration/SKILL.md` 是本流程的執行轉接器，
  用來在 `/goal`、CI 判案、WIP lane 轉換與 closeout 時啟動固定階段；**本文件仍是
  主要正式規則**。skill 與本文件衝突時，以 `origin/main` 中較新的高順位政策為準。

### 5.8 初始成本目標與量測

初始工作量目標：

| 模型 | 目標占比 |
|---|---:|
| Sol | 10%～20% |
| Terra | 60%～70% |
| Luna | 15%～25% |

無法取得平台真實 token 時，不可編造數字。每個完成 Issue 至少記錄：

- Sol 接觸次數；
- full CI 次數與無效重跑次數；
- AUDIT 退回 Terra 次數；
- Agent 新增 blocking Issue 數與 owner-or-unknown Issue 數；
- requested model 與 platform-verifiable actual model；
- `active_candidate_peak`、Terra lane 違規、Closure Sweep 盤點／提升數與 close verdict。

先以 10 個 Issue 為一輪觀察，目標是 Sol 一般不超過 2～3 次接觸、無效 CI 重跑為 0、
`active_candidate_peak <= 2`、Terra lane 違規為 0，並且每輪至少產生一個 close verdict，
而非只增加 Draft PR 或審計文件。

### 5.9 Close-first TRIAGE 與全域 WIP lanes

#### 5.9.1 固定拓樸

整個 repo 同一時間最多：

| Lane | 上限 | 說明 |
|---|---:|---|
| `TERRA_BUILD` | 1 | 唯一中大型實作／明確除錯線 |
| `LUNA_CLOSURE_SWEEP` | 1 | 固定掃描既有成果並補最後證據／文件／狀態／closeout |
| `TEST_VALIDATION` | 1 | 唯一共用 TEST migration／reset／seed／integration／E2E 線 |
| active candidates | 2 | 正在 BUILD、TEST 或本輪 closeout 的 PR；其他 open PR 全部 parked |

舊 PR 沒有 lane metadata 時，預設 parked。Open 或 Draft 本身不代表 active，也不是繼續
提交、跑完整 CI 或要求 Sol 重審的理由。

#### 5.9.2 Closeability 排序

Sol 必須依序選：

1. `READY`：已有實作，只剩 0–2 個可自主完成缺口，無 Owner／外部／大型依賴。
2. `NEAR`：主要實作與大多數測試存在，可在一個循環完成。
3. `UNBLOCKER`：可自主解除多題共同依賴，或處理 P0／安全／資料損失風險。
4. `BUILDABLE`：規格完整、可自主施工，但需要新的中大型循環。
5. `BLOCKED`：依賴 Owner、外部人類、Production 或另一張未完成大型 Issue。

只要有 READY／NEAR，禁止先啟動 BLOCKED 或新的大型 BUILDABLE。真正緊急的安全、
跨租戶、資料損失或付款風險可由 Sol 明寫例外理由，但仍不能開第二條 Terra lane。

TRIAGE 固定輸出：

```text
NEXT:
CLOSEABILITY: READY | NEAR | UNBLOCKER | BUILDABLE | BLOCKED
AUTONOMOUS_GAPS:
DEPENDENCIES:
ACTIVE_CANDIDATE_COUNT:
LANE_ASSIGNMENT:
WHY_NOT_OTHER_ACTIVE_PRS:
EXPECTED_FULL_CI_COUNT:
```

#### 5.9.3 開工前檢查

新的 Terra BUILD 只有在全部成立時可啟動：

- `lane:terra-build` 沒有其他持有者；
- `candidate:active` 少於 2；
- `lane:test-validation` 持有者已知；
- 目標不是已知會因 Owner／外部／另一張大型 Issue 而停車的題目；
- 沒有既有 PR 可接續；
- Luna Closure Sweep 仍在運轉。

任一不成立時，只能做 Closure Sweep、文件、靜態核對、unit test、既有 PR cleanup 或
其他不產生新 active candidate 的工作。

#### 5.9.4 PR metadata 與 labels

PR body 必須有：

```text
AGENT_LANE: TERRA_BUILD | LUNA_CLOSURE_SWEEP | TEST_VALIDATION | PARKED
CANDIDATE_STATUS: ACTIVE | PARKED
CLOSEABILITY: READY | NEAR | UNBLOCKER | BUILDABLE | BLOCKED | N/A
```

對應 labels：

```text
lane:terra-build
lane:luna-closeout
lane:test-validation
candidate:active
candidate:parked
governance:wip-limit-exceeded
governance:lane-metadata-missing
```

每張 PR 同時最多一個 lane。Active 必須剛好一個 lane；parked 不得持有 lane。轉換階段
時移除舊 lane 再加新 lane。`.github/workflows/agent-wip-lanes.yml` 檢查上限與 metadata，
但不替代 Sol 決定優先順序。

## 6. Branch、PR 與 CI 流程

1. 一個 Issue／緊密相依的小批次使用一條責任清楚的 branch；若已有 PR，優先接續。
2. 新 PR 建立時填寫固定 Agent lane metadata；預設 parked，只有 TRIAGE 可升為 active。
3. 程式、migration、依賴、workflow、agent skill 與部署設定走
   feature branch → PR → CI → review。
4. migration 平行施工前先分配不重複編號；合併前依 base 順序核對 drift 與相依性。
5. 先跑單一失敗測試與相關型別／單元測試；有新提交或新環境證據後才跑完整 CI。
6. 完全相同的 commit 與環境失敗不得反覆 rerun 碰運氣。
7. PR 合併前逐項核對 changed files、base/head、驗收證據、migration、秘密掃描與 CI。
8. 合併到指定整合分支後重新核對該分支；未取得 Production 授權時，停在 Ready 或
   已驗證整合分支，繼續處理其他 Issue。
9. Issue 只有在它要求的最終分支已包含實作、驗收全部成立，且 Sol AUDIT 回覆
   `CLOSE_APPROVED` 時才關閉；傘狀 Issue 不得因其中一小段完成就關閉。

## 7. 測試與共用 TEST 資源

- 遵守 `docs/integration/12-TESTING-TDD.md` 的紅燈 → 最小實作 → 綠燈 → 回歸循環。
- 單元測試、文件核對與互不重疊的程式閱讀可平行。
- 共用 TEST 的 migration、reset、seed、integration 與 E2E 必須排成單一路線；
  同一時間只允許一個會改動共用 TEST 狀態的工作。
- 整合後只跑一次必要全量；CI 的 `check` 成功不代表 integration／E2E 成功。
- GitHub job 顯示失敗時，讀到精確 step、suite 與案例後才修；缺日誌時以相同 Node 22、
  commit、env 與單一測試重現，不猜測。
- 沒有實際執行的測試一律寫「未驗證」，不得用「應該會過」代替證據。

### 7.1 已知失敗模式

- CI log 的單一 401 可能只是刻意驗證未登入。先看 suite 結果與案例名稱；
  已登入路徑才依序驗證 seed 建帳號 → 登入 → `/api/auth/me` → 同 cookie 的受保護請求。
- 新 migration 後的 `PGRST202` 優先視為 TEST migration／schema cache 訊號；
  `PGRST201` 優先檢查同表多條外鍵造成的關聯歧義。先驗 DB，再改 route。
- seed 的 optional-table 只可略過明確「表不存在」；欄位、外鍵、權限、cache 或未知
  錯誤必須 fail closed（失敗即停止），不可假裝 seed 成功。
- 測試沒有真正開始不能算綠；成功 toast 也不能證明副作用真的發生。
- 先檢查再分段寫入可能留下半套資料；撞班、名額、收款與狀態轉移須用 transaction／
  atomic RPC（同一次資料庫操作）保護，並測並發。

### 7.2 CI 文件分流

- CI 只可把**完全**落在 `docs/**`、`README.md`、`AGENTS.md`、`CLAUDE.md`、
  `.agents/**` 或 `.claude/**` 的非空 diff 視為 docs-only；PR 必須比較 base→head，
  `main` push 必須比較 before→after，rename 的舊／新路徑都要檢查。
- `workflow_dispatch`、缺 revision、空 diff、git／payload 解析失敗、未知 status 或任何
  白名單外路徑一律 fail closed，走完整 runtime CI。workflow、依賴、測試或應用程式
  變更不得靠路徑略過。
- 分類 job 必須輸出 `docs_only`、`reason`、`detail`、`changed_count` 與 `runtime_path`，並把
  同一判定寫入 GitHub Step Summary；任何無法可靠分類的 machine reason 固定為
  `classifier_failed`，詳細原因只寫在 `detail`。
- docs-only 路徑只做不需 npm、TEST secret 或 Chromium 的輕量 check／integration，且不得
  等待或佔用 TEST lane；完整路徑仍依序跑 check，再在固定
  `shared-test-supabase-integration` lane 內跑 integration→E2E，`cancel-in-progress: false`。

## 8. 錯誤停止線與恢復

- 同一驗證路徑連續兩次遇到**環境錯誤**，停止重試；只有權限、設定、服務狀態或
  其他環境條件真的改變後才重新計數。這與 TDD 的「實作修改三次仍紅」是不同規則。
- 停止該路線後，保存最小錯誤、已試條件與下一個可驗證假設；改走不同安全路線，
  或先做其他不相依 Issue。不得因此結束整個專案 goal。
- agent 長時間沒有提交時，要求最小檢查點：變更檔、目前 commit、重現指令、
  技術阻塞與可推送內容。拿回檢查點後整合、換路或重新派工。
- 不以刪測試、放寬斷言、隱藏按鈕、mock 假成功或靜默略過錯誤解除阻塞。

## 9. 證據、文件與教訓

每個完成項目至少記錄：

- Issue／PR、base/head 與提交；
- 驗收項目對應的測試檔與案例；
- 實際執行指令、結果與 CI 連結；
- TEST migration 基線／套用／schema cache／目標查詢證據；
- 未驗證範圍、殘餘風險、環境錯誤次數與 Owner 待辦；
- SCOUT／TRIAGE／BUILD／DIAGNOSE／AUDIT／CLOSEOUT 的負責模型與結果；
- Owner control events、agent premature stops、Issue 來源；
- active candidate peak、lane 違規、Closure Sweep 盤點／提升、Sol 接觸、full CI、
  無效重跑、AUDIT 退回、close verdict 與 closed Issue。

每次發生會造成 CI／測試失敗、環境重試、錯誤診斷、半成品、權限阻塞或 agent
停滯的事件，都要依固定格式新增或更新 `docs/AGENT-PLAYBOOK.md`。至少記：事件、證據、
根因、影響、修正、預防與驗證；相同根因更新原條目的最近日期與次數，不散落到新檔。
若教訓改變正式做法，再同步更新最相關 canonical 文件。不得另建會與正式規格競爭的
第二套完整文件。

## 10. 停止條件與最終交付

只有下列情況可結束一輪長程 goal：

1. 所有 open Issue 都已具備完整驗收證據、合併到其要求的最終分支並關閉；或
2. 所有剩餘項目都確實只缺 Owner 決策、外部權限／憑證、Production 授權或
   `SOL_GATE_PENDING`，且其他可施工項目已全部完成；或
3. 執行平台本身無法繼續，且已留下另一位 agent 可直接接手的精確檢查點。

最終報告必須包含：已關閉 Issue／合併 PR、測試與 CI、TEST migration、Production
未變更確認、剩餘阻塞與推薦決策、agent 分工、WIP lanes、active candidate peak、
環境錯誤、playbook 更新，以及 §5.8 的模型與重工量測。不得只回報「目前進度」或
要求 Owner 重複已給過的授權。
