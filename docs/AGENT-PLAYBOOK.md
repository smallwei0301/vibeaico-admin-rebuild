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

## 複盤與接續施工速查（2026-09-14）

> 先用這張表找到原條目，不全量重讀歷史。這是既有教訓的操作入口，不是新的評分器、
> 模型門禁、併行額度或 Production 授權；現行 Owner Decision 與正式執行規則優先。

| 遇到的情境 | 先查原條目 | 下一個最小查證 |
|---|---|---|
| CI 綠、PR 已合併、Issue 已關閉 | PB-001、PB-029、PB-032、PB-039 | 分開核對 exact head、實際執行案例、合併可達性、目標環境與驗收；不拿一項代替全部。 |
| 要說物件不存在、migration 已套用或環境等價 | PB-017、PB-026、PB-027、PB-030、PB-035、PB-037 | 先驗搜尋正向對照，再查整體結構、權限、觸發器、來源與相依；一個 bucket 存在不是完整證據。 |
| 要重跑 CI 或變更測試入口 | PB-015、PB-016、PB-021、PB-034、PB-038 | 核對本次輸入與失敗步驟；先用既有 preflight。真程式錯誤不盲重跑，失敗退出碼必須阻止下一步。 |
| 要把工作列成等 Owner、過時或已完成 | PB-019、PB-031、PB-032 | 先查現行決策、最新本文／留言及 live state，辨別已授權、真外部阻塞、選配與歷史快照。 |
| 準備碰 TEST／Production、權限或外部服務 | PB-002、PB-018、PB-020、PB-028、PB-033 | 先確認環境、使用者、呼叫端、共用 TEST 持有者、授權與回復方式；安全修正也不能先做後查。 |
| 已有另一個 Session／PR 在修相同問題 | PB-009、PB-010、PB-031、PB-034 | 讀最新 head、檔案範圍與剩餘步驟，沿用候選或正式交接，不另派重複工作。 |

### 歷史條目的適用性校正

- **PB-015 與 PB-021 引用的 `HEAD^ == main`／一律壓成單一 commit，是歷史避開症狀的方法，
  不是現行普遍要求。** 依 `docs/decisions/2026-09-10-owner-multi-environment-base-freshness.md`
  與 `CLAUDE.md`，不能僅因 main 有無關前進就重整分支。先查真正的 base、衝突、
  migration 編號或共享契約是否改變；下方原事件與原預防保留作歷史，不覆蓋新決策。
- **PB-036 的 Product 施工分工，不得擴張成純治理也要指定模型。** 依
  `docs/decisions/2026-09-11-owner-governance-unpinned-model.md`，MODEL_GOVERNANCE 不分析
  使用哪個模型；Product 的施工、審核、Final Risk 與安全規則不變。
- **#359 維持 OPTIONAL_NONBLOCKING（選配、不阻擋）。** 不再為純治理索取模型憑證，
  也不把「目前不用」自行改成「已廢棄，必須關閉」。#104 仍只採真正可比較的 Product Run。
- 本檔過往的「已防止／仍待處理」與數量，是各事件當時的紀錄，不是今日全專案狀態。
  送出新的進度或處置前，仍須重查當下來源。修正建議、候選已提交與 main 已驗證要分開寫。

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
| PB-015 | 本機與 CI 的 base 不同就不能互相佐證 | `workflow_dispatch` 使 `base_revision` 為空，守門腳本退回 `HEAD^`。凡是 `HEAD^ != main` 的分支形狀都會誤判：head 為 merge commit、或分支有第二顆 commit 動到自己新增的 migration。錯誤指向不屬於本次變更的檔案時，先懷疑 base。~~規則：帶 migration 的分支一律壓成置於 main 之上的單一 commit。~~ **此結尾預防句已被 `docs/decisions/2026-09-10-owner-multi-environment-base-freshness.md` 取代**——`HEAD^ == origin/main` 不是全域必要條件，也不要求所有 PR 使用 merge commit。本條的 base-evidence 教訓仍然有效。<br><br>**持久 baseline pin 的 ancestry 規則（Owner 2026-09-14，來源 #425 與 #420／#77 的 ancestry 對照）**：現行機械判準是 `scripts/agents/fresh-install-baseline.mjs` 的 `assertPinnedSource()`，它要求**同時**成立三件事：(a) pin 的 SHA 可解析為 commit；(b) 它是受驗 main／candidate 的**祖先**；(c) `supabase/migrations` 在 pin 與受驗版本之間**內容一致**。只證明「SHA 物件存在」或只證明「檔案內容相同」都不夠——三者缺一，pin 就不是它自稱的那個保證。<br><br>有新 migration 時的操作順序：先提交 canonical SQL 得到 commit P，再由**下一筆** commit 更新 manifest 指向 P（該筆不得動 `supabase/migrations/**`，否則 (c) 立刻破裂）；P 必須包含與候選相同的 canonical migrations。**需要保留 P 的 ancestry 的候選，不能用 squash 或 rebase 把 P 從 main 歷史移除**——這是唯一需要特定合併方式的情境，不是普遍規則。 | `docs/AGENT-EXECUTION.md` §7；`docs/decisions/2026-09-10-owner-multi-environment-base-freshness.md`；`scripts/agents/fresh-install-baseline.mjs`；Issue #227、#425、#420、#77 |
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
| PB-027 | 用「名字出現幾次」代替「那件事真的會發生」 | 四種同型：規格存在≠功能可用、路由存在≠功能可用、政策提到≠物件存在、符號出現≠符號被使用。`grep -c` 數到的可能全是**定義本身**（一支 service 的 export ＋ 型別就兩次）。可機械檢查的判準是**「呼叫端在哪裡」**，不是名稱出現次數。 <br><br>**第五種同型（Owner 2026-09-14，來源 #425）：「檔案內容已合併進 main」≠「被 pin 的 commit 仍是 main 的祖先」。** #420 走 squash 之後，原分支的 commit 不在 main 的 ancestry 裡，即使它帶的檔案內容一字不差地進了 main；#77 走 merge commit，第二個 parent 被保留，原 commit 因此仍然可達。要驗的是 ancestry 這個性質本身（`git merge-base --is-ancestor`），不是內容相等。同一個家族的另一個實例見 PB-042：用 migration 帳本的檔名集合去推論「某環境缺什麼」，那個比對維度證明不了你真正要的性質。 | `docs/integration/14-GAP-AUDIT.md` §7.4.4 |
| PB-032 | `conclusion=success` 不等於測試執行過 | 共用 TEST 一次只允許一位 `TEST_VALIDATION` holder，非 holder 的 `integration` job 會印一行 `POLICY_SKIP` 後以 **success** 結束——跳過與通過在 check 層級長得一模一樣。宣稱測試通過前必須讀 job log 看到 `✓ tests/integration/...(N tests)`；`conclusion`／check 顏色不是執行證據。 | `docs/AGENT-EXECUTION.md` §3.1；Completion Truth Gate |
| PB-033 | 對正式庫下了 revoke 之後，才回頭查有沒有呼叫端 | 把「這是安全修正」當成可以少一道查證。收權與加權在風險結構上對稱——兩者都可能讓線上功能當場停止，差別只在失敗方向。動線上資料庫的權限前，必須先完成呼叫端清查（全 repo grep 含測試 → client 建構函式 → 該 client 的角色 → 其他 SQL 函式內部呼叫）；migration 尾端的自我驗證要雙向，也檢查 service_role 有沒有被誤撤。 | 本檔 PB-028、PB-033 |
| PB-034 | 用 CI 當規則查詢器；以及**預防本身涵蓋不全** | #352 退四次、#361 兩次、#370 一次、#397 一次，全是中繼資料錯、零程式碼問題。開 PR 前跑 `scripts/agents/agent-wip-preflight.mjs`，通過才推。**但 #370 證明跑了也可能不夠**：preflight 當時沒涵蓋 `local-isolated-test-policy.mjs`，於是 preflight 綠、CI 仍退。已讓 preflight 直接呼叫 CI 的同一支函式。**#397 再證一次**：`ASTRA_TEST_BASELINE`／`ASTRA_SCHEMA_BASELINE` 由 `astra-review-policy.mjs` 驗證，卻連 PR 模板都沒列出來——照模板填完仍然必退。preflight 已改呼叫 `evaluateAstra()`，但只留下本機真的能知道的那兩條錯誤；模板也補上了這兩個欄位。欄位錯常是 **lane 選錯的症狀**。 <br><br>**合併後必須重驗，PR 自己的綠燈不算（Owner 2026-09-14）。** 合併之後要重新抓 main，重新驗證 ancestry、canonical migration 內容與 fresh-install baseline。PR 在合併前的綠燈證明的是「合併前」的狀態，證明不了「合併後 ancestry 仍成立」——合併方式本身就可能改變 ancestry（見 PB-015、PB-027）。<br><br>**WORKSTREAM 與工作性質分開記（Owner 2026-09-14，來源 #425）。** 碰到 `supabase/**` 就屬 `PRODUCT_MAINLINE`，這是 workstream 的判定；但一支只修 baseline pin 的 PR 仍然可以是 `AGENT_LANE: GOVERNANCE`／`DELIVERY_UNIT_TYPE: GOVERNANCE`／`COUNT_IN_DELIVERY_OUTCOME: false`。WORKSTREAM 問的是「碰哪個領域的路徑」，AGENT_LANE 與 DELIVERY_UNIT_TYPE 問的是「做哪一類工作、宣稱了什麼」。**不得為了讓欄位看起來一致，就把治理性質的修補掛進 Product Run 去湊交付數。** | `scripts/agents/agent-wip-preflight.mjs`、`scripts/ci/local-isolated-test-policy.mjs` |
| PB-035 | 從欄位定義推斷 insert 會失敗，卻沒查參與寫入的 trigger | `NOT NULL` 且無 default、而 insert 沒列該欄，**不足以**推出「一定 23502」——`BEFORE INSERT` trigger 會在約束檢查之前改寫 NEW，本例該欄早就被 trigger 填好。宣稱任何寫入會成功或失敗之前，先用 `pg_trigger` 列出該表上所有參與寫入的物件，或直接在那個資料庫上跑一次。 | 本檔 PB-032、PB-035 |
| PB-036 | `TERRA_BUILD` 的施工跑在 audit 層模型上 | CLAUDE.md 寫得很直白：Terra 一律用 Sonnet，把施工放在 Opus 上是 over-spec，不是 diligence——它燒掉 audit 層的成本，還讓 audit 層變成在審自己的產出。已發生四次（#370、#396，以及 2026-09-14 同一輪內的兩次：兩張 TERRA_BUILD 都跑在 Opus 上，以及 audit 層直接改 `0108` 的 enum 斷言），每一次的理由都是「我人已經在跑了，順手做完比較快」。第四次特別值得記：當時 Final Risk 剛回報 BLOCK，修一行是「顯然正確且很小」的事——**正是那個「很小」讓分層被跳過**。判準是動到什麼檔案，不是改了幾行。**開工前先判斷這一輪是不是施工**：新增／修改 migration、route、server 模組或測試就是 `TERRA_BUILD`，必須委派給 build 層模型；不是委派不了，是沒有先問。已發生就如實記為違規，不得寫成中性註記。 | `CLAUDE.md`「Lane → model tier」；`docs/MODEL-ROUTING.md` |
| PB-037 | 把「欄位集合」當成「欄位順序」，並用一次找不到的搜尋證明「它不存在」 | **已發生三次。** (1)(2) 同一支 migration（`0105`）同一輪內：先 grep `id, tenant_id` 漏掉既有的 `unique (tenant_id, id)`，據此斷定「沒有等價約束」而自建一條重複的，害 schema proof 在 drop 既有約束時被依賴擋下；修正時又把 `conkey`（**保留宣告順序**，`{2,1}`）拿去比排序過的 `{1,2}`，讓保護性斷言必定誤報。(3) 同日稍晚換領域再犯：closure sweep 用 `grep '^- LANE_STATE:'` 取 PR 欄位，漏掉格式沒有項目符號的 #312 而誤報「無 lane metadata」，錯誤寫進兩份 PR，最後由委派出去的 scout agent 訂正——**結論碰巧仍正確，所以沒有任何紅燈會提醒我**。**判定「是否已存在」一律查系統目錄並兩邊排序比欄位集合；從半結構化文字取欄位不得綁定單一拼法；任何證明「X 不存在」的搜尋，送出結論前先餵一個已知存在的正向對照。** 「我沒找到」是關於搜尋的陳述，不是關於世界的陳述。 | `supabase/migrations/0105_issue_44_traveler_risk_policies.sql`、`0104:138`、`0067`、PR #312／#418／#428 |
| PB-038 | 用 `;` 把退出碼吃掉，然後在測試是紅的情況下推上去 | 已發生三次。`npm run … \| tail`、`npx vitest run … \| grep`、以及 `npx vitest … > file 2>&1; echo "EXIT=$?"; git add && git commit && git push`——最後這個 `;` 讓 `git push` 完全不受測試結果影響，於是我在 1 failed / 2109 passed 的情況下推了上去。管線取的是最後一段的退出碼，`;` 根本不看前一段。**驗證與推送永遠用 `&&` 串成一條；要保留輸出就先重導向到檔案，再讓 `&&` 接下去，不要用 `;` 分隔。** 推送前最後一個動作必須是一個「紅了就會擋住推送」的指令。 | PR #416（`57de3b9`）、PR #77 早期 |
| PB-039 | 一個從來沒有受測對象的 guard，永遠不會失敗 | `governance-scoreboard.test.ts` 的「每一本 post-policy terminal Run 都要有 durable review evidence」寫得很嚴格，但在 2026-09-14 之前，repo 裡沒有任何一本 Run 同時是 terminal 且晚於 policy 生效日——**迴圈跑零次**。它從寫下的那天起就一直是綠的，不是因為受檢查的東西是對的，而是因為它沒有東西可檢查。#412 給了它第一個對象，潛伏的範圍錯誤才連同 main 紅燈一起爆出來。**任何「對所有符合條件的 X 都斷言 Y」的 guard，必須同時斷言符合條件的 X 至少有一個**；並在寫完當下故意讓條件落空一次，確認那個反空轉斷言真的會擋。 | `tests/unit/governance-scoreboard.test.ts`、PR #412／#416、Issue #415 |
| PB-040 | 把埋點欄位建好，然後沒有埋 | 2026-09-14 我在 #411 結案時親自判定「前九本 Run 不可評分的原因是全程沒埋點」，並宣告「從現在起的 Run 即時埋點」。接著開了 `2026-09-14-product-delivery-r01`，寫了三段說明它會怎麼埋——然後 `modelUsage.tasks: 0`、`ci.fullCiRuns: 0`、`closureSweeps: 0`、`delivery: {}`。同一輪還完整違反了模型分層（兩張 TERRA_BUILD 都跑在 Opus 上，PB-036 第三次）、`lunaTasks: 0`、`solTouches: 0`。**記帳的架子搭好卻不記帳，比誠實地說「沒埋點」更糟——它看起來像有在做。** 與 PB-039 是同一種病：看起來在守，實際上沒有。**每完成一個可觀察事件（委派、CI run、closure sweep、開/關 Issue）就當場寫進 ledger，不留到收尾**；收尾時只准填當下仍可觀察的量，其餘維持 null。 | `docs/metrics/agent-runs/2026-09-14-product-delivery-r01.json`、#411、PB-036、PB-039 |
| PB-041 | 一條**永遠失敗**的斷言，比恆真的斷言更糟 | PB-039 講的是「從來沒有受測對象的 guard」——恆真，沒用。它有個反面：**恆假**。`0108` 的 enum 值域後置斷言寫成 `array_agg(e.enumlabel::text order by e.enumlabel) is distinct from array['PAID','PARTIAL','REFUND_PENDING','REFUNDED','UNPAID']`，看起來嚴謹（「不多不少」），實際上永遠不相等：`pg_enum.enumlabel` 的型別是 `name`，排序走 C collation，共同前綴 `REFUND` 之後比 `E`(0x45) 與 `_`(0x5F)，所以實際順序是 `REFUNDED` 在 `REFUND_PENDING` **之前**，而手寫的期望陣列把兩者寫反。結果不是「驗得寬鬆」，是**這支 migration 在任何環境都套不上去**。本機 unit 測試沒抓到，因為它只對 migration 做字串比對；抓到它的是 CI 的 fresh-install replay，以及 Final Risk 覆核（`claude-fable-5-1`）在本機 PG16 上的實際重現。**預防**：(1) 斷言「集合相等」就用集合運算（不在預期集合內的值 + 數量），不要比對有序陣列——排序規則是環境變數，不是常數；(2) 對 catalog 欄位排序前先確認它的型別，`name` 與 `text` 的 collation 不同；(3) 新增或修改後置斷言時，至少跑一次**真的資料庫**，字串比對的 unit 測試證明不了斷言會通過。 | `supabase/migrations/0108_issue_41_payment_state_model.sql`、PB-039、PB-026 |
| PB-042 | 用 migration 帳本比對判斷「某環境缺什麼」，會得到危險的錯誤結論 | 2026-09-14 排查 shared TEST 時，我把 `supabase_migrations.schema_migrations` 的檔名集合與 `origin/main:supabase/migrations/` 的檔名集合做 `comm` 比對，得到「canonical 有 36 支 TEST 沒套用」（含 `0001`–`0014` 基礎建設與 `0066`／`0087` tour domain）與「TEST 有 37 支 canonical 沒有」。**那個結論是錯的**：實查 `to_regclass` 後，`tour_orders`(0087)、`trip_plans`(0066)、`tenants`(0003)、`bookings_view`(0007)、`trip_departure_staff`(0092)、`is_tenant_member()`(0010) 全都存在。原因是 shared TEST 是從 `supabase/local-migrations/historical-integration-baseline/` 那套**另一個編號體系**建起來的，帳本記的是 overlay 的檔名，與 canonical 檔名天生對不上。若照那張比對表去「補套 36 支」，會在一個物件已經存在的資料庫上重跑建表與 ACL，後果不可逆。這是 PB-017／PB-037「比對內容，不要只比對檔名」的第三種變形——這次連「檔名」都不是同一個命名空間。**預防**：(1) 判斷某環境是否具備某個物件，一律查 `to_regclass`／`information_schema`／`pg_proc` 等**實際 catalog**，不查 migration 帳本；(2) 帳本只能證明「這個檔名被這個環境跑過」，不能證明「這個環境缺什麼」；(3) 要宣告某支 canonical migration 未套用，必須拿出該 migration 所建物件不存在的實查證據——`0105` 的判定之所以成立，是因為 `to_regclass('public.traveler_risk_policies')` 回 `null`，不是因為帳本裡沒有它。 <br><br>**同一天的第二個實例：只比對欄位，會漏掉 trigger 與 function——而行為就在那裡。** 確認了「欄位清單」之後，我向 Owner 回報 shared TEST 的漂移是「三個形狀不對的欄位，範圍有限可列舉」。執行 `drop column` 時才被資料庫擋下來：`cannot drop column formation_status ... other objects depend on it`。實查後，TEST 上是一整套**活的**舊 #41 實作——15 個 function 與 8 個 trigger，包含 `decide_tour_formation`、`record_tour_order_payment_41` 等完整業務 RPC。委派的 scout 用 `git grep` 查函式名，正確回報「repo 端零引用」，**但那個方法本身也有盲點**：trigger 是自動觸發的，不需要被任何程式碼「引用」，所以 grep 找不到「某測試依賴 trigger 副作用」這種依賴。親讀 `snapshot_trip_departure_formation` 的函式本體才看到它會`raise FORMATION_DEADLINE_INVALID` 拒絕成團截止日已過的 INSERT、並在欄位為 null 時自動改寫 `min_to_depart_snapshot`——canonical `0107` 沒有這個 trigger，因此 TEST 的**寫入行為**不等於 canonical，整合測試在那裡跑出來的結果是假訊號。**預防**：(1) 盤點 schema 漂移時，欄位、constraint、index、trigger、function、view、RPC 授權要各自查一遍，缺一項就不要宣稱「範圍可列舉」；(2) 判斷「移除某物件會不會弄壞東西」時，`git grep` 名稱只能證明「沒有人按名字呼叫它」，證明不了「沒有人依賴它的副作用」——自動觸發的物件必須讀本體；(3) 對 Owner 回報範圍時，明說這份清單是用什麼維度查出來的，好讓讀的人知道它可能漏掉什麼。 | shared TEST `nmwhwngojosmagjuvxol`；PB-017、PB-037、PB-026 |
| PB-043 | 在乾淨的最小 schema 上驗 migration，驗不出「既有資料」類的缺陷 | 2026-09-14 的 `0108` 覆核：build 端**確實**起了一個真的 PostgreSQL 16、跑了 9 次 INSERT 探測與突變測試——方法是對的，比字串比對強得多。但它是在一個**自己現建的最小 schema** 上跑的，那張表裡沒有任何既有列。於是它沒測出：`refunded_amount` 是本檔**新增**的欄位（`not null default 0`），而 M1 的 `check (payment_status::text <> 'REFUNDED' or (paid_amount > 0 and refunded_amount > 0))` 會在 `add constraint` 當下驗證既有資料——任何既有的 REFUNDED 訂單加完欄位後都是 `refunded_amount = 0`，於是整支 migration 以 23514 失敗。同一支檔案裡的 M2 有既有資料前置 guard，M1 沒有，兩個等價風險處理方式不對稱。**預防**：(1) 新增 CHECK 時先問「這條約束會不會對既有列失敗」，特別是當約束引用的欄位是**本檔新增**的（新欄位的 default 幾乎必然不滿足誠實性約束）；(2) 本機探測除了空表，至少要塞一列「本檔之前就合法、加上新約束後會違規」的既有資料；(3) 這類 migration 要嘛附既有資料前置 guard 並明確中止，要嘛說明為何既有資料不可能違規——不得靠「目前那張表是空的」，空表是當下的偶然不是保證。 | `supabase/migrations/0108_issue_41_payment_state_model.sql`、PB-026 |

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

- 首次／最近：2026-09-07／**2026-09-11**
- 發生次數：3（`0087` 的四支 tour-order RPC；`0090` 的 `redeem_booking_points`；**正式庫 `egehnijjpgijmccagxac` 上三支 tour-seat RPC——實際處於可被利用狀態，非僅程式碼層**）
- Issue／PR／CI：Issue #8-B、#218；PR #271（Sol audit P1，由 `0088` 補）、PR #280（開工時就用正確寫法）；PR #352 的 Final Risk 追查（2026-09-11）
- 分類：權限
- 事件：SECURITY DEFINER 的 RPC 繞過 RLS，所以執行權**就是**那道安全邊界。兩支 migration 都只寫了 `revoke execute on function … from anon, authenticated`，看起來已經把前端持有的兩個角色都撤掉了。
- 證據：PostgreSQL 對新建函式**預設 grant EXECUTE 給 `PUBLIC`**，而 `anon` / `authenticated` 都是 PUBLIC 的成員。本機 Postgres 16 實測 —— 只撤那兩個角色之後 `has_function_privilege('anon', …, 'EXECUTE')` 仍然是 `true`；補上 `revoke all … from public` 之後才變 `false`。`pg_proc.proacl` 在只撤兩個角色時是 `NULL`（＝維持預設，PUBLIC 有權），這個「什麼都沒有」的樣子很容易被讀成「乾淨」。
- 根因：把角色清單當成權限的全集。撤銷只能撤掉「直接授給該角色」的權限，撤不掉它**經由 PUBLIC 繼承**的那一份；而預設授權不是任何一支 migration 寫的，所以 grep 整個 `supabase/` 都看不到它。
- 影響：任何登入者（甚至未登入者）可直接呼叫該 RPC，route 上的所有閘門——租戶檢查、角色檢查、金額與點數檢查——全部被繞過。#218 那支的具體後果是「扣別家店顧客的點數」。且完全沒有症狀。
- 修正：三段式，缺一不可 —— `revoke all … from public;` → `revoke all … from anon, authenticated;` → `grant execute … to service_role;`。
- 預防：① 每新增一支 SECURITY DEFINER 函式，執行權一律寫這三段，不要只寫角色那一段。② 驗收不能只 grep migration 文字，要**實際查權限**：`select has_function_privilege('anon', '<sig>', 'EXECUTE')` 必須是 `false`，`proacl` 必須有明確條目而不是 `NULL`。③ 整合測試的邊界案例要包含**真的登入過的** authenticated 角色，並斷言錯誤碼是 `42501`（沒有權利），而不是只斷言「有錯誤」——後者在函式根本沒被 expose 時也會通過。
- 2026-09-11 第三次發生（正式庫，實際可被利用）：
  - 實查 `egehnijjpgijmccagxac` 的 `reserve_seats(uuid,int)`、`release_seats(uuid,int)`、
    `create_tour_order(...)`：三支皆 `prosecdef = true`，且
    `has_function_privilege('anon', …, 'execute') = true`。**未登入即可執行**——anon key 是公開的、
    會送到瀏覽器裡，而 SECURITY DEFINER 繞過 RLS，這三支又只驗參數之間的歸屬（團次是否屬於
    `p_tenant`），不驗呼叫者是否為該租戶成員。後果：任何人可把任一店家的 `seats_booked` 歸零
    造成超賣、吃掉任一店家的名額、在任一店家底下建假單。
  - **為什麼既有三條預防沒接住**：它們全都是針對「每新增一支 SECURITY DEFINER 函式」的作者。
    正式庫這三支來自 `0087` 之前的另一套實作（簽章是 `p_party` / `p_customer_name`，
    與 repo 的 `0087` 完全不同），從未被這條規則涵蓋；而**從來沒有人去查過線上資料庫的實際權限**。
    這條教訓寫過，但只擋得住未來的作者，擋不住既存的資料庫。
  - 修正：以與正式庫實際簽章相符的 revoke 收回（`0088` 原文在此無法套用——它要 revoke 的是
    repo `0087` 的簽章，那些函式在正式庫不存在，照套會因函式不存在而整個回滾）。migration 尾端
    加自我驗證：任一支仍對 `anon`／`authenticated` 開放即 `raise` 回滾。套用前後
    `has_function_privilege` 唯讀證據皆已記錄。
- 預防（2026-09-11 新增，這條才擋得住既存資料庫）：
  ④ **定期對每個線上資料庫實查權限，不是只檢查 migration 文字。** 最小查詢：
  ```sql
  select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'));
  ```
  **這個查詢回傳任何一列，就是一個待處理的權限缺口。** 正式庫與 canonical TEST 都要查。
  ⑤ 帶 SECURITY DEFINER 函式的 migration，尾端一律加自我驗證的 `do $$ … raise … $$`，
  讓「收權沒生效」當場失敗回滾，而不是靠事後有人想起來去查。
  ⑥ 線上資料庫的函式簽章**可能與 repo 的 migration 完全不同**（本例即是）。撰寫任何
  revoke／grant 之前，先查 `pg_get_function_identity_arguments` 取得實際簽章；照抄 repo 的
  簽章會因函式不存在而讓整個 migration 回滾，結果是缺口照樣開著而你以為修好了。
- 2026-09-11 全面查證結果（以預防 ④ 的查詢實跑）：
  - **正式庫 `egehnijjpgijmccagxac` 共 10 支** SECURITY DEFINER 函式對 anon／authenticated 開放。
    `proacl` 逐字為 `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`——開頭的 **`=X`
    （grantee 空白）就是 PUBLIC 持有 EXECUTE 的字面證據**，這比「`proacl` 是 NULL」更容易辨識，
    查核時應直接看 ACL 字串有沒有 `=X`。
  - 已撤 8 支（分兩批）：`reserve_seats`、`release_seats`、`create_tour_order`；
    `subscribe_feature`、`subscribe_bundle`、`user_id_by_email`、`email_exists`、`next_tour_order_no`。
    撤權前逐一查證呼叫端皆為 `createAdminSupabase()`（`SUPABASE_SERVICE_ROLE_KEY`），
    `next_tour_order_no` 則全 repo 無應用程式呼叫、僅由 `create_tour_order` 在 SQL 內部呼叫
    （SECURITY DEFINER 內部呼叫以擁有者身分執行，不受撤權影響）。
  - **最嚴重的一支是 `subscribe_feature`**：`p_price` 由呼叫端提供，`p_price=0` 即可免費開通
    任意功能與月數；亦可指定他人 `tenant` 在其 `tenant_point_transactions` 寫入 CONSUME。
    未登入即可執行。這不是理論風險，是當時的實際狀態。
  - **必須保留開放、不得撤**：`is_tenant_member`、`tenant_role_at_least`——RLS policy 內部要用，
    撤掉等於全站讀不到資料。
  - **不能用撤權解決**：`reserve_catalog_positions` 是由 `requireTenant()` 正常路徑回傳的
    **session client（authenticated 身分）**呼叫的，撤掉會讓「新增服務／商品／作品集」當場壞掉。
    這類要改程式走 admin client，是一支 PR，不是一行 SQL。
  - canonical TEST `nmwhwngojosmagjuvxol` 同一查詢回 11 支，尚未處理（測試庫，不含真實資料）。
- 狀態：**監看中**——正式庫的 8 支已撤且留有套用前後證據；`reserve_catalog_positions` 待程式修正；
  TEST 待清理；預防 ④ 目前仍靠人工執行，尚無自動化檢查會在新缺口出現時報警。

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

- 首次／最近：2026-09-09／2026-09-13
- 發生次數：2（第 2 次一輪內同時犯了兩件）
- Issue／PR／CI：#25、#42；`docs/OWNER-DECISIONS.md:88`、`:108`；
  #396／#27；`docs/decisions/2026-09-10-schema-canonical-source.md`、
  `docs/decisions/2026-09-07-owner-production-ddl-0086-0087-0089.md` 第二節
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

#### 第 2 次（2026-09-13）：一次把兩件已裁示的事列成「卡在 Owner 身上」

#396 收尾與主線盤點後，我向 Owner 列了四件待辦，其中兩件**早已有 Owner Decision
在 `main` 上**：

| 我當時的說法 | 實際狀態 |
|---|---|
| 「#41 overlay 要認列為產品契約還是 TEST 殘留，這是產品判定，不是我能決定的」 | `docs/decisions/2026-09-10-schema-canonical-source.md`（**Status: DECIDED**）已給出分類法 `ACTIVE_RUNTIME`／`FUTURE_PRODUCT`／`LEGACY_RETIRED`／`COMPATIBILITY_ONLY`，並明文寫著 `TEST_ONLY` 只是**證據標籤，不是哪一邊正確的判定**。該 overlay 的 manifest 自標 `mode: LOCAL_ONLY_TRANSITIONAL`、`status: CANDIDATE_SOURCE_NOT_CANONICAL`，canonical 採納綁在 #41／PR #73 自己的驗收閘。正確分類是 `FUTURE_PRODUCT`，沒有待裁示的事。 |
| 「#27 收尾要的 Preview 部署（環境變數指向 TEST Supabase）」 | `docs/decisions/2026-09-07-owner-production-ddl-0086-0087-0089.md` 第二節**已經授權**，連邊界都寫好：「只動 Preview 環境變數，不動 Production 的任何設定」。 |

而且「二選一」這個框架本身就是錯的——那個 overlay 既不是產品契約也不是殘留，它是
**開放中工作的候選基線**：repo 裡有專屬目錄 `supabase/local-migrations/issue-41-candidate-baseline/`、
有 manifest、CI 還專門把它排除在 canonical bootstrap 證明之外。用二選一提問會逼出一個錯的答案。

與第 1 次的差別值得記下來：第 1 次是把 Issue 內文當決策來源；這一次是**根本沒去查**
決策來源。`CLAUDE.md` 的「Mandatory start」第 2 步就要求讀 `docs/OWNER-DECISIONS.md`
與 `docs/decisions/**`，我在那一輪跳過了，因為當時的任務看起來是「盤點與回報」而不是
「開工」——但把待辦丟回給 Owner 同樣是一個需要先確認現行裁示的動作。

- 預防（在原本的基礎上追加）：
  1. **任何「這件事卡在你身上」的陳述，送出前必須先 grep `docs/decisions/` 與
     `docs/OWNER-DECISIONS.md`。** 這比開工前讀更重要——開工做錯還有 CI 會擋，
     問錯問題不會有任何東西擋你，只會浪費 Owner 一輪往返並降低後續提問的可信度。
  2. 狀態未明的東西不要寫成二選一。先問「這在現行治理下屬於哪一類」，再問「需要做什麼」。
     分類法已經存在時就套用它，不要重新發明選項。
- 狀態：監看中（第 3 次再發生時，把「送出 Owner 待辦前的決策查核」做成可執行檢查）

### PB-032 — `conclusion=success` 不等於測試執行過：`POLICY_SKIP` 也是綠的

- 首次／最近：2026-09-11／2026-09-11
- 發生次數：1
- Issue／PR／CI：#352；run 34546518776 job `integration`；run 34546915631 job `integration`
- 分類：CI
- 事件：PR #352 帶進一支新的整合測試 `tests/integration/api/product-positions.238.test.ts`。
  CI 的 `integration` check 回報 `conclusion=success`，我據此向 Owner 宣稱「完整測試套件
  （含整合測試）在這顆 head 上跑過且綠了」。**那支測試一次都沒有執行過。**
  `integration` job 只印了一行 policy 訊息就以 success 結束。
- 證據：
  ```
  POLICY_SKIP: this PR is not the sole active TEST_VALIDATION holder
  (source_only_pr_without_test_lane).
  ```
  該 job 的完整 log 只有這一行實質輸出，沒有任何 vitest 輸出、沒有測試名稱、沒有通過數。
  對照真正執行後的 log：
  ```
  ✓ tests/integration/api/product-positions.238.test.ts (6 tests) 15860ms
  ```
- 根因：兩層，第二層才是真正的問題。
  1. **機制層**：共用 TEST 一次只允許一位 `TEST_VALIDATION` holder，非 holder 的 PR 依政策
     記一筆成功的 `POLICY_SKIP`。這是**刻意設計**，不是缺陷——它讓非 holder 的 PR 不會因為
     搶不到 TEST 而紅。副作用是「跳過」與「通過」在 check 層級長得一模一樣。
  2. **判斷層**：我把 `conclusion=success` 當成「測試執行且通過」的證據。那是**狀態碼**，
     不是**執行證據**。同一個綠燈可以來自「跑了而且過了」「依政策跳過」「job 提早結束」，
     三者在 API 回應上無法區分。這與 PB-027（用「名字出現幾次」代替「那件事真的會發生」）
     是同一種錯誤的不同外觀：拿一個**代理指標**代替**要證明的事實**。
- 影響：我向 Owner 報出的是一個假綠。若當下合併，#352 會帶著一支從未執行過的整合測試進 main，
  而該測試正是這支 PR 唯一能證明「排序真的落地到 DB」的證據。無資料受影響——因為在合併前
  自己回頭讀 job log 才發現。
- 修正：
  1. 查出 `POLICY_SKIP` 的成因是 `classify` 因舊 PR 內文而紅，導致本 PR 未被認定為 TEST holder。
  2. 修正 PR 內文的中繼資料，將 lane 由 `TERRA_BUILD` 轉入 `TEST_VALIDATION`。
  3. 以 `ci.yml` 的 `workflow_dispatch`（`lane_transition`）重新派工——**不補 no-op commit、
     不 close/reopen**，因為 `ci.yml` 只監聽 `[opened, synchronize, reopened]`，而重跑會重播
     舊的 event payload、再次讀到舊內文。
  4. 向 Owner 主動更正先前的錯誤宣稱。
- 預防：
  1. **宣稱任何測試通過之前，必須讀 job log 並看到測試名稱與通過數。**
     `conclusion` / `state` / check 顏色一律不接受作為執行證據。
  2. 整合測試尤其要查：它是唯一會因為共用資源政策而被整批跳過的一類，而且跳過時是綠的。
     判準是 log 裡有沒有 `✓ tests/integration/...(N tests)` 這一行。
  3. 同族陷阱：任何「依政策跳過」「matrix 條件不成立」「job 提早 return」都會產生同樣的綠。
     `skipped` 至少還看得出來，`success` 的 `POLICY_SKIP` 看不出來。
  4. 這條屬於 Completion Truth Gate 的第一項（「成功的工具呼叫只代表 REQUESTED」）在 CI 上的
     具體形狀：**綠燈只代表 check 回報綠，不代表它驗過你以為它驗過的東西。**
- 驗證：重新派工後讀 log 確認 `✓ tests/integration/api/product-positions.238.test.ts (6 tests)
  15860ms`，6 條全過。
- 狀態：已防止（判準已寫入本條預防第 1、2 點）
- 相關教訓：PB-027、PB-029。

### PB-033 — 對正式庫下了 revoke 之後，才回頭查有沒有呼叫端

- 首次／最近：2026-09-11／2026-09-11
- 發生次數：1
- Issue／PR／CI：PR #352 的 Final Risk 追查；正式庫 `egehnijjpgijmccagxac`
- 分類：權限
- 事件：查到正式庫三支 tour-seat RPC 對 `anon` 開放、取得 Owner 授權後立即套用 revoke。
  **套用之後**才去讀 `requireTenant()`，發現它在正常路徑回傳的是 **session client（authenticated
  身分）**，不是 admin client——也就是說「被 revoke 的函式是不是正好由 authenticated 呼叫」
  這件事，我在動手時並不知道。
- 證據：`src/server/tenant.ts:66-125`——只有代登入分支回 `supabase: admin`，其餘一律回 session client。
  而 `src/app/api/tour-orders/manual/route.ts:62` 正是 `t.supabase.rpc('create_tour_order', …)`。
- 根因：把「這是安全修正」當成「可以少一道查證」。收權與加權在風險結構上是對稱的——
  兩者都可能讓線上功能當場停止運作，差別只在失敗的方向。而我對加權會謹慎，對收權沒有。
- 影響：**這次沒有造成損害，但那是運氣不是判斷**。事後查證發現該 route 傳的是 `0087` 的參數名
  （`p_order_no` / `p_party_size` / `p_contact`），而正式庫的函式是另一套簽章
  （`p_party` / `p_customer_name`），PostgREST 本來就回 PGRST202——那條路徑在我撤權之前就已經是壞的。
  若簽章恰好相符，我就會在無預警的情況下讓正式站的建單停止運作。
- 修正：第二批（`subscribe_feature` 等五支）改為**先逐一查證呼叫端與其使用的 client，列出證據
  給 Owner 確認，才執行**。查證項目：全 repo grep（含 `tests/`）、呼叫端用哪個 client 建構函式、
  該 client 用哪把 key、以及是否被其他 SQL 函式內部呼叫。
- 預防：
  1. **對線上資料庫執行任何 `revoke`／`drop`／`alter` 之前，先完成呼叫端清查**，把清單與每一處
     使用的 client 列出來。「這是安全修正」不是略過這一步的理由。
  2. 清查必須包含四個面向，缺一不可：全 repo grep（含測試）→ 呼叫端的 client 建構函式 →
     該 client 用的 key/角色 → `pg_proc.prosrc` 裡有沒有其他函式內部呼叫它。
  3. migration 尾端的自我驗證要**雙向**：既檢查「權限有沒有撤乾淨」，也檢查「該保留的角色
     （通常是 `service_role`）有沒有被誤撤」。只驗前者的話，「連 service_role 一起撤掉」這種
     會弄壞正式站的錯誤會安靜通過。
  4. 同時提供還原指令給 Owner，並說明「repo 之外的呼叫端我無法證明不存在」這個界線。
  5. **同族（2026-09-11 同一輪再次發生）：用會寫入的指令去做只需要讀的事。**
     為了找 TEST 重建工具而跑了 `git checkout -q origin/main -- .`——結尾那個 `.` 會把
     整個工作區覆蓋掉。當時分支上是 #352 的未合併成果，於是產生一份「看起來像工作進度」
     的未提交變更，內容其實是**把 #352 的修正全部移除**；若照 stop hook 的提示 commit 下去，
     等於撤銷整支 PR。只想讀檔案時一律用 `git show <ref>:<path>`，不要用 `git checkout`。
     這與本條主體同因：為了省一步，選了一個會改變狀態的動作去達成只需要觀察的目的。
- 驗證：第二批五支撤權前後皆記錄 `has_function_privilege` 與 `proacl`；雙向自我驗證未觸發。
  工作區污染於 commit 前查出方向（diff 顯示為移除 `reorderProducts` 接線），以
  `git reset --hard HEAD` 丟棄，並確認被丟掉的兩份 docs 與 `origin/main` 逐位元組相同。
- 狀態：已防止
- 相關教訓：PB-028。

### PB-034 — 用 CI 當規則查詢器：靠一次次被退來湊出正確的 PR 中繼資料

- 首次／最近：2026-09-11／2026-09-11
- 發生次數：3（#352 連續 4 次、#361 2 次、#370 1 次）
- Issue／PR／CI：PR #352、#361、#370
- 分類：Agent
- 事件：#352 開出後被守門與 CI 連退四次，**四次都是中繼資料填錯，沒有一次是程式碼問題**：
  1. `FINAL_CANONICAL_REQUIRED: false` —— `TEST_PROFILE: LOCAL_ISOLATED` 強制要求 `true`
  2. `CLOSURE_SWEEP_TARGET: #239` —— 只接受 `EMPTY_WITH_SCAN` 或 `REPORT:`，PR 編號不是合法值
  3. `AGENT_LANE: TERRA_BUILD` —— 要派工共用 TEST 必須先轉 `TEST_VALIDATION`
  4. `ACTIVE_CANDIDATE: true` —— `TEST_VALIDATION` 規定必須是 `false`
- 證據：四條規則全部明文寫在 repo 裡且開工前可讀：`scripts/agents/dual-terra-wip-policy.mjs`
  （第 283-291 行的 closure 規則、`isActiveTestValidation()`）與
  `scripts/ci/local-isolated-test-policy.mjs`（`LOCAL_ISOLATED` 的 profile 檢查）。
- 根因：把 PR 內文當成「填完送出、錯了再改」的表單，而不是一份**有明文規格的契約**。
  我是從既有 PR 複製欄位再逐項猜，而不是先讀那兩支 policy 腳本。
- 影響：四輪 CI 配額與 Owner 的等待時間。每一輪都要重跑守門與分類，其中一輪還佔用了
  共用 TEST 的派工。無程式碼或資料受影響。
- 修正：讀 `dual-terra-wip-policy.mjs` 與 `local-isolated-test-policy.mjs` 的實際判定式，
  依規則一次補齊。
- 2026-09-11 同一輪重演（PR #361），以及一個**更好的預防**：
  寫完本條之後，我在同一個 session 開 #361，又被退了兩次中繼資料錯誤。
  查規則時才發現 repo **本來就有 `scripts/agents/agent-wip-preflight.mjs`**——一支可以在
  開 PR 前本機執行的檢查器：
  ```bash
  node scripts/agents/agent-wip-preflight.mjs \
    --body <pr-body.md> --changed-files <files.txt> --number <pr>
  # → WIP_PREFLIGHT_PASS issue=362 lane=GOVERNANCE
  ```
  也就是說本條原本的預防（「先讀那兩支腳本」）**比實際可用的工具還弱**——要人用眼睛
  模擬一支可以直接跑的程式。這是本條會重演的真正原因。
  實跑後它一次列出兩個 CI 當時**還沒報**的錯（`DELIVERY_UNIT_TYPE must be SLICE,
  STANDALONE, EPIC, or GOVERNANCE`、`An active Product delivery lane must point to a
  closable SLICE or STANDALONE Issue`），而且更嚴格：#352 填 `DELIVERY_UNIT_TYPE: PRODUCT`
  時 CI 的守門並沒有擋，preflight 會擋。
  那兩個錯也揭露了真正的問題不在欄位而在 **lane 選錯**：#361 改的是測試種子與 Playbook，
  沒有任何使用者可見產出，宣告成 `TERRA_BUILD`／`SLICE` 會強制
  `COUNT_IN_DELIVERY_OUTCOME=true`——把一支沒有交付的 PR 記成一個交付單位。改為
  `GOVERNANCE` lane 後 preflight 一次通過。
- 2026-09-11 第三次發生（PR #370），而且**預防 0 這次沒擋住**：
  #370 的 `TEST_PROFILE` 被我填成 `CANONICAL_TEST`——一個不存在的值（合法值是
  `SOURCE_ONLY`／`LOCAL_ISOLATED`／`LOCAL_ISOLATED_CANARY`／`SHARED_CANONICAL`）。
  我**有**依預防 0 先跑 preflight，而且它回 `WIP_PREFLIGHT_PASS`；CI 的 `classify` job
  照樣把 PR 退了：

  ```
  [local-test-policy] TEST_PROFILE is invalid: CANONICAL_TEST
  ```

  根因是 preflight **沒有涵蓋** `scripts/ci/local-isolated-test-policy.mjs`。它呼叫
  `agent-wip-policy` 與 `dual-terra-wip-policy`，但 `TEST_PROFILE` /
  `FINAL_CANONICAL_REQUIRED` 由第三支驗證器管，preflight 從來沒問過它。

  **這比原本的失效模式更危險**：原本是「沒跑工具」，一旦跑了就會發現；現在是
  **跑了工具、拿到綠燈、而綠燈是不完整的**。一條「通過才推」的預防，只有在檢查器
  真的涵蓋 CI 會擋的規則時才成立；少涵蓋一支，預防就只是看起來有效，而這件事在
  preflight 通過時完全看不出來。

  修正不是「以後記得多讀一支腳本」——那又會退回被本條否定過的、用眼睛模擬程式的做法。
  修正是讓 preflight **直接呼叫 CI 用的同一支函式**（`decideLocalIsolatedTest`），
  而不是在 preflight 裡複製一份合法值清單：複製一份的話兩邊日後會分歧，而分歧同樣
  在 preflight 通過時看不出來。已在 `agent-wip-preflight.mjs` 補上，並以
  #370 被退的那份真實 PR 內文雙向驗證（填 `CANONICAL_TEST` → 擋下；填
  `SHARED_CANONICAL` → 通過），另加變異驗證：拿掉那一行 → 新測試 3 條轉紅。
- 狀態：監看中。前兩次的預防都在下一輪被繞過（第一次是工具比人弱，第二次是工具涵蓋不全），
  所以本條不宣稱「已防止」。下一次若再以中繼資料被退，先問的不是「哪個欄位錯」，而是
  **「preflight 是不是又少涵蓋了一支 CI 驗證器」**。
- 預防：
  0. **開 Agent PR 前先跑 `scripts/agents/agent-wip-preflight.mjs`，通過才推。**
     這是唯一真正有效的一條；下面幾條是它擋不到時的備援。不要拿 CI 當規則查詢器。
  1. 它報錯時，回頭讀會驗這份內文的腳本（`scripts/agents/dual-terra-wip-policy.mjs`、
     `scripts/agents/agent-wip-policy.mjs`、`scripts/ci/local-isolated-test-policy.mjs`），
     不要從別的 PR 複製欄位後逐項猜。
  2. 欄位之間有**互相依賴**，不能逐欄獨立填：`TEST_PROFILE` 決定 `FINAL_CANONICAL_REQUIRED`；
     `AGENT_LANE` 決定 `ACTIVE_CANDIDATE` 與能不能派工共用 TEST。改一欄要回頭檢查相依欄。
  3. 有列舉值的欄位（`CLOSURE_SWEEP_TARGET`、`SELECTION_REASON`、`AGENT_LANE`、`LANE_STATE`）
     一律回腳本確認合法值集合，不要憑語意自創。
  4. 同族陷阱：PB-027 是「拿代理指標代替事實」，本條是「拿試誤代替讀規格」。兩者都是
     **用便宜的動作取代一次應該做的查證**，而在有守門的專案裡，試誤的成本會由 CI 與 Owner 承擔。
  5. 欄位錯常常是 **lane 選錯的症狀**，不是獨立的填寫失誤。改欄位之前先問：
     這支 PR 真的是一個交付單位嗎？沒有使用者可見產出的，就不該佔 Product lane。
- 驗證：#352 第四次修正後守門 `Agent WIP Policy=success`、`classify-changes=success`，
  整合測試實際執行並通過。#361 改用 preflight 後，本機一次 `WIP_PREFLIGHT_PASS` 才推。
- 狀態：監看中——預防 0 於 2026-09-11 才建立，尚未累積足夠的執行次數證明它真的擋得住。

### PB-035 — 從欄位定義推斷「這筆 insert 會失敗」，卻沒查參與寫入的 trigger

- 首次／最近：2026-09-11／2026-09-11
- 發生次數：1
- Issue／PR／CI：#352；canonical TEST `nmwhwngojosmagjuvxol`
- 分類：TEST DB
- 事件：canonical TEST 的 `tour_orders.deposit_mode_snapshot` 是 `NOT NULL` 且無 default，
  而 `main` 的 `0087` 裡 `create_tour_order()` 的 `insert` **欄位清單沒有它**。我據此向 Owner
  斷定：「就算把函式簽章修好，下一個錯誤會是 23502」，並以此為前提提出三個選項、取得
  同意要新寫一支 `0096` 去補寫該欄。
  **那個前提是錯的。** 該表上早就有 `t_tour_orders_payment_policy_snapshot`——一個
  `BEFORE INSERT` trigger，body 第一行就是 `new.deposit_mode_snapshot := v_plan.deposit_mode;`，
  連 `upfront_required_amount` 都一併算好。`BEFORE INSERT` 在 `NOT NULL` 檢查**之前**執行，
  所以那筆 insert 從來就不會失敗。`0096` 完全不需要，而且寫下去會與既有 trigger 重複。
- 證據：
  ```sql
  -- 我當時只查了這個，就下了結論
  select column_name, is_nullable, column_default from information_schema.columns
   where table_name='tour_orders' and column_name='deposit_mode_snapshot';
  -- → NOT NULL, default null

  -- 沒查這個（後來為了確認 drop 相依才順手查到）
  select t.tgname, p.prosrc from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
   where c.relname='tour_orders' and not t.tgisinternal;
  -- → t_tour_orders_payment_policy_snapshot（BEFORE INSERT）已經在填那一欄
  ```
  實測收尾：把函式簽章對齊 `0087` 之後，`tour-orders.10` 直接由 PGRST202 轉為通過，
  **沒有出現任何 23502**。
- 根因：拿**靜態 schema 的一部分**去推斷**執行期行為**。一筆 insert 會不會成功，參與者不只
  欄位定義：`BEFORE INSERT` trigger、column default、generated column、rule 都會插手，
  而其中 trigger **可以在約束檢查之前改寫 NEW**。只看欄位就宣稱「必定違反 NOT NULL」，
  等於把「我看到的那一半」當成「全部」。
- 影響：向 Owner 提出了一個建立在錯誤前提上的方案並取得同意。若照做，會多一支與既有
  trigger 重複的 migration 進入 `main`——兩處各自寫同一欄，日後只改一邊就會產生分歧，
  而這種分歧在測試全綠的情況下看不出來。實際損害為零，因為在動工前恰好查到 trigger，
  **但那是順手查到的，不是流程保證的**。
- 修正：改為只對齊函式簽章（`drop` 舊多載 + 套用 `0087`／`0088`），保留 overlay 的全部
  6 個 trigger 不動，並在 migration 尾端加斷言：該 trigger 必須存在，否則 `0087` 的 insert
  會違反 NOT NULL。實跑四個測試檔 54 條全綠。
- 預防：
  1. **宣稱任何寫入會成功或失敗之前，先列出該表上所有參與寫入的物件**，不是只看欄位：
     ```sql
     select t.tgname,
            case t.tgtype::int & 2 when 2 then 'BEFORE' else 'AFTER' end as timing,
            p.proname
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_proc p on p.oid = t.tgfoid
      where c.relname = '<table>' and not t.tgisinternal;
     ```
  2. `BEFORE INSERT`／`BEFORE UPDATE` trigger **會在約束檢查之前改寫 NEW**。因此
     「欄位是 NOT NULL 且 insert 沒列它」**不足以**推出「一定失敗」；反過來
     「欄位有 default」也不足以推出「值一定是 default」。
  3. 同族判準：只要結論的形式是「某段程式碼在某個資料庫上會怎樣」，就必須有**在那個
     資料庫上執行過**的證據，或至少列完所有參與者。本例只要多跑一句 `pg_trigger` 查詢
     就不會發生。
  4. 這條與 PB-032 是同一種病的不同器官：PB-032 是拿 `conclusion=success` 當執行證據，
     本條是拿欄位定義當執行證據。**兩者都是用一個看得到的局部，代替一次沒做的查證。**
- 驗證：對齊簽章後實跑 `tour-orders.10`、`tours.10`、`plan-advanced-settings.10`、
  `platform-impersonation.25` 四檔共 54 條，全綠，無 23502。
- 狀態：已防止
- 相關教訓：PB-026、PB-027、PB-032、PB-033。

### PB-036 — `TERRA_BUILD` 的施工跑在 audit 層模型上，因為「反正我已經在跑了」

- 首次／最近：2026-09-12／2026-09-13
- 發生次數：2
- Issue／PR／CI：#370（migration＋RPC＋route＋測試，掛在 `TEST_VALIDATION` lane 上）；
  #396（`0104_tour_order_lineage_keys.sql`＋契約測試＋基線 manifest）
- 後續：#397 的 Final Risk 覆核發現修正已**確實委派給 build 層（Sonnet）**，預防第一次真的生效。
- 分類：模型治理
- 事件：兩次都不是判斷錯誤，是**根本沒判斷**。任務開始時我在 Opus 上，接到「繼續完成
  資料庫一致性」之後就直接寫 SQL、寫測試、跑驗證，從頭到尾沒有問過「這一輪是不是施工」。
  CLAUDE.md 的規則本身沒有模糊地帶——新增 migration 與測試就是 `TERRA_BUILD`，`TERRA_BUILD`
  一律用 Sonnet——模糊的是**什麼時候該套用它**：它需要在動手之前被想起來，而動手之前
  正是最不想停下來的時刻。
  #370 當時還多了一層：lane 被填成 `TEST_VALIDATION`，於是「施工」這個字面上沒出現，
  規則看起來就不適用了。那是用中繼資料把規則繞開，不是規則沒涵蓋。
- 證據：
  - #396 的 commit `76ae2d2` 新增 `supabase/migrations/0104_*.sql` 與
    `tests/unit/tour-order-lineage-keys.396.test.ts`——定義上的 `TERRA_BUILD`，
    `ACTUAL_MODEL` 為 Opus 5。
  - `CLAUDE.md`：「**Terra 一律用 Sonnet.** Doing `TERRA_BUILD` work on Opus is over-spec,
    not diligence」以及「`actual=Opus 5` on a `TERRA_BUILD` lane is a routing violation
    and should be recorded as one, not left as a neutral note」。
- 預防：
  1. **接到任務、動第一個檔案之前**先分類 lane，不是填 PR 內文時才分類。判準可機械化：
     這一輪會不會新增或修改 `supabase/migrations/**`、`src/**`、`tests/**`？會，就是
     `TERRA_BUILD`，就要委派。
  2. 委派的成本是一次 Agent 呼叫，遠低於「audit 層審自己產出」的代價。「我已經在跑了」
     不是理由——那正是規則要擋的那個念頭。
  3. lane 欄位不得用來讓規則失效。填 `TEST_VALIDATION` 而實際在新增 migration，
     是同一條違規再加一條不實中繼資料。
  4. 已發生的違規如實記在 PR 上，不寫成「註記」。
- 狀態：監看中（第 3 次再發生時，改為開工前強制先跑一次 lane 分類並記錄結果）

### PB-037 — 把「欄位集合」當成「欄位順序」，然後用一次找不到的搜尋證明「它不存在」

- 首次／最近：2026-09-14／2026-09-14
- 發生次數：**2（同一支 migration、同一輪內）**
- Issue／PR／CI：#44／PR #77；`agent-schema-bootstrap` run 34791455530、34791859620
- 分類：Schema／驗證方法
- 事件：`0105` 需要一個 `customers` 上的唯一約束當複合 FK 的目標。兩次都在同一個
  觀念上出錯。

  **第 1 次——用文字搜尋判定「不存在」。** 我下的是
  `grep -iE "unique \(id, tenant_id\)|id, tenant_id"`，零命中，於是寫下
  「`customers` 上確實沒有等價的唯一約束，所以那個 FK 靶是必要的」並據此
  `add constraint customers_id_tenant_uq unique (id, tenant_id)`。
  但 `0104_tour_order_lineage_keys.sql:138`（同一天稍早才由我套用到正式庫的那支）
  早就建了 `customers_tenant_id_id_key unique (tenant_id, id)`——**同一個欄位集合，
  只是宣告順序相反**，我的樣式因此漏掉它。
  後果不只是多一條冗餘約束：FK 綁上去之後，`agent-schema-bootstrap` 的
  `production-shaped-simple-keys-upgrade` 證明在 drop 既有約束時被依賴關係擋下。

  **第 2 次——修正時又踩同一個觀念。** 改成「重用既有約束、缺少就 raise」是對的
  方向，但判斷式寫成 `conkey = (select array_agg(attnum order by attnum) ...)`。
  `pg_constraint.conkey` **保留的是約束宣告時的欄位順序**，不是排序後的值：
  `customers` 的 `id=attnum 1`、`tenant_id=2`，所以 `unique (tenant_id, id)` 的
  `conkey` 是 `{2,1}`，而我拿 `{1,2}` 去比，**永遠不相等**，於是那條「保護性」斷言
  必定誤報「約束不存在」並中止整支 migration。
- 證據：
  ```sql
  -- 對 canonical TEST 實查（唯讀），一次看清兩件事
  select conname,
         conkey::int[]                                        as conkey_宣告順序,
         (select array_agg(k order by k) from unnest(conkey) k)::int[] as conkey_排序後,
         (select array_agg(attnum order by attnum) from pg_attribute
           where attrelid='public.customers'::regclass
             and attname in ('tenant_id','id') and not attisdropped)::int[] as 我的運算式
    from pg_constraint
   where conrelid='public.customers'::regclass and contype='u';
  -- → customers_tenant_id_id_key | {2,1} | {1,2} | {1,2}
  --   宣告順序 {2,1} ≠ 我的 {1,2}；排序後才相等

  -- 兩個判斷式直接對打
  -- 修正後（兩邊都排序）→ true
  -- 修正前（直接比 conkey）→ false
  ```
- 預防（可機械執行）：
  1. **「唯一約束／索引是否已存在」不得用文字搜尋判定。** 一律查系統目錄，並以
     **欄位集合**比對：`(select array_agg(k order by k) from unnest(conkey) k)`
     對 `(select array_agg(attnum order by attnum) from pg_attribute ...)`。
     `conkey`／`indkey` 依設計保留順序，兩邊不各自排序就是在比「順序」不是「集合」。
  2. **新增 UNIQUE／index 當 FK 靶之前，先查是否已有等價者；有就重用。**
     「照名稱查不到 → 自己建」正是製造重複約束的那個形狀。本 repo 既有慣例是
     `<table>_tenant_id_id_key unique (tenant_id, id)`（見 `0067`、`0104`）。
  3. **正向對照（positive control）**：任何用來證明「X 不存在」的搜尋或判斷式，
     送出結論前必須先拿一個**已知存在**的案例餵它。找不到那個已知案例，代表
     搜尋壞了，不代表世界是空的。第 2 次若先拿 `customers_tenant_id_id_key`
     餵一次判斷式，當場就會看到 `false`。
  4. **「我沒找到」不是「它不存在」。** 前者是關於我的搜尋的陳述，後者是關於世界的
     陳述。寫進 PR／Issue 前先分清楚自己在講哪一個。
- 狀態：監看中。第 3 次再發生時，改為：任何 migration 內用來判定「物件是否已存在」
  的述詞，必須在 PR 證據裡附上**對真實資料庫跑過的正向對照結果**，否則該 PR 不得
  進入 Final Risk。

### PB-038 — 用 `;` 把退出碼吃掉，然後在測試是紅的情況下推上去

- 首次／最近：2026-09-13／2026-09-14
- 發生次數：**3**
- Issue／PR／CI：PR #77（早期兩次）、PR #416（`57de3b937c8a18b90f484c9d7bec2f7502a9de25`）
- 分類：驗證方法／工具使用
- 事件：三次都是同一個機制——**我以為自己在檢查，實際上那個檢查的結果沒有進到任何判斷**。

  1. `npm run … | tail`：拿到的是 `tail` 的退出碼，永遠是 0。
  2. `npx vitest run tests/unit | grep …`：拿到的是 `grep` 的退出碼，後面的 `&&`
     照樣往下走，於是在 5 支測試紅的情況下 commit。
  3. 2026-09-14，PR #416：

     ```bash
     npx vitest run tests/unit > /tmp/u.txt 2>&1; echo "UNIT=$?"; \
       git add … && git commit … && git push …
     ```

     這次我**有**把退出碼印出來（`UNIT=1`），但 `echo` 之後那個 `;` 讓 `git push`
     跟測試結果毫無關係。輸出裡明明白白寫著 `1 failed | 2109 passed`，推送照樣完成。

  第 3 次特別值得記：前兩次是「沒看到退出碼」，第 3 次是「**看到了退出碼，但沒有讓它
  控制任何事**」。把結果印出來給自己看，不等於讓它擋住下一步。
- 證據：
  ```bash
  # 管線：取最後一段的退出碼
  false | tail -1; echo $?     # → 0

  # 分號：完全不看前一段
  false; echo "EXIT=$?"; echo "我照樣執行了"   # → EXIT=1，然後照樣執行

  # 正確：紅了就擋住
  npx vitest run tests/unit > /tmp/u.txt 2>&1 && git push …
  ```
- 預防（可機械執行）：
  1. **驗證與推送永遠用 `&&` 串成一條。** 要保留輸出就重導向到檔案
     （`> file 2>&1`）再用 `&&` 接下去，不要用管線、也不要用 `;` 分隔。
  2. **推送前的最後一個指令，必須是一個「紅了就會擋住推送」的指令。**
     若中間插入了 `echo`、`grep`、`tail` 之類，那條鏈就已經斷了。
  3. 需要看摘要時，順序是「先 `&&` 跑完驗證，再單獨讀檔」，不是「邊跑邊過濾」。
  4. 推送後若才發現紅燈，**立刻修，不等 CI 告訴我**；本次 CI 也確實在下一輪擋下了。
- 狀態：監看中。第 4 次再發生時，改為：任何 push 之前必須先執行一個專用的
  verify 腳本，由該腳本自己 `set -euo pipefail` 並在失敗時非零退出，不再允許
  在對話中臨時拼裝驗證鏈。

### PB-039 — 一個從來沒有受測對象的 guard，永遠不會失敗

- 首次／最近：2026-09-14／2026-09-14
- 發生次數：1（但它已經靜默存在了三天）
- Issue／PR／CI：Issue #415；PR #412（引爆）、PR #416（修正）
- 分類：測試設計／證據強度
- 事件：`tests/unit/governance-scoreboard.test.ts` 有一條看起來很嚴格的 guard：

  ```ts
  for (const name of fs.readdirSync(ledgerDir)…) {
    const run = JSON.parse(…);
    if (!terminal || Date.parse(run.startedAt) < effectiveAt) continue;
    expect(fs.existsSync(evidencePath), `${run.runId} must have durable review evidence`).toBe(true);
    …
  }
  ```

  policy 的 `effectiveAt` 是 `2026-09-11T08:46:22Z`。在 2026-09-14 之前，repo 裡
  唯一 terminal 的 Run 是 `2026-09-09-governance-loop-r01`，起算於 09-09——**早於
  生效日**。也就是說這個迴圈從寫下的那一刻起就跑零次，什麼都沒斷言，而測試一直是綠的。

  #412 把三本 Run 收成 terminal，它才第一次拿到對象，並立刻暴露出兩件事：guard 的
  適用範圍與 evaluator 自己的範圍不一致（向 Product Run 索取 governance 證據），
  以及 main 就這樣紅了。

  這跟 PB-037 是同一種病的兩個面向：PB-037 是「一次找不到就當作不存在」，PB-039 是
  「一次都沒找到對象就當作通過」。**綠燈在「沒有受測對象」與「受測對象全部正確」
  之間沒有任何鑑別力。**
- 證據：
  ```bash
  # 逐本檢查 #412 之前的 ledger，看有沒有任何一本會進入迴圈
  for f in $(git ls-tree --name-only 45b65b6^:docs/metrics/agent-runs/ | grep json); do
    git show 45b65b6^:docs/metrics/agent-runs/$f | python3 -c "…terminal and startedAt >= effectiveAt…"
  done
  # → 無任何輸出：迴圈跑零次

  # 反向對照：把 effectiveAt 暫時改到 2027 後，新的反空轉斷言確實會擋
  # → AssertionError: no post-policy terminal Run was inspected; expected 0 to be greater than 0
  ```
- 預防（可機械執行）：
  1. **任何「對所有符合條件的 X 都斷言 Y」的 guard，必須同時斷言符合條件的 X 至少
     有一個**（`expect(inspected).toBeGreaterThan(0)`）。沒有這一行，它就只是一段
     可能永遠不執行的程式碼。
  2. **寫完當下故意讓條件落空一次**，確認反空轉斷言真的會擋——跟 PB-037 的正向
     對照是同一個要求，只是方向相反。
  3. **guard 的適用範圍要跟它所依賴的 evaluator 的範圍一致。** 這次是測試比
     evaluator 更寬：evaluator 明說「非 MODEL_GOVERNANCE 的 Run 不適用」，測試卻
     無條件索取 governance 證據。範圍不一致時，以**被呼叫者自己宣告的範圍**為準。
  4. 「範圍外」也是一個要被證明的事實，不要用 `continue` 靜默跳過——改成正面斷言
     「它確實在範圍外且沒有 errors」。
- 狀態：監看中。

## 2026-09-14 複盤回填與改善紀錄

> 以下沿用原 PB 根因，不另建重複編號。原事件、計數與證據保留；新案例的日期與
> 計數另列，避免把文件整理冒充再次事故或改寫歷史。本次文件更新不宣稱已修完 Product。

### PB-027 補充：代表物件存在，不證明整支 migration 已執行

- 首次／最近：本延伸案例為 2026-09-13／2026-09-13；2026-09-14 回填。
- 發生次數：本延伸 1 次；原條目四種形態保留，不重算來源中的歷史數字。
- Issue／PR／CI：#396，comment `5652730712`；後續狀態另查 #401，不沿用補登當下的待辦。
- 分類：Migration／稽核方法。
- 事件：只因 `welcome-card-images` bucket 存在，就把 `0069` 補登為已套用。
  後續比對整份寫入 policy，發現它符合歷史 `0024`，不符合 `0069`；原作者已撤回錯誤補登。
- 證據：[原始更正與完整比對](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/396#issuecomment-5652730712)。
- 根因：用一個代表物件代替整支變更及其來源。重放是否改變現況、目前效果是否等價、
  歷史上是否真的執行，是三個問題；物件可能由另一條安裝路徑建立，舊效果也可能被後續取代。
- 影響：錯誤帳本會誤導後續部署與一致性判定；補登數量增加不能代表環境已對齊。
- 修正：本輪把已發生的撤回及判準回填手冊；沒有再次操作或補登任何資料庫。
- 預防：先比完整變更效果、相依與權限，再按既有來源分類／別名對照處理。
  證據不足就保留未知或差異，不因 bucket、欄位、函式名稱出現便認列已套用；正式庫寫入仍須具名授權。
- 驗證：已核對原始更正內容；本輪沒有重跑 SQL，不能將引用的歷史查詢當成本輪資料庫驗收。
- 狀態：監看中；三方整體等價仍由原資料庫工作線驗證。

### PB-031 補充：複盤建議不能取代已生效的處置

- 首次／最近：本次回報誤判為 2026-09-14／2026-09-14。
- 發生次數：本延伸 1 次；原條目兩次歷史仍保留。
- Issue／PR／CI：#359、#360；`docs/OWNER-DECISIONS.md`；本次最新複盤。
- 分類：Agent／決策真相。
- 事件：複盤把「治理不再分析模型」外推成「#359 應關閉為已取代」，忽略現行處置是選配、不阻擋。
- 證據：`docs/decisions/2026-09-11-owner-governance-unpinned-model.md` 與主線決策索引。
- 根因：從新政策推導額外處置，沒有再次比對該工作已具名的實際安排。
- 影響：可能誤關保留項目或讓 Owner 重複裁示；本輪核對後沒有關閉 #359。
- 修正：已在回報與本檔速查更正，維持 OPTIONAL_NONBLOCKING，不索取治理模型憑證。
- 預防：任何「已過時／等 Owner／可以關」都先對照最新決策；清單、本文、留言不一致時，
  保留可追查的更正，不採最樂觀一段，不把舊快照當現況。
- 驗證：主線決策索引與本輪處置一致；機器自動防止所有語意誤判仍未完成，不宣稱已根除。
- 狀態：監看中。

### PB-032／PB-039 補充：關帳、可比較與出貨分開核對

- 首次／最近：2026-09-14／2026-09-14；本段為既有案例的跨報告判讀補充，不新增事故計數。
- Issue／PR／CI：#104、#411／#412、#415／#416；CI `34798759176`、scorecard `34798759138`。
- 分類：完成真相／複盤方法。
- 事件：三本舊 Product Run 已由 #412 正式關帳；缺少的全程量測及 Completion Truth 沒有因此補齊。
- 證據：#412 final head `8e57801087691cb6c4163ba5b2addd04de06d68d`、
  merge `45b65b64a2fc17371c7ce6320b6dba06ce88a14a`；狀態為 COMPLETE／CLOSED／NOT_CHECKED。
- 根因：將狀態、規則版本、執行證據與成果混成同一個綠燈，會讓複盤的結論超出資料範圍。
- 影響：可能重做已完成關帳、拿不足的 Run 湊 #104，或將文件工作計成產品出貨。
- 修正：本輪不改三本 Run、不補零值與歷史用量；已把分離判讀寫進速查及下表。
- 預防／驗證判準：使用既有驗證器與來源，不新增另一套評分公式。

| 要回答的問題 | 可用的證據 | 不可替代它的訊號 |
|---|---|---|
| Run 是否結束 | 真實 terminal 狀態與關帳／交接紀錄 | 有很多 commit 或 Issue 已關 |
| 能否比較 Product 效率 | 既有工具驗證通過的完整、truth-verified、可重建且可比較 Run | 只有 endedAt；初始 0 或 tasks 空陣列 |
| Governance Scoreboard 是否有效 | 實際 policy、Run、review evidence 與重算結果分別核對 | 文件寫 v2；policy active；只有報告檔名 |
| CI 究竟驗了什麼 | 同一 exact head 的 job step、案例數與日誌 | conclusion=success；舊 head 的綠燈 |
| 產品是否出貨 | 現行 Delivery Truth 要求的目標部署、資料庫與登入驗收 | PR merged；Preview 三條測試通過 |
| 返工與外部事故是否改善 | 固定時間窗、可比較樣本、去重後的失敗原因與供應商實查 | PR 庫存下降；失敗通知封數；Gmail 沒找到通知 |

#412 的 scorecard 重算及文件檢查確實執行，但 application install／typecheck／unit／build
及 integration／E2E 是文件政策略過，不能列為這些套件已通過。沒有資格比較時照實
NOT_GRADED，不刪除舊報告，也不把缺欄位改成 0。PB-039 的檢查器正反例可使用明確標示的
測試資料；它們不能冒充正式治理 Run，Product Run 也不能被拿來充當 Governance 樣本。

- 狀態：監看中；#104 的正式比較仍等待真實合格資料，不以本次手冊更新宣稱完成。

### 已採納的兩項操作優化與仍在外部的工作

1. **先情境速查，再讀相關原條目。** 先核對現行決策、已存在的修補和責任人；不全量回放
   舊對話、不為無關 main 前進重整分支、不另造同型治理 Issue／PR。
2. **先列可證明的事，再列待證明的事。** 同一個結果分開寫「本輪實測、來源記載、
   目前未知、建議下一步」。結案或交接必須指出責任人、剩餘步驟和證據，不替其他 Session 假關帳。

本輪查核基準為 main `dbfa970ebca489df2a2a490ae8f9a53c0086c57d`。#419 的 PB-038／PB-039
已存在，直接沿用。#415／#421 的分類器逐檔授權另有候選，不重做、不擴大整個 `scripts/ci/`
目錄。#414 的分支保護恢復是獨立管理權限事項；本輪不解除或旁路任何檢查。
#31、#396、#402 等 Product／正式環境驗收仍由各自工作線接續，不能用本次文件 PR 宣稱修完。

### PB-040 — 把埋點欄位建好，然後沒有埋

- 首次／最近：2026-09-14／2026-09-14
- 發生次數：1（但它讓一整輪的 B+ loop 形同虛設）
- Issue／PR／CI：#411、PR #418、PR #428；`docs/metrics/agent-runs/2026-09-14-product-delivery-r01.json`
- 分類：治理／記帳誠實度
- 事件：同一天之內，我先做對了一件事，然後把它抵銷掉。

  **做對的部分。** #411 結案時，我查出前九本 Run 不可評分的真正原因不是
  「status 停在 IN_PROGRESS」，而是**全程沒有埋點**：九本的 `modelUsage.tasks`
  幾乎全空、`actualTokensAvailable` 全是 `false`。我把這件事寫進 Issue、寫進
  commit、也跟 Owner 說清楚「唯一的路是從現在起的 Run 即時埋點」。

  **抵銷掉的部分。** 我接著建了 `2026-09-14-product-delivery-r01`，在 `notes`
  裡寫了三段說明它會如何即時埋點——然後整輪下來：

  ```text
  modelUsage.tasks: 0      ci.fullCiRuns: 0
  flow.lunaTasks: 0        flow.solTouches: 0
  inventory.closureSweeps: 0
  delivery: {}
  ```

  同一輪還有兩件本來就該記的違規：PR #418 與 #428 的 `AGENT_LANE` 都是
  `TERRA_BUILD`，`ACTUAL_MODEL` 都是 `claude-opus-5`（PB-036 第三次）；所有窄盤點
  都自己做，沒有委派給 scout 層。

  Owner 問「我們現在是否有遵循 B+ delivery loop」時，我才去查這些欄位——**不是
  因為我在做的時候有在看**。
- 為什麼比「沒埋點」更糟：一本欄位齊備、`notes` 寫滿方法論、但數字全是 0 的 Run，
  在任何摘要裡都長得像「有在管理」。前九本至少誠實地空著。這與 PB-039 是同一種病
  的兩個實例：**看起來在守，實際上沒有**。
- 預防（可機械執行）：
  1. **埋點的時機是事件發生的當下，不是收尾。** 每一次委派、每一次 full CI run、
     每一次 closure sweep、每一次開或關 Issue，當場寫進 ledger。
  2. **收尾時只准填當下仍可觀察的量**（CI run id、PR／Issue 編號、sweep 紀錄），
     其餘一律維持 `null`。`modelUsage.tasks` 與 `weeklyUsage*` 事後不得回填——
     那是推算不是實查，正是判定前九本不可評分的同一個理由。
  3. **每輪結束前對 B+ loop 的六個步驟各答一次「做了沒有」**，任一項答「沒有」就
     必須寫進 PR，不得靜默跳過。規則已寫進 `CLAUDE.md` 的「B+ delivery loop」一節。
  4. **違規要記成違規。** `flow.lunaTasks: 0`、`solTouches: 0`、`TERRA_BUILD` 跑在
     Opus 上，都是如實的違規記錄，不是「還沒填」。
- 狀態：監看中。下一輪若 `modelUsage.tasks` 仍為空而該輪確實有委派，視為第二次。

### PB-044 — 破壞性動作前的查證，有效期只有幾分鐘

- 首次／最近：2026-09-14／2026-09-14
- 發生次數：1
- Issue／PR／CI：shared TEST 漂移排查；CI 與 scout 並行跑 integration
- 分類：TEST DB／Agent
- 事件：07:20 查詢 TEST 上 `trip_departures` 的 `formation_status`，結果是「3 列全部 COLLECTING」，於是告訴 Owner「drop 掉再重建是安全的」。07:45 準備真的執行 drop/recreate 之前再查一次，結果變成「1 列 AT_RISK + 2 列 COLLECTING」——中間 25 分鐘內 CI 跑了 #440 的 integration 測試，seed 改掉了資料。
- 證據：兩次查詢間隔、查詢結果各一份、migration 日誌顯示該時間段有 seed 執行。
- 根因：在共用環境（TEST 被 CI 與其他 lane 共用）上，「我剛剛查過」不等於「現在還是這樣」。查證與破壞性動作之間隔了一次對話往返，環境狀態有時間改變。
- 影響：若按照 07:20 的結論執行 drop/recreate，會丟掉真實資料。改用 `alter column type … using` 保住資料，但延遲了排查進度。
- 修正：放棄第一份查詢結果，改以最新查詢為準；在 migration 與 seed script 前加鎖序列化 TEST DDL。
- 預防：
  1. **破壞性動作的前置查證必須緊貼動作本身**。drop／truncate／alter 之前，把查證與動作放在同一個交易或同一次 RPC 呼叫裡。
  2. **做不到原子化就在動作前一刻重查一次**，並把兩次的結果都記下來。查證的有效期是幾分鐘，不是一個 session。
  3. 在共用資源上，任何「我剛驗過」都必須問「期間有沒有其他工作可能改過」，特別是 CI lane 在跑時。
- 驗證：後續 TEST 動作前先確認無 CI 運行，或改用原子查證+動作；重查成功執行且資料一致。
- 狀態：已防止

### PB-045 — 並行工作的判準是檔案所有權與 Issue 邊界，不是功能描述

- 首次／最近：2026-09-14／2026-09-14
- 發生次數：1
- Issue／PR／CI：Issue #43；PR #418、PR #428；dual Terra 宣告
- 分類：Agent
- 事件：我判定 #43 的「第 5 類」與「第 7 類」可以開雙 Terra 並行，理由是「兩件不同的事，功能目標有區別」。
- 實際：兩條 lane 改的是**完全重疊**的檔案集：都動到 `src/app/api/`、`src/server/`、相同的 supabase migration、相同的 page；而且**同屬一個 Issue #43**。`docs/AGENT-EXECUTION.md` §5 的 dual Terra 契約明確要求「不同的 primary Issue」與「FILE_OWNERSHIP 零重疊」，兩條都違反。
- 證據：兩個 PR 的 `git diff --name-only` 結果有 95% 的重疊；Issue 號碼都是 #43；dual Terra 宣告的時間點早於實際檔案清查。
- 根因：把功能描述上的差異（「訂單管理」vs「退款管理」）當成了可並行的判準，沒有在宣告之前實際列出檔案所有權並做交集。
- 影響：兩條 lane 可能同時改一個檔案、同時跑 integration，造成 merge conflict、TEST 序列化違反、或一方覆蓋另一方的工作。
- 修正：停止其中一條 lane，改為序列執行；檔案合併後再開第二條。
- 預防：
  1. **並行的判準只有一個：檔案所有權與 Issue 邊界**。在宣告雙 Terra 之前，對每一條 lane 實際列出 `git diff --name-only` 與所有依賴的 supabase migration 編號。
  2. **計算交集並寫下來**。交集非空就一律不是雙 Terra 候選，這是可機械檢查的。
  3. **同一個 Issue 下的工作不得並行**，除非已正式分割成子 Issue。primary Issue 相同時，後續動作必須等待前置方完成。
  4. 功能上「聽起來是不是兩件事」不構成並行資格——要證明的是**可觀察的工作邊界**，不是功能描述。
- 驗證：改為序列執行後，確認第一條完成合併、第二條的 diff 與第一條無重疊、分別通過 integration；merge 與上線時只有一個時間點。
- 狀態：已防止

### PB-046 — 後置斷言只檢查本檔新增的欄位，不檢查所依賴的前提

- 首次／最近：2026-09-14／2026-09-14
- 發生次數：1（但涉及 canonical migration 與環境漂移）
- Issue／PR／CI：Issue #41（payment state 模型）；PR #432；`supabase/migrations/0108_issue_41_payment_state_model.sql`；TEST 環境漂移排查
- 分類：Migration
- 事件：`0108` 整支都在替 `public.tour_payment_status` enum 補 `PARTIAL`、`REFUND_PENDING` 兩個 label，並加上一整組後置斷言檢查新增欄位的型別。它依 PB-026 寫了斷言，但只檢查**本檔新增的三個欄位**的型別與 nullability，沒有檢查它所依賴的前置條件。實際上 TEST 上 `tour_orders.payment_status` 的型別是 `text`（外加一條整個 repo 反查零命中的古舊 check constraint），根本不是那個 enum。`0108` 在 TEST 上完整套用成功、零告警——它從來沒有斷言過自己所依賴的前提。
- 證據：
  1. **Canonical**：`git show origin/main:supabase/migrations/0087_tour_schema_foundation.sql | grep -A3 'payment_status'` → `payment_status tour_payment_status not null`（enum）
  2. **Production**：同上，enum 正常
  3. **TEST**：`select column_name, udt_name from information_schema.columns where table_name='tour_orders' and column_name='payment_status'` → `(payment_status, text)`
  4. **同表其他欄**：`status` 與 `source` 也都是 enum，只有 `payment_status` 一欄被改成 text
  5. **後置斷言發現漂移的機制**：不是靠盤點，是靠一個**沒有變綠的探針**。移除另一項漂移（孤兒 trigger）後 7 個 integration 失敗案例有 5 個轉綠，剩下一個仍紅：`expected '23514' to be '22P02'`。`22P02` = 字串不是 enum 的合法 label（正常 enum 通過），`23514` = 被 CHECK constraint 擋（非 enum 型別通過初始檢查但被老舊 constraint 擋）。拿到 `23514` 只有一種解釋：這個欄位根本不是 enum。
- 根因：migration 的後置斷言只對**自己建的東西**負責，忽略了**依賴的前提**。一支 migration 依賴「某欄位是某型別」才能執行，就應該把那個前提寫成斷言；否則它可以在前提不成立的環境上「成功」。
- 影響：TEST 的狀態對 `0108` 是隱形的，所有以 TEST 跑出的測試結論（payment state transition、refund logic 等）都是在一個**與 canonical 不等價的 schema** 上驗收的。若以 TEST 的「通過」宣稱「功能正確」，實際上只是證明了程式碼在錯的 schema 上不會撞到它自己的新 check——沒有證明它在正的 enum 上也會通過。
- 同類缺口（同一本 migration）：`0107` 與 `0108` 的後置斷言都檢查型別與 nullability，**都不檢查 default**。`add column if not exists` 對已存在的欄位是 no-op，不會修 default，所以 default 的漂移同樣不會被抓到。先前 `trip_departures.min_to_depart_snapshot` 是 NOT NULL 卻沒有 default 就是這樣漏掉的。
- 修正：
  1. 檢查 canonical 與 TEST 的 `information_schema.columns` → payment_status 型別確實不同
  2. 查出 TEST 上是否存在相應的舊 migration、overlay 或手工修改 → 找到 `supabase/local-migrations/historical-integration-baseline/` 有整套舊 #41 實作
  3. 未修改 TEST（保留漂移作為診斷記錄），改用 canonical 版本的 schema 重新跑一遍，所有探針轉綠
- 預防：
  1. **後置斷言的檢查清單至少涵蓋三項**：(a) 本檔新增的欄位 / constraint / index / trigger / function 的型別、nullability、default；(b) 本檔依賴的既有欄位與其型別、nullability、default（「本檔會改它」或「本檔的邏輯依賴它是某個型別」都算）；(c) 型別、nullability、default 三者都要檢，缺一項就留盲點。
  2. **對 catalog 排序前確認型別**。`pg_enum.enumlabel` 走 C collation 會改變結果，不能跟 `text` array 比；enum 值陣列排序要用集合運算而不是字串順序比對。
  3. **新增或修改後置斷言時，至少跑一次真的資料庫**。字串比對的 unit 測試證明不了 SQL 斷言會通過。
  4. **帶新表或新欄位的 migration，每條 check 都要問「既有資料會不會違規」**。新增 CHECK 時，新欄位的 default 幾乎必然不滿足誠實性約束，要嘛附既有資料前置 guard，要嘛明確說明為何既有資料不可能違規。
- 驗證：
  1. TEST 診斷已完整記錄，canonical canonical 探針全綠
  2. 已補上「既有資料」測試案例（本檔新增的欄位必須能通過本檔新增的 check）
  3. `0108` 的後置斷言已擴展為同時檢查 `tour_orders.payment_status` 的型別前提
- 同類缺口補充：在排查 #43 類別 5 時發現，後置斷言（恆假）與測試斷言（恆真）中都存在「永遠失敗」或「永遠成立」的缺陷，與 PB-039 的「恆真 guard」是同一個家族：(a) 恆假例：`0108` 的 enum 後置斷言因 `pg_enum.enumlabel` 走 C collation 導致排序不同，永遠失敗；(b) 恆真例：`tests/unit/guide-action-inbox.43.test.ts` 的兩條測試斷言（集合論身分式永遠成立，型別 union 不涵蓋的值無法觸發）。共同教訓：恆真與恆假都是「看起來在守，實際上沒有」——任何斷言寫完後都要反問「如果這件事壞掉，斷言會不會轉紅」；不會就不是斷言。
- 狀態：監看中；TEST 環境漂移的根本修正（重建 historical overlay）由 #43 的進一步整合決定

### PB-047 — `PRODUCTION_SCHEMA_STATUS` 填了卻沒有去查正式庫

- 首次／最近：2026-09-14／2026-09-14
- 發生次數：2（同一輪內 PR #440 與 #442；同一個欄位 `formation_status`）
- Issue／PR／CI：Issue #41（formation state model）；PR #440（#43 的第 3／4 類成團待決定）、PR #442（#43 的第 5 類退款待確認）；`supabase/migrations/0107_issue_41_formation_state_model.sql`；`src/app/api/guide/action-inbox/route.ts`；`docs/schema-truth/2026-09-14-production-0107-not-applied.md`
- 分類：Production Schema；PR Review；依賴判定
- 事件：
  - PR #440：`PRODUCTION_SCHEMA_STATUS` 填成 `NOT_REQUIRED`，證據欄寫「本 PR 無任何 DDL；所讀欄位來自**已在 main 的** `0107` 與 `0066`」。結果 `/api/guide/action-inbox` 在正式環境回 `42703: column "formation_status" does not exist`。
  - PR #442：由 audit 層（Opus）填 `PRODUCTION_SCHEMA_STATUS: READY`，理由是它依賴的 `0108` 已套用正式庫。問題是**沒有檢查同一支端點裡既有的 formation 查詢**——同一個根因、換一個欄位、又犯一次。
  - `/api/guide/action-inbox` 把五條查詢放在同一個 `Promise.all` 並逐一 `throw`，所以 formation 查詢一旦失敗，整支端點就 500——不是「成團卡片不顯示」，是「待辦區整個壞掉」。正式庫當時唯一的租戶就是 `GUIDE`——唯一會看到這個畫面的人。
- 證據：
  1. 正式庫唯讀查詢：`select id, formation_status from public.trip_departures limit 1;` → `ERROR 42703: column "formation_status" does not exist`
  2. 欄位清單查證：`trip_departures` 只有 `0066` 的 11 個欄位，`0107` 的八個欄位一個都不在（`formation_status`、`formation_deadline_at`、`min_to_depart_snapshot` 等）
  3. `supabase/ledger-alias-map.json` 分類：`0107` = `NOT_APPLIED / PENDING_APPLY`，ledger row 編號最後到 56，找不到 `0107`
  4. 與「已在 main」的區別：`git show origin/main:supabase/migrations/0107_issue_41_formation_state_model.sql` 確實存在，但**環境中沒有**
- 根因：
  - **「已在 main」被當成「已在正式庫」回答了。** `PRODUCTION_SCHEMA_STATUS` 這一格問的是「執行這支 PR 時需要的欄位有沒有在它將執行的環境上」，不是「需要的檔案有沒有在 repo 裡」。
  - **填欄位但不查環境，等於沒有這一格。** 與 PB-040（把埋點欄位建好卻不埋）是同一種病：**欄位存在讓它看起來有在把關，但實際上沒有任何驗證發生**。
  - 二度犯錯時的跳步：已知第 4 條預防（全表掃描）理論上應該檢查，但審核時沒有擴大檢查範圍到「這支端點內**所有**既有查詢」。
- 影響：
  - 正式環境應會持續 500（當時已自動部署）；待辦區（共五類查詢）因為同一個 `Promise.all` 整個無法使用。**此項為程式邏輯推導：欄位不存在 ⇒ PostgREST 回 42703 ⇒ route 逐一 `throw` ⇒ 整支端點 500**——不是從正式環境的執行記錄觀察到的。
  - 驗收時未能抓住根因：若基於「所有測試綠」與「主要欄位正確」就宣稱「功能驗收通過」，其實是在驗收一個與 canonical **不等價** 的環境上的程式
  - 修正的遺漏放大：第二次犯錯代表第一次的預防措施沒有被確實執行或推廣
- 修正：
  1. 檢查正式庫 ledger 與結構，確認 `0107` 真的沒有套用
  2. Owner 具名授權後，套用 `0107` 到正式庫（ledger row `20260914094736`）
  3. `trip_departures` 由 11 欄變 19 欄；先前必定 `42703` 的查詢改回傳空集合
  4. `0107` 套用後 `0109` 第四段在正式庫上變成**真正的 no-op**（`min_to_depart_snapshot` default `1`、`formation_status` default `'COLLECTING'::departure_formation_status` 已符合 canonical）。但該段的**欄位存在性守衛必須保留**——它守的是「`0107` 尚未套用」的環境，那種環境仍會出現（任何新建或只套到一半的環境）
- 預防（必須機械檢查，不能依賴人工記憶）：
  1. **填 `PRODUCTION_SCHEMA_STATUS` 之前，對正式庫下唯讀查詢，驗證**本 PR 實際會讀到的每一個欄位**都存在。不是驗證「migration 在 main 上」，是驗證「欄位在環境裡」。**不能只查 ledger 帳本，必須真的跑查詢。**
  2. **檢查範圍是整支端點**，不只是本 PR 新增的那幾行——本 PR 沒改到的既有查詢一樣會在同一個 `Promise.all` 裡把整支端點拖垮。
  3. **一支端點若把多條查詢放在同一個 `Promise.all` 並逐一 `throw`，評估影響時要以整支端點為單位**。不是「我加的那張卡片」，是「這支端點整體」。
  4. **`ledger-alias-map.json` 裡分類為 `NOT_APPLIED / PENDING_APPLY` 的 migration，其欄位不得被視為正式環境可用**——這一項現在沒有任何 CI 在做，但應該機械檢查（preflight 或 astra-review-policy）。
  5. **不只是 pull request review；PR 模板應該明確要求填寫者貼出驗證查詢。** 「我查過」的承諾必須附上實際執行過的 SQL 與結果。
- 驗證：
  - **已驗證**：
    1. 正式庫 `trip_departures` 由 11 欄變 19 欄（`show tables` → column count ＋ system catalog 查證）
    2. `select id, formation_status from public.trip_departures limit 1;` 由 `ERROR 42703` 變成回傳 `[]`
    3. ledger 56 → 57，新增 row `20260914094736 / 0107_issue_41_formation_state_model`（帳本同步已完成）
    4. `0107` 自己的五段後置斷言全數通過（任一不符都會 `raise exception` 中止整支 migration，所以套用成功即為其成立的充要證據）
  - **尚未驗證**：
    - 沒有人呼叫過正式環境的 `/api/guide/action-inbox` 端點；也沒有人登入正式環境看過待辦區畫面
    - `AUTHENTICATED_PRODUCTION_ACCEPTED` 仍是 `NOT_RUN`
    - **欄位補上、查詢不再報錯，不等於畫面正常——這正是本條目所講述的現象**
- 同類教訓（與 PB-027 第五種同型、PB-040 的欄位形式主義）：
  - PB-027：「名字出現≠真的會發生」
  - PB-040：「埋點欄位存在≠實際埋點」
  - 本條：「驗證欄位存在≠查詢過環境」
  - 共同性質：**程序通過留下的痕跡（欄位、紀錄、檔案）被當成了實質確認，而實質確認的工作從未發生。**
- 狀態：已修復（正式庫已補欄位；ledger row 及帳本同步已完成）；預防措施（第 4、5 點）尚未機械化

### 六問開工／Review Checklist

對任何涉及狀態一致性、共享資源或外部承諾的功能，在施工與 Sol／Final Risk review 時至少問一次：

1. **不變量**：現實世界絕對不能成立的狀態是什麼？DB 是否能做最後一道保證？
2. **單一來源**：同一條商業規則是否被複製到兩個以上入口？能否抽成共用判斷？
3. **自動適應**：系統已知道的答案，是否還在要求使用者多做一個設定？
4. **安全失敗**：資料缺失、查詢錯誤或規格不確定時，會保守阻擋還是樂觀放行？
5. **證據層級**：Unit／Integration／Provider／Production 各自到底證明了什麼？是否有越級宣稱？
6. **變異反證**：刻意拔掉最重要的 guard／lock／filter 後，測試會不會真的轉紅？

若其中任何一題的答案是「不知道」，不得用「測試很多」「CI 綠」「畫面看起來正常」代替答案；先把該層的真實證據補齊。


### PB-048 — 被順帶量到沒有覆蓋的過濾器，三次都沒人補

- 首次／最近：2026-09-11 / 2026-09-14
- 發生次數：3（同一檔案、同一類過濾器、同一成因）
- Issue／PR／CI：Issue #43（第 3／4 類成團待決定、第 5 類退款待確認、第 7 類訂單行為盤點）；PR #440、PR #448、同一輪 audit 層查驗
- 分類：測試覆蓋；既知缺口
- 事實經過（時序順序）：
  1. **PR #440**（Issue #43 第 3／4 類）的「已知缺口」第 1 項逐字記述：
     > formation 查詢的 `CANCELLED` 排除只有 source-grep 斷言保護。突變測試 M6（把 `.neq('status','CANCELLED')` 改成 `'ZZZ'`）**不會**讓行為測試失敗，因為 fixture 裡沒有 CANCELLED 的團次。
     
     記下來了，沒有補。

  2. **PR #448**（Issue #43 第 7 類）：audit 層實跑突變時發現**新查詢**的 `.in('status', ['OPEN','CLOSED'])` 拿掉之後 21 個測試全綠——同一檔案、同一類過濾器、同一成因（fixture 裡沒有反例）。這一次補了：加入 `dep-cancelled-conflict` 與 `dep-stale-conflict` 兩筆對照組。補完後拿掉過濾器測試會紅。

  3. **同一輪**，audit 層順手量既有的 `DEPARTURE` 查詢（`src/app/api/guide/action-inbox/route.ts` L111，#440 帶進來的那一條）的 `.in('status', ['OPEN','CLOSED'])`：刪掉後仍然 **21 passed**。Final Risk（claude-fable-5-1）獨立用 `sed` 逐行刪除重驗，得到同樣結果，並明確建議：
     > 這一項應該在 #440 的後續或 PB 補一筆，不要讓它第三次被「順帶量到」。

- 根因：規格（如 `docs/integration/18-*` 或 issue checklist）會要求排除 `CANCELLED`，開發者也照寫了，但**寫過濾器的那一刻沒有同時寫出會被它擋掉的那一筆資料**。於是：
  - 過濾器存在，看起來有在守
  - 測試全綠，看起來有被驗證
  - 實際上拿掉它不會有任何測試變紅

  這與 PB-039（從來沒有受測對象的 guard）、PB-040（埋點欄位建好卻沒埋）是同一個家族：**留下了「有在做」的痕跡，實質檢查沒有發生**。差別在於本條的痕跡是「已知缺口」欄位本身——**把缺口誠實記錄下來，不等於處理了它**。誠實記錄是必要的，但如果三輪過去那一行字沒有變成一筆 fixture，記錄就只是把債務寫得比較好看。

- 影響（推導，非觀測）：L111 那條過濾器若失效，效果是「今天／明天出發、狀態為 `CANCELLED` 的團次會多出一張 DEPARTURE 卡片」。**這是從程式碼與查詢條件推導的，不是從線上觀察**——目前正式庫 `trip_departures` 是 0 列。不是租戶邊界問題。

- 預防（寫成可執行的檢查，不要寫成心法）：
  1. **每加一個過濾器，同一次 commit 就加一筆會被它擋掉的 fixture**。判準是機械的：把那個過濾器刪掉，測試必須變紅。
  2. **「已知缺口」欄位不是垃圾桶**。一項缺口若在兩輪之內沒有被處理，就該變成一張 Issue 或一筆 PB，而不是繼續在每張 PR 的 body 裡被複製貼上。
  3. **突變要用行號精準定位，不要用 regex**。同一支檔案可能有多處相同字串——`src/app/api/guide/action-inbox/route.ts` 就有三處 `.gte('departs_on', today)`（L112／L135／L158）。audit 層先前用不帶 `/g` 的 perl regex 做突變，只換到第一個匹配，因而把「另一條查詢有覆蓋」誤報成「本查詢有覆蓋」。
  4. **多維度掃描：新增查詢、既有查詢、同一個端點的所有查詢都要檢**。不要只檢本次新增的過濾器；一支端點若把多條查詢放在同一個 `Promise.all` 並逐一 `throw`，既有查詢的過濾器漂移也會導致端點失敗。
  5. **存在性與行為覆蓋分開確認**。過濾器的欄位可能存在（避免編譯錯誤），但不代表 SQL 執行期有約束力——fixture 要驗的是行為後果，不是語法正確。

- 待處理項 → **已關閉（2026-09-14，PR #449）**：
  原記述為「L111 的 `.in('status', ['OPEN','CLOSED'])` 仍然沒有行為覆蓋」。PR #449 在
  `tests/unit/guide-action-inbox.43.test.ts` 補上對照組後，這一條已有行為覆蓋。
  **合併後於 `origin/main` 實測覆核**（獨立 worktree，`sed -i "${L}d"` 行號刪除，每次還原後
  `git status --porcelain` 為空）：baseline 24 passed；刪 L124（DEPARTURE 查詢）→ `1 failed | 23 passed`；
  刪 L170（第 7 類 STAFF_CONFLICT 查詢）→ `1 failed | 23 passed`。行號因 #449 併入新查詢而由
  L111 位移至 L124，是同一條過濾器。

  記一句給下一個人：這一項從「被順帶量到」到真的補上，橫跨三輪。**讓它關閉的不是決心，是
  把判準寫成機械可執行的那一句**——「把過濾器刪掉，測試必須變紅」。前兩輪寫的是「應該補」。

- 順帶記一項相關但不同的覆蓋邊界：
  
  Final Risk 在同一輪指出：`loadStaffLoad()`（`src/server/staff-availability.ts` L128–141）與 `queryEffectiveBlockTimes()`（`src/server/block-times.ts` L100–105）內部的四條 `.eq('tenant_id')` 在**全專案沒有任何突變或行為覆蓋**——`tests/unit/departure-guide-assignment.37.test.ts` 沒有觸及租戶。#448 的跨租戶測試只證明了**候選查詢**的租戶條件。它的結論是：程式碼審讀加上正式庫實查的 RLS（八張表 SELECT 都是 `is_tenant_member(tenant_id)`）讓這一點可以接受，但**「租戶邊界有測試」不能被讀成涵蓋整條鏈**。這是非阻擋的已知邊界，不是缺陷。

- 狀態：過濾器覆蓋部分**已關閉**（2026-09-14 於 `origin/main` 實測，見上）；仍監看中的是 `loadStaffLoad()` 與 `queryEffectiveBlockTimes()` 的租戶邊界，由 #43 進一步整合決定

### PB-049 — 在證據還沒送達之前就觸發檢查閘門，然後把時序問題讀成內容問題

- 首次／最近：2026-09-14 / 2026-09-14
- 發生次數：1（但與 PB-044「驗證有保存期限」是同一個家族的第二個面向）
- Issue／PR／CI：Issue #43 第 1 類；PR #449；`agent-wip-guard` run `34838245246`、`34838537190`（皆 failure）、`34838944744`（success）
- 分類：流程順序；證據時序

- 事實經過（時序，皆為 UTC）：

  | 時間 | 事件 |
  |---|---|
  | `11:26:51` | guard（`pull_request_target`）跑在 `a7a9e8c` → **failure** |
  | `11:30:19` | 我貼 `/astra-review-check`，guard 再跑 → **failure** |
  | `11:32:18` | Final Risk 對 `a7a9e8c` 的 **PASS** review 才送達 API |
  | `11:35:06` | 我再貼一次 `/astra-review-check` → **success** |

  兩次紅燈的訊息都是：
  `Astra evidence is stale: testBaseline; Astra evidence is stale: changeDigest; Astra verdict is not PASS`

- 根因：`parseAstraReviews()`（`scripts/agents/astra-review-policy.mjs` L277）以 `submittedAt`
  降序排序後只取 `parsed[0]`。在 `11:32:18` 之前，最新的一則是對前一個 head `81a42b3` 的
  `CHANGES_REQUESTED`——它的 `testBaseline` 釘在舊 body、`changeDigest` 是 `e0c5be1e…`、
  `verdict` 是 `CHANGES_REQUESTED`。**三條錯誤訊息完全自洽，而且全部都是對的。**

  我的錯誤不在讀錯訊息，而在**觸發的時機**：我在委派 Final Risk 之後、確認 review 真的
  存在於 API 之前，就把 `/astra-review-check` 貼出去了。

- 為什麼容易犯：`review 送出` 直覺上像是一個會自己推進流程的事件。它不是。
  `agent-wip-guard.yml` L19 的觸發條件只有兩個：`pull_request_target`，或首行為
  `/astra-review-check` 的 issue comment。**submit review 不在其中**。所以 review 送出後
  guard 不會自己重跑，而任何在 review 送達前觸發的 guard，讀到的必然是舊證據。

- 這條與 PB-044 的關係：PB-044 說的是「驗證有保存期限——舊 head 的結論不能用在新 head」。
  本條是同一件事的另一個方向：**新 head 的結論也不能在它還沒送達之前就拿來觸發閘門**。
  兩者的共同判準是：**閘門讀的是它執行當下的狀態，不是我心裡以為已經完成的狀態。**

- 影響：兩次多餘的 CI run，約 4 分鐘。沒有錯誤合併，沒有偽造證據——guard 擋住了，而且
  擋得對。這是閘門正常運作的紀錄，不是閘門的缺陷。

- 預防（機械可執行）：
  1. **觸發 guard 之前，先以 API 確認 review 已存在且 head 相符**：
     ```bash
     gh api repos/<owner>/<repo>/pulls/<n>/reviews \
       --jq '[.[] | select(.commit_id=="<HEAD_SHA>")] | last | {state, submitted_at}'
     ```
     回傳為 `null` 就是還沒送達——**等，不要貼指令**。
  2. **確認 `verdict` 真的是 `PASS` 再觸發**。`parsed[0]` 只看最新一則；一則較新的
     `CHANGES_REQUESTED` 會直接蓋掉較舊的 `PASS`。
  3. **guard 紅燈先分辨「時序」與「內容」**：比對 guard 的 `completed_at` 與最新 review 的
     `submitted_at`。前者早於後者，就是時序問題，重貼指令即可，**不要去改 PR body 或 review
     內容**——那會把一個正確的 attestation 改壞。
  4. 一般化：**任何「我已經請某人做了 X」到「X 的結果已經可被系統觀察」之間都有延遲。**
     下一步若依賴 X，就必須先查 X 是否已可觀察，而不是依賴自己的記憶。本 Run 這是第二次
     因為「沒有先確認狀態就宣布下一步」而付出代價（前一次是 `git push` 的結果被 pipe 吃掉，
     在分支仍 `ahead 1` 的情況下回報成功）。

- 狀態：已關閉（預防規則已寫成上述可執行指令）；同類再犯視為第二次。
