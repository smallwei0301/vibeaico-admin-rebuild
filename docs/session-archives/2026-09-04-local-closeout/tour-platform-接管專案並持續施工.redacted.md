# tour platform - 接管專案並持續施工（安全文字存檔）

> 原始 HTML 匯出包含登入／工作階段憑證，未原封不動提交。以下只保留可見對話文字。

## 1. 使用者

/goal

你現在是 "smallwei0301/vibeaico-admin-rebuild" 專案的新一輪持續主導者。

Repo：
https://github.com/smallwei0301/vibeaico-admin-rebuild

你的任務不是回顧上一個 ChatGPT session，也不是完成一張 Issue 後回報。

你的任務是：

重新從 GitHub / CI / TEST 的即時真實狀態接管專案，持續自主推進，直到所有可以自主完成的 open Issue 都完成、合併或正確關閉，只剩真正需要 Owner 決策、Production 授權或外部服務憑證的項目。

0. 不可信任舊 session 狀態，先建立 CURRENT TRUTH

上一個 session 約在 2026-08-31 晚間停止推進。

以下 checkpoint 只是交接提示，不是你可以直接相信的現況。

開工第一件事必須重新查：

1. current "main" HEAD
2. 所有 open Issues
3. 所有 open PRs
4. 每張 open PR 的 lifecycle / lane metadata
5. 最新 GitHub Actions 與 exact-head CI
6. shared TEST Supabase migration history
7. 是否目前有人占用 shared TEST integration/E2E lane

以「現在 GitHub / current main / canonical repo 文件」為最高事實來源。

如果舊 Issue body、舊 PR comment、舊 ChatGPT session、歷史 CI 與 current main 衝突，必須以 current main 與最新 canonical governance 文件為準。

開工先閱讀：

- "AGENTS.md"
- "CLAUDE.md"
- "docs/AGENT-EXECUTION.md"
- "docs/OWNER-DECISIONS.md"
- "docs/PR-LIFECYCLE.md"
- "docs/AGENT-PLAYBOOK.md"
- ".agents/skills/vibeaico-agent-orchestration/SKILL.md"

不要重新發明另一套 agent 規則。

1. 使用 Mode C 持續施工

現行模式是 Mode C：

不同 Issue 可以有不同 Terra 同時施工。

但：

- 同一個 medium/large Issue 只能有一位 Terra implementation owner
- 每個 Issue 最多 1 張 ACTIVE implementation PR
- 必要時可額外有 1 張短命 VALIDATION/canary PR
- shared TEST Supabase migration/reset/seed/integration/E2E 全 repo 永遠只能一條
- Luna Closure / Janitor 是獨立 repo-wide lane，不得綁住其他 Terra
- Sol 只用於 TRIAGE、高風險 DIAGNOSE、最終 AUDIT
- 不要浪費 Sol 在機械式掃檔、CI polling 或一般 CRUD 施工

產品流程：

SCOUT(Luna)
→ TRIAGE(Sol)
→ BUILD(Terra)
→ DIAGNOSE(Terra/Sol)
→ AUDIT(Sol)
→ CLOSEOUT(Luna)

JANITOR 為跨階段 Luna 責任。

如果 shared TEST 正忙：

不要等待、不要停止。

讓需要 TEST 的 Issue 排隊，其他 Terra 繼續進行不碰 shared TEST、且檔案施工面不衝突的 source work。

2. 第一輪優先做 Closure Sweep，不要立刻再開一堆新 PR

目前 repo 有大量 historical / parked / owner-blocked PR，以及 Issue 狀態與實際程式進度不同步的情況。

第一輪先盤點每張 open PR：

- ACTIVE
- VALIDATION
- PARKED
- OWNER_BLOCKED
- HISTORICAL
- REBUILD_REQUIRED
- SUPERSEDED
- close-ready

並依 primary Issue 分組。

對每個 open Issue 判斷：

A. current main 已經真的完成，可以直接進 closeout
B. 有 current candidate，只缺 CI / audit / Preview
C. 有舊 PR，但必須 current-main rebuild
D. 真正還需要產品施工
E. Owner / Production / provider 外部 gate

不要因 Issue 還是 open 就假設「功能尚未寫」。

不要因歷史 PR 很長就繼續往上疊 commit。

對可以證明 superseded 的 stale PR，依 canonical Janitor ancestry / metadata 規則安全關閉。

不確定就 "JANITOR_REVIEW"，不要猜。

3. 目前最重要的交接點：Issue #17 / PR #87

上一輪最後已知狀態：

PR #87：
"feat(#17): rebuild atomic booking addons"

舊 checkpoint head：
"142fdc639f9cb6fa91eb4bc626d2151918dddb24"

請先重新確認它仍然是 current head。

已知上一輪：

- source typecheck PASS
- unit PASS
- build PASS
- 新增 forward migration：
  "0055_issue_17_booking_addon_price_rollback.sql"
- 已補兩個 price-adjustment rollback integration cases
- 舊 TEST RPC 在極端折抵情境會得到 "final_price = -300"
- acceptance 要求 clamp 為 "0"
- 第一個一般調價後 rollback case 已通過
- clamp-to-zero case 因 TEST 尚未套 0055 而失敗
- TEST migration history 當時只到：
  "0054_issue_17_booking_addons_hardening"

新 session 必須重新確認 TEST history。

如果：

- shared TEST lane 已空閒
- 0055 仍未套
- current canonical Owner Decisions / TEST authorization 允許

則下一步不是再改程式，而是：

1. 套用 "0055_issue_17_booking_addon_price_rollback" 到 TEST only
2. 不修改 Production
3. refresh PostgREST schema cache if needed
4. 唯讀確認 RPC definition / ACL
5. 因 TEST 環境已真正改變，重跑 #17 最新 exact-head serialized integration/E2E
6. 確認兩個 rollback acceptance cases 都綠
7. 確認測試 residue 歸零
8. Sol 做 final source / security / acceptance AUDIT
9. 更新 PR #87 body，不准保留過時「queued / waiting」敘述
10. 若只剩 authenticated Preview / Owner gate，精確轉 OWNER_BLOCKED，並把 Terra lane 釋放給下一個 Issue

不要用 no-op commit 製造新 CI。

不要重跑 superseded SHA。

4. 第二條 current lane：Issue #66 / PR #89

上一輪最後已知：

PR #89：
"feat(#66): establish GUIDE mobile UI foundation"

舊 checkpoint head：
"66e9c66c448162f4cfd1a4c8c0000b87a8700862"

該 exact head 的 CI 最後已：

- typecheck PASS
- unit PASS
- build PASS
- integration PASS
- E2E PASS

但 PR body 當時仍殘留「integration/E2E in progress」的過時描述。

先重新查證。

若仍成立：

1. 先更新 PR #89 exact-head evidence
2. 不要重跑已綠的同 SHA CI
3. Phase A 已有 GUIDE UI foundation
4. Phase B 已有 GUIDE_FIVE navigation profile、五大 parent route、"/tenant/more"、route-parent contract
5. 繼續 #66 後續工作時，先檢查 Issue #34 / PR #86 對 "AppShell" 的 current ownership
6. 若 #34 仍 Owner-blocked，不要硬撞 AppShell hot file
7. #66 可以先繼續所有不碰 AppShell 的獨立 source slices
8. 等 #34 ownership 可以 reconciliation 後，再接五大 parent shell

不要因 #34 被 Owner gate 卡住，就讓整個 #66 Terra 停工。

5. 不要讓「等待」成為停止理由

以下全部不是停止理由：

- 完成一個 Issue
- 建立一張 PR
- 一張 PR CI 綠
- 一張 PR CI 紅
- CI 正在排隊
- shared TEST 正忙
- Vercel Preview rate limit
- 某個 Issue Owner-blocked
- 某個 agent 已完成
- Sol AUDIT 剛完成
- 某張舊 PR 需要 Janitor
- 一條 lane 暫時無法前進

某一條 lane 等待時，立即切換到另一個不衝突的 Issue。

每次 "/goal" checkpoint 都要重新掃：

open Issues → open PRs → CI → TEST lane → Closure Sweep → next actionable work

只要還有可以自主完成的 open Issue，就不得把整體 Goal 宣告完成。

6. 避免再出現「看起來忙，其實沒收尾」

每完成一個 significant checkpoint：

- 更新 PR lifecycle metadata
- 更新 exact-head CI evidence
- 移除過時的 queued / in-progress 描述
- 回填 Issue acceptance checkbox
- 執行 Closure Sweep
- 判斷是否能關 Issue
- 判斷 stale PR 是否應 supersede / close
- 釋放不再需要的 Terra / TEST lane

不要只 push code。

我們的 KPI 不是 commit 數，而是：

open Issue 真正下降。

7. CI / TEST 節流

禁止：

- no-op commit 只為觸發 CI
- superseded SHA 重跑 integration
- 同一 PR 每改一個小檔就製造一次 full shared TEST
- TEST busy 時盲目 rerun
- 同一環境錯誤連續重試三次

多檔變更盡量原子提交。

exact-head 才能當驗收證據。

舊 SHA CI 只能作歷史診斷。

若發現 stale PR SHA 排隊占 shared TEST，優先依 current governance 做 fail-closed stale-head skip / cleanup，而不是讓它浪費 TEST lane。

8. 安全邊界

除非 current canonical Owner Decisions 已有明確授權，以下仍是 Owner gate：

- Production Supabase DDL / migration / DML
- Production deploy / promote
- 真實付款
- 真實退款
- 真實顧客通知
- 需要 Production runtime 行為改變的 main merge

不要把 TEST authorization 外推成 Production authorization。

TEST 操作也必須遵守 shared TEST single-lane 規則。

9. 執行方式

不要只做「狀態報告」。

完成 initial current-truth audit 後，立刻開始執行最高價值的 autonomous next action。

目前第一優先預期是：

#17 TEST 0055 closeout

但只有重新確認 current repo / current TEST 後才能執行，不准只因這份 handoff 寫著就盲做。

同時維持 #66 或其他不衝突 Issue 的 Mode C source progress。

當 #17 釋放 Terra 後，從 current open Issues 中依：

1. close-ready
2. dependency unlocker
3. current-main defect
4. independent build lane

依序選下一個 Terra。

不要重新建立 repo-wide Terra=1 的舊規則。

10. Goal 完成條件

持續自主循環，直到：

- 所有能自主完成的 open Issue 已 close
- stale/superseded PR 已安全清乾淨
- current active PR 都有 truthful exact-head evidence
- 只剩真正 Owner / Production / provider / credential / business decision gate

如果還有自主可做事項，就繼續做，不要問 Owner「要不要繼續」。

只有真正需要 Owner 決策時才提出問題，而且一次整理所有 Owner decisions，避免一題一題打斷。

開始。

第一個輸出只需要簡短告訴我你重新確認到的：

current main HEAD、open Issue 數、open PR 分類、目前 TEST holder，以及你現在立即開始的第一條施工 lane。

然後直接施工，不要停在報告。
顯示更多
顯示較少

## 2. 助理

我會先依現行規則讀取施工技能與 repo 治理文件，接著從 GitHub、CI 與 TEST 的即時狀態建立真實盤點；盤點完成後立刻進入 #17／#66 或下一條不衝突施工線，不停在報告。

我正在使用「implement（實作）」工作流程，因為這一輪不只是盤點，而是要依真實狀態直接完成施工、驗證並提交目前分支上的成果。先讀規則，再查現況。

目前工作目錄不是 Git repository，
git fetch
因此沒有改動任何內容。我會先定位已存在的 repo 工作樹，再在正確目錄重新執行 fetch；不會 checkout、reset 或覆蓋現有工作。

初步真實盤點已完成一半：GitHub
main
目前是
ee22d0f
，共有 40 張 open Issue、15 張 open PR；目前沒有排隊或執行中的 Actions，因此 shared TEST lane 在 CI 觀察上是空的。接下來我會讀 TEST／Supabase 規則並查 TEST migration history，這是 #17 能否立即收尾的關鍵。

這一步會使用「Supabase」技能，因為必須確認精確的 TEST 專案、migration 基線、schema cache 與資料殘留；它只允許我把 TEST 與 Production 分開，避免把測試授權誤用到正式環境。

#17 的即時狀態已證實不是新程式回歸：PR #87 的
142fdc…
exact-head CI 中，22 個整合檔有 177/178 通過，唯一失敗正是 TEST 仍使用舊 RPC，收到
-300
；TEST migration history 也確實只到 0054。#89 的
66e9c6…
exact-head CI 則已完整通過整合與 E2E。shared TEST 目前無 holder，我現在依既有長期授權只套 0055 到
nmwhwngojosmagjuvxol
，不碰 Production。

0055 已成功套用到 TEST，migration history 現在到
0055_issue_17_booking_addon_price_rollback
且只出現一次；PostgREST schema reload 已要求，唯讀 catalog 驗證確認 RPC 仍是
SECURITY DEFINER
、
search_path=''
、authenticated 可執行，且含非負金額下限。現在只重跑因 TEST 基線改變而合理的新 integration job；它會在同一條 shared TEST lane 依序跑 integration → E2E，不重跑已綠的 check，也不碰 Production。

我先做一個不占 TEST 的 Closure Sweep 小收尾：#89 的 exact-head 已經是全綠，但 PR 內文仍寫「integration/E2E 進行中」。我會只更新證據與下一步，不重跑同一個已綠 SHA，也不宣稱 #66 已完成。接著在 #17 TEST holder 執行期間，繼續 #66 不碰 AppShell 的獨立 source slice。

#66 的規格與視覺基準已讀完：目前 Phase A/B 只建立元件與導航，尚未完成首頁、團次、旅客、訊息、更多五個入口的實際頁面收斂。我要在獨立 worktree 取出 #89 exact head，先做視覺與檔案盤點，再挑不碰 #34 AppShell 的最小 Phase C/D source slice；不會改動其他正在工作的 worktree。

我已確認 #17 的 TEST-only migration 已成功套用並完成 schema reload，現在正等待同一個 exact-head 的整合測試重跑；同時我會在不碰 #34 AppShell 熱檔的前提下，檢查 #66 下一個可獨立施工的 UI slice。

#17 的 exact-head integration 與 E2E 已因 TEST 0055 套用而全數通過；我會先完成其 migration residue／ACL 唯讀驗證，再把 #66 的首頁 slice 做完本地型別與單元檢查。

#66 首頁 slice 已接到現有 dashboard route：GUIDE 模式會讀既有提醒、設定、行程與團次 service，首頁先呈現待辦、即將出發、本週摘要、三個快速操作與連線健康；沒有改 AppShell/Sidebar，也沒有新增資料模型。接下來我會按實作規範做一次 code review，再提交成單一 remote commit。

目前 #66 新 head 已通過 check，整合測試仍在 shared TEST lane 執行；#17 已完成 TEST／CI／residue closeout 並轉為 OWNER_BLOCKED。接下來我會保持 TEST 單線，先處理 closure sweep 與下一個不碰 active PR 熱檔的自主缺口。

Closure sweep 沒有找到可依 ancestry 規則自動關閉的 stale PR；Janitor dry-run 是 0 close、0 review、0 budget violation。下一條獨立 lane 我選 #28 的「feature-store restore 回傳值」：它不碰 #17/#66 熱檔、不改 DB，且 current main 確實仍把副作用結果丟掉。

我已把 #17 的 TEST 0055 與 exact-head 驗收收尾，並釋放其 lane；現在切到不碰 #66/AppShell、也不佔 shared TEST 的 #28 feature-store restore result source slice，先在 current-main worktree 實作並驗證。

#28 的 restore 結果已接回前端：現在會顯示實際恢復的票券/商品數量，副作用失敗則明確顯示 warning 與手動補救方向；新增純函式測試覆蓋正常、數量與失敗三種結果。單元測試 148/148、typecheck 已通過，接著跑 build 並準備單一原子 PR。

我會依
implement
的收尾規則做一次獨立 code review：一位檢查標準與安全性、一位對照 #28 acceptance；兩者只讀、不改檔，我則同步準備遠端原子提交與 PR metadata。

#66 exact head
dcf93fd…
的 CI 已全部完成且綠（classify/check/integration/E2E）；我現在先把 PR 內過時的「進行中」改成 exact-head 成功證據。獨立 review 同時指出三個需要修正的 GUIDE 首頁問題（focus 溢出、低頻設定混入首頁、錯誤狀態不夠誠實），我會在同一條 #66 lane 續修，不另開第二張 #66 implementation PR。

#28 本地變更已在單一 commit
13bb93c
完成，且重新驗證到
origin/main = ee22d0f…
、遠端沒有同名 branch；現在用 current-main tree 做一次原子上傳，再建立唯一的 #28 ACTIVE draft PR。這條 source slice 不需 shared TEST。

#66 已在同一 branch 修正可立即自主處理的 review findings：低頻庫存/功能到期不再塞進首頁主區、第四個主要待辦改用原生「查看全部」展開、提醒 API 失敗不再冒充空資料、待處理預約連到實際 bookings、週條縮距以符合 360px；接著跑本地回歸。 #43 真正 action-inbox domain wiring 仍按 Issue 分工保留為後續 lane。

#28 review 的核心問題已修正：移除沒有實際發生的「已通知平台」宣稱；新增真實 TEST API 整合測試（無副作用、票券數量、商品數量、0 數量），並把 restore service→notice 接線抽成可行為驗證的 seam。
restoreSideEffectFailed
的端點 fault-injection 仍需要 TEST Management API credential，因此保留為明確外部 gate，不用 skip 假裝 CI 已覆蓋。現在上傳第二個原子 commit。

#66 本地回歸已通過（150 unit、typecheck、build）；修正 commit
c83d37d
也已完成。重新核對遠端 branch 仍在
dcf93fd…
後，我現在把這批 review fixes 以單一 fast-forward commit 上傳，避免產生多次 CI。

#28 PR 的最新 exact head 已由目前 branch 狀態推進到
bbd39d4…
，CI 已全綠（含 integration/E2E）；我會先做唯讀驗證 PR body、commit/tree 與工作樹一致，再進行這個 slice 的 closeout 判斷。副作用失敗分支仍只缺 TEST Management API fault-injection 憑證，沒有把 skip 或未授權操作帶進 CI。

#28 的 exact-head CI 與 #66 新 head 都已進入可驗證狀態；我不等 CI，另開一條不碰 dashboard/feature-store 的 Luna scout，從 current main 的 open Issues 找下一個可自主完成、且不占 shared TEST 的 source slice；我同步做 #66 CI polling 與 PR metadata 清理。

我會先收斂兩個現行 lane：確認 #66 最新 exact-head CI 是否已終結、同步取得 Luna scout 的下一個獨立 Issue；若 #66 仍在跑 shared TEST，我會直接切到不碰該 lane 的施工。

#66 的 classify/check 已綠，但 integration 仍是唯一 shared TEST holder；我不重跑它，也不讓整體停住。Closure 掃描確認 #15 尚未有施工中的 PR，且其核心是獨立的 SupportChatWidget 假成功修正，不碰 #66 的 dashboard/feature-store 與 #34 的 AppShell；我現在從 current main 開始這條 source lane，先補失敗測試再實作。

Luna 已回報：#15 沒有 active PR；最乾淨的先行切片是 SupportChatWidget 誠實化。我已先用測試證明原本確實會把本地輸入當成送出，現在改成 i18n 的未開通警示、停用輸入與按鈕；接著會在同一條 #15 Terra lane 重驗其餘三項，因為 current main 仍可看到 chat 圖片本地泡泡、作品集本地排序與報表錯誤檔案路徑，不能把舊 issue 勾選當成完成證據。

我會先在目前的 #15 worktree 做一次真實 diff/編譯檢查，接著把圖片訊息、雙排序持久化、作品集與報表匯出補成可驗證的 current-main slice；同時持續輪詢 #66 的既有 exact-head CI，不重跑任何已存在的綠色或排隊 run。

#15 的 current-main 實作面已經接上第一版：聊天圖片會真的走 upload → LINE push → OUT 落庫，三個目錄頁的兩套排序各寫獨立欄位，作品集與報表也不再只改本地 state。現在進入測試補強與本地回歸，先把所有成功訊息都綁在真實回應上。

我繼續在 #15 的 current-main lane 收尾：先核對文件與 diff，再完成 build；之後會用兩個獨立 review 重新檢查這批 API、權限與 UI wiring，並同步輪詢 #66 的 exact-head CI。#15 尚未進 shared TEST，不會搶占目前的 TEST lane。

本地 build 已通過；唯一是既有的 Next
themeColor
警告，與這批變更無關。我也抓到兩處交接文件仍引用舊測試檔名，會在提交前修正；現在依 code-review 規則啟動兩條互補的只讀 review（API/資料安全、UI/驗收），不重跑 CI。

#15 的聊天契約已對齊 canonical 選項：
/api/upload
取得 URL，再以
type:'image'
、
originalContentUrl
、
previewImageUrl
呼叫訊息端點；測試也改為驗證這個正式契約，而不是額外自訂的
imageUrl
body。現在重跑完整 unit 與 typecheck，接著吸收兩條 review。

#66 的 exact-head
6fdc6d7
CI 已完整結束且全綠：classify、typecheck/unit/build、integration、E2E 都成功；我現在先把 PR #89 的過時「CI pending」改成真實 evidence，讓那條 lane 回到可繼續施工狀態。#15 的本地回歸也仍是 151 tests、typecheck、build 綠。

兩條 review 還在讀完整 diff（包含報表 SQL 形狀與三頁排序邊界）；我趁等待先核對現有報表端點與 migration runner，確認新 migration 不會被誤當成已在 TEST 自動套用。這也決定 #15 CI 前的 TEST 操作順序。

#66 的 PR body 已更新為
EXACT_HEAD_CI_GREEN
，沒有再保留 pending 描述。#15 目前仍只在本地未提交，避免在 review 前佔用 shared TEST；我正在把「文件契約、實作 payload、整合測試」三者保持一致，之後才建立唯一的 #15 implementation PR。

兩個 review agent 沒有在合理時間內回傳結果，我已要求它們停止探索；若仍不收斂，我會關閉並以更窄的範圍重新啟動同樣的兩條 review，避免讓等待阻塞施工。期間我先修正了獨立排序後「新增／複製項目各自取兩個欄位最大值」的邊界，避免新資料撞到另一條排序 lane。

第一條 API/security review 已回傳：指出 6 個 P1、3 個 P2。這裡有兩個需要先用 canonical 文件裁決的重大點：聊天圖片是否必須獨立 preview/ref，以及報表匯出路徑是否已有既定契約；另外確認排序完整集合與 quota 原子性不能被這批改動留下漏洞。我先讀它引用的規格，再逐項修正或明確排除不屬於 #15 的範圍。

我會先把 #15 review 指出的契約與並發風險收斂：確認既有匯出 API 是否才是 canonical 路徑，再補齊 LINE 圖片真正的 preview/儲存權限驗證、推播額度的 fail-closed 原子扣減，以及篩選狀態下的完整排序集合。完成後才會建立 exact-head PR 與 TEST lane 驗收。

第二個 review agent 也完成了；沒有 P0，但確認了幾個不能留到 CI 才發現的問題。接下來我會把圖片與額度邊界補在 server/DB，而不是只靠頁面端的善意輸入；同時修正篩選排序的完整清單與作品新增的封面必要條件。
