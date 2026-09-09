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
| PB-008 | GitHub connector 寫入不等於 CI 已觸發 | connector 與 shell 是不同認證通道，且 Git Data／Contents 寫入可能不產生 Actions run；必須回查 exact-head workflow。 | `docs/AGENT-EXECUTION.md` §6、§7 |
| PB-010 | PR 多檔遠端更新必須原子提交 | Contents API 每檔一 commit 會讓同一 PR 同時啟動多輪 TEST；先建 blobs/tree，再一次 create commit + update ref。 | `docs/AGENT-EXECUTION.md` §6、§7 |
| PB-011 | 驗收帳號必須能看見受測入口 | GUIDE 隱藏一般預約導覽，不能驗 bookings badge；先由產品閘門選可見入口的 fixture。 | `docs/AGENT-EXECUTION.md` §7 |
| PB-012 | 靜態檢查不能驗證 SQL 語意 | SELECT alias 不能在同層 WHERE 使用，且 DB enum 與 UI enum 不同；對 DB 實跑或鎖 schema mapping。 | `docs/AGENT-EXECUTION.md` §7.1 |
| PB-013 | build workspace artifact 可在編譯後失敗 | page collection 清理殘留 artifact 時可報 `ENOTEMPTY`；保留首個完整證據、清 workspace 後單次重驗。 | `docs/AGENT-EXECUTION.md` §7 |
| PB-014 | 遠端 Git tree 必須先過完整性閘門 | 原子 commit 只能減少 push 次數，不能證明 tree 完整；核心路徑、異常大量刪檔、裸 SHA、`npm ci`、typecheck 與 build 必須在 Preview 前驗證。 | `docs/AGENT-EXECUTION.md` §8；`scripts/ci/repo-integrity-guard.mjs` |
| PB-015 | 本機與 CI 的 base 不同就不能互相佐證 | `workflow_dispatch` 使 `base_revision` 為空，守門腳本退回 `HEAD^`。凡是 `HEAD^ != main` 的分支形狀都會誤判：head 為 merge commit、或分支有第二顆 commit 動到自己新增的 migration。錯誤指向不屬於本次變更的檔案時，先懷疑 base。**規則：帶 migration 的分支一律壓成置於 main 之上的單一 commit。** | `docs/AGENT-EXECUTION.md` §7；Issue #227 |
| PB-016 | 退出碼被蓋掉的檢查等於沒有檢查 | 管線退出碼取最後一個命令，`&&` 後的 echo 只反映前一個；`grep` 無 match 也回非零。驗證命令不得放管線中段，測試不得依賴 `grep` 退出碼。 | `docs/AGENT-EXECUTION.md` §7.1；`12-TESTING-TDD.md` §6 |
| PB-017 | 先套用再改檔名會留下 ledger 偏差 | migration 編號是跨分支共享序列，未進 main 前都可能被別人佔走；套用時機必須晚於「檔名在 main 定案」。改檔名時一律全 repo grep 舊檔名。 | `docs/AGENT-EXECUTION.md` §3.1；`docs/DELIVERY-CHAIN.md` |
| PB-018 | 「只是查一下」的寫入同樣佔用 TEST lane | PB-002 的序列化不只約束 reset/seed。任何對 canonical TEST 的 `DELETE`／`INSERT`／`UPDATE`——包含為了排查而下的一次性清理——都會讓同時段的 CI 測試看見不屬於它的狀態。動手前先查 canonical lane 是否被佔用。 | `docs/AGENT-EXECUTION.md` §3.1、§7；`12-TESTING-TDD.md` §1.5 |
| PB-019 | 「repo 裡沒有」不等於「沒有做過」 | 實作可能躺在一條未併回 `main` 的分支上——而那條分支可能正是線上服務實際在跑的版本。判定「這個功能不存在」之前，先查線上跑的是哪一顆 commit，再查它是不是 `main` 的祖先。 | `docs/AGENT-EXECUTION.md` §7；`docs/DELIVERY-CHAIN.md` |
| PB-020 | 量測外部打進來的路徑前，先確認它打到哪裡 | 「對正式站量測」與「對 configured endpoint 量測」是兩件事。先唯讀查出目標位址並確認它屬於哪個部署，再開始量；否則數字會被歸因到錯的程式碼上。 | `docs/AGENT-EXECUTION.md` §7 |
| PB-021 | 改 PR body 修 metadata，對只監聽 `synchronize` 的 workflow 是無效操作 | `pull_request` 的 `types` 不含 `edited` 時，改 body 不會重觸發；而 `rerun_failed_jobs` 重播的是**原始 event payload**（含舊 body），所以重跑同樣讀到舊值。需用該 workflow 自帶的 `workflow_dispatch`。 | `docs/AGENT-EXECUTION.md` §7；`.github/workflows/local-isolated-test.yml` |
| PB-022 | `.gitignore` 的目錄規則不涵蓋同名 symlink | `node_modules/` 只比對目錄；同名的 symlink 是另一種型別，會被 `git add` 收下，且能通過 typecheck、全量測試、repo-integrity-guard 與全部 CI。rebase 或建 worktree 後必須重讀 `git diff --name-status`。 | `docs/AGENT-EXECUTION.md` §8；`.gitignore` |
| PB-023 | 丟掉 Supabase 的 `error`，會讓「查失敗」冒充「查無資料」 | `const { data } = await …` 捨棄 error；PostgREST 一出錯 `data` 就是 null，於是走進「沒有資料」分支，對使用者宣告一個我們根本沒驗證過的事實。查詢失敗必須與空結果分開處理。 | `CLAUDE.md`（誠實原則）；`14-GAP-AUDIT.md` §1 根因 A |
| PB-024 | FK constraint 名稱在不同安裝路徑上不同，不可綁進 runtime | canonical（`create table`）與整合測試的 historical overlay 產生的 constraint 名稱不是同一組；PostgREST 的 `!fk_name` embed hint 因此在其中一邊解不開。多條 FK 造成 ambiguous embed 時，改用多次一般查詢。 | `12-TESTING-TDD.md` §1.5；`supabase/local-migrations/**` |
| PB-025 | mutation 有 entitlement 閘門、read path 沒有，等於留後門 | 讀取路徑若只看「資料庫有沒有資料」，訂閱到期的租戶只要歷史資料還在就照樣讀得到——**用「有沒有資料」代替「有沒有權利」**，且完全沒有症狀。閘門必須在任何 domain SELECT 之前。 | `docs/integration/10-TOUR-DOMAIN.md` §6.1；`docs/integration/09-*` §5 |
| PB-026 | `create table if not exists` 遇到「同名但形狀不同」的表會靜默跳過 | 既有表可能來自另一條安裝路徑（historical overlay），欄位與 check constraint 都不同。migration 顯示成功、什麼都沒建，程式接著對著一個**不是自己定義的契約**寫入，直到某個約束把它擋下來才發現。帶新表的 migration 必須像 `0066` 那樣「加法且會協調」，不能只 `if not exists` 就當作冪等。 | `supabase/migrations/0066_*.sql`（協調範例）；`supabase/local-migrations/**` |
| PB-027 | 用「名字出現幾次」代替「那件事真的會發生」 | 四種同型：規格存在≠功能可用、路由存在≠功能可用、政策提到≠物件存在、符號出現≠符號被使用。`grep -c` 數到的可能全是**定義本身**（一支 service 的 export ＋ 型別就兩次）。可機械檢查的判準是**「呼叫端在哪裡」**，不是名稱出現次數。 | `docs/integration/14-GAP-AUDIT.md` §7.4.4 |

## 事件紀錄

PB-001～PB-007 是從舊任務帶回、但當時未保存完整日期與證據的「既有教訓摘要」，
不得為補格式而捏造歷史資料。它們第一次再次發生時，沿用原 ID，在本節依必填格式
建立完整事件條目，並從該次開始維護最近日期、次數與證據。

不屬 PB-001～PB-007 的新根因從 `PB-008` 開始；已有完整事件條目的相同根因只更新
原條目，不另編號。

### PB-002 — 共用 TEST reset／migration 必須使用同一把跨分支鎖

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：3
- Issue／PR／CI：PR #49 Run 164／PR #53 Run 168、Run 172；Issue #40／#50 TEST rollout
- 分類：CI／TEST DB／Agent
- 事件：舊 main／PR workflow 在另一輪 integration 中途 reset 共用 TEST，讓 tenant、session 與 seed 消失；後續人工序列化 rollout 期間，又在 `0039` 前 14 秒出現未由該工作線排程的 `0040_notification_booking_modification_revision`。
- 證據：Run 172 global setup 成功後 155 例通過，尾端 restore/upsert 以 `23503` 指向已消失的 `tenant-a`／`tenant-b`；migration history 顯示 `0040_notification_booking_modification_revision` 於 13:43:02 UTC、`0039_keyword_reply_images` 於 13:43:16 UTC 寫入。
- 根因：只有新 PR 具固定 concurrency group，舊 main／PR workflow 與其他 session 的 Management API migration 不共享同一鎖；「本 agent 沒有啟動第二條 TEST 線」不等於整個 project 已單線化。
- 影響：Run 164／168／172 的 integration 尾端與 E2E 不可作候選證據；0040 的來源與 schema 契約需先分類，#41 不可盲目用相同 prefix 再套 migration。
- 修正：停止第三次盲目重跑；每次 TEST DDL 前後回查 migration history，發現外部寫入立即停止下一條 DDL 並改做唯讀稽核；不 reset 或回滾未知變更。
- 預防：所有 reset／seed workflow 必須先在 main 收斂到相同跨分支 concurrency group；人工／agent TEST DDL 另需一個 project-level lease（含 session、issue、預期 migration），CI 與 Management API 共用。
- 驗證：Run 172 已精確分類並回填 PR #53；0038／0039 各自完成 post-DDL live ACL 驗證，但未知 0040 尚待來源與 schema 稽核。
- 狀態：仍待處理

### PB-003 — seed 把缺欄位誤判成 optional table

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：[CI run 33149309897](https://github.com/smallwei0301/vibeaico-admin-rebuild/actions/runs/33149309897)
- 分類：CI／TEST DB
- 事件：integration global setup 在 seed `trip_plans` 時遇到缺欄位，卻記成「資料表尚未建立」並繼續；隨後 `trip_departures` 因參照未建立的 plan 而失敗。
- 證據：integration job `98777353298` step 5；`trip_plans` 回傳 `Could not find the 'price_per_person' column ... in the schema cache`，後續 `trip_departures` 回傳 PostgreSQL `23503` 與 `trip_departures_tenant_trip_plan_fkey`。
- 根因：`scripts/test/seed.mjs` 的 `isMissingSchemaError` 無條件接受 `PGRST202`、`42883` 與任何包含 `schema cache` 的訊息，讓缺欄位／缺 function 也走 optional-table 略過路徑；子表 seed 又未依父表寫入結果停下。
- 影響：reset 已清空共用 TEST 並重建部分 seed，但 integration 測試尚未開始、E2E 被跳過，整體 CI 為 failure；文件變更與 `check` job 不受影響。
- 修正：`seed.mjs` 與 `reset-db.mjs` 的可略過分類只保留「relation／table 不存在」；`PGRST202`／`PGRST204` 缺欄位與 `42883` 缺 function 一律立即失敗。標準 seed 的旅遊方案價格欄位同步為現行 `base_price`。`trip_plans` 未成功寫入時，seed 明確略過依賴它的 `trip_departures`，不再造成第二個外鍵雜訊。
- 預防：optional-table 只接受可證明「relation／table 不存在」的 code 或訊息；父資料略過時不得繼續寫入依賴它的子資料，並為錯誤分類器補 table-missing／column-missing／function-missing 測試。
- 驗證：新增單元測試區分 missing table、missing column、missing function；待有新 TEST CI 時驗證會在 schema mismatch 的原始錯誤停止，且不產生子表 FK 錯誤。
- 狀態：監看中

### PB-008 — GitHub connector 寫入成功不代表 exact-head CI 已觸發

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：3
- Issue／PR／CI：專案 agent 常駐自主執行規則文件更新；`main` docs-only commits
- 分類：權限
- 事件：shell `git push` 無 GitHub HTTPS 認證；改用 connector 的 Git Data 與 Contents 路徑後，commit/ref 都成功更新，但兩種路徑都沒有為 exact HEAD 建立 Actions run。
- 證據：shell 回傳 `fatal: could not read Username for 'https://github.com': No such device or address`；connector 回讀 commit/ref 正確，但 `fetch_commit_workflow_runs` 對新 SHA 持續回傳 `[]`。
- 根因：connector 與 shell git 是不同認證通道；connector 寫 ref 的事件來源亦不保證觸發 GitHub Actions，因此「遠端已有 commit」與「CI 已排程」是兩個獨立事實。
- 影響：文件可安全落到遠端，但不能拿不存在的 workflow 當 exact-head CI 證據；需要 CI 的 Issue 仍未完成。
- 修正：保留已回讀一致的 docs commit，將缺少 Actions run 精確標成環境 blocker；Git Data、Contents 各已證明一次後停止第三次盲目寫入。
- 預防：每次 connector 更新 ref 後，同時回查 ref SHA 與該 SHA 的 workflow runs；空陣列不得解讀為綠燈，也不得靠重複無實質差異的 commit 刺激 CI。
- 驗證：remote ref/tree 與預期一致；exact-head workflow 查詢仍為 `[]`，故 CI 觸發問題仍待外部環境解除。
- 狀態：仍待處理

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

### PB-011 — GUIDE 隱藏受測導覽，驗收 fixture 選錯產品型態

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：Issue #34；PR #49；舊候選 `d057481`、修正 `1d0896d`
- 分類：CI／其他
- 事件：Preview verifier 用 GUIDE 帳號建立 PENDING booking，再期待側邊欄顯示 `/tenant/bookings` badge；但 GUIDE 的產品閘門本來就隱藏該導覽。
- 證據：GUIDE run 無法定位 bookings nav；修正後的 unit 契約明確鎖定 GUIDE 不得作此 fixture。
- 根因：驗收腳本只檢查資料能否建立，沒有先檢查受測 business type 是否可看見 UI 入口。
- 影響：舊 run 的 badge 結果無效且被新 HEAD 淘汰，不能作 #34 驗收證據。
- 修正：改用 canonical `owner-a@test.local`／`LOCAL_SHOP` fixture，要求非零 API、DB 與可見 badge 三方相等；舊 run 標為 superseded。
- 預防：寫 Preview verifier 前先由 nav／feature gating 契約確認 fixture 可見受測入口，並在入口 fail-fast 驗證角色與 business type。
- 驗證：`1d0896d` 的 focused unit 33、contract 8、`node --check` 與 diff-check 通過；Preview 仍須以新候選執行。
- 狀態：監看中

### PB-012 — SELECT alias 與跨層 enum 讓 Preview SQL 靜態通過、實際無效

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：Issue #35；`bf35c62`、修正候選 `acca8c2`
- 分類：TEST DB／其他
- 事件：唯讀 Preview SQL 將 `discount_type as type` 後在同層 `WHERE` 使用 `type`，同時以 UI 值 `DISCOUNT_AMOUNT`／`DISCOUNT_PERCENT` 比對 DB 值。
- 證據：原查詢含 `select ... discount_type as type ... where ... type = 'DISCOUNT_AMOUNT'`；DB schema／integration fixture 使用 `AMOUNT`、`PERCENT`、`GIFT`。
- 根因：JavaScript 語法與文字契約檢查不會解析 PostgreSQL name resolution，也沒有明確維護 DB enum→UI enum mapping。
- 影響：腳本通過 `node --check` 仍會在真 DB 失敗或找不到代表資料，無法產生可信的 DB→UI 證據。
- 修正：`WHERE` 改用真欄位與 DB enum，`SELECT CASE` 再映射成 UI enum 供覆蓋判斷。
- 預防：含 SQL 的 verifier 至少對相同 schema 執行唯讀 prepare/query；另以測試鎖定欄位名、DB enum 與 UI mapping。
- 驗證：修正 SQL 已在 `acca8c2` 收斂並通過 diff-check；真 Preview DB/UI 驗收仍待執行。
- 狀態：監看中

### PB-013 — mock build 編譯成功後因 workspace artifact 清理失敗

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：2
- Issue／PR／CI：Issue #43；mock build page collection
- 分類：CI／其他
- 事件：compile 與 type success 後，page collection 清理 workspace artifact 時以 `ENOTEMPTY` 失敗；同一環境再次出現後停止第三次盲目 retry。
- 證據：build 已完成 compilation/type checking，後續 filesystem step 回傳 `ENOTEMPTY`，而非 TypeScript、route 或 page compile error。
- 根因：共用 workspace 留有或競爭寫入 build artifact，清理目錄時仍非空；問題位於 workspace lifecycle，不是 #43 source 語意。
- 影響：該次 mock build 沒有完整成功終態，不能用前段 compile success 代替 build gate。
- 修正：保留完整錯誤分類與已通過的獨立 type/unit 證據；第二次同環境錯誤後改由乾淨 workspace／CI 候選驗證。
- 預防：每個 build 使用獨立、乾淨的 output/worktree；清理前確認沒有其他 process 使用 artifact，第二次相同環境錯誤即改變診斷方式。
- 驗證：#43 focused tests、full unit 與 typecheck 通過；乾淨候選的完整 build 尚待驗證。
- 狀態：仍待處理

### PB-014 — Janitor dry-run 必須明確指定 repository context

- 首次／最近：2026-08-31／2026-08-31
- 發生次數：1
- Issue／PR／CI：PR #73 closure／Janitor dry-run
- 分類：Agent
- 事件：在本地直接執行 `npm run agent:pr-janitor -- --dry-run` 時，Janitor 尚未開始讀取 PR 就停止。
- 證據：命令回傳 `GITHUB_REPOSITORY must be set to owner/repo`；沒有任何 GitHub mutation、TEST 操作或 CI rerun。
- 根因：腳本刻意要求明確 `GITHUB_REPOSITORY`，避免在沒有目標的 shell 環境中掃描或寫入錯誤 repo；本次呼叫漏帶該 context。
- 影響：第一次稽核沒有產生 inventory；沒有改變遠端狀態。補上 context 後同一 dry-run 完成，回報 0 superseded、0 review、0 budget violation。
- 修正：改以 `GITHUB_REPOSITORY=smallwei0301/vibeaico-admin-rebuild` 重跑 dry-run；保持無寫入模式。
- 預防：本地執行 Janitor 前先設定並檢查精確 `owner/repo`；`--apply` 仍需額外 token 與二次確認，禁止以空值或廣泛路徑代替。
- 驗證：補 context 的 dry-run 成功；PR／Issue／TEST／CI 狀態未被 mutation。
- 狀態：已防止

### PB-015 — 本機與 CI 的 base revision 不同時，同一支守門腳本會給出相反結論

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：3
- Issue／PR／CI：Issue #227；PR #225、PR #239、PR #243；job 101605728719、101606491364
- 分類：CI
- 事件：同一個根因在一輪內打中三次，但**分支形狀各不相同**，所以前兩次的修法沒有讓我認出第三次。
  - ① PR #225 的 `check` 失敗，訊息是 `new migration prefix must be greater than base max 0082: supabase/migrations/0081_reconcile_product_order_coupon_fields.sql`。**它抱怨的 `0081` 是 `main` 上早就存在的檔案，不是該 PR 新增的。** 當時 head 是 merge commit。
  - ② PR #239：把 `main` 併進分支後再次踩到，同樣是 merge commit head。
  - ③ PR #239 的後續：分支已無 merge commit，但**有第二顆 commit 動到自己新增的 `0084`**，於是 `HEAD^` 是「已含 0084 的自家父節點」，守門腳本再次把基線最大號算成本分支的號碼。
- 證據：失敗輸出含 `"baseRevision": "HEAD^"`。本機以 `BASE_REVISION=origin/main` 執行 `scripts/ci/repo-integrity-guard.mjs` → `{ ok: true, errors: [] }`；不帶該環境變數且分支為上述任一形狀時 → 同樣誤報。
- 根因：Guard 於 lane transition 以 `workflow_dispatch` 派工；`scripts/ci/classify-changes.mjs` 的 `classifyEvent()` 對 `workflow_dispatch` 回 `classifierFailure('workflow-dispatch')`，而 `withRevisions()` 的預設值是空字串，於是 `base_revision` 為空。`.github/workflows/ci.yml` 把空值傳給 `BASE_REVISION`，`repo-integrity-guard.mjs:146` 的 `process.env.BASE_REVISION || 'HEAD^'` 因空字串 falsy 而退回 `HEAD^`。

  關鍵是：**`HEAD^` 只有在「分支恰為 main 之上的單一 commit」時才等於 main。** merge commit head 只是其中一種違反形狀；任何多於一顆 commit、且新增的 migration 不只存在於最後一顆 commit 的分支，都會誤判。我前兩次把教訓記成「merge commit 會誤判」，範圍記太窄，第三次才因此沒認出來。
- 影響：與 PR 內容無關，會偽裝成「你的 migration 編號有問題」，誘導實作者去改一個沒有問題的編號。第一次先誤判為「上一顆 head 的殘影」，浪費一個排查循環；第三次又浪費一個。
- 修正：三次都把分支壓成**置於 `main` 之上的單一 commit**，使 `HEAD^` 恰等於 `main`，CI 以自身預設即通過。**這是繞過症狀，不是修好根因。**
- 預防：① **帶 migration 的分支，推送前一律確認 `git rev-parse HEAD^` 等於 `git rev-parse origin/main`**；不等於就先壓成單一 commit。這是可機械檢查的條件，比記憶「哪些分支形狀會出事」可靠。② 比對守門腳本結論前，先確認本機與 CI 用的是同一個 base；本機刻意加了 `BASE_REVISION` 才變綠，就代表 CI 那邊不會綠。③ 錯誤訊息若指向**不屬於本次變更的檔案**，先懷疑 base 取錯，不要先改自己的檔案。④ 根因修法見 Issue #227（PR #240）：`workflow_dispatch` 時仍應解出可用 base，或在 `BASE_REVISION` 為空時**明確失敗並說明原因**，而不是靜默退回 `HEAD^`。
- 反面教訓：把教訓寫成「某個具體形狀會出事」而非「某個不變量被破壞」，就會在下一個形狀出現時失效。PB 條目的預防欄應盡量寫成**可驗證的不變量**（`HEAD^ == main`），而不是症狀清單。
- 驗證：壓成單一 commit 後，不帶 `BASE_REVISION` 執行 → `{ ok: true, errors: [], baseRevision: "HEAD^" }`；CI `check` job 101606950146 success。第三次的替代交付 PR #244 於 exact head `36022c1f` 以 `BASE_REVISION=13fafcd3` 驗得 `{ ok: true, errors: [] }`，遠端 `guard` 亦 success。
- 狀態：監看中（症狀已繞過，根因待 Issue #227 / PR #240 修）

### PB-016 — 管線或後續命令的退出碼會蓋掉失敗，讓紅燈顯示成綠燈

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：2
- Issue／PR／CI：Issue #33①（PR #223 準備期）；本輪 available-slots 標註測試
- 分類：Agent
- 事件：兩次都寫出「看起來在驗證、實際上沒有驗證」的檢查。① `npx tsc --noEmit 2>&1 | head -5 && echo TYPECHECK_OK`——`head` 成功退出，把 `tsc` 的 TS1005 失敗蓋掉，畫面照樣印出 `TYPECHECK_OK`。② 測試中以 `execFileSync('grep', ...)` 判斷「有無呼叫端」，但 `grep` 無 match 時退出碼為 1，`execFileSync` 直接拋錯——該斷言是以「測試錯誤」而非「通過」的形式存在。
- 證據：① 之後單獨執行 `npx tsc --noEmit; echo $?` 才看見非零。② `Tests 1 failed | 4 passed`，堆疊指向 `execFileSync` 那一行，而非任何 `expect`。
- 根因：管線的退出碼是**最後一個命令**的；`&&` 之後的 `echo` 只反映前一個命令。而 `grep` 把「找不到」設計成非零退出碼，與「執行失敗」共用同一個訊號。兩者都讓「沒有量到東西」與「量到了好結果」在畫面上長得一樣。
- 影響：① 帶著型別錯誤往下走一段。② 一條原本要防「標註過期」的斷言，若沒發現就會長期以錯誤形式存在，等於沒有這條斷言。
- 修正：① 改成 `npx tsc --noEmit; echo "TYPECHECK_EXIT=$?"`，直接看 `$?`。② 改用 Node `readdirSync` 遞迴掃描，不依賴 `grep` 的退出碼語意。
- 預防：**驗證命令不得放在管線中段，也不得用另一個命令的成功來宣告它成功。** 需要截斷輸出時，先取退出碼再截斷。凡是「找不到＝正常」的工具（`grep`、`find`），在測試中一律改用語言內建的檔案 API，不要靠退出碼。收到綠燈時反問一次：**如果這件事現在壞掉，這個檢查會不會變紅？** 不會就不是檢查。
- 驗證：① 修正後 `TYPECHECK_EXIT=0` 與 82 檔 817 tests 全過同時成立。② 變異測試：刪掉整段標註 → 3 條轉紅；假裝有頁面呼叫它 → 該條轉紅；還原 → 5/5 綠。
- 狀態：已防止

### PB-017 — 先套用到資料庫、後來才改檔名，會在 ledger 留下永久的名稱偏差

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：2
- Issue／PR／CI：Issue #35／PR #93（`0015 → 0079 → 0080`）；Issue #7／PR #225（`0082 → 0083`）
- 分類：Migration
- 事件：同一輪內發生兩次。migration 已經套用到 Supabase（ledger 以當時的檔名記錄），之後檔案在 repo 裡因編號競爭被改名，於是 **ledger 名稱與 repo 檔名永久不一致**。
- 證據：① 正式庫 ledger 記 `0015_page_local_display_fields`，repo 檔名最終是 `0080_page_local_display_fields.sql`（先被 `scripts/ci/repo-integrity-guard.mjs` 的編號守門擋下改為 0079，再因 main 新增 `0079_reconcile_category_bug_report_fields.sql` 順延為 0080）。② 正式庫與 canonical TEST ledger 記 `0082_staff_display_fields`，repo 檔名最終是 `0083_staff_display_fields.sql`（治理側 #226 先把 `0082_reconcile_booking_addon_notify_fields.sql` 併進 main）。
- 根因：**順序錯了。** 套用到資料庫的時間點早於「檔名在 `main` 上定案」的時間點。migration 編號是**跨分支共享的單一序列**，只要還沒進 main，任何人都可能先佔走同一個號碼——所以分支上的編號本質上是未定的。
- 影響：schema 本身正確（兩次的 SQL 都完全冪等，套用前後皆有唯讀驗證），受影響的只有 ledger 上的名字。但它會讓日後「用 ledger 名稱比對 repo migration」的稽核對不起來，且**不能靠重跑修正**——重跑只會在 ledger 多一筆，不會改掉舊的那筆。
- 修正：兩次都**沒有**擅自重跑或改寫 ledger，改為在 PR 與 Issue 上具名揭露為「已知偏差」，並附「內容相同、schema 已驗證」的證據。
- 預防：**先讓檔名在 `main` 上定案，再套用到資料庫。** 具體順序：① PR 合併進 main（編號至此才真正確定）→ ② 取得 Owner 逐次授權 → ③ 套用，且 `apply_migration` 的 name 一律使用 **main 上的最終檔名**。若因故必須在合併前套用（例如合併後立刻要用），就要預期並接受這筆偏差，且**在 PR 內先寫明**，不要等偏差發生才補說明。另：改 migration 檔名時，一律 `grep -rn "<舊檔名>"` 全 repo 檢查引用（測試常會讀那個檔），這一點與 PB-015 同源。
- 驗證：兩次的 schema 皆以 `information_schema.columns` / `pg_constraint` / `pg_proc` / `pg_trigger` 唯讀確認正確；#225 的檔名引用漏改在推送前即被 `tests/unit/staff-display-fields.test.ts` 以 `ENOENT` 擋下。
- 狀態：監看中（偏差已揭露，順序規則待下一輪實際遵循後才算已防止）

### PB-018 — 為了排查而下的一次性寫入，同樣會佔用 canonical TEST lane 並污染別人的測試

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：2
- Issue／PR／CI：Issue #7；PR #239；canonical TEST `nmwhwngojosmagjuvxol`
- 分類：測試環境
- 事件：CI 於 06:03:56 取得 canonical TEST lane、06:04:09 開始跑測試。我在**同一個時間窗內**為了排查 #7 的殘留資料，對 canonical TEST 下了 `DELETE`。我當時的心智模型是「這只是查一下、順手清掉，不是 reset/seed，不算佔用 lane」。
- 證據：`tests/integration/api/reports.a5.test.ts:97` 出現 `expected +0 to be 4`；我自己新增的測試同時回 400。事後以**唯讀**複查，`shop_a_bookings = 4` 仍然正確——也就是說資料沒有被永久破壞，紅燈純粹來自**執行當下**的狀態被我抽走。
- 根因：PB-002 的規則我記成「reset／seed／migration 要序列化」，但真正的不變量是「**任何會改變 canonical TEST 狀態的動作**都必須與測試執行互斥」。`DELETE` 一列和 reset 整個庫，對正在跑的測試而言沒有區別。「排查」在心理上感覺是唯讀活動，於是繞過了我自己的檢查。
- 影響：讓一個**與該 PR 無關**的既有測試轉紅。這種紅燈最貴的地方不是修，而是它會讓人去找一個不存在的程式缺陷；本輪確實先往「是不是 reports 查詢壞了」的方向查了一段。同時它也污染了該次 CI 的證據價值——那一輪的綠／紅都不能作為 exact-head 證據使用。
- 修正：未擅自重跑掩蓋，改為在 #239 上具名揭露這次違規、附上唯讀複查證明資料未受永久損害，並說明該次 CI 結果不得採信。
- 預防：① **對 canonical TEST 下任何非 `SELECT` 語句之前，先確認沒有 CI 正持有該 lane。** ② 排查一律從唯讀開始；需要改狀態才能繼續時，那就是一次**需要先取得 lane** 的正式動作，不是順手。③ 本輪自訂並沿用的延伸規則一併寫進正式規則：**任何指向 canonical TEST 的本機 server／script／Playwright 都算持有該 lane**，必須與 CI 的 canonical 執行互斥。
- 驗證：唯讀複查 `shop_a_bookings = 4`，確認為執行期干擾而非持久性損壞；後續所有對 canonical TEST 的動作改為唯讀 schema／function／privilege 等價性查詢（見 PR #244 的 `CANONICAL_TEST_STATUS: READ_ONLY_EQUIVALENCE_REQUIRED`）。
- 狀態：監看中（規則已寫明，待下一輪實際遵循後才算已防止）

### PB-019 — 「repo 裡沒有」不等於「沒有做過」：線上跑的可能是一條沒併回 main 的分支

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #251；連帶影響 #5、#6、#8、#31
- 分類：交付真相
- 事件：查 `祕島 MIDAO` LINE channel 的 webhook 指向時發現，它指的不是正式站，而是一個 branch preview 部署（`claude/deploy-vercel-project-nnno59`，commit `7ad9ac53`，2026-08-28）。進一步比對：

  ```
  git merge-base --is-ancestor 7ad9ac53 origin/main   → NOT_ANCESTOR
  git rev-list --count 7ad9ac53..origin/main          → 261
  7ad9ac53:src/server/line-events.ts   1101 行
  origin/main:src/server/line-events.ts  416 行
  ```

  那條分支**不是 `main` 的祖先**，而且功能遠多於 `main`：`replyFlexMenu` / `replyMenu` / `replyBuiltin` / `resolveBuiltinIntent` / `SYSTEM_KEYWORD_GROUPS` / `RICH_MENU_TEXT_INTENT` / `replyCoupons` / `replyTrips` / `replyDepartures` / `replyTourOrders` / `replyMember` / `replyFaq` / `pickKeywordReply` 等約 20 個處理器，`main` 一個都沒有。
- 證據：Vercel API `get_deployment` 回 `target: null`（preview）、`githubCommitRef: claude/deploy-vercel-project-nnno59`；LINE `GET /v2/bot/channel/webhook/endpoint` 回該 preview 網址且 `active: true`；上述 git 指令輸出。
- 根因：一次臨時的 webhook 指向設定沒有被收回，而該分支後來沒有併回 `main` 就被擱置。之後所有人都在 `main` 上做 CI、exact-head 驗證與五點完成驗證——**證明的是 `main` 的行為，但真實顧客走的是另一份程式碼**。
- 影響：① 2026-08-28 之後合併進 `main` 的每一項修正對該店家都未生效。② preview 部署隨時可能被回收，回收即 bot 死亡且後台無任何錯誤。③ **三張標為 `owner-blocked` 的 Issue（#5 Rich Menu 關鍵字、#6 Flex 主選單、#8 行程域）其實作就在那條分支上**——它們卡住的原因有一部分是誤判為「尚未實作」。④ 差點造成二次傷害：我原本建議「把 webhook 切回正式站」，若照做會讓該店家瞬間失去約 20 種關鍵字／選單回應，是用刪除代替補齊。
- 修正：先做唯讀 diff 判定「是 `main` 缺功能還是實驗殘留」，得到「`main` 缺功能」後**推翻自己前一則建議的處理順序**，改為「先把功能補回 `main` → 驗證 → 部署 → 才切換 webhook」。未 cherry-pick、未改 webhook 設定。
- 預防：① 判定「這個功能不存在」之前，先查**線上實際跑的是哪一顆 commit**，再查它是不是 `main` 的祖先。② 對外服務的指向設定（webhook endpoint、DNS、alias）應納入定期核對；「設完就忘」在這裡的代價是整條交付鏈的證據失效。③ 提出「把指向修回正確目標」這類建議時，先確認目標**功能不比現況少**——否則修好指向等於功能倒退。
- 驗證：唯讀 `git` 與 Vercel／LINE API 查詢；未修改任何檔案、未推送、未更動 webhook 設定。
- 狀態：監看中（已揭露並開 Issue #251，補回 `main` 的工作待裁決）

### PB-020 — 量測外部系統打進來的路徑之前，先確認它到底打到哪裡

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #31；Issue #251
- 分類：測試環境
- 事件：#31 要求對「正式站」做 LINE webhook 真實延遲量測。`POST /v2/bot/channel/webhook/test` 預設打的是 channel **configured endpoint**，而該 endpoint 當時指向一個 preview 部署。若直接開始量，拿到的數字會是 preview 的，卻被寫進 issue 當作「正式站改後證據」。
- 證據：`GET /v2/bot/channel/webhook/endpoint` 回 preview 網址；同一輪對兩個目標量測的結果差異明顯——正式站**閒置 25 分鐘後的第一發** `REQUEST_TIMEOUT`（較短閒置時 run1–3 連續逾時），而當時已暖的 preview 端點 6/6 成功。**同一支 API、同一個 channel，答案完全相反。**
- 根因：把「量測工具」與「量測對象」混為一談。`webhook/test` 是對 channel 設定的測試，不是對某個部署的測試；要指定對象必須顯式帶 `endpoint` 參數。
- 影響：差一步就把 preview 的數字當成正式站證據寫進 #31。這種錯誤特別難發現，因為數字本身是真的、API 也是官方的，只是歸因錯了。
- 修正：先唯讀查明 configured endpoint，再以 `endpoint` 參數分別量測正式站與 configured 端點，兩組數字並列呈現並各自標明對象。指定 `endpoint` 同時避免了更動店家設定。
- 預防：**量測外部系統打進來的路徑時，第一個動作是唯讀查出「它打到哪裡」，第二個動作才是量。** 數字旁邊一律標註對象與取得方式；「對正式站量測」與「對 configured endpoint 量測」在報告裡必須是兩行，不能合併成一行。
- 驗證：兩組量測皆完成並各自標註；正式庫唯讀比對確認量測零寫入（`chat_messages` 維持 6 列且全部來自 2026-08-24，`line_users` 維持 0 列）。
- 狀態：已防止（規則已落地並在同一輪實際套用）

### PB-021 — 改 PR body 修 metadata，對只監聽 `synchronize` 的 workflow 是無效操作

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #246；PR #248
- 分類：CI
- 事件：PR #248 的 `classify` 因我填錯 metadata 失敗（`FINAL_CANONICAL_REQUIRED: false`，但 `LOCAL_ISOLATED` 一律要求 `true`）。我改好 PR body 後等待重跑——**等到的是同一個紅燈**。接著用 `rerun_failed_jobs`，**又是同一個紅燈**。白等兩輪。
- 證據：`.github/workflows/local-isolated-test.yml` 的 `on.pull_request.types` 是 `[opened, synchronize, reopened]`，**不含 `edited`**；`rerun_failed_jobs` 的 attempt 2 仍在同一步驟以同一原因失敗。
- 根因：兩件事同時成立才造成這個死結——① 該 workflow 不監聽 `edited`，所以改 body 不會重觸發；② GitHub 的 re-run **重播原始 event payload**，其中的 PR body 是修正前的，所以重跑永遠讀不到新值。單看任一條都不明顯，合在一起就是「改了也沒用、重跑也沒用」。
- 影響：兩輪等待（各數分鐘）加上一次誤判——我一度以為是 metadata 還有第三個錯誤。
- 修正：改用該 workflow 自帶的 `workflow_dispatch`（輸入為 `test_profile` / `expected_head` / `final_canonical_required`），以 exact head 派工，一次通過。
- 預防：① 修 PR body 上的 CI metadata 後，**先確認目標 workflow 的 `types` 是否含 `edited`**；不含就別等，直接找 `workflow_dispatch` 或推一顆真實 commit。② `rerun_failed_jobs` 只適用於「輸入不變、環境瞬時故障」；**凡是失敗原因來自 PR metadata 的，重跑一定無效**。③ 用 `workflow_dispatch` 前先確認 PB-015 的 `HEAD^ == main` 條件成立，否則會換一個紅燈。
- 驗證：dispatch 的 run 34097639862 全綠——`classify` success、`local-isolated-a` success（integration 37 檔 246 tests、E2E 18 passed）。
- 狀態：已防止（規則已落地並在同一輪實際套用）

### PB-022 — `.gitignore` 的目錄規則不涵蓋同名 symlink，於是 `node_modules` 通過了每一道閘門

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #5；PR #254
- 分類：CI
- 事件：在 worktree 裡用 `ln -s .../node_modules node_modules` 借用相依套件。rebase 之後 `git add` 把**那條 symlink 本身**收進了索引。它通過了 `npx tsc --noEmit`、1013 條單元測試、`scripts/ci/repo-integrity-guard.mjs`（`ok: true`）與全部 9 道 CI 檢查。只有在我依習慣重讀一次 `git diff --name-status` 時才看見。
- 證據：`.gitignore` 的 `node_modules/` 尾端有斜線，只比對**目錄**；同名的 symlink 在 git 眼中是 mode `120000` 的 blob，不是目錄，因此不被該規則涵蓋。`git status --short` 會顯示 `?? node_modules`，容易被當成「就是那個被忽略的目錄」而略過。
- 根因：忽略規則的比對單位是「路徑型別 ＋ 樣式」，不是「名字」。而所有既有閘門檢查的都是**內容**（型別、測試、完整性），沒有一道檢查「這次提交是否包含不該入版控的路徑型別」。
- 影響：差一步就把一條指向 `/home/user/...` 的絕對路徑 symlink 推進 `main`。它在別人的環境會是一條斷掉的連結，且 `npm ci` 的行為會變得不可預期。
- 修正：`git rm --cached node_modules`，重新提交。
- 預防：① **在 worktree 裡借 `node_modules` 之後，push 前一律重讀 `git diff --cached --name-status` 逐檔確認**——不是看 `git status`，因為 `?? node_modules` 在兩種情況下長得一模一樣。② 改用明確列舉的 `git add <path> …`，不要 `git add -A` / `git add .`。③ 綠燈不是「沒問題」的證據，只是「這幾件事沒問題」的證據；閘門沒有涵蓋的類別，綠燈完全不表態。
- 驗證：修正後 `git diff --cached --name-status` 只剩預期的檔案；`repo-integrity-guard` `trackedCount` 回到預期值。
- 狀態：已防止（規則已落地並在其後每一個 PR 實際套用）

### PB-023 — 丟掉 Supabase 回傳的 `error`，會讓「查失敗」冒充成「查無資料」，並對使用者宣告一個假的已知

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #8；PR #258（head `d6d3f4a` → `fe97aed`）
- 分類：其他（產品誠實性）
- 事件：LINE webhook 的「行程」handler 寫成 `const { data } = await ctx.admin.from('trips').select(...)`，接著 `if (!data?.length) return replyText(ctx, MSG.tripEmptyGuide)`。PostgREST 查詢失敗時 `data` 是 null，於是它走進「沒有行程」那條路，對顧客說**「目前還沒有上架行程，敬請期待！」**——而店家後台明明上架了。
- 證據：`local-isolated-a` 紅在 `expected '目前還沒有上架行程，敬請期待！' to contain 'A 店測試行程'`。整條路徑沒有丟出例外、沒有 5xx、webhook 照常回 200。
- 根因：解構時省略 `error`，把「兩種語意完全不同的結果」（查成功且為空 / 根本沒查成功）合併成同一個 falsy 判斷。這類寫法在 happy path 完全正常，只有在錯誤發生時才顯現，而錯誤發生時它**正好**選了最糟的解釋。
- 影響：對顧客宣告一個我們根本沒有驗證過的事實（14 分冊 §1 根因 A 的形狀）。它是靜默的：不會紅、不會錯、店家不會發現，只會收到客訴說「我明明上架了」。
- 修正：接住 `error`，記進 log，回 `false` 讓它落到既有的 AI／預設回覆，**不冒充「查過了，沒有」**。次要資料（方案名稱、最低價）的失敗則只降級不擋主結果。
- 預防：① **凡是「查不到就對使用者說某件事不存在」的分支，都必須先處理 `error`**；空結果與查詢失敗要走不同的路。② code review 時看到 `const { data } =` 後面接 `if (!data)` 就要問一次「error 呢」。③ 這條同樣適用於「查不到就當作 0／未啟用／沒有權限」的寫法。
- 驗證：`fe97aed` 之後 `local-isolated-a` 綠；行程輪播、團次清單皆回真實資料。
- 狀態：已防止

### PB-024 — FK constraint 的名稱在 canonical 與 historical overlay 兩條安裝路徑上不同，不可把 runtime 行為綁在名稱上

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #8；PR #258（head `d6d3f4a` → `fe97aed`）
- 分類：TEST DB
- 事件：`trip_departures` 對 `trips`、對 `trip_plans` 各有**兩條** FK（`0066` 的單欄 FK ＋ `0067` 為 tenant-aware 完整性加的複合 FK），PostgREST 因此拒絕 embed（`PGRST201`）。我改用 `trip_plans!trip_plans_trip_id_fkey(...)` 這種**指定 constraint 名稱**的 hint 來消歧義。
- 證據：整合測試環境跑的是 `supabase/local-migrations/historical-integration-baseline/0016_tour_domain_core.sql` 先建表，於是 canonical `0066` 的 `create table if not exists` 整段跳過——兩條路徑產生的 constraint 名稱不是同一組，hint 在其中一邊解不開。
- 根因：constraint 名稱是**安裝過程的產物**，不是 schema 契約的一部分。同一份 schema 由不同 migration 路徑建成時，名稱可以完全不同，而且沒有任何地方保證它們一致。
- 影響：把「回覆送不送得出去」綁在一個純命名的差異上。更糟的是它與 PB-023 疊加：embed 失敗 → `data` 為 null → 靜默地變成「沒有行程」。
- 修正：完全不用 embed，改成兩次一般查詢（先查父表取 id，再以 `.in()` 查子表），在 JS 端組合。多一次 round-trip，換掉整類問題。
- 預防：① **不要把 constraint／index 名稱寫進 runtime 程式碼。** 需要消歧義時，優先改成多次查詢或明確的 join 欄位。② 若真的必須用 FK hint，該名稱要有 migration 明確 `add constraint <name>` 保證，且兩條安裝路徑都要有。③ 「讀 migration 推論名稱」不算驗證——只有對真實 schema 跑過才算。
- 驗證：`fe97aed` 之後 `local-isolated-a` 綠（fresh local Supabase 從 0001 建庫）。
- 狀態：已防止

### PB-025 — mutation 有 entitlement 閘門、read path 沒有，等於用「有沒有資料」代替「有沒有權利」

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #8；PR #258（Sol audit P1，head `08e1983`）
- 分類：權限
- 事件：`replyTrips()` / `replyDepartures()` 進函式後第一個動作就是查 `trips`，沒有任何 entitlement 檢查。而 `docs/integration/10-TOUR-DOMAIN.md` §6.1 的原文是「導遊模組新增內建關鍵字組，**只在租戶有 `TOUR_MODULE` 時顯示**」。
- 證據：core mutation API 早就同時擋 `MANAGER` 與 `TOUR_MODULE`（同節下方），但讀取路徑沒有。訂閱已到期或從未訂閱的租戶，只要資料庫還留著歷史的 PUBLISHED 行程，顧客就照樣從 LINE 讀得到行程與名額。
- 根因：閘門是在「寫入」那一側設計的，讀取路徑被當成「反正沒有資料就不會回」。但**資料的存在與權利的存在是兩件事**：訂閱到期不會刪資料，於是「沒有資料」這個代理條件在最需要它的時候剛好失效。
- 影響：entitlement 可被繞過，且**完全沒有症狀**——不會紅、不會錯、店家也不會發現。是最難靠測試自然抓到的一類缺陷（要抓到它，測試必須主動把訂閱關掉）。
- 修正：兩支 handler 在**任何 domain SELECT 之前**先 `isFeatureActive(tenantId, 'TOUR_MODULE')`，未啟用回 `false`（落到既有的 AI／預設回覆，顧客仍有回應）。不對顧客宣告「本店未訂閱」——那是店家的帳務狀態，講了既沒用又洩漏營運資訊。
- 預防：① **新增任何 domain 讀取路徑時，先問「這個 domain 的 mutation 擋了什麼？讀取有沒有擋一樣的東西？」** 兩側必須用同一個判準（本例讀寫都走 `isFeatureActive`，與 route 的 `requireFeature` 同源）。② 閘門的驗收必須有**負向案例**：主動停用訂閱，逐項斷言看不到任何 domain 內容，`finally` 還原後再驗一次正例——只有負向斷言的話，一個「查詢壞掉」的實作也會全綠。
- 驗證：`0dc0ca1` 的 `local-isolated-a` 綠，含負向案例（停用 TOUR_MODULE → 行程／團次皆不洩漏行程名、團次清單與輪播按鈕，且不對顧客宣告訂閱狀態）。另一個獨立佐證：補上閘門的那一顆 head 上，三條既有斷言在三個不同位置各自落到 defaultReply，證明閘門真的攔得住。
- 狀態：已防止

### PB-026 — `create table if not exists` 遇到「同名但形狀不同」的表會靜默跳過

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：1
- Issue／PR／CI：Issue #8-B；PR #271（`local-isolated-a` 紅，head `ad161ab`）
- 分類：schema／migration
- 事件：`0087` 用 `create table if not exists public.tour_orders (...)` 建表。CI 的 `local-isolated` 會套用 historical overlay，而 overlay 的 `0026` **早就建過同名的 `tour_orders`**，欄位不同、還帶著 `#41` 的 `0040` 加上的 check constraint。於是我的 `create table` 是一個 no-op，程式對著 overlay 的契約寫入，`confirm-payment` 回 `500 / 23514`。
- 證據：`new row for relation "tour_orders" violates check constraint "tour_orders_payment_amounts_nonnegative"`；失敗列的尾巴是 `..., 6000, 0, 0, FULL)` —— 四個**我的 migration 根本沒定義**的欄位（`upfront_required_amount` / `paid_amount` / `refunded_amount` / `deposit_mode_snapshot`）。
- 根因：把 `if not exists` 當成「冪等」。它只保證**不會報錯**，不保證**結果符合我的定義**。同名表存在時它既不比對也不協調，就只是跳過；而 migration 執行成功這件事，看起來與「表已按我寫的建好」完全一樣。
- 影響：兩條安裝路徑得到兩個不同契約的同名表，而程式只對其中一個是正確的。在只跑 canonical 的環境會全綠，在有 overlay 的環境才炸——反過來也可能：canonical 少了 overlay 的約束，於是**真正的缺陷（見下）在 canonical 上不會被抓到**。
- 修正：像 `0066` 那樣改成「加法且會協調」：`alter table ... add column if not exists`，約束用 `pg_constraint` 檢查後才建（避免同一條規則有兩份定義）。
- 順帶抓到的真缺陷：那條 check 寫著 `(payment_status <> 'PAID' or paid_amount = total_amount)` ——**它是對的**。初版的 `confirm-payment` 只翻 `payment_status = 'PAID'` 旗標、沒寫實收金額，會在資料庫留下一筆「已付款」而實收 0 元的訂單，正是本專案一直在修的那種假宣稱。所以修的是路由與 canonical schema（補 `paid_amount` 與同一個不變量），**不是把測試或約束改成接受它**。
- 預防：① 新增表的 migration 前，先 `grep -rn "create table .* <name>" supabase/` 查**所有**安裝路徑（含 `local-migrations/**`），確認沒有同名前身。② 若有前身，改寫成協調式：加欄位、補約束、不假設自己是第一個建表的人。③ 別的分支加在同一張表上的 check constraint，要當成**別人已經想過的不變量**先讀一遍——本例它比我的實作更嚴謹。
- 狀態：已防止

### PB-027 — 用「名字出現幾次」代替「那件事真的會發生」

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：4（同一輪內四種形態）
- Issue／PR／CI：Issue #27、#50、#8；PR #264、#268、#271、#273
- 分類：稽核方法
- 事件：同一輪出現四種同型的誤判——
  1. **規格存在 ≠ 功能可用**：04／06 分冊描述 `imageStorageRef` ＋ preview ＋ 清理 queue，`main` 上零命中（那是未合併的 PR #98 的設計）。
  2. **路由存在 ≠ 功能可用**：`src/app/api/ai-settings/route.ts` 在 `main` 上齊全、閘門完整，但**全 repo 沒有任何一處呼叫它**；店家按下儲存打的是別的端點。
  3. **政策提到 ≠ 物件存在**：`p_storage_write` 的允許清單列了 `keyword-reply-images`，我據此推論 bucket 已存在——`bucket_id in (...)` 只是字串比對，Postgres 不會因為政策引用了不存在的 bucket 而抱怨（PB-024 的同族）。
  4. **符號出現 ≠ 符號被使用**：我用 `grep -c` 數到四支 tour-order service「8 處引用」，據此在 #8 寫下「tour-orders 頁本來就已接 service」。那 8 處全在 `src/services/tours.ts` 裡（一支 service 的 export ＋ 型別就是兩次），頁面實際上四個寫入動作**一個都沒接**。
- 根因：判準錯了。四者都在問「這個名字在某處出現了嗎」，而該問的是「那件事真的會發生嗎」。名稱出現是**必要非充分**條件，而它剛好很容易 grep 到，於是變成預設判準。
- 影響：第 4 項是我自己寫進 issue 的錯誤結論，若沒有在實作 #271 時撞到，會直接變成一個假打勾。第 2 項讓一個「已經在對真實顧客做錯事」的缺陷在 issue 上顯示為已完成。
- 修正：#273 把四種形態並列寫進 `14-GAP-AUDIT.md` §7.4.4；#8 的錯誤結論已發留言更正。
- 預防：① 判準一律改成**「呼叫端在哪裡」**：`grep -n "<symbol>(" <呼叫端檔案>`，而不是 `grep -c "<symbol>" .`。② `grep -c` 的結果**必須連同檔名一起看**（用 `-rn` 或 `-l`，不要用 `-c` 加總）。③ 對「文件說有」「路由檔在」「政策提到」三種線索，一律再走一步查到實際執行路徑；查不到就當作沒有。
- 狀態：已防止

### PB-028 — `revoke execute … from anon, authenticated` 不會關掉 PUBLIC 的預設授權

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：2（`0087` 的四支 tour-order RPC；`0090` 的 `redeem_booking_points`）
- Issue／PR／CI：Issue #8-B、#218；PR #271（Sol audit P1，由 `0088` 補）、PR #280（開工時就用正確寫法）
- 分類：權限
- 事件：SECURITY DEFINER 的 RPC 繞過 RLS，所以執行權**就是**那道安全邊界。兩支 migration 都只寫了 `revoke execute on function … from anon, authenticated`，看起來已經把前端持有的兩個角色都撤掉了。
- 證據：PostgreSQL 對新建函式**預設 grant EXECUTE 給 `PUBLIC`**，而 `anon` / `authenticated` 都是 PUBLIC 的成員。本機 Postgres 16 實測 —— 只撤那兩個角色之後 `has_function_privilege('anon', …, 'EXECUTE')` 仍然是 `true`；補上 `revoke all … from public` 之後才變 `false`。`pg_proc.proacl` 在只撤兩個角色時是 `NULL`（＝維持預設，PUBLIC 有權），這個「什麼都沒有」的樣子很容易被讀成「乾淨」。
- 根因：把角色清單當成權限的全集。撤銷只能撤掉「直接授給該角色」的權限，撤不掉它**經由 PUBLIC 繼承**的那一份；而預設授權不是任何一支 migration 寫的，所以 grep 整個 `supabase/` 都看不到它。
- 影響：任何登入者（甚至未登入者）可直接呼叫該 RPC，route 上的所有閘門——租戶檢查、角色檢查、金額與點數檢查——全部被繞過。#218 那支的具體後果是「扣別家店顧客的點數」。且完全沒有症狀。
- 修正：三段式，缺一不可 —— `revoke all … from public;` → `revoke all … from anon, authenticated;` → `grant execute … to service_role;`。
- 預防：① 每新增一支 SECURITY DEFINER 函式，執行權一律寫這三段，不要只寫角色那一段。② 驗收不能只 grep migration 文字，要**實際查權限**：`select has_function_privilege('anon', '<sig>', 'EXECUTE')` 必須是 `false`，`proacl` 必須有明確條目而不是 `NULL`。③ 整合測試的邊界案例要包含**真的登入過的** authenticated 角色，並斷言錯誤碼是 `42501`（沒有權利），而不是只斷言「有錯誤」——後者在函式根本沒被 expose 時也會通過。
- 狀態：已防止

### PB-029 — 測試名稱宣稱的，比它實際證明的多

- 首次／最近：2026-09-07／2026-09-07
- 發生次數：2
- Issue／PR／CI：Issue #218、#259；PR #280、#278（`local-isolated-a` 紅，head `4d60b2a`）
- 分類：測試方法
- 事件：兩個形態——
  1. 一條測試叫「**已登入使用者**不得直接呼叫 `redeem_booking_points` rpc」，用的卻是**沒有登入**的 anon client，而且只斷言 `error` 非 null。它證明的是「未登入者叫不動」，名字宣稱的卻是 authenticated 角色；而 authenticated 才是危險的那個身分（見 PB-028）。
  2. 一組整合測試宣稱「PUT 寫進去、重新 GET 還在」，但把 `GET /api/trips/:id` 的 `{ trip, plans }` 信封當成 trip 本身在讀。每個欄位都是 `undefined`。
- 根因：第 1 種是寫測試時先想好名字、實作時走了最省事的 client，名字沒有跟著回頭校對。第 2 種是沒有先確認端點的**回應形狀**就寫斷言。共同點是：**測試名稱不是斷言**，沒有任何東西會檢查它們是否一致。
- 影響：第 1 種是最壞的一類——它是綠的、名字看起來剛好覆蓋了那個風險，於是那個風險再也不會被人檢查。第 2 種相對無害（會紅），但如果斷言寫成 `toBeFalsy()` 或 `not.toBeNull()` 之類的寬鬆形式，一樣會假綠。
- 修正：第 1 種改成未登入與真的 `signInWithPassword` 登入兩段都測，並收緊到錯誤碼 `42501`；第 2 種抽一支 `getTrip()` helper，內含 `expect(body.data?.trip).toBeTruthy()`，讓信封讀錯時**在那一行**就失敗而不是在下游變成 undefined。
- 預防：① 寫完一條測試，把名字當成一句斷言念一遍，逐字問「這一段程式證明了這句話嗎」——特別是名字裡有身分（已登入／跨租戶／管理員）或條件（併發／逾期）的時候。② 斷言「東西存在」時要收斂到**具體值或具體錯誤碼**，不要停在 `not.toBeNull()` / `toBeTruthy()`；後者對「功能根本不存在」與「功能存在且正確擋下」給出同一個綠燈。③ 讀 API 回應前先確認信封形狀，並在 helper 的第一行就斷言它。
- 狀態：已防止

### PB-030 — 兩道 DB 閘門同時是「兩套寫法的超集」，於是它們天生偵測不到 repo↔正式庫的分歧

- 首次／最近：2026-09-08／2026-09-08
- 發生次數：1
- Issue／PR／CI：Issue #197、#259；PR #278、#287
- 分類：CI／環境真相
- 事件：`trips` 與 `trip_plans` 在正式庫用的是一套欄位名（`region` / `inclusions` / `duration_minutes` …），repo 的程式用的是另一套（`location` / `includes` / `duration_hours` …）。四道閘門全綠，正式庫卻是壞的：

  | 環境 | `trips` 欄位數 | 兩套名字 | 程式能動嗎 |
  |---|---|---|---|
  | 純 canonical build | 23 | 只有新那套 | 能 |
  | CI `local-isolated` | 32 | **兩套都在** | 能 |
  | canonical TEST | 32 | **兩套都在** | 能 |
  | **正式庫（當時）** | **28** | 只有舊那套 | **不能** |

- 根因：`local-isolated` 與 canonical TEST 都是「先套 historical overlay `0016`、再套 canonical 的調和 `0066`」建出來的，結果是一個**兩種寫法都滿足的超集**。超集對兩套寫法都回綠，所以它不只是「證明不了與線上一致」，而是**連不一致都顯示不出來**。
- 影響：比 #197 §影響第 2 點原本的描述更嚴重。原文說 `local-isolated` 證明的是「migration 寫對了」不是「與線上一致」；實際上兩個環境同時綠燈，而正式庫是壞的——沒有任何一道閘門有機會紅。
- 修正：以 `scripts/db/schema-fingerprint-diff.mjs` 取「欄位數 ＋ 排序後欄位名的 md5」逐表比對 repo 與線上，這才看得到分歧；並依擁有者具名授權把 canonical `0066`/`0067`/`0068` 補套到正式庫（`trips` 28 → 32 欄，指紋與 canonical TEST 逐字相同）。
- 預防：① **建庫路徑不同的環境不能互相當對照組**——要驗「與線上一致」，唯一有效的對照組是線上本身，其餘都只是驗「migration 跑得完」。② 對兩套並存的欄位名，測試綠不構成證據；直接查 `information_schema.columns` 取指紋比對。③ 同族陷阱見 PB-026（`create table if not exists` 對同名不同形狀的表靜默跳過），那正是超集的成因之一。④ 我自己在本輪還多踩一層：看到「repo 用 A 名、正式庫用 B 名」就推論成**設計分歧**，沒有回頭讀 `0066` 到底做了什麼——那支 migration 就是為調和這件事而寫的，只是從未被套上去。**先讀那支 migration，再下結論。**
- 狀態：已防止（工具已合併；#197 建議處置第 2 步「讓 repo 能重現線上」仍未完成）

## 可重用工程設計準則（由 PR #294 萃取）

> 來源：PR #294／Issue #37 的團次導遊指派與撞班修復。這一節不是新的產品規格，也不取代 `docs/integration/**`；它把一輪已被真實 HTTP、PostgreSQL 與變異測試驗證過的工程方法，抽成可跨領域重用的設計問題。
>
> 適用：排班、名額、庫存、點數、付款、退款、優惠券、LINE entitlement／routing，以及任何「現實世界不可能同時成立，系統也不應允許同時成立」的功能。

### 原則 1：重要不變量放到最靠近資料真相的層級

- UI 的責任是降低誤操作；API／server 的責任是做商業規則檢查並回人看得懂的錯誤；**DB 的責任是守住無論從哪個入口進來都絕對不能被破壞的不變量**。
- 只靠「先查再寫」不能處理併發。兩個請求可能同時看到舊快照、同時判定可寫，再一起留下非法狀態。能由 unique／check／FK／transaction／atomic RPC 表達的不變量，優先由 DB 做最後保證。
- #294 範例：一個團次最多一位 PRIMARY 不是只靠前端單選或 server `if`，而由 partial unique index 保證；同團同人不得重複也由資料層約束。
- 相關教訓：PB-007、PB-026、PB-028。
- Review 問句：**「如果 UI 壞掉、API 漏檢查，或兩個請求同時進來，資料庫仍會拒絕這個不可能狀態嗎？」**

### 原則 2：同一個商業概念只維護一套判斷邏輯

- 同一個概念若在不同入口各寫一份規則，兩份規則遲早漂移。不要讓「開團時說可以」與「一般預約時說不行」同時成立。
- 把共通的「讀資料」與「判斷」拆開：資料可以一次讀取，判斷最好是純函式，讓不同入口共用同一套演算法，也方便單元測試。
- #294 範例：團次建立／更新／批次開團與 `/api/bookings/available-slots` 共用 `staff-availability` 的占用區間與撞班規則，形成真正的雙向防撞。
- 相關教訓：PB-025、PB-027。
- Review 問句：**「這個商業概念在 repo 裡有幾份判斷？如果我改一條規則，需要改幾個地方？」** 理想答案是核心規則只有一份。

### 原則 3：系統能推得出的事情，不要再要求使用者設定

- 不為工程架構額外發明產品設定。當系統已經知道答案，就直接採用答案；只有真正存在選擇時才把選擇交給使用者。
- 介面複雜度應隨現實複雜度成長，而不是一開始就塞滿模式開關。這可降低設定錯誤、空狀態與「設定和真實資料互相矛盾」的機會。
- #294 範例：可接案導遊 0 人時阻擋 OPEN 並說明原因；1 人時自動指派、不顯示無意義的選擇器；2 人以上才要求選 PRIMARY／ASSISTANT。
- Review 問句：**「這個欄位／開關真的是使用者的商業決策，還是系統其實可以從現有資料直接推得？」**

### 原則 4：資訊不完整時，往安全方向失敗，不要樂觀猜測

- 無法確定資料時，不得把「不知道」偷偷轉成「可以」。選擇較保守、可解釋、可人工解除的結果，優先於可能造成超賣、撞班、錯扣款、越權或其他不可逆後果的樂觀猜測。
- 必須區分兩種代價：多擋一筆可人工處理的操作，通常比接受一筆事後無法履行或無法一致回滾的交易便宜。
- #294 範例：無法得知團次時長時採整日占用。它可能多擋一個其實有空的時段，但不會因「算不出結束時間」就把同一位導遊排進兩個地方。
- 相關教訓：PB-023、PB-025。
- Review 問句：**「當必要資訊是 null、查詢失敗或規格與 schema 不一致時，程式現在是在說『不知道』、安全阻擋，還是偷偷假設『可以』？」**

### 原則 5：每種測試只宣稱它真正能證明的那一層

- Unit test 適合證明純邏輯、邊界與狀態轉換；它不能證明 HTTP route 真的接上、PostgREST 真的寫入、DB constraint 真的存在或外部 provider 真的接受。
- Integration test 應走真 HTTP ＋真 DB，對持久化功能最好「操作後再讀一次」或直接查資料庫；對反向排除類測試要有正向對照組，避免空集合造成假綠。
- Provider／Production 行為仍需對應層級的真實證據；不得拿 local／TEST 綠燈宣稱線上已生效。
- #294 範例：23 個單元案例只證 0/1/2+、占用區間與衝突演算法；15 個整合案例才證 API 真的寫入 `trip_departure_staff`、`available-slots` 真的排除已被團次占用的人。這一層還實際抓到「只改導遊指派會因空 update 被誤判 404」的真缺陷。
- 相關教訓：PB-001、PB-006、PB-029、PB-030。
- Review 問句：**「這個測試名稱宣稱的事情，是否真的在它執行的層級被觀察到了？」**

### 原則 6：關鍵規則要做變異測試，證明保險絲真的會叫

- 「測試全綠」只證明現況通過；對金額、並發、租戶邊界、名額、庫存、權限、排班等高代價規則，還要刻意拔掉關鍵 guard／lock／filter／constraint，確認至少一條測試會轉紅，再還原。
- 變異應對準要保護的性質，而不是隨便破壞語法。若拿掉規則後仍全綠，表示測試沒有保護到那個規則，不能因測試數量很多就當作有覆蓋。
- #294 範例：刻意取消「未知時長視為整日占用」、忽略團次衝突、拿掉單人店自動指派，三種變異都讓指定測試轉紅後才還原。
- 相關教訓：PB-016、PB-027、PB-029。
- Review 問句：**「如果我現在故意把最重要的保護拿掉，哪一條測試一定會紅？」** 如果答不出來，該保護尚未被可靠驗證。

### PB-031 — 拿 Issue 內文當 Owner 決策，於是對一件早已裁示的事重新提案

- 首次／最近：2026-09-09／2026-09-09
- 發生次數：1
- Issue／PR／CI：#25、#42；`docs/OWNER-DECISIONS.md:88`、`:108`
- 分類：Agent
- 事件：Owner 詢問 #25 的 impersonate 做或不做時，我以「不做（推薦）」為預設選項提案，
  並額外建議一個**與裁示相反**的替代方案（唯讀支援檢視）。實際上 Owner 早在 **2026-08-27**
  就裁示「**要做，作為正式平台能力**」，2026-08-28 另有 #42／#25 的代建裁示補充實作方式。
- 證據：
  ```
  docs/OWNER-DECISIONS.md:108（2026-08-27 已裁示）
  | #25 | Midao 管理者代登入租戶 | 要做，作為正式平台能力 |
    從 Midao 管理者後台進入指定租戶協助查看／修改。僅 platform admin；全程 audit；
    租戶可查紀錄；不可取得租戶密碼或共用密碼。 |

  docs/OWNER-DECISIONS.md:88（2026-08-28 已裁示）
  | #42 / #25 | Midao 協助代建方案 | 平台可代建，但導遊仍是可編輯的資料 owner；
    使用 platform-admin／impersonation + audit，不共用密碼。 |
  ```
  另有兩處 canonical 規格已把它當成既定能力引用：
  `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md:406`、
  `docs/integration/19-GUIDE-PRODUCT-EXPERIENCE.md:446`。
- 根因：三層疊加，全部是執行者的問題，不是紀錄的問題。
  1. **沒有讀 `docs/OWNER-DECISIONS.md`。** CLAUDE.md「Mandatory start」第 2 點逐字點名這個檔案，
     整個 session 一次都沒開過它。後面兩層都是這一層的結果。
  2. **拿 Issue 內文當決策來源。** #25 的 body 仍寫著「⚠️ 決策（阻擋性）：impersonate 做還是
     不做…**不做也是有效答案**」——那段文字寫於裁示之前且從未回填。CLAUDE.md 的真相優先序是
     **main canonical docs ＞ Issue 內文**，我把它反過來用了。
  3. **對已裁示事項重新提案。** 這比「重問」更糟：重問只是浪費一次往返，附帶一個有說服力的
     反向建議則可能真的翻掉一個已定案的產品決策。
- 影響：Owner 必須花一輪把已經做過的決定再講一次；#25 因此又多停一天。無程式碼或資料受影響。
- 預防：
  1. **開工第一件事就是 `grep -n -i "<關鍵字>" docs/OWNER-DECISIONS.md`**，在讀 Issue 內文之前。
     Issue body 是提案時的快照，Owner 裁示後**不保證**會回填。
  2. 任何準備向 Owner 提出的「決策題」，送出前一律先在 `docs/OWNER-DECISIONS.md`、
     `docs/decisions/**`、`docs/integration/**` 三處各搜一次同義詞（本例：`impersonat`、
     `代登`、`代建`、`platform.admin`）。**搜不到才問。**
  3. 發現 Issue 內文與 `OWNER-DECISIONS.md` 不一致時，**當場回填 Issue**，不要只在留言裡講——
     下一個 agent 讀到的還是 body。
  4. 同族陷阱：PB-019（沒併回 main 的實作等於不存在）是「repo 落後於現實」；本條是
     「Issue 內文落後於 repo」。兩者都來自「拿一份沒有回填義務的文字當現行事實」。
- 相關教訓：PB-019、PB-024、PB-027。

### 六問開工／Review Checklist

對任何涉及狀態一致性、共享資源或外部承諾的功能，在施工與 Sol／Final Risk review 時至少問一次：

1. **不變量**：現實世界絕對不能成立的狀態是什麼？DB 是否能做最後一道保證？
2. **單一來源**：同一條商業規則是否被複製到兩個以上入口？能否抽成共用判斷？
3. **自動適應**：系統已知道的答案，是否還在要求使用者多做一個設定？
4. **安全失敗**：資料缺失、查詢錯誤或規格不確定時，會保守阻擋還是樂觀放行？
5. **證據層級**：Unit／Integration／Provider／Production 各自到底證明了什麼？是否有越級宣稱？
6. **變異反證**：刻意拔掉最重要的 guard／lock／filter 後，測試會不會真的轉紅？

若其中任何一題的答案是「不知道」，不得用「測試很多」「CI 綠」「畫面看起來正常」代替答案；先把該層的真實證據補齊。