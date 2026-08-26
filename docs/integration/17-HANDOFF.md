# 17 分冊 — 交接說明（2026-08-26）

> **這一份是寫給「只能讀 GitHub、拿不到原本那台機器」的接手人。**
> 目標：讀完這一份 + 它指到的章節，就能無斷層接手，不需要問任何人。
>
> 前一位主導者（Claude Opus）的 session 因額度上限收尾。**本機環境已不可依賴**，
> 所有必要資訊都已推上 GitHub：程式碼在分支上、決策在 issue 留言裡、
> 踩過的坑在 14／15 分冊裡。

---

## 1. 現在的狀態（一眼看完）

| 項目 | 值 |
|---|---|
| 開發分支 | `claude/deploy-vercel-project-nnno59`（**所有工作都在這裡，`main` 落後很多**） |
| 本輪 commit 數 | 110（2026-08-25 ~ 08-26） |
| 單元測試 | **56 檔 / 867 例全綠** |
| 整合測試 | **58 檔 / 677 例全綠**（`exit=0`，於最終 HEAD `ffd1ae0` 上跑完，**已涵蓋 #8／#19／#33**） |
| typecheck / build | 皆綠 |
| migration | 已到 `0026`，**全部已套用 TEST 與正式兩個專案並逐一查表驗證** |
| Vercel | 分支 preview 自動部署，每次 push 約 1 分鐘後 READY |

⚠️ **`main` 分支不是最新的。** Vercel 的 production 從 `main` 部署，開發分支有自己的 preview alias。
要讓改動出現在正式站，得另外把分支合進 `main`（**尚未做，屬未決事項**）。

---

## 2. 接手人的第一步

```bash
git fetch origin
git checkout claude/deploy-vercel-project-nnno59
npm ci                       # ⚠️ 不要用 npm install，見 §6 的坑 3
npm run typecheck            # 應為零錯誤
npx vitest run tests/unit/   # 應為 56 檔 864 例全綠
```

然後**讀這三份**（順序有意義）：

1. `docs/integration/15-AGENT-PLAYBOOK.md` — 執行者紀律。**這是最重要的一份**，
   本輪所有的「差點出錯」都被寫成了規則。
2. `docs/integration/14-GAP-AUDIT.md` §6（結案紀錄）、§8（擁有者裁決）、§9／§10（盤點）
3. 本檔 §4（未決事項）與 §6（坑）

---

## 3. Open issue 狀態總表

> 每個 issue 的驗收清單就在它自己的 body 裡，**每一格底下都有證據或留白說明**。
> 留白的格子一律附「缺什麼」的說明——**沒有任何一個勾是沒有證據的**。

### 3.1 程式已完成、驗收清單待收尾

| issue | 狀態 | 還缺什麼 |
|---|---|---|
| **#6** Flex 主選單 | 7/8 | 只差「真人收到訊息」——需擁有者拿手機加 `@786sojsi` 傳「選單」。三條替代路都實測堵死（見 issue 留言） |
| **#7** 修復-5 | 13/14 | 只差全量 `test:integration` 的獨立證據 |
| **#17** 預約加購 | 9/11 | 全量整合證據、14 分冊補 commit hash |
| **#18** 老闆通知 | 待回填 | 額度用盡時的狀態顯示位置需裁示；Preview 實測 |
| **#28** 修復-9 九筆 | 7/13 | ③④⑤⑥ 的 Playwright 已對 Preview 跑過（見 issue 留言），待回填進 body |
| **#31** webhook | 7/10 | AI 客服實測缺 `ANTHROPIC_API_KEY`（見 §4）；冷啟動那格**文件明寫不要勾** |
| **#34** 全站外框 | 8/10 | 全量整合證據 |
| **#35** 三頁假欄位 | 8/10 | 全量整合證據 |
| **#8** 行程域 | 待回填 | e2e、Preview 實測、全量整合 |
| **#19** 進階選單設計器 | 待回填 | Playwright、真實 LINE `validate/reply`、全量整合 |

### 3.2 施工中（**未完成，程式在分支上但未合併**）

| issue | 分支 | 狀態 |
|---|---|---|
| **#33** 五支無人認領端點 | `worktree-agent-af2377e7450256f84` | ①②③ 已實作（含 migration `0027`），④⑤ 待查證。**未合併，見 §5** |

### 3.3 尚未開工

`#9` → `#10` → `#11` → `#12` → `#13` → `#14`（建置鏈，前置 #8）
`#20` → `#21` → `#22` → `#23` → `#24` → `#25` → `#26`（補齊鏈，前置 #19）
`#32`（顧客端線上付款，前置 #12）

⚠️ **`#20` 在開工前必讀它的留言** — 它的端點、資料模型、狀態機原本三者全錯，已依規格重寫。

---

## 4. 擁有者未決事項（7 項，其中 2 項只要 1 分鐘）

> 全部整理在 [issue #1 的裁示總表留言](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/1)。
> 這 7 項之外的所有決策（約 30 項）都已由主導者裁示並記錄在該留言，**執行者不需要再問**。

| # | 事項 | 為什麼只有擁有者能決定 |
|---|---|---|
| 1 | **加 LINE `@786sojsi` 傳「選單」** | LINE 沒有「模擬真人收訊息」的介面，且該帳號零好友。**1 分鐘** |
| 2 | **Vercel 加 `ANTHROPIC_API_KEY` 到 preview** | 按次計費、Preview 公開可達。金鑰在本機 `.env.local`。**1 分鐘** |
| 3 | **impersonate 做／不做** | 一旦有這條路徑，「是店家自己改的」就不再能單憑 log 證明 |
| 4 | **OAuth 第二段做／不做** | 要做的話 Google／LINE 主控台的 redirect URI 只有擁有者能設 |
| 5 | **正式切換 `NEXT_PUBLIC_USE_MOCK=false` 的時點** | 上線時機 |
| 6 | **正式資料搬遷的時點** ＋ Midao partner secret 部署 | 上線時機 |
| 7 | **`PUBLIC_API_ALLOWED_ORIGINS` 的正式值** | 需要 Midao 的正式網域 |

另有兩項**非阻擋**、但值得擁有者知道的：
- `#18`：額度用盡時 `notified:false` 要顯示在哪裡（目前沒有畫面承載處）
- `#8`：「行程複製」執行者選了「做」，若要移除，回滾範圍已寫在 issue 留言

---

## 5. ⚠️ 接手後**必須先做**的三件事

### 5.1 CI 的獨立整合證據：**只有擁有者能觸發**（主導者被 403 擋下）

**本機全量已經跑完了**：最終 HEAD `ffd1ae0` 上 **58 檔 / 677 例全綠**（`exit=0`），
已涵蓋 #8／#19／#33 三批新端點。**所以「跑一次全量」這件事不用再做。**

但那份輸出的性質是「**主導者手動跑的、由跑的人自己保證**」。各 issue 驗收裡
「`test:integration` 全綠」那一格要的是**任何人都點得進去看**的證據，也就是 CI。

主導者嘗試觸發時被擋：

```
POST /actions/workflows/ci.yml/dispatches
→ 403 Resource not accessible by integration
```

這個 GitHub App 沒有 `Actions: write` 權限，**只有擁有者（或有寫入權限的人）能觸發**。

**✅ 已完成（2026-08-26 08:47 UTC）**：擁有者開放權限後，主導者用 GitHub MCP
成功觸發 `workflow_dispatch`，**Run #65 全綠**：

https://github.com/smallwei0301/vibeaico-admin-rebuild/actions/runs/32947638422

`check` 與 `integration` 兩個 job 皆 `success`，耗時 22 分鐘（08:25→08:47 UTC），
跑在 HEAD `5bc777c` 上。**這是任何人都點得進去看的獨立整合測試證據**，
各 issue「`test:integration` 全綠」那一格可以直接引用這個 run 連結。

若之後又需要重跑一次（例如 HEAD 前進了）：GitHub → Actions → 選 `ci` workflow →
右上角 **Run workflow** → branch 選 `claude/deploy-vercel-project-nnno59` → 執行。
`integration` job 的 `if` 已含 `workflow_dispatch`（commit `70dbe8d`）。

⚠️ 跑之前確認**沒有人在本機跑整合測試**，兩邊會互相清掉對方的資料。

### 5.2 決定 `#33` 那個未合併分支怎麼處理

`worktree-agent-af2377e7450256f84` 上有 #33 的施工成果（①②③ 完成、④⑤ 待查證），
**含一支未套用驗證的 migration `0027`**。

**migration `0027` 的狀態（主導者已獨立查證）**：**兩個專案都已完整套用**，
七個欄位逐一比對相同 ——
`block_times.{title,recurrence,day_of_week,full_day,auto}`、
`product_orders.{coupon_discount,coupon_instance_id}`。

⚠️ 儘管如此，**接手時仍請自己查一次**（查法見 `CLAUDE.md` 的「Database changes」一節）。
本檔也是「別人的說法」。

> 順帶一個查證方法上的小坑：主導者第一次查的時候用 `column_name like '%weekly%'`
> 去猜欄位名，結果只查到一半，差點誤判成「只套用了部分」。**要用實際 SQL 檔裡的
> 欄位名去查，不要憑 migration 的檔名或功能名去猜。**

**⚠️ 這個分支的存檔時機**：提交當下 agent 正在跑測試，收尾時工作區出現過
`src/server/coupon-redeem.ts.mutbak`（變異測試的備份檔，代表本體當時處於
**被刻意改壞**的狀態）。主導者已用 `diff <已推送版本> <.mutbak>` 驗證過，
**推上去的 `0eec792` 是乾淨的原始碼、不是變異態**。方法與教訓見 15 分冊
「搶救 agent 的施工中資料時」那一節。

**這個分支未經完整閘門**（typecheck / build / 全量測試），且 ④⑤ 兩支端點的
用途查證**尚未產出**——issue #33 明文寫那兩支無法從規格判定用途，派工單要求
「查不到就回報請示，不准發明」。合併前請先補完這一步。

### 5.3 origin 上只有三個分支（不必清理，這裡是說明）

```
origin/main                                  ← 落後很多，Vercel production 從這裡部署
origin/claude/deploy-vercel-project-nnno59   ← 所有工作都在這裡
origin/wip/issue-33-partial                  ← §5.2 那一支，未合併
```

本輪平行施工用了 24 個本機 worktree 分支，**它們從未被 push**——內容全部已經
合併進開發分支，所以 origin 上看不到、也不需要清。**沒有任何成果只留在本機。**

> ⚠️ 主導者第一版的本檔在這裡寫「repo 上會看到十幾個 `worktree-agent-*` 分支」，
> **那是錯的**——寫的時候沒查 `git branch -r`。已更正。
> 這正是本輪反覆抓到的那種錯：**把「我記得的狀態」寫成「查證過的狀態」**。
> 交接文件裡的每一句都會被下一個人當成事實，所以它自己也要被查證。

---

## 5.4 已完成的一輪 issue 驗收稽核（2026-08-26）

涵蓋**全部 34 個 issue**（26 open + 8 closed），檢查「驗收標準 × 證據 × 打勾」三者
是否對齊。分四類：A（打勾＋有證據）、**B（打勾＋沒證據）**、**C（沒打勾＋有證據）**、
D（沒打勾＋沒證據）。

### 結果

**B 類：0 筆。** 沒有任何一個勾是沒有證據的。
（本輪稍早有一筆被另一位執行者主動取消打勾——#35 的「`test:integration` 全綠」，
因為留言自己承認只跑了子集。那是對的，已保留。）

**C 類：43 筆，全部補齊。** 集中在**六個已關閉的 issue**：#3、#4、#5、#15、#27、#30。

> ⚠️ 這六個 issue 有一個**共同的形狀**，值得記下來：
> 它們都是以 `state_reason: completed` 關閉的，但 **body 的清單從頭到尾沒被更新過**，
> 完成的證據只活在留言裡。於是 repo 上長期存在一種矛盾：
> **「已完成」的 issue 裡有一整排未完成的格子。**
>
> 稽核者逐條驗證證據為真（`grep` 測試案例名、`git show` 確認改動、
> 對兩個 Supabase 專案獨立查表）之後才打勾，並在每個 issue 留言說明是事後補齊帳面。
> **沒有重新開啟任何 issue**——關閉是一個已經做過的決定。

### 稽核順帶發現的兩個文件落差（**尚未修**）

1. **`08-CHECKLIST.md` 有數處「重開」註記已過期**——理由描述的缺陷已被後續 issue 修好。
   已在該檔頂端加一則精確的落差說明（含已知過期的行號與正確的更新格式範本），
   **刻意沒有代為打勾**：要打這些勾得逐列驗證「重開理由現在還成不成立」，
   那是一輪要跑測試的工作，不是文件整理。**稽核者代為打勾就變成他自己在製造
   一個沒有證據的勾。**
2. **`14-GAP-AUDIT.md` §5 的四個格子**在 issue #15 關閉後仍未更新。

### #18 的 body 沒有被動

該 issue 的 body 含混合的 HTML 實體編碼（引用規格片段的 `&gt;&lt;i&gt;…`），
round-trip 風險過高。15 個項目的證據**已逐一獨立驗證為真**，但只留言、不動 body。
見 §7.5 的環境限制。

## 6. 本輪踩過的坑（完整清單）

> 每一條都已經寫進 `15-AGENT-PLAYBOOK.md` 或 `14-GAP-AUDIT.md`，這裡只做索引。
> **強烈建議接手人逐條讀過**——它們全部是「測試綠、但事情是錯的」那一類。

### 6.1 讓閘門說謊的坑

| 坑 | 症狀 | 詳見 |
|---|---|---|
| **commit 進 `node_modules` symlink** | 合併後主 worktree 的 193 個套件被蓋成指向自己的死連結，而 `npm run typecheck` **仍然安靜地「通過」** | 15 分冊「worktree 的 node_modules」 |
| `.gitignore` 的 `node_modules/` **擋不住 symlink** | 尾斜線只比對目錄；已補一行不帶斜線的 | 同上 |
| **檔案裡混進 NUL 位元組** | git 把整檔當二進位，diff／grep 全失效；**行為完全正常**所以測試照樣綠 | 15 分冊 |
| **刪除路由後 `.next/types` 殘骸** | typecheck 報兩個假錯；`rm -rf .next` 即解 | — |
| **反向斷言用固定秒數等** | 錯誤送出的請求在 1 秒後才到，**該紅的沒紅、後面兩案紅了** | 14 分冊 §6.16-a |
| **比對斷言的非零分支從沒執行過** | `expected === 0 ? A : B` 在資料剛好全為 0 時永遠只走 A，**「永遠回 0」的壞實作照樣全綠** | 15 分冊檔尾 |
| **清理默默失敗** | `delete from storage.objects` 被 `storage.protect_delete()` 擋下（42501），**斷言全綠、exit 0，測試圖留在正式 bucket 裡**。TEST 專案永遠看不出來 | 15 分冊檔尾 |
| **BOM 斷言永遠是 false** | `res.text()` 會吃掉 BOM，那條斷言量的是 `fetch` 不是端點。要斷言原始 bytes `EF BB BF` | 踩過兩次 |
| **CI 根本沒在跑** | `on.push.branches` 只有 `main`，開發分支**連續 66 個 commit 沒跑過 CI**。「CI 全綠」與「CI 沒跑」在 GitHub 上長得很像 | 已修（`34173e4`） |
| **`seed.mjs` 靜默跳過** | 欄位名寫錯 → PostgREST 回「schema cache」→ 被誤判成「表還沒建」而跳過；**錯誤炸在下一步的外鍵上，根因在上一步**。#8 與 #19 的執行者各自獨立撞到 | `scripts/test/seed.mjs` 註解 |

### 6.2 讓事實變形的坑（**主導者自己犯的**，值得下一位警惕）

| 坑 | 內容 | 詳見 |
|---|---|---|
| **把推論寫成事實** | 一天內三次，其中一次還附了一個**不支持該主張的引用** | 15 分冊「派工單裡的事實陳述」 |
| **抄 issue 內文而不查證** | issue 是擁有者寫的、看起來就是規格，抄進派工單等於替它背書。#7 的表格一次貢獻三筆錯誤 | 15 分冊「issue 內文的事實陳述」 |
| **採用預設值＝連同前提一起簽收** | #20 的兩個「人工介入點」，一個問了**原站根本不存在的概念**（過號回補：全文 0 次），一個問了**規格早已回答**的問題 | 15 分冊 + 已公開撤回 |
| **統計「量了 A、寫成 B」** | 用 `set(re.findall(帶上下文))` 去重，把「出現次數」算成「不同上下文數」 | 14 分冊 §9.2 |
| **貼數字不註明 commit** | 把 HEAD 的 742 寫成某個舊 commit 的數字（實際 717） | issue #17 留言 |
| **合併時只跑「我覺得相關」的測試** | 信了 commit 訊息那句「既有測試都改了」，實際只涵蓋一檔，**16 條紅燈被放行** | 14 分冊 §6.16-c |
| **平行派工時 migration 撞號** | 兩個 agent 各自算「現有最大 +1」，**兩邊算的時候最大都一樣**。發生兩次 | 現在改為**主導者預先指派編號** |

### 6.3 產品層面的坑（都已修，但形狀會重複出現）

- **擁有者裁決被反向執行**：§8.6 明文「文案保留、補實作」，執行者卻套用通用的
  誠實化模式把文案刪掉、端點一行未動。而且**只改了一半**——同一份字典裡六處仍在
  宣稱推播，確認視窗與成功訊息**對同一個動作給出互相矛盾的事實主張**。
  → 規則：**誠實化之前先 `grep` 14 分冊 §8 有沒有既有裁決**；改文案要一次改完。
- **假資料掩蓋了依賴它的算式**：「應收金額」算式是 `finalPrice − 折抵`，但
  `final_price` 早就扣過了——先前不會爆是因為折抵一直是假的頁內常數。
  → **拆假資料時要一併重算所有引用它的算式。**
- **`drop view` 會連權限一起帶走**：`create or replace view` 在欄位順序變動時會拒絕
  （42P16），改用 drop+create 之後要**另外查 grants**。
- **指錯 issue 的「尚未建置」說明比不寫更糟**：它看起來已經有人在追。

---

## 7. 派工模式（如果接手人也用 agent）

### 7.1 三種角色不可互相冒充

- **擁有者**：裁決，不可翻案
- **主導者**：複核、工程判斷、派工
- **執行者**：提出證據

詳見 15 分冊開頭。

### 7.2 混合模型制度

依「**做錯時會不會被測試抓到**」分流：
- 會被抓到（照抄既有正確實作、機械性接線）→ Sonnet
- 不會被抓到（測試前提變更、驗收打勾、規格判定、安全相關）→ Opus
- **測試前提變更一律 Opus，沒有折扣**

### 7.3 平行施工的鐵則（本輪血淚）

1. **worktree 隔離**，且開工第一件事是 `git rebase <整合分支>`
   （worktree 的基底不是 HEAD，**rebase 前讀到的行號全部作廢**）
2. **migration 編號由主導者預先指派**，不准執行者自算
3. **`docs/integration/**` 只新增段落、不要重排**（本輪因此撞了七次合併衝突）
4. **不要跑全量整合測試**（會 wipe 共用 TEST 專案，且一輪 21 分鐘）——
   只跑自己動到的那幾支，用 `flock /tmp/vibeaico-integration.lock` 序列化
5. **收尾前 `git show --stat` 逐行看檔案清單**（本輪救場兩次）

### 7.4 打勾的規矩

**沒有證據不准打勾。** 打不出證據就**留白並說明缺什麼**——本輪有執行者
**主動取消一個前人打過的勾**（因為留言自己承認整合測試只跑子集），那是對的。

改 issue body 有一個技術陷阱：GitHub MCP 讀回的 body 是 **HTML 實體轉義過的**，
整份寫回會二次轉義、把前人貼的證據弄壞。作法是**只做最小範圍替換**，送出前自驗：
長度差是否等於插入長度、`&gt;` 與 `&amp;` 的出現次數 delta 是否為 0。
**技巧**：讓插入內容刻意不含 `& < > ' "`，delta 就會是穩定的 0。

---

## 7.5 ⚠️ 本環境對 `api.github.com` 的直連是 **403**

本輪多位執行者回報：sandbox 內 `curl https://api.github.com/...` 一律 **403**，
且沒有 `gh` CLI。**唯一能動 GitHub 的管道是 GitHub MCP 工具。**

這造成一個實際的限制：**MCP 讀回的 issue body 是 HTML 實體轉義過的**
（`>` → `&gt;`、`'` → `&#39;`），而拿不到原始 body 就**沒有比對基準**，
也就無法做 §7.4 那三項 delta 自驗。

因此本輪有兩位執行者**刻意不動 issue body、只留言**，並把驗收清單完整回填到
`08-CHECKLIST.md`。**那是對的判斷**——寧可留一份「留言裡有、body 沒勾」的落差，
也不要交一份被二次轉義弄壞的清單（body 裡有前人辛苦貼的證據）。

> **接手人若在能直連 GitHub API 的環境**（例如有 `gh` 或 token 沒被擋），
> 可以取得原始 body 做安全的最小替換，把這些落差補起來。
> 落差清單見各 issue 的留言與 `08-CHECKLIST.md`。

## 8. 憑證與環境

所有 token 在擁有者 Google Drive 的 **`midao.env`** 文件裡（Supabase 兩專案、
Vercel、LINE Midao 頻道、Resend、Cloudflare）。測試帳號在同一份文件末尾。

⚠️ **測試帳號密碼用完必須還原並驗證**。本輪每一位執行者收尾都跑過
`scripts/verify/preview-password-restored.cjs`。

⚠️ **Preview 站連的是「正式」Supabase 專案**（不是 TEST）。在上面做實測要：
- 測試資料用可辨認前綴，**測完清乾淨並查詢驗證殘留為 0**
- 絕不跑任何會清空表的東西（`reset-db.mjs` 有拒絕正式專案的安全鎖，不要繞過）

---

## 9. 兩件已經定案、不要再重新討論的事

1. **行程域（trips / tour-orders）不是原站既有功能**，是本專案新增的。
   四條獨立證據見 issue #8 的留言。**這條鏈上的工作不得說成「對齊原站」。**
   14 分冊 §9.4 第 6 點的疑慮（規格對它們全盲）**不成立——不是漏抓，是本來就沒有**。
2. **`docs/specs/*.json` 是對齊原站的唯一事實來源。** 分冊與 issue 都可能寫錯
   （本輪抓到六個 issue 的範圍與規格不符），**衝突時一律以 `docs/specs` 為準並回報**。

---

## 10. 2026-08-26 接手續報：CI 序列化與 #8 驗收

### 10.1 主導者錯誤公開記錄：兩輪完整 CI 被錯誤地重疊觸發

為取得 #8 的獨立整合證據，建立了 **draft PR #36**（開發分支 → `main`）；該 PR
只用來觸發 `pull_request` CI，**不得合併**，因為 `main` 會觸發 production 部署。

主導者在 Run #71（`32978764543`）的 `integration` job 尚未結束時，又更新開發分支，
因此 Run #73（`32979074676`）也進入 `npm run test:integration`。兩輪共用、且都會
清空同一個 TEST Supabase，違反 15 分冊的序列化規則。**即使其中任一輪顯示綠燈，
也不得用作 #8 或其他 issue 的驗收證據。**

修正：`.github/workflows/ci.yml` 的 `integration` job 加入全 repo 共用的固定
`concurrency` group `shared-test-supabase-integration`，`cancel-in-progress: false`。
group 刻意不含分支名，因為 PR、`main` 與手動觸發共用的是同一個 TEST 專案。
只有在 #71/#73 都完全停止、此修正已生效後，才能再觸發一輪乾淨的完整 CI。

### 10.2 #8 新增的 E2E 證據仍須滿足的條件

`tests/e2e/tour-admin.spec.ts` 已涵蓋登入 → 建行程 → 規劃 → 開團 → 人工建單 →
確認付款 → 取消，且每次寫入後重整；DB 斷言名額 `0 → 2 → 0`。清理後直接查
`trips`、`trip_plans`、`trip_departures`、`tour_orders` 四表，必須全部為 0。

但 #8 仍不可結案：除了上述乾淨 CI，還缺 Preview 同旅程、截圖清單與正式資料庫
測試資料 residual=0 證據。Preview 沒有安全的四表 cleanup route；`DELETE trip` 在有
訂單時只會 archive，外鍵也會阻擋直接刪除。因此在取得管理式、可精確限定測試 ID
的清理權限以前，**不得先在 Preview 建資料**。

### 10.3 本環境連接器狀態（須重新實測，不可當永久結論）

本 session 的 GitHub MCP 可讀寫、`git ls-remote` 可讀，但 git push 沒有可用認證；
未認證的 `api.github.com` 公開唯讀請求也已實測可用（與 §7.5 的上一輪環境不同）；
Google Drive plugin 顯示已安裝且已允許讀取，但 Drive 動作沒有載入目前 session。
因此尚未讀取擁有者指定的 `midao.md`，也沒有用瀏覽器繞過連接器取得憑證。

---

## 11. 2026-08-26 續報：遠端 blob 污染與 full integration 的時間相依前提

### 11.1 #19 遠端 blob 曾被寫成二進位；本機檢查不能代替遠端證據

`0da9c4d` 的本機來源 `src/app/tenant/rich-menu-design/page.tsx` 是 93466 bytes、
NUL 數 0，但重組後實際寫進 GitHub 的 blob 只有 90059 bytes、含 3 個 NUL，
CI Run #77 因 `TS1490: File appears to be binary` 失敗。主導者先前宣稱本批無 NUL
是錯的，已在 PR #36 公開更正。

修正 commit `946fda5` 以 base64 建立該 blob；更新 ref 後重新 fetch 遠端驗證：
93466 bytes、NUL 數 0、blob SHA `c9b717e9552535789ebc0714df955b64a493cabf`。
本機隔離 worktree 的 typecheck、#19 四個 unit test files／49 tests、mock build 全綠。
新 CI 全綠前，`0da9c4d` 的 Run #76/#77 都不是驗收證據。

### 11.2 Run #75 證明 #7 customer tags 新測試通過，但整輪仍不可算綠

Run #75（`32981612609`）在 `449b173` 上執行，check 的 typecheck/unit/build 全綠；
full integration 中新檔 `customers-tags.07.test.ts` 4/4 全綠，包含 sentinel 非零、
排序／去重、停用顧客、租戶隔離、feature gate 與精確還原。可是整輪最後仍為 failure，
所以不能替 #7 或 #8 打總驗收勾。

唯一失敗是既有 `business-hours-draft.33.test.ts` 的「全天營業必定零衝突」前提：
seed 用「現在 +1h」建立 A 店預約；CI 在台北晚間跑時該預約跨過午夜，而 production
規則明定跨日預約即使 00:00–24:00 也算衝突，故正確收到 1，不是 0。修正只改測試
障壁：零分支改用沒有 booking seed 的 B 店，先以 service role 直查端點相同狀態與
一年時窗確實為 0，再斷言端點回 0；A 店的非零分支與 production 算法均不改。

### 11.3 Google Drive 重新載入後仍是 session 工具掛載問題

Plugin 管理資料已再次查證：Google Drive 已安裝、啟用、使用者啟用，connector
依賴無 unresolved app，權限為 Allow all actions；但目前 session 的 callable tool
清單仍為 `drive: []`。這不是擁有者設定錯誤，也不是文件權限錯誤。不得用瀏覽器繞過
連接器讀憑證；若後續仍未掛載，需在新的 Work Mode 對話重新選取 Google Drive。
