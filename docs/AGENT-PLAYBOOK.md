# Agent 失敗與教訓 Playbook

> 本檔保存「發生過什麼、為什麼、以後如何避免」。
> 正式執行規則仍在 `docs/AGENT-EXECUTION.md`，產品規格仍在 `docs/integration/**`；
> 本檔不得改寫兩者。

## 使用規則

- 每次任務出現會造成 CI／測試失敗、環境重試、錯誤診斷、半成品、權限阻塞或
  agent 派工停滯的事件，都必須在任務收尾前新增或更新一筆。
- 已有相同根因時，不複製另一篇；更新「最近發生、次數、證據與新增預防措施」。
- 紅燈是 TDD 預期結果且立即證明測試有效時，可不另記；若紅燈揭露制度／環境／
  契約問題，仍須記錄。
- 不寫入 token、密碼、key、完整 `.env`、顧客個資或可重建秘密的日誌。
- Agent 開工時用 Issue、錯誤碼、測試名或領域關鍵字搜尋本檔，只讀直接相關條目，
  不為了形式全量重讀所有歷史。

## 每筆必填格式

```md
### PB-XXX — 短標題

- 首次／最近：YYYY-MM-DD／YYYY-MM-DD
- 發生次數：N
- Issue／PR／CI：連結或編號
- 分類：CI｜TEST DB｜Auth｜Migration｜Agent｜權限｜其他
- 事件：實際發生什麼
- 證據：失敗 step、案例、狀態碼或最小重現指令
- 根因：為什麼發生，不寫猜測
- 影響：哪些工作／資料／判斷受影響
- 修正：本次如何解除
- 預防：下次開工前或 CI 如何提前擋下
- 驗證：修正後的測試／查詢／CI
- 狀態：已防止｜監看中｜仍待處理
```

## 已知教訓索引

| ID | 教訓 | 根因與預防摘要 | 正式規則位置 |
|---|---|---|---|
| PB-001 | 測試未開始不能算綠 | job 排隊、取消或卡在 setup 時沒有執行案例；必須看 suite／step 終態與案例數。 | `docs/AGENT-EXECUTION.md` §7 |
| PB-002 | 共用 TEST 不可平行清空 | 多條 integration／E2E 同時 reset/seed 會互刪資料；所有會改 TEST 狀態的工作序列化。 | `docs/AGENT-EXECUTION.md` §7；`12-TESTING-TDD.md` §1.5 |
| PB-003 | seed 不可把欄位錯誤當 optional table | 過寬的略過條件會把真正 schema／權限錯誤藏到下一張表；只允許明確「表不存在」。 | `docs/AGENT-EXECUTION.md` §7.1 |
| PB-004 | 單一 401 不等於登入壞掉 | 負向測試本來就應回 401；先看案例契約，再驗登入→`/api/auth/me`→同 cookie 請求。 | `docs/AGENT-EXECUTION.md` §7.1；`12-TESTING-TDD.md` §2.3.1 |
| PB-005 | 新 migration 後先查 TEST 基線與 cache | `PGRST202` 常是 migration 未套用或 schema cache 未刷新；不能先猜 route 壞掉。 | `docs/AGENT-EXECUTION.md` §3.1、§7.1 |
| PB-006 | 測試要鎖行為，不鎖無關字串排列 | 精確比對查詢欄位字串會讓安全新增欄位誤報回歸；斷言必要欄位與真正副作用。 | `12-TESTING-TDD.md` §2.3、§6 |
| PB-007 | 關鍵寫入不可先查再分段寫 | 並發時兩邊都可能通過舊快照，留下撞班、超賣或半套資料；使用 transaction／atomic RPC 並測競爭。 | `docs/AGENT-EXECUTION.md` §7.1 |
| PB-010 | PR 多檔遠端更新必須原子提交 | Contents API 每檔一 commit 會讓同一 PR 同時啟動多輪 TEST；先建 blobs/tree，再一次 create commit + update ref。 | `docs/AGENT-EXECUTION.md` §6、§7 |
| PB-011 | TEST 寫入前掃全 repo active runs | 只看已知 PR 會漏掉新啟動的 workflow；每次 migration/reset/seed 前即時查全 repo `in_progress`／`queued` runs。 | `docs/AGENT-EXECUTION.md` §7；`12-TESTING-TDD.md` §1.5 |
| PB-012 | 平行 agent 不共用 checkout | 不同 agent 即使改不同檔，切換同一 worktree 的 branch 仍會污染 HEAD、測試與 commit；每條寫入線使用獨立 worktree／clone。 | `docs/AGENT-EXECUTION.md` §6 |
| PB-013 | 多端點整合逾時要標出單一步驟 | 總 timeout 只能證明整條流程太慢；每個 HTTP／DB／Auth 步驟都要有較短上限與穩定 label，先分出真回歸與外部延遲。 | `12-TESTING-TDD.md` §2.3.1、§6 |
| PB-014 | 權限 migration 同時驗 deny 與 allow | 只測 anon/authenticated 已撤權不夠；每個 server-only table/RPC 還要明確 grant `service_role` 並驗證正向可用。 | `02-SUPABASE-SCHEMA.md`；`12-TESTING-TDD.md` §6 |

## 事件紀錄

PB-001～PB-007 是從舊任務帶回、但當時未保存完整日期與證據的「既有教訓摘要」，
不得為補格式而捏造歷史資料。它們第一次再次發生時，沿用原 ID，在本節依必填格式
建立完整事件條目，並從該次開始維護最近日期、次數與證據。

不屬 PB-001～PB-007 的新根因從 `PB-008` 開始；已有完整事件條目的相同根因只更新
原條目，不另編號。

### PB-003 — seed 把缺欄位誤判成 optional table

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：[CI run 33149309897](https://github.com/smallwei0301/vibeaico-admin-rebuild/actions/runs/33149309897)
- 分類：CI／TEST DB
- 事件：integration global setup 在 seed `trip_plans` 時遇到缺欄位，卻記成「資料表尚未建立」並繼續；隨後 `trip_departures` 因參照未建立的 plan 而失敗。
- 證據：integration job `98777353298` step 5；`trip_plans` 回傳 `Could not find the 'price_per_person' column ... in the schema cache`，後續 `trip_departures` 回傳 PostgreSQL `23503` 與 `trip_departures_tenant_trip_plan_fkey`。
- 根因：`scripts/test/seed.mjs` 的 `isMissingSchemaError` 無條件接受 `PGRST202`、`42883` 與任何包含 `schema cache` 的訊息，讓缺欄位／缺 function 也走 optional-table 略過路徑；子表 seed 又未依父表寫入結果停下。
- 影響：reset 已清空共用 TEST 並重建部分 seed，但 integration 測試尚未開始、E2E 被跳過，整體 CI 為 failure；文件變更與 `check` job 不受影響。
- 修正：本次先保留精確 job／錯誤／程式位置並停止相同重試；seed classifier 與 TEST migration 基線需由後續施工 Issue 一起修復。
- 預防：optional-table 只接受可證明「relation／table 不存在」的 code 或訊息；父資料略過時不得繼續寫入依賴它的子資料，並為錯誤分類器補 table-missing／column-missing／function-missing 測試。
- 驗證：本次尚未修復；`check` job 的 typecheck、107 個 unit tests 與 build 通過，integration／E2E 未通過。
- 狀態：仍待處理

### PB-008 — GitHub connector 與 shell git 是不同認證通道

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：專案 agent 常駐自主執行規則文件更新
- 分類：權限
- 事件：本機 commit 完成後，使用 shell `git push origin main` 無法取得 GitHub HTTPS 認證。
- 證據：push 回傳 `fatal: could not read Username for 'https://github.com': No such device or address`。
- 根因：ChatGPT 已連結的 GitHub connector 與執行環境中的 shell git 使用不同認證通道；connector 可用不代表 shell 已配置 username／token。
- 影響：第一次遠端推送路徑被阻塞，但本機 commit 與檔案內容未受損。
- 修正：改用已授權的 GitHub connector，以 Git Data API 原子建立 tree／commit 並更新 `main` ref。
- 預防：需要遠端寫入時先辨識可用通道；shell 未配置認證就直接使用 connector，不重試或要求輸出秘密。
- 驗證：從 remote `main` 回讀新 commit 與八份變更檔，並比對其 tree 內容與本機一致。
- 狀態：已防止

### PB-009 — 長程 goal 誤把階段回報送成 final

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：3
- Issue／PR／CI：`/goal` 自主推進（#36、#39、#40）
- 分類：Agent
- 事件：#36 的 integration 尚未完成、#39 仍待正確整合、#40 尚有 Telegram 綁定入口時，主力三次送出 final 回覆，工作階段因此停止等待下一次使用者訊息。
- 證據：本對話中三次 final 都列出未完成工作，卻沒有對應 `docs/AGENT-EXECUTION.md` §10 的停止條件。
- 根因：把「本回合已有可回報成果」誤當成「長程 goal 可以交付」，沒有在送 final 前執行停止條件核對。
- 影響：CI 等待與後續可施工項目沒有自動接續，需要 Owner 額外提醒，違反常駐自主執行規則。
- 修正：在 `docs/AGENT-EXECUTION.md` §1 加入 final 防呆；未達 §10 時只允許非終止進度並轉往下一個工作。
- 預防：每次準備送 final 前先寫出 §10 的 1／2／3 哪一項成立；寫不出即不得送 final。等待 CI 時優先處理不碰共用 TEST 的工作。
- 驗證：後續 `/goal` 由主力以此條目作開工檢查；未完成 Issue、未驗證測試與排隊工作必須保留在責任表。
- 狀態：監看中

### PB-010 — PR 多檔遠端更新拆成多個 commit，平行啟動共用 TEST

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：PR #52；CI run #156、#157、#158
- 分類：CI／TEST DB／Agent
- 事件：為 #27 同步四個已驗證的 seed 基礎檔時，使用 GitHub Contents API 逐檔更新；每一檔都立即產生 commit，PR 因而連續啟動三輪可見 CI，而 workflow 沒有 concurrency 自動取消舊輪。
- 證據：同一 PR 分支在數秒內產生 `c18a575`、`03e090d`、`9f7070a`，對應 run #156、#157、#158 均進入 `in_progress`。
- 根因：把「多檔同步」誤當成可安全逐檔寫入，未先確認 PR workflow 每次 synchronize 都會觸發 integration，也未使用 Git Data API 將多檔組成單一 tree／commit。
- 影響：被取代的 run 仍可能和最新 run 同時 reset／seed 共用 TEST，舊 run 的成功或失敗皆不可作候選證據；在全部舊 run 終止前不得啟動其他 TEST 線。
- 修正：停止新增 TEST 工作，只以最新 HEAD `9f7070a` 的 run #158 作候選；#156/#157 視為 superseded，不重跑、不作驗收證據。
- 預防：凡已開 PR 的遠端多檔修改，先建立所有 blobs 與單一 tree，再一次 create commit + update ref；若工具無法原子提交，先在未開 PR 的 staging branch 完成所有檔案，再以一次 ref 更新接到 PR head。workflow 另應加入以 PR/ref 為 key 的 concurrency + cancel-in-progress。
- 驗證：待 #156/#157/#158 全部終止後，確認只有 #158 的 exact HEAD 可進下一步，並在後續首次原子多檔更新時回查只建立一個 CI run。
- 狀態：監看中


### PB-011 — TEST 寫入前只看已知佇列，漏掉新啟動的整合測試

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：PR #49、PR #52；CI run 33163294908、33163685282
- 分類：CI／TEST DB／Agent
- 事件：套用 TEST migration 0037 前只核對既有責任表與已知 PR，沒有重新掃描整個 repository 的 active Actions；因此 migration 在 PR #52 舊 integration 的尾端執行。
- 證據：TEST migration ledger 為 `20260828103045 0037_issue_37_batch_error_classification`；PR #52 integration job 98822645398 的執行區間是 10:25:26–10:32:21 UTC，兩者時間重疊。
- 根因：把「責任表中只有一條 TEST 工作」誤當成「GitHub 現在只有一條 active TEST 工作」，缺少每一次破壞性或結構性 TEST 寫入前的全 repo 即時門檻。
- 影響：違反共用 TEST 序列化規則，讓 PR #52 舊失敗的歸因風險升高。0037 只替換團次 batch RPC，沒有碰該輪失敗的 rich-menu／通知資料，後續 #37 目標整合案例也通過；目前沒有證據顯示 0037 造成該輪失敗，但這不降低流程缺口的嚴重性。
- 修正：停止其他 TEST 寫入；CI workflow 加入固定 `shared-test-supabase-integration` concurrency group，並以 repo-wide active run 查詢確認只剩一條工作。
- 預防：每次 TEST migration、reset、seed、完整 integration 或 E2E 前，重新查詢整個 repo 的 `queued`／`in_progress` Actions，不得只讀 PR 清單、責任表或先前查詢；發現未知 workflow 時立即排隊。
- 驗證：PR #52 run 33164035229 完整綠燈後，PR #49 run 33163685282 attempt 2 才取得 concurrency lock 並開始 integration，兩條工作未再重疊。
- 狀態：監看中


### PB-012 — 平行 agent 共用 worktree，branch 與未追蹤檔互相污染

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：Issue #34、#35；staging branches `test/issue-34-guide-pending-booking-badge`、`test/issue-35-preview-e2e-acceptance`
- 分類：Agent／其他
- 事件：#34 與 #35 雖修改不同檔案，卻在同一 Git worktree 平行切 branch；#35 的未追蹤 E2E 檔進入 #34 的 typecheck 視野，#34 commit 建立時 HEAD 已被切到 #35 branch。
- 證據：#34 typecheck 因非本工作建立的 `tests/e2e/page-local-fields.35.spec.ts` 發生 TS2739；commit `97d272d` 的 parent 雖正確是 `7eb63d81`，建立當下 symbolic HEAD 指向 #35 branch，需另把 #34 自有 ref 指回該 commit。
- 根因：派工只隔離「檔案範圍」，沒有隔離 Git index、HEAD、未追蹤檔與建置輸出；不同 branch 的 shell 操作仍共享同一 checkout。
- 影響：#34 的 typecheck/build 證據被 #35 未完成檔案污染，兩條 staging branch 暫時共享錯誤 ancestry；提交沒有遺失，但需要額外整理與回讀。
- 修正：停止共享 worktree 的 checkout/reset；保留 #34 commit 到自有 branch，#35 改在獨立 worktree／clone 或以 Git Data API 從精確 base 建乾淨 ref。
- 預防：每位會寫檔或提交的平行 agent 必須有獨立 worktree／clone；只讀 agent 可共用。派工前記錄 worktree path，提交前核對 symbolic HEAD、parent、changed files，遠端同步後再核對 ancestry/tree。
- 驗證：#34 已在隔離 clone 建立遠端 branch `test/issue-34-guide-pending-booking-badge`；#35 已在另一個隔離 clone 建立 `test/issue-35-preview-e2e-acceptance`，遠端 compare 只含各自目標檔。後續 #35 安全修正仍以 non-force fast-forward 更新同一獨立 branch，未再污染 #34。
- 狀態：已解決

### PB-013 — 真實 auth 流程只放寬總 timeout，仍看不出卡在哪一步

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：PR #49；CI run 33167858331（run #162）
- 分類：CI／測試／外部服務
- 事件：`tests/integration/api/auth.03.test.ts` 的「寄碼 → 註冊 → 登入 → me」在固定 30 秒總預算被 Vitest 截斷；四個端點實際都有成功跡象，但 E2E 因 integration job 失敗未開始。
- 證據：run #162 唯一失敗在 `auth.03.test.ts:128`；register 約 12.374 秒、login 約 10.344 秒，整條約 30 秒。原案例還有一次明確 login 後再由 `loginAs()` login，且 `/me` 也重複 preflight／斷言。
- 根因：單一總 timeout 包住多個真實 HTTP、PostgREST 與 Supabase Auth admin 步驟，錯誤只回報案例逾時，不能定位是哪個外部呼叫停住；測試中的重複登入也消耗不必要預算。
- 影響：一次外部延遲被表現成整條 auth flow 失敗；只把總 timeout 改 60 秒可讓候選繼續驗證，但下一次卡住仍缺精確診斷。
- 修正：保留 60 秒總上限作整體防線，另在 staging `codex/auth03-diagnostics` 為每個 endpoint／DB／Auth admin 步驟加入 20 秒界線與可搜尋 label；沒有吞錯或放寬 assertion。
- 預防：凡一個 integration case 串三個以上外部步驟，每步都要有 AbortSignal／timeout race 與穩定操作名稱；總 timeout 只負責最後兜底。重複 helper preflight 要在案例設計時明列，不可默默增加一次完整登入。
- 驗證：staging typecheck、72 files／924 unit tests、mock build 通過；真實 TEST integration 尚待 #49 唯一工作釋放後，以 exact-head CI 驗證。
- 狀態：監看中

### PB-014 — 只撤銷瀏覽器 RPC 權限，漏掉 service role 正向授權

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：Issue #40；migration `0038_notification_outbox_delivery.sql`
- 分類：資料庫／安全／測試
- 事件：#40 source migration 已 `revoke` anon/authenticated/PUBLIC 的 ledger 與 privileged RPC，但最初版本沒有明確 `grant` `service_role`；單元測試也只數 revoke，沒有驗 server worker／webhook 的正向能力。
- 證據：migration 審查時六條 `revoke execute` 存在，但沒有任何 `grant execute ... to service_role`；若專案 default privileges 不同，claim、status refresh、Resend callback 與 Telegram bind RPC 會在 TEST 才報 permission denied。
- 根因：把 Supabase 專案可能存在的 default grants 當成 migration 契約，權限測試只看「誰不能做」，沒看「唯一應該能做的人是否真的能做」。
- 影響：安全面看似收緊，實際 server-only 路徑可能全部不可用；錯誤會延後到 migration 套用後才出現。
- 修正：0038 明確 grant service role ledger table access與五支 server RPC execute；trigger-only function 維持無 API execute。schema unit 同時鎖正向 grant 與負向 revoke。
- 預防：每個 ACL migration 建立角色矩陣：anon、authenticated、service_role 逐一寫 allow／deny；測試不得只用 revoke 數量代表完成。
- 驗證：#40 schema／delivery 相關 147 個 unit tests與 typecheck 通過；TEST 真實 `has_function_privilege`／RPC 呼叫待序列化 migration 後驗證。
- 狀態：監看中
