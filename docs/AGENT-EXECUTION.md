# Agent 常駐自主執行規則

> Owner 裁示日期：2026-08-28。
>
> 本文件是本 repo 的 agent 執行方式唯一正式版本（canonical execution policy）。
> 它規範怎麼盤點、派工、驗證、推進與停工；產品規格仍以各
> `docs/integration/**` 分冊為準。

## 1. 預設工作模式

- 主 agent 是專案主導者，不只是回報者。收到一個 Issue、`/goal` 或「繼續」後，
  應持續完成所有目前可施工工作，直到符合 §10 的停止條件。
- 階段性進度只能是非終止更新；更新後立刻繼續。不得把「已查到狀態」、
  「CI 還在跑」或「已建立 PR」當成任務完成。
- 等待 CI、agent 或外部讀取時，若有不會碰撞的工作，應繼續下一條工作流。
- 每次開工都重新讀 GitHub 的 open Issue、open PR、分支、最新提交與 CI；
  舊對話、舊清單與 Issue 內過時勾選只能當線索，不能當目前事實。
- 先接續既有可用 PR／分支，不為同一題重開一組平行實作。

## 2. 強制開工順序

1. `git fetch origin --prune`。
2. 從 `origin/main` 讀 `AGENTS.md`、`CLAUDE.md`、本文件、
   `docs/DOCUMENTATION-GOVERNANCE.md` 與 `docs/OWNER-DECISIONS.md`。
3. 讀 Issue 指定的 canonical 分冊、驗收清單與
   `docs/integration/12-TESTING-TDD.md`；以 Issue、錯誤碼或領域關鍵字搜尋
   `docs/AGENT-PLAYBOOK.md` 的相關教訓，只讀直接相關檔案，不重讀整個 repo。
4. 確認目前 base、head、既有 PR、migration 編號、CI 與 TEST schema 基線。
5. 建立精簡責任表：`Issue → 負責者 → branch/PR → 依賴 → DB 使用 → 驗證 → 狀態`。
6. 將工作分為：
   - **A：可直接施工**；
   - **B：等其他 Issue／PR，但可先做不衝突部分**；
   - **C：確實缺 Owner 決策、外部憑證或 Production 權限**。
7. 依依賴順序持續處理 A；C 只進待辦清單，不得卡住其他 A／B 工作。

## 3. 長期授權與禁止事項

| 動作 | 預設權限 | 必要條件 |
|---|---|---|
| 讀 repo、Issue、PR、CI、Preview 與文件 | 允許 | 使用目前狀態，不洩漏秘密 |
| 修改程式、測試、文件；建立 branch、commit、PR | 允許 | 遵守 Issue 範圍與文件治理 |
| 更新 PR 描述、review 回覆、Issue 證據與標籤 | 允許 | 內容必須有可驗證證據 |
| 關閉已完成的 Issue | 允許 | 最終分支已包含實作，且 Issue 每項驗收都有證據 |
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

## 5. 多模型派工與節流

- **目前對話選擇的模型是總體主力**：負責目標、依賴、風險、整合、最終判定與回報。
- **Luna 處理低風險、可審核且互不重疊的工作**：例如狀態盤點、CI 日誌整理、
  既有模式接線、格式修正、測試準備與文件核對。可平行使用多條 Luna 工作流，
  但每條必須有不同檔案／問題邊界與明確交付。
- **一個中大型 Issue 只交一位 Terra 完整負責**：由同一位讀最少必要規格、診斷、
  修改、跑針對性測試並提交。禁止多位 Terra 重複讀同一題或競作不同修法。
- **Sol 只在整個高風險變更鏈最後做一次唯讀終審**。主力若已是 Sol，不另派 Sol。
- 模型或 sub-agent 功能不可用時，由主力按相同責任邊界繼續；不可把「無法派模型」
  當成程式工作阻塞。
- agent 交接只提供：目標、必要文件、base/head、指定範圍、驗收、最新錯誤、安全界線。
  禁止預設複製完整舊對話或讓多個 agent 全量重讀 repo。
- 回報時區分「要求使用的模型」與「平台可驗證的實際模型」；無法驗證就寫 unknown。

## 6. Branch、PR 與 CI 流程

1. 一個 Issue／緊密相依的小批次使用一條責任清楚的 branch；若已有 PR，優先接續。
2. 程式、migration、依賴、workflow 與部署設定走 feature branch → PR → CI → review。
3. migration 平行施工前先分配不重複編號；合併前依 base 順序核對 drift 與相依性。
4. 先跑單一失敗測試與相關型別／單元測試；有新提交或新環境證據後才跑完整 CI。
5. 完全相同的 commit 與環境失敗不得反覆 rerun 碰運氣。
6. PR 合併前逐項核對 changed files、base/head、驗收證據、migration、秘密掃描與 CI。
7. 合併到指定整合分支後重新核對該分支；未取得 Production 授權時，停在 Ready 或
   已驗證整合分支，繼續處理其他 Issue。
8. Issue 只有在它要求的最終分支已包含實作且驗收全部成立時才關閉；傘狀 Issue 不得
   因其中一小段完成就關閉。

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

## 8. 錯誤停止線與恢復

- 同一驗證路徑連續兩次遇到**環境錯誤**，停止重試；只有權限、設定、服務狀態或
  其他環境條件真的改變後才重新計數。這與 TDD 的「實作修改三次仍紅」是不同規則。
- 停止該路線後，保存最小錯誤、已試條件與下一個可驗證假設；改走不同安全路線，
  或先做其他不相依 Issue。不得因此結束整個專案 goal。
- agent 長時間沒有提交時，主力要求最小檢查點：變更檔、目前 commit、重現指令、
  技術阻塞與可推送內容。拿回檢查點後整合、換路或重新派工。
- 不以刪測試、放寬斷言、隱藏按鈕、mock 假成功或靜默略過錯誤解除阻塞。

## 9. 證據、文件與教訓

每個完成項目至少記錄：

- Issue／PR、base/head 與提交；
- 驗收項目對應的測試檔與案例；
- 實際執行指令、結果與 CI 連結；
- TEST migration 基線／套用／schema cache／目標查詢證據；
- 未驗證範圍、殘餘風險、環境錯誤次數與 Owner 待辦；
- 主力、已指定 agent 模型與平台可驗證模型。

每次發生會造成 CI／測試失敗、環境重試、錯誤診斷、半成品、權限阻塞或 agent
停滯的事件，都要依固定格式新增或更新 `docs/AGENT-PLAYBOOK.md`。至少記：事件、證據、
根因、影響、修正、預防與驗證；相同根因更新原條目的最近日期與次數，不散落到新檔。
若教訓改變正式做法，再同步更新最相關 canonical 文件。不得另建會與正式規格競爭的
第二套完整文件。

## 10. 停止條件與最終交付

只有下列情況可結束一輪長程 goal：

1. 所有 open Issue 都已具備完整驗收證據、合併到其要求的最終分支並關閉；或
2. 所有剩餘項目都確實只缺 Owner 決策、外部權限／憑證或 Production 授權，且其他
   可施工項目已全部完成；或
3. 執行平台本身無法繼續，且已留下另一位 agent 可直接接手的精確檢查點。

最終報告必須包含：已關閉 Issue／合併 PR、測試與 CI、TEST migration、Production
未變更確認、剩餘阻塞與推薦決策、agent 分工、環境錯誤、playbook 更新。不得只回報
「目前進度」或要求 Owner 重複已給過的授權。
