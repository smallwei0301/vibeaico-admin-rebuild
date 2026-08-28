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
| PB-014 | 已套 migration 的 source 以實際基線為準 | 分支上的後續 runtime 修正不可倒灌已記錄 migration；以 TEST history/schema 對齊 exact source，所有差異用新編號 forward migration。 | `AGENTS.md`；`docs/AGENT-EXECUTION.md` §3.1、§6 |

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
- 修正：本次先保留精確 job／錯誤／程式位置並停止相同重試；seed classifier 與 TEST migration 基線需由後續施工 Issue 一起修復。
- 預防：optional-table 只接受可證明「relation／table 不存在」的 code 或訊息；父資料略過時不得繼續寫入依賴它的子資料，並為錯誤分類器補 table-missing／column-missing／function-missing 測試。
- 驗證：本次尚未修復；`check` job 的 typecheck、107 個 unit tests 與 build 通過，integration／E2E 未通過。
- 狀態：仍待處理

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

### PB-014 — 分支 source 與已套 notification migration baseline 漂移

- 首次／最近：2026-08-28／2026-08-28
- 發生次數：1
- Issue／PR／CI：#40
- 分類：Migration／TEST DB
- 事件：保留 runtime 修正的分支仍帶有與已套 TEST baseline 不同的 `0038` 定義。
- 證據：TEST history 順序為 `0038`、`0038a`、`0040`；其 `0038` schema 符合 v2 基線，而 f7 source 含後續 runtime 語意。
- 根因：將「保留 branch runtime」誤延伸為可保留已套 migration 的 source 差異。
- 影響：fresh install 與 TEST 的 notification ACL、Telegram uniqueness、auth audit schema 會漂移。
- 修正：將 `0038`／`0038a` 對齊 v2 exact；將 reclaimable、auth audit、trigger hardening、bind RPC 都放入唯一 forward `0041`。
- 預防：整合前先以 migration history 與 schema contract 固定 immutable 檔案；後續 DDL/RPC 只加未保留編號的 forward migration。
- 驗證：source test、exact diff/byte comparison、unit/typecheck/mock build；TEST 套用與 integration 另行授權。
- 狀態：已防止
