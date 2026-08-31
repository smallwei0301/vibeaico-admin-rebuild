Warning: truncated output (original token count: 52170)
Total output lines: 2943

# 14 — 落差稽核與重開清單（2026-08-24 全面盤查）

> **這份文件是稽核結果與待辦帳本，不是新規格。** 起因：使用者實測發現「圖文選單
> 發布」按鈕按了顯示成功、LINE 端卻什麼都沒發生——該項卻早已在 Phase 6 打勾。
> 據此對整個計劃書（00–13）與程式碼做了三路全面盤查：①全部 40 個後台頁面逐頁
> 掃「假成功互動」②計劃 vs 實作端點逐條交叉比對 ③08 清單逐項還原「當時打勾用
> 的證據」。本冊記錄四類根因、完整落差清單、以及**已重開**的驗收項。
>
> 修復進度直接改本冊勾選狀態；規格性的修正已回寫各分冊（00 §1 鐵則 12、
> 08 開頭打勾規則、12 §6 DoD 9–11 條）。
>
> **修復工作已切成六個依序執行的 issue（前一個驗收清單全數打勾＋證據才可開下一個）：**
>
> | Issue | 內容 | 對應本冊 |
> |---|---|---|
> | [#3 修復-1](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/3) | 高危假成功誠實化（後端不存在的假互動；實刷測試最優先） | §1 A-1 後端也缺組 |
> | [#4 修復-2](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/4) | 帳號安全三件接線（變更密碼/登出/LINE 解除連接） | §1 A-1 安全組 |
> | [#5 修復-3](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/5) | 關鍵字回覆頁接線＋webhook 關鍵字覆蓋 | §1 keyword-replies、§2 覆蓋不足 |
> | [#6 修復-4](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/6) | Flex 主選單三層補齊 | §2 flex-menu |
> | [#7 修復-5](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/7) | Phase 6 測試補課＋upload 接線＋營運頁批次接線 | §1 其餘、§4 重開項 |
> | [#8 修復-6](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/8) | 行程域 route 補齊→測試→接線（先 route 後頁面） | §2 route 不存在組 |
>
> **修復系列之後接建置系列（後續 Phase 全部展開，同一套規則）：**
>
> | Issue | 內容 | 對應分冊 |
> |---|---|---|
> | [#9 建置-1](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/9) | Phase 8c 導遊自訂金流（payment-methods 後端全套＋ECPay 模組） | 10 §4 |
> | [#10 建置-2](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/10) | Phase 8d 行事曆整合（DEPARTURE／ICS／available-slots 排除團次） | 10 §5.5 |
> | [#11 建置-3](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/11) | Phase 9a 旅客 migration＋公開讀取 API＋商店頁讀取面 | 11 §1–§2 |
> | [#12 建置-4](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/12) | Phase 9b 旅客登入／checkout 並發／評論／自動建檔 | 11 §1.3/§3、10 §2–§4、12 §5 |
> | [#13 建置-5](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/13) | Phase 10 Midao 整合（Partner API／審核流／搬遷腳本；tour-platform 側另列） | 11 §4 |
> | [#14 建置-6](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/14) | 收尾：稽核殘項清零＋AI 測試補課＋端對端 10 條自動化＋正式切換 | 08 尾、09 §7、12 §4 |
>
> **2026-08-25 二輪盤點後新增「補齊系列」（#15–#26，同樣嚴格循序）。**
> 方向來自擁有者：**「對齊原站功能是首要目的；若有缺少功能，請用補齊的方式，
> 而不是刪除。」** 本輪盤點結果見下方 §5。
>
> | Issue | 內容 | 分冊狀態 |
> |---|---|---|
> | [#15 修復-7](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/15) | 本冊漏網的活體假成功四件（chat 送圖／三頁排序／報表匯出／客服 widget 誠實化） | 需補 04 §B-5/B-2/B-3/B-6 |
> | [#16 補齊-1](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/16) | QR Code 真實產生與下載（promote／line-settings） | REBUILD-SPEC §9.2 已更正；⚠️ 編碼器選型待裁決 |
> | [#17 補齊-2](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/17) | 預約加購 `booking_addons` 後端全套（＋更正 #3 的「屬 Phase 8b」誤標） | 04 §B-1 零記載，需補寫 |
> | [#18 補齊-3](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/18) | LINE 老闆通知 owner-notify（4 支端點＋儀表板 UI） | 06 分冊零記載，需新增 §5.5 |
> | [#19 補齊-4](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/19) | Rich Menu 進階設計器 11 支端點 | 06 §6 僅一句「Phase 6+ 再說」，需展開 |
> | [#20 補齊-5](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/20) | 診所叫號 clinic-queue 後端全套（4 表＋5 端點＋1170 行頁面接線） | **完全無分冊，需新增 `16-CLINIC-QUEUE.md`** |
> | [#21 補齊-6](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/21) | 外部行事曆匯入 external_calendars（＋ICS 拉取 cron＋staff token） | 10 §5.5 只有輸出面，需補 §5.6 |
> | [#22 補齊-7](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/22) | shop-page 端點群 6 支＋settings 三支雜項＋staff/reorder | 04 §A-1 需補 |
> | [#23 補齊-8](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/23) | 推廣成效統計 promotion/stats（埋點＋PV/UV＋7/30/90 天） | **完全無分冊，需補寫** |
> | [#24 補齊-9](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/24) | 推薦碼與推薦獎勵 referrals（首次儲值雙方各 500 點） | **完全無分冊，需補寫**（規則原文 `REBUILD-SPEC.md:1020`） |
> | [#25 補齊-10](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/25) | 平台級三項（support-chat 4 支／donate 金流／impersonate 判定） | 04 §B-6 僅一行，需展開 |
> | [#26 補齊-11](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/26) | 第三方登入 OAuth（＋先做 5 分鐘小修：兩顆按鈕現在點下去 404） | **03 §7 規格已完整，不需補寫** |
>
> **補齊系列的共通鐵則**：凡「分冊需補寫」的 issue，**補寫分冊是該 issue 的第一個
> 工作項，也是第一個驗收項**——沒有規格就開工正是本輪 19 項缺口的成因。
>
> 驗證方式以自動化為原則（單元/整合/Playwright 對 Preview 站實測，憑證自
> Google Drive「#Supabase#midao」文件自主撈取）；人工只保留各 issue 列名的
> 決策點與缺 token 時的 env 補填。**執行者共通紀律與環境要點見 15 分冊
> （AGENT-PLAYBOOK），每個 issue 開工前必讀。**

---

## 0. 四類根因（為什麼「打勾了但功能是壞的」）

### 根因 A：有計劃、有打勾，但沒完成（勾是假的）
計劃寫了、清單也勾了，但只完成了 API 層；頁面從未接線，或接了假的。
代表案例：rich menu「基本建立/發布」——端點 Phase 6 就寫好且過整合測試，
頁面按鈕卻是 `setTimeout(500)`+成功 toast，從未呼叫它。
**機制**：整合測試用 service role 直插 DB / 直打 API，綠燈被當成「功能完成」；
沒有任何一層測試負責「頁面按鈕 → service → API」這段接線。

### 根因 B：計劃漏掉（規格沒寫，做的時候也沒人發現缺）
分冊沒點名的東西，執行者不會做，清單上也沒有格子可以漏勾。
代表案例：webhook 對 Rich Menu 格子文字的 handler 覆蓋（06 分冊從未要求
「發布出去的每個按鈕文字都要有對應回覆」）；主題底圖從未有人負責上傳
（richmenu-assets bucket 是空的，靠它的發布流程必然 404）。

### 根因 C：驗收標準沒寫到（清單有格子，但格子太粗）
「rich menu 基本建立/發布」一行字沒有定義完成 = 什麼。12 §6 DoD 逐條套在
假發布上**八條全過**：§4 矩陣沒列 rich menu 測試（第 1 條免測）、E2E 只在
「該 Phase 有 E2E 項目時」才要求而矩陣只給 Phase 2/8/9 排了 E2E（第 5 條免測）、
§3 又明文「整合測試不驗 UI」——頁面接線落在三層測試的夾縫，制度上無人負責。

### 根因 D：驗收標準被 bypass（有規定，執行時沒守）
08 清單開頭本來就寫「每一項都必須有對應的自動化測試，只有無法自動化的才允許
人工驗收**並記錄**」——rich menu、verify、預約推播全都沒有測試也沒有人工記錄，
照樣打勾。Phase 5 的「每做完一組，對應頁面實測 CRUD 一輪」只有 commit 留下
「A/B 域進行中」就再無下文；block-times 頁根本沒接線這件事本身就證明該輪
實測沒做完。**機制**：打勾不需要出示證據，違規零成本。

---

## 1. 根因 A 清單：已打勾但實際未完成（全部重開）

### A-1 頁面假成功互動（按了顯示成功、後端什麼都沒發生）

後端端點/service **已存在**、頁面卻沒接（修法：補 service 包裝→接頁面→依 12 §6-10 驗證）：

- [ ] 設定頁「變更密碼」從未呼叫 `/api/auth/change-password`（settings/page.tsx 289–307）
- [ ] LINE 設定頁「解除連接」送空字串＝依契約「不變更」，token 實際沒清（line-settings/page.tsx 383–397；`/api/settings/line/disconnect` 已存在未用）
- [ ] LINE 設定頁「建立圖文選單」只存主題設定，沒打 create 端點（line-settings/page.tsx 322–345）
- [x] 關鍵字回覆整頁 CRUD 已接真實 service/API（issue #5，commit `faa7c22`）：
      `keyword-replies-wiring.05.test.ts` 驗證載入、建立、編輯、啟停與刪除接線；
      `keyword-replies.05.test.ts` 驗證 DB 設定會被 webhook 使用。Preview 的 UI→簽章
      webhook→LINE mock→清理仍列在 issue #5 的站點驗收，不把 source/CI 冒充 Preview。
- [ ] 行銷推播整頁假：發送/取消/刪除/建立（marketing/page.tsx；`/api/marketing/pushes*` 已存在）
- [ ] 活動管理整頁假：發布/暫停/恢復/結束/刪除/建立（campaigns/page.tsx；`/api/campaigns*` 已存在）
- [ ] 顧客管理：新增/編輯假（load 後蒸發）、LINE 綁定假（customers/page.tsx；service 已存在，bookings 頁同功能是真的——照抄）
- [ ] 封鎖時段整頁假（block-times/page.tsx；calendar 頁同 service 是真的——照抄）
- [ ] 點數儲值 modal 假送出（points/page.tsx 305–322；`/api/points/topup` 已存在）
- [ ] 作品集整頁 CRUD＋排序假（portfolio/page.tsx；`/api/portfolios*` 已存在）
- [ ] 行程列表：上/下架、Midao 申請、刪除假（trips/page.tsx；service 已備）＋「新增行程」是空 onClick
- [ ] 行程詳情：行程/方案/出發日/加購全套編輯假（trips/[id]/page.tsx；service 已備）
- [ ] 旅遊訂單：確認收款/結案/取消/手動開單假（tour-orders/page.tsx；service 已備）
- [ ] Topbar「登出」只是 `<Link>` 導頁，從未呼叫 `POST /api/auth/logout`，session 不失效（e2e 用 clearCookies 代打——測試遷就了 bug）
- [ ] 員工頁「自訂稱呼」假儲存（staff/page.tsx 439–455；可入 tenant_settings）
- [ ] 班表：週班表儲存與排班模式切換 local-only（shifts/page.tsx 855–865、475–483）
- [ ] shop-design「儲存」送出**空 patch**（`saveTenantSettings({})`）＝形似有接、持久化為零

後端也缺（修法：先把成功 toast 改誠實的未建置狀態＝CLAUDE.md 原則，端點另排期）：

- [ ] 付款方式整頁（含「實刷測試」謊報刷卡成功並設 gatewayVerified=true——**金流級假成功，最優先移除**）
- [ ] 診所叫號整頁（含「已 LINE 通知病患」謊報）
- [x] 預約加購 modal（謊報「顧客將收到 LINE 消費明細」）—— #3 已誠實化；**後端已於 issue #17 補齊並真實接線**（migration 0020 + 04 §B-1.1，見 §6.14），誠實化文案整組移除
- [ ] 行事曆同步頁（ICS token 重生＝假安全操作、外部行事曆 CRUD）＋設定頁 ICS token 重生（硬編碼輪替陣列）
- [ ] 贊助頁假送出、推薦頁硬編碼假推薦碼、兩處「QR 已下載」沒下載
- [ ] rich-menu-design 殘留：FlexMenuTab 發布/重設/刪卡、每格彈窗、儲存草稿、還原、預約步驟、背景圖「上傳圖片」死按鈕（無 onClick）

### A-2 API 有測試但無人使用（綠燈孤兒）

- [ ] `/api/upload`：測試矩陣完整全綠，但全 src/ 無任何頁面呼叫——「圖片上傳」對使用者不存在
- [ ] `/api/bookings/available-slots`：有整合測試，services 層連包裝函式都沒有

---

## 2. 根因 B 清單：計劃漏掉（規格要補寫、工作要補做）

- [x] **webhook 關鍵字覆蓋已補齊（issue #5，commit `faa7c22`）**：原實作只比對
      4 個字面值（預約/服務/我的預約/行程佔位）；現由
      keyword-replies i18n 定義的 15 組系統關鍵字（含同義詞）與 `MODE_PRESETS.richMenuCells`
      的格子文字（服務項目/會員卡/優惠/聯絡我們/團次/我的訂單/常見問題/看診進度/營業時間…）
      全部受 `line-keyword-coverage.test.ts` 與 `keyword-replies.05.test.ts` 的
      程式化矩陣保護。**新增規格**：已回寫 06 §3——「Rich Menu 每個
      格子送出的文字、與系統關鍵字組全部同義詞，webhook 必須有對應分支；系統組的
      啟停開關（systemGroupDisabled）webhook 必須讀」。PR #49 `cadab19`
      run #163 已通過完整 unit／integration／E2E。
- [ ] **flex-menu 三層只做一層**：儲存端點有；webhook「選單」關鍵字回 Flex（06 §6 原文要求）完全沒做、頁面發布也沒接。已在 06 §6 標註現況
- [ ] 主題底圖無人負責上傳（bucket 空）→ 已用「現生成純色 PNG」修掉硬依賴（commit 3a7429b），06 §6 已註記
- [ ] `/api/trips/:id/addons`、`/api/trips/import`、`/api/trips/:id/export`、`GET/POST/DELETE /api/demo-data`、`DELETE /api/settings/line/rich-menu`：程式已存在、計劃全無記載 → 已補記（10 分冊 / 06 §6）
- [ ] tours.ts real 分支呼叫、但 **route 根本不存在** 的端點（`USE_MOCK=false` 頁面接上後會 404）：
      `POST /api/trips/:id/publish|unpublish`、`request-midao-listing`、
      `GET/POST /api/trips/:id/departures`（＋batch、trip-departures/[id]）、
      `GET /api/tour-orders`、`confirm-payment|complete|cancel|manual`——屬 Phase 8b 範圍，10 分冊已有規格但**與前端進度脫鉤**；接頁面前必須先補 route
- [ ] 10 §4 與 04 分冊互指錯誤：10 §4 稱 payment-methods「即 04 §B 既列」，04 其實沒列 → 已修 10 §4 改為本冊自帶定義
- [ ] `POST /api/bug-report` 規格要求寄信給平台管理者的一半沒做（email 模組缺通用寄信函式）；`/api/support-chat/*` 未實作
- [ ] ICS 訂閱輸出端點（10 §5.5）完全不存在；available-slots 未排除團次時段
- [ ] 陳舊註解誤導後續施工（本次一併修正）：line-events.ts 三處「trips 表尚不存在」（0016 已建表）、verify/route.ts 檔頭仍寫「恆回 pass:false」（實作已改）、tour-order-expiry 註解稱每小時（實際每日）

---

## 3. 根因 C／D 的制度修正（已落地）

- **00 §1 鐵則 8 加嚴 + 新增鐵則 12**：打勾必須附證據；成功 toast 是斷言對象。
- **08 清單開頭新增「打勾規則」**：每一勾必須註明驗證方式與證據（測試檔:案例名，
  或人工實測日期+步驟+結果），無法對應者不得打勾；「只驗 API 不驗頁面接線」不構成
  頁面功能項的打勾證據。
- **12 §6 DoD 新增 9–11 條**（原 8 條不動）：
  9. checklist 逐項證據；10. 使用者可見的寫入動作必須有「按下去後副作用真的發生」
  的自動化證據（E2E 斷言，或最低標準：靜態核對 handler→service→端點鏈路完整且
  端點有整合測試）；11. 顯示成功訊息的路徑，測試必須同時斷言副作用存在——
  只改本地 state 就報成功視同鐵則違規。
- **12 §4 Phase 6 矩陣補列**：rich menu create/delete、verify 五項、預約狀態推播
  （line-notify 路徑）、keyword-replies 頁接線後的端到端案例。
- **12 §4 Phase 5 補列**：B-6 報表進階/匯出（原本零測試檔）。

---

## 4. 重開的 08 清單項（原勾作廢）

| Phase | 項目 | 重開原因 |
|---|---|---|
| 2 | 註冊→登入→**登出**→忘記→重設全流程 | 登出未接後端（A-1），e2e 用 clearCookies 遮掉 |
| 5 | B-1 預約進階 | block-times 頁未接線；available-slots 無人使用 |
| 5 | B-6 報表進階/匯出 | 零測試檔 |
| 5 | 每組頁面實測 CRUD 一輪 | 無完成紀錄，且 block-times 反證未做完 |
| 6 | keyword replies | 管理頁全假（webhook 側 OK） |
| 6 | 預約狀態推播＋額度控管 | 實作在但零測試（推播路徑額度控管零覆蓋） |
| 6 | rich menu 建立/發布 | 頁面假發布（已修）；補自動化測試後才可重勾 |
| 6 | verify 五項檢查 | 端點零測試（曾長期帶著假錯誤無人發現） |
| 7 | `/api/upload` | 無任何頁面使用 |
| 8(部分) | trips/plans | 寫入面頁面全假＋多支 route 不存在＋零測試 |

重勾條件一律照修正後的 08 打勾規則與 12 §6 DoD 9–11。

---

## 5. 二輪盤點（2026-08-25）：19 項未排期缺口、68 支原站端點

第一輪（§0–§4）盤的是「**打勾了但功能是壞的**」。二輪盤的是另一個問題：
「**原站有、本專案的計劃書從頭到尾沒提過**」——這些項目不會在任何清單上出現，
因為它們連格子都沒有。結果：**19 項未排期缺口，涉及原站 68 支端點。**

### 5.1 共同根因：`02-SUPABASE-SCHEMA.md` 的一句懸空指標

02 分冊原本寫著：

> 「`clinic_queue_*`、`payment_methods`、`external_calendars`、`donations`、
> `bug_reports`、`support_chat` 屬 Phase 5+ 的長尾功能：**先不建表**，等 04 分冊
> §B 對應端點要實作時，依同樣模式補 migration。」

**04 分冊 §B 從未定義這六者中任何一支端點。** 02 把責任交棒給 04、04 沒接，
交棒處沒有任何一冊負責。六者中的四者——`clinic_queue_*`、`external_calendars`、
`donations`、`support_chat`——因此在整份 00–13 裡完全沒有落點。前端頁面照原站
做出來了（`clinic-queue` 約 1170 行、`calendar-sync`、`donate`、掛在每一頁上的
`SupportChatWidget`），按下去全是假成功。

這是本輪大部分缺口的共同來源。02 分冊該段已於 2026-08-25 改寫：作廢原句、
逐表列出具名歸屬（issue 編號＋分冊章節），並在原地記下這則教訓。

**一般化**：「等 X 冊要用的時候再補」只有在 **X 冊真的寫了那一項**時才成立。
交棒必須指向一個**已經存在的章節**；指向「未來應該會有」的章節不叫排期，叫遺失。
（與 §0 根因 B 同型，但更隱蔽——根因 B 是「沒人想到」，這裡是「以為有人負責」。）

### 5.2 上一輪稽核為什麼漏掉版面元件——**稽核方法本身的缺陷**

第一輪的 25 項假成功清單，**漏了 `src/components/layout/SupportChatWidget.tsx`**
——一個掛在**每一個後台頁面**上的浮動客服按鈕，送出後顯示已送出，
`/api/support-chat/*` 根本不存在。它是本專案曝光率最高的假成功之一，卻整輪沒被
看過一眼。

原因不是疏忽，是**掃描範圍寫死了**：第一輪只掃 `src/app/tenant/**/page.tsx`。
這個 glob 的隱含假設是「使用者可按的東西都在頁面檔裡」——而版面元件、共用元件、
Modal 元件全都不在 `page.tsx` 裡。假設沒有被寫下來，也就沒有被檢查。

**訂正後的稽核範圍（下次盤點照此，不得再用單一 glob）**：

| 範圍 | 為何必掃 |
|---|---|
| `src/app/**/page.tsx` | 頁面主體（第一輪唯一掃過的） |
| `src/app/**/layout.tsx` | 版面層的互動 |
| `src/components/**` | **第一輪的漏洞**：版面元件、共用元件、Modal、Widget |
| `src/services/**` | 只回 mock 卻被當成真資料源的包裝函式 |
| `src/app/api/**` vs 原站端點清單 | 綠燈孤兒（有端點沒人用）與反向缺口（有頁面沒端點） |

**掃描訊號**（不只看 `setTimeout`）：成功 toast 的呼叫點、`setState` 後直接報成功、
`onClick` 為空或不存在的按鈕、寫死的常數被渲染成數值、`disabled` 缺失的未實作入口。

**一般化教訓**：稽核腳本的**掃描範圍本身就是一個「已知」**，一樣會是假的。
「我掃過了」若沒有附上掃了哪些路徑，等同於 §0 根因 D 的無證據打勾——
下一輪稽核的產出必須包含**實際使用的 glob 清單**，供人檢查它漏了什麼。

### 5.3 二輪的四件活體假成功（第一輪漏網，已排 #15）

- [ ] `/tenant/chat` 送圖／送檔只 append 本地 state，未走 `/api/upload`、未 push 給顧客
- [ ] `/tenant/services`、`/tenant/products`、`/tenant/portfolio` 三頁「上移／下移」只改本地陣列，重整即還原
- [ ] `/tenant/reports` 匯出顯示成功但無檔案產生
- [ ] `src/components/layout/SupportChatWidget.tsx` 送出顯示已送出，端點不存在（**範圍缺陷漏掉的那一件**）

### 5.4 19 項未排期缺口與歸屬

| # | 缺口 | 原站端點數 | 分冊狀態 | Issue |
|---|---|---|---|---|
| 1 | chat 送圖 | 1 | 04 §B-5 需補 | #15 |
| 2 | 三頁排序持久化 | 3 | 04 §B-2/B-3/B-5 已有契約，頁面未接 | #15 |
| 3 | 報表匯出接線 | 2 | 04 §B-6 已有契約 | #15 |
| 4 | support-chat widget 誠實化 | — | — | #15 |
| 5 | QR Code 產生與下載 | 0（前端產圖） | REBUILD-SPEC §9.2 已更正 | #16 |
| 6 | 預約加購 `booking_addons` | 3 | ~~04 §B-1 零記載~~ → **已補寫 04 §B-1.1**，端點與頁面接線完成（§6.14） | #17 ✅ |
| 7 | LINE 老闆通知 owner-notify | 4 | ~~06 分冊零記載~~ → **已補寫 06 §5.5**，四支端點＋儀表板名單 UI＋`owner-reminders` cron 完成（§6.17） | #18 ✅ |
| 8 | Rich Menu 進階設計器 | 11 | 06 §6 僅一句 | #19 |
| 9 | 診所叫號 clinic-queue | 5 | **完全無分冊** | #20 |
| 10 | 外部行事曆匯入 | 2（＋cron） | 10 §5.5 只有輸出面 | #21 |
| 11 | 員工個人行事曆 token | 1 | 同上 | #21 |
| 12 | shop-page 端點群 | 5 | 04 §A-1 零記載 | #22 |
| 13 | banner-video presign/confirm | 併入上列 | 同上 | #22 |
| 14 | settings 三支雜項 | 3 | 04 §A-1 零記載 | #22 |
| 15 | staff/reorder | 1 | 04 §B-2 模式已有 | #22 |
| 16 | 推廣成效統計 promotion/stats | 1（＋埋點） | **完全無分冊** | #23 |
| 17 | 推薦碼與推薦獎勵 referrals | 2（＋註冊/儲值掛勾） | **完全無分冊** | #24 |
| 18 | 平台級三項（support-chat／donate／impersonate） | 4＋金流＋1 | 04 §B-6 僅一行 | #25 |
| 19 | 第三方登入 OAuth | 3 | **03 §7 規格已完整** | #26 |

> 端點數為原站對照計數（68 支），本專案實作時的端點切分可能略有出入——
> 以各 issue 第一個工作項所補寫的分冊契約為準。

### 5.5 本輪同時完成的分冊修正

- `02-SUPABASE-SCHEMA.md` 長尾表段落：作廢懸空指標，改為逐表具名歸屬＋教訓記錄。
- `REBUILD-SPEC.md` §9.2：「QR Code —— 原站由後端出圖」更正為「原站是前端 JS 產圖」，
  附 `docs/specs/promote.json` 的五項證據（`downloadQr()` inline onclick、
  「QR 元件載入失敗」、「QR 尚未產生」、檔名 `預約QRcode.png`、195 支端點清單中無 QR 端點），
  並記下「規格文件裡的『原站是這樣做的』也是一種已知，一樣需要證據」。
- 本冊：issue 對照表補 #15–#26；新增本節。

---

## 6. 稽核結案紀錄（滾動更新）

本節記錄 §1–§5 盤出來的項目**實際被關掉**的時間點與證據，讓「重開的勾」有一條可追溯的
回填路徑。規則：**沒有本節的一列，08 分冊的勾就不准補回去。**

### 6.1 issue #3（修復-1 誠實化）— 2026-08-25 結案

- commits：`742f33d` / `88ffc9d` / `fb3d56b` / `d4cafdf`
- 不可回歸測試：`tests/unit/honest-not-built-pages.test.ts`（25 案）、
  `honest-not-built-interactions.test.ts`（20 案）、
  `honest-not-built-rich-menu-design.test.ts`（31 案）、`honest-not-built-residuals.test.ts`
- 每一條都做過**變異測試**：把誠實化改回假成功，測試必紅（這是本專案第一次把
  「測試真的會抓到」本身也當成證據要求）
- 頁面實測：`scripts/verify/issue3-honest-pages.cjs` → `scripts/verify/out/i3-*.png`
- 一併修掉的真 bug：`aa06146` AppShell 整頁重掛載（`<main key>` 在載入完成時換值），
  前後對照證據為 Playwright route interception 把 `my-tenants` 延遲 15 秒的截圖組
  `appshell-01~04-*.png` ＋ `tests/unit/appshell-mount-stability.test.ts`

⚠️ **§1 的 A-1 各列不因本 issue 而清空。** 誠實化只把「畫面在騙人」關掉，
功能本身仍缺；A-1 每一列真正的關閉條件是它對應的補齊 issue（#16–#26）完成。
本 issue 只清掉 A-1 的**誠實性**問題，不清掉**功能性**問題。

### 6.2 issue #4（修復-2 帳號安全三件）— 2026-08-25 結案

- commit：`5526ed2`
- 整合測試：`tests/integration/api/security-wiring.04.test.ts` 三個 describe，
  分別對應變更密碼／登出／LINE 解除連接
- 頁面實測：`scripts/verify/issue4-security-wiring.cjs` → `out/01~10-*.png`
- **可回填 §4 的一列**：Phase 2「註冊→登入→**登出**→忘記→重設全流程」——
  登出已接後端，且測試斷言的是「原 session 打 `/api/auth/me` 回 401」，
  不再是 e2e 用 `clearCookies` 遮掉。§4 其餘各列維持重開狀態。

### 6.3 技術債（已知、已記錄、尚未還）

| 項目 | 現況 | 影響 |
|---|---|---|
| `tests/integration/api/chat-link.06.test.ts` 偶發紅燈 | 用固定 port 4123 起本地 server，前一輪未釋放時會撞 | CI 偶發假紅；重跑即過。應改成 port 0 由 OS 配發 |
| Agent worktree 隔離在本沙箱不可用 | `isolation: 'worktree'` 建出來的 worktree 基底是 `28a14cb`（已分岔 8 個 commit），不是當前 HEAD | 平行施工只能共用工作目錄，**因此必須由主導者手動切開檔案範圍**，且同一時間只能有一個 agent 跑 `npm run test:integration`（`reset-db.mjs` 會清空 TEST 專案，是全域序列化點） |
| `src/services/settings.ts:11` 模組層 `const current = MOCK_TENANTS[0]` | CLAUDE.md 明文警告過這個陷阱，仍然犯了 | 骨架模式下 demo 租戶被凍結成 GUIDE，三種模式看到同一間店；且 mock 分支硬塞已設定的 LINE token，假裝成已連動狀態 |

---

---

## 7. 三輪盤點（2026-08-25）：26 筆「呼叫了端點，但呼叫錯端點」

### 7.1 為什麼要有第三輪——前兩輪的判準本身有洞

前兩輪找假成功用的規則是：
- 按了只動本地 React state 就顯示成功 toast
- 用 `setTimeout` 假延遲讓假動作看起來像在跑
- 硬編碼的假資料／假狀態

`line-settings` 的「建立 Rich Menu」**三條都不符合**，所以兩輪都放過它——它確實
`await` 了一支真實端點（`PUT /api/settings/line`），只是那支端點做的事（存外觀偏好）
跟成功訊息宣稱的事（已發布到 LINE、顧客看得到）無關。

**第三輪的判準因此改成：**

> 這則成功訊息宣稱的事，是**哪一支端點**做的？那支端點真的做了那件事嗎？

用這條規則重掃 `src/app/tenant/**` 與 `src/components/**`，得到 **26 筆 MISMATCH**
（高 12／中 12／低 2）。其中 5 筆與 Rich Menu 完全同型（有 await 真端點但端點不對），
另 21 筆是「端點存在、service 函式甚至已寫好、頁面從頭到尾沒 import」。

### 7.2 判準的第四層：可自動化的靜態鎖

三輪下來，判準逐次變嚴：

| 輪次 | 判準 | 漏掉什麼 |
|---|---|---|
| 一 | 只動本地 state／setTimeout 假延遲 | 版面元件（只掃了 `src/app/tenant/**/page.tsx`） |
| 二 | 加掃 `src/components/**` | 有 await 真端點但端點不對的 |
| 三 | 成功訊息宣稱的事是哪支端點做的 | （待第四輪驗證） |

第三輪的規則可以部分自動化，建議補一條靜態測試：
**頁面每一則非 danger／warning 的 `toast.show(...)`，都必須能在同一個函式內追到一個
`await <service 函式>`。** 26 筆裡有 5 筆（campaigns／marketing／block-times／
customers 新增編輯／BugReportModal）純靠這條規則就抓得到，不必等人工稽核。

⚠️ 但這條鎖**抓不到** MISMATCH 的核心型態（有 await、端點不對），所以它是補充、
不是取代。端點對不對仍然只能靠人讀 route。

### 7.3 最嚴重的一筆：AI 客服設定把提示詞當罐頭訊息推給顧客

`src/app/tenant/ai-settings/page.tsx:79` 呼叫的是
`saveLineSettings({ autoReplyEnabled, defaultReply: prompt })`，寫進
`tenant_settings.line` jsonb。但 webhook 的 AI 分支（`src/server/line-events.ts` 分支 ⑤）
讀的是 `tenant_settings.ai.enabled`，那個欄位永遠停在 zod 預設的 `false`。專用端點
`PUT /api/ai-settings` 存在，**從來沒有被呼叫過**。

實際後果不只是「AI 沒開起來」，而是**主動做錯事**：店家寫的「AI 提示詞」被原封不動
存成 `defaultReply`，於是 webhook 分支 ⑥ 把那段提示詞**逐字推播給每一位顧客**。
店家看到的是「AI 客服設定已儲存（已啟用）」。

這一筆同時暴露一個設計衝突：`ai-settings` 與 `line-settings` **搶寫同一組**
`line.autoReplyEnabled` / `line.defaultReply`，兩頁互相覆蓋。修的時候必須一併決定
誰擁有這兩個欄位。

### 7.4 26 筆的歸屬

| 已排在既有 issue | 筆數 | issue |
|---|---|---|
| keyword-replies 全頁 | 1 | #5 |
| trips／trip 詳情／tour-orders 三頁 | 3 | #8 |
| customers 新增編輯／LINE 綁定解綁、block-times、points 儲值、marketing、campaigns、shifts 週班表與模式、shop-design 空 patch、rich-menu 底圖上傳 | 10 | #7 |
| shop-page 端點群 | （併入 #7 的 shop-design 列） | #22 |

| 本輪新開 | 筆數 | 新 issue | 狀態 |
|---|---|---|---|
| LINE 對外行為三件（ai-settings 走錯端點／預約 MODIFIED 通知／商品訂單通知勾選框） | 3 | #27 | Source、unit、integration、E2E 已完成（`38e714f`；PR #49 exact HEAD `5cc70ba` CI run #159 attempt 2 全綠）；Preview 三路徑仍待租戶登入實證 |
| 單點與匯出批次（BugReportModal、`/pay` 死連結、班別範本文案、三處匯出、feature-store 丟棄回傳值、分類說明欄位） | 9 | #28 | ①②⑦⑧⑨ source 已完成；③–⑥ 亦有 deployed `0db681f` Preview 輸出（exports 18/18、welcome upload 8/8），但 current-head 截圖／full CI 待補，故 issue 維持 open |

`#7` 的清單須補三筆本輪才發現、屬於它範圍但原本沒列到的：顧客匯出、預約匯出、
歡迎卡片圖片上傳按鈕。

### 7.5 本輪未判定（不准猜，列出來等決策）

- `POST /api/settings/line/flex-menu` 無任何呼叫者。它與 `PUT /api/settings/line`
  寫同一組 flex 欄位，所以不造成資料落差；但它是廢棄端點還是 issue #6 的預留，
  無法從程式碼判定。
- `notifyBookingStatus` 是 fire-and-forget（06 分冊 §5 明文要求不 await），函式內
  吞錯只 `console.error`。因此推播實際失敗時，畫面仍顯示「已通知顧客」。這算不算
  「宣稱了未驗證的事」是規約層級的取捨，需要決策而不是逕行判定為 MISMATCH。
- `/tenant/promote` 的流量統計讀 `MOCK_PROMOTION_STATS`，程式碼註解誠實，但頁面上
  有沒有對使用者說明那是示範數字，需要看渲染結果才能定論（假數字與真的公開網址並排）。
- `shifts` 的「週排班」與「排班模式」是否本來就規劃為純前端概念——`/api/shifts` 的
  契約不含這兩者。無論如何，目前顯示「已儲存」都不對。

---

## 8. 擁有者裁決紀錄（2026-08-25）

⚠️ **這一節是給執行者看的。動工前先確認你要做的事有沒有出現在這裡——
有的話照裁決做，不要重新思考、不要自行變通。** 每一條都附「為什麼」，
是為了讓你在遇到邊界情況時能推得出一致的答案，不是留給你翻案的空間。

### 8.1 `line.autoReplyEnabled` / `line.defaultReply` 的所有權 → **分家**

| | 歸屬 | 語意 |
|---|---|---|
| `tenant_settings.line.autoReplyEnabled` / `.defaultReply` | 只由 **`line-settings` 頁**寫 | **沒有 AI 時**的靜態罐頭回覆 |
| `tenant_settings.ai.*` | 只由 **`ai-settings` 頁**寫 | AI 客服的啟用狀態、提示詞、嚴格模式、轉人工訊息 |

webhook 維持既有的分派順序不變：分支 ⑤（AI，條件 `ai.enabled`）優先，
落回分支 ⑥（靜態罐頭，條件 `line.autoReplyEnabled`）。

**為什麼**：這兩件事本來就是不同的東西——一個是「AI 幫我回」，一個是
「AI 沒接手時回這句」。先前 `ai-settings` 把提示詞寫進 `defaultReply`，
等於把「給 AI 的指令」當成「給顧客的話」，於是提示詞被逐字推播給每一位顧客
（§7.3）。分家之後兩頁不再搶同一組欄位，也不需要任何一頁去猜對方的狀態。

### 8.2 QR Code 產生方式 → **安裝 `qrcode` 套件**

不得自寫編碼器。安裝後在 `docs/integration/` 的對應分冊指名套件與版本。

**為什麼**：QR 有 Reed–Solomon 糾錯，自寫的典型失敗模式是「看起來像 QR、
掃不出來」——外觀完全正常、沒有任何錯誤訊息、單元測試也會綠。那正是本專案
最怕的假成功型態，而且是最難被發現的那一種。

### 8.3 xlsx 產生套件 → **`exceljs`**

**為什麼**：匯出只需要 write，API 直白；SheetJS 社群版的授權需要額外確認，
不值得為了體積差異去承擔法務不確定性。

### 8.4 班別範本改時間 → **不連動已排定的班表，改文案**

範本的語意是「下次排班時的預設值」。文案不得再出現「班表時間已同步」。

**為什麼**：多數排班系統都是這個行為；更重要的是，已排定的班次可能已經
有預約、已經通知過顧客，回頭改動它的時間會產生沒人預期的連鎖影響。

### 8.5 庫存匯出 → **CSV 與 Excel 兩者都做**，照 reports 的慣例

### 8.6 `campaigns` 發布 → **真的推播**，不是改文案

文案「活動已發布，LINE 推播已發送」保留，`POST /api/campaigns/:id/publish`
要補上實際的推播與額度扣減。

**為什麼**：活動發布本來就該通知會員，這是原站有的功能。依「補齊優先於刪除」
的方針，缺的是實作而不是文案。

### 8.7 只改備註（未動時間／人員）→ **不推播**，且文案跟著改

`PUT /api/bookings/:id` 只有在**時間或服務人員真的變動**時才發 MODIFIED 通知。
`bookings` 頁的成功訊息不得再寫死「預約已更新，已發送通知給顧客」，
要依這一次到底有沒有發通知顯示不同的話。

**為什麼**：顧客不需要為了一則店家內部備註收到推播；而畫面既然會因此有兩種
結果，就不能只講其中一種。

### 8.8 `/api/bookings/available-slots` 綠燈孤兒 → **標記 Phase 8b 再用**

現在不接進任何頁面。在 14 分冊記錄它是「已實作、已測試、刻意尚未使用」，
**不是**假成功、也不是漏接。

### 8.9 `shop-design` 與 issue #22 的邊界 → **先讓儲存真的存到東西**

本輪走現有的 `PUT /api/settings`，把 `config` 的欄位真的帶進 patch
（目前送的是空物件 `{}`，端點收到後一個欄位都沒寫就回 200）。
端點搬家到 `/api/settings/shop-page` 留給 #22。

### 8.10 通知類文案的通則 → **「已送出通知」，不得寫「已通知」**

⚠️ **這一條適用全站，不限單一 issue。** 凡是推播／簡訊／email 之後顯示的
成功訊息，一律只能宣稱「已送出」，不得宣稱「已通知」「顧客已收到」。

**為什麼**：`notifyBookingStatus` 是 fire-and-forget（06 分冊 §5 明文要求
不 await，避免 LINE 慢的時候店員畫面卡住），失敗只寫 log。所以推播實際失敗
時，畫面仍會顯示成功。改成「已送出通知」之後，這句話在**任何情況下都成立**——
系統確實把訊息交出去了。

還有一層技術天花板要一併理解：就算改成 await，LINE 的推播 API 回 200 也只
代表「LINE 收下了」，不代表「顧客的手機顯示出來了」。**沒有任何實作方式能
讓「已通知顧客」這句話為真**，所以問題不在要不要 await，而在那句話本身
就超出了系統可以知道的範圍。

### 8.11 `/api/shifts` 的週排班與排班模式 → **補契約**

不當作「本來就只是前端小工具」。`/api/shifts` 要擴充成能接收 weekly pattern
與 scheduleMode，讓那兩顆按鈕變成真功能。

**執行順序強制**：先把契約改動寫進 `docs/integration/04-API-CONTRACTS.md`，
再動實作。不得邊做邊定義。

### 8.12 `chat-images` 的公開性與保留期限 → **現在就查 LINE 文件**

先查證 LINE 抓圖的時機與重試行為，再決定能不能改用簽名 URL。查證結果寫進
`docs/integration/06-LINE-INTEGRATION.md` 並附文件出處。

**為什麼要查而不是猜**：兩種可能的行為導向完全相反的結論——
- 若 LINE 在**發送當下**就把圖抓一份存到自己的伺服器，簽名 URL 完全可行
  （只要簽名在那幾秒內有效即可，顧客之後看的是 LINE 的副本）
- 若 LINE 是在**顧客點開圖片時才即時回源抓**，簽名一過期顧客就看到破圖，
  等於製造一個新 bug；那就得改做一層驗身分的代理，是獨立的工程

CLAUDE.md 有明訓：**在把「我們做不到」寫進程式碼之前，先去查供應商當前的
API 文件**。先前「自動回應訊息無法檢查」就是這樣被證明只對一半
（`GET /v2/bot/info` 的 `chatMode` 其實查得到）。

**查證結果（2026-08-25，已完成）→ 「無法確認」，因此維持 public、暫不做保留期限。**
完整紀錄與出處見 `docs/integration/06-LINE-INTEGRATION.md` §8。摘要：

- LINE 官方**沒有任何一句話**說明 image message 的 `originalContentUrl` 何時被誰
  抓取、LINE 端是否留副本。連 `line/line-openapi` 的 `ImageMessage` 都只有型別、
  沒有語意——**上次靠 spec 一次 grep 解決爭議的那招，這次失效**。
- 已確定的一件事（與 A/B 無關，獨立成立）：**LINE Official Account Manager 會
  直接回源抓圖，簽名一過期就破圖。**
- 因此：短效簽名 URL **現階段不得採用**（理由不是做不到，是沒有依據）；
  保留期限同樣被這個未知卡住——若真相是 (B)，刪掉舊物件＝顧客回頭看舊訊息全部破圖，
  所以「保留幾天」不是成本問題而是正確性問題。
- ⚠️ **我先前提的「代理層」構想已被證明無效**：LINE 端抓圖不帶任何可辨識顧客的憑證，
  伺服器收到請求時無從得知對方是誰，所以「顧客點圖 → 驗身分 → 回傳圖」掛在
  `originalContentUrl` 後面不成立。正確方向是**不送圖、送連結**（LIFF ＋ LINE Login
  取 userId 驗身分後再發簽名 URL），屬獨立工程。
- **在實測回填之前，06 分冊 §8.1 必須維持「無法確認」**，不得因為旁證偏向 (B)
  就改寫成 (B)——那正是本分冊反覆警告的「把沒有量到的狀態當成量到的」。


### 6.4 issue #28 ①⑧⑨ — 2026-08-25 完成（commit `3aee55e`）

| 項 | 內容 | 關鍵證據 |
|---|---|---|
| ① | `BugReportModal` 四欄改 controlled、真的打 `POST /api/bug-report` | `tests/integration/api/bug-report.28.test.ts:「modal 的四個欄位逐一落到 bug_reports：category / subject / content / contact_email 內容相符」`——每欄給不同可辨識值後以 service role 直查。**只驗「表裡多一列」不算通過**，原本的缺陷正是四個欄位全是 uncontrolled、內容從未被收集 |
| ⑧ | `feature-store` 恢復訂閱依回傳值分三種結果顯示 | `feature-store-restore.28.test.ts` 五案；三句文案是**引用早就備好、全站零引用**的既有字典（`feature-store.ts:147-151`），不是新寫的 |
| ⑨ | 分類的「說明／啟用」真的存得進去 | migration `0018`，兩專案 `information_schema.columns` 輸出逐字相同；`category-fields.28.test.ts` 五案含「不帶欄位的舊呼叫端走預設值不報錯」 |

三次變異測試（拿掉 ① 的接線、把 ⑧ 的分支改回一律成功、拿掉 ⑨ 的欄位傳遞）全部轉紅。

**主導者獨立複驗**（不採信 agent 回報）：兩專案各查一次 `information_schema.columns`
→ `cat_cols=4`、`bug_cols=2` 皆相符；並額外查 `pg_trigger` / `pg_proc`
→ `leftover_triggers=0`、`leftover_fns=0`（見下方技術債第 3 條）。

#### 由本輪衍生項目的後續狀態

1. ~~**分類的「編輯」（鉛筆）按鈕仍是假成功。**~~ → **已完成**
   （`9829f12`／`a36cb71`）。服務／商品分類 modal 已把名稱、說明、啟用狀態
   經 service 寫入 `PUT /api/{service,product}-categories/:id`；
   `category-edit-modal.28.test.ts` 逐欄驗證同時修改、單欄修改、說明清空與
   `sortOrder` 不被 modal 路徑誤動。

   ⚠️ **更正（2026-08-25，主導者）**：本節下文一度把「同型」擴大解釋成
   **新增與刪除**兩頁也都有缺陷，並據此發了派工單。實測不成立——商品頁的
   新增與刪除在 `c9e04f9` 就已經是 await-first，只有服務頁是舊寫法。
   執行者拒絕為了對齊派工單而重寫已經正確的程式碼，是對的。
   **教訓：「A 頁有這個問題，B 頁應該同型」是假設不是事實，寫進派工單前要先 grep。**
   當時把 `active` 變成真欄位卻尚未接編輯曾短暫提高誤導性；上述後續 commit
   已收斂這個「補了一半」缺口。本段保留作為稽核教訓，不再列為 open blocker。
2. ~~**回報問題的截圖上傳**~~ → **已完成**（issue #30，commit `c6d99b0`，見 §6.7）。
3. **⑧ 第三分支（`restoreSideEffectFailed`）在 CI 會 skip，不是假綠。**
   該分支純資料無法誘發（`coupons` / `products` 上無任何 check/trigger 可違反），
   測試改用 Management API 在 **TEST 專案**臨時裝一個只對哨兵名稱 raise 的
   trigger、`finally` 拆掉，因此需要 `SUPABASE_ACCESS_TOKEN`，而 CI 的
   `.env.test` 沒有這個 token。
   **這一格目前的證據是沙箱實跑，不是 CI 綠燈**——差別要講清楚，
   否則下一輪稽核會把它當成已被 CI 覆蓋。要讓 CI 也涵蓋，需要把 Management
   API token 加進 repo secrets（⚙ 只有擁有者能做）。
### 6.5 issue #27（LINE 對外行為三件）— 2026-08-25 完成（commit `38e714f`）

| 項 | 關鍵證據 |
|---|---|
| ① ai-settings 走對端點 | `tests/integration/api/ai-settings.27.test.ts:「⚠️ webhook 送一則顧客訊息 → mock LINE 收到的訊息不含提示詞任何一段」` |
| ② 預約 MODIFIED 通知 | `bookings-modified.27.test.ts` 五案：開→push+額度-1／**只改備註→零 push**（§8.7）／改人員→有 push／關→零 push 仍 200／額度用盡→零 push 仍 200 |
| ③ 商品訂單 LINE/Email | `product-order-notify.27.test.ts` 六案，含未綁 LINE→走 Email 且**額度不變**、寄信失敗→回 `FAILED`（不報成 EMAIL） |

三次變異測試全部轉紅並已還原（`grep -rn "MUTATION"` 零殘留）。
主導者補跑 `npm run build` → 通過（agent 依指示未跑，見下方「唯一沒被 build 驗過的環節」）。

#### 值得記錄的一個測試設計：對照組

①的關鍵測試斷言「mock LINE 收到的**不是**提示詞原文」。這種**否定式斷言**有個
先天弱點——如果那條路徑根本不會回訊息，斷言也會通過，測試就變成綠色的謊。

執行者為此在同一個 describe 補了對照組：
`「對照組：把提示詞塞回 line.defaultReply（＝修好前的存法）→ 顧客真的收到提示詞原文」`，
刻意重現病徵並斷言 `reply === PROMPT`。

**這個手法值得推廣**：凡是「斷言某件壞事沒有發生」的測試，都應該配一個
「讓那件壞事發生、證明測得到」的對照組。否則無法區分「修好了」與「這條路
根本沒被走到」。

#### 執行者做出的兩個判斷（主導者已認可）

1. **`strictMode` 不只存起來，還接上了 webhook 分支 ⑤。** 理由：開關說明
   「開啟後…AI 完全不回覆」是一句**行為承諾**，只存不執行等於換一種方式說謊。
   判準逐字對應說明文字的四類（純數字／亂碼符號／單字／≤3 個英文字母），
   刻意不做語意判斷。
2. **未訂閱時的文案改了。** `PUT /api/ai-settings` 依 09 §7.1 帶 `requireFeature`，
   未訂閱回 403。接上專用端點後，原句「此頁設定**可以儲存**但不會生效」立刻
   變成假的已知（使用者照它按下去只會拿到紅色的儲存失敗），改為「此頁的設定
   也無法儲存（送出會被擋下）」。
   ⚠️ 這是**修好一件事會讓旁邊一句話變成謊言**的例子——同一輪裡必須一起處理，
   否則就是用新的假成功換掉舊的。

#### 唯一沒被 build 驗過的環節（已補驗）

`src/services/products.ts` 用 `import type` 從 `@/server/line-notify` 取型別。
`isolatedModules: true` 且未設 `verbatimModuleSyntax` → 型別匯入會被完全抹除，
不會把 server 程式碼帶進 client bundle。執行者依指示未跑 build，只有靜態推論；
**主導者已補跑 `npm run build` 通過**，這一環節現在有輸出佐證。

#### 由 §8.10 通則掃出、尚未處理的三處文案

| 檔案:行 | 原文 | 判定 |
|---|---|---|
| `src/i18n/zh-TW/pages/calendar.ts:113` | `notified: '，已通知顧客'` | 明確違反 §8.10，與修好前的 bookings 同型 |
| `src/i18n/zh-TW/pages/feature-store.ts:151` | `…（已通知平台處理）` | **捏造的已知**——主導者已查證 `restore/route.ts` 全檔零通知程式碼。店家被告知「平台已知道」，實際沒有任何人被通知，於是店家不會主動回報，問題就此消失 |
| `src/i18n/zh-TW/pages/tour-orders.ts:124` | `…旅客會收到 LINE 通知。` | 確認視窗的未來式；`/api/tour-orders/**` 路由樹可能整個不存在（屬 #8） |

已排除的非違規：`campaigns.ts:209`（§8.6 明令保留，缺的是實作不是文案）、
`register.ts` / `forgot-password.ts`（「驗證碼已發送」＝已送出，合規）、
`settings.ts` 的開關說明（描述功能，非事實主張）。

### 6.6 issue #5（關鍵字回覆頁接線＋Rich Menu 覆蓋）— 2026-08-25 完成（commit `faa7c22`）

#### 最重要的數字：**18 格 Rich Menu，修改前有 14 格按下去完全沒反應**

Rich Menu 的六格是 **message action**——顧客按下去等於在聊天室送出一段文字。
那六段來自 `MODE_PRESETS[businessType].richMenuCells`，三種業態共 18 段。
修改前 webhook 只比對 **4 個字面值**，而且 `'行程'` 是一個**空的 if 區塊**（進去了什麼都不做）。

| 業態 | 修改前認得的格數 |
|---|---|
| LOCAL_SHOP | 2 / 6（「預約」還要該店有 active 服務才回） |
| GUIDE | 0 / 6 |
| CLINIC | 2 / 6 |

**GUIDE 業態一格都不通**——嚮導把選單發布給顧客，顧客按任何一格都石沉大海。
這件事沒有任何測試會發現，因為 rich menu 的建立與 webhook 的回應分屬兩個模組，
中間那條「選單送出的文字 → webhook 認不認得」從來沒有人測過。

現在 18 格全部由整合測試**逐格打 webhook** 斷言「有回覆且不等於 defaultReply」，
並用 `for…of MODE_PRESETS[bt].richMenuCells.entries()` 程式化列舉——
日後有人在 `modes.ts` 加一格卻忘了加 handler，測試會直接紅。

#### 一個新的假成功型態：**引用不存在的測試檔**

WIP `9ccb873` 寫好的 ②④ 分支，註解裡引用了
`tests/unit/line-keyword-coverage.test.ts` 當作它的覆蓋證據——
**那個檔案根本不存在**。

這是 15 分冊 §2 禁止的「假的已知」在**程式碼註解**裡的變體：註解宣稱有測試把關，
讀 code review 的人看到那行就不會再追。執行者把那個檔案真的寫出來（81 案），
並補了 33 案整合測試把 WIP 的實作釘住。

⚠️ **值得列入日後稽核清單**：註解裡出現 `tests/...` 路徑時，去確認那個檔案存在
且真的涵蓋所宣稱的東西。這種寫法成本極低、極難察覺，而且**看起來比沒有註解更可信**。

#### 執行者做出的兩個設計判斷（主導者複核通過；**擁有者尚未裁決**）

⚠️ 「主導者複核」的意思是：主導者讀過執行者的推導並認為成立，**不等於擁有者裁決**。
兩者的效力不同——擁有者裁決記在 §8，不可翻案；主導者複核是工程判斷，
日後有更好的理由可以推翻。下面兩條屬後者。

1. **18 段走「系統內建」（分支 ④，webhook 寫死），不走 `keyword_replies` 表。**
   依據 06 §3 分派表：② 是店家自訂、④ 是內建指令，而 richMenuCells 是**平台**
   發布的預設選單，不是店家輸入的內容。走 ② 會變成每家新店都得先手動建 6 筆
   才有反應。店家仍可用同名自訂關鍵字覆蓋（② 早於 ④，已有測試）。
2. **系統關鍵字的停用存在 `tenant_settings.line.systemKeywordGroupsDisabled`**，
   走既有的 `PUT /api/settings/line`，不需 migration（與 `ai.strictMode` 同一手法）。
   **0019 仍未使用，留給下一位。**

#### 待決策：未訂閱 KEYWORD_REPLY 時，「停用」設定存得下但不生效

目前 `isSystemGroupDisabled` 內有 `isFeatureActive` 把關，所以未訂閱的店家
**關掉開關、看到「已儲存停用設定（尚未生效…）」，顧客那邊照樣有回應**。
文案有講，所以不是假成功；但商業行為本身需要確認。

⚠️ 主導者的意見：**「關掉某個東西」通常不該需要付費。** 一間停止訂閱的店家
無法讓 bot 閉嘴，在某些業態（例如診所要求對外訊息全部由專人處理）可能造成
真實困擾。建議改為停用設定一律生效、付費閘門只擋「自訂內容」。
但這是收費邊界的商業決定，留給擁有者。

#### 本輪順手發現、已誠實化但需補齊的假介面

關鍵字回覆 modal 的「附加圖片」`<input type="file">` **從來沒有 onChange**——
店家選了檔案完全沒反應。而 webhook 端其實早就會送 IMAGE 訊息、service 也會依
`imageUrl` 決定 `replyType`，**缺的只有上傳這一段**。
本輪照 `SupportChatWidget` 與回報問題截圖的前例停用欄位並在畫面上說明尚未建置。
補齊需動 `/api/upload` 的 bucket 白名單，可能還要新 bucket——而 bucket 的公開性
與保留期限仍卡在 §8.12 的未決事項。

### 8.13 「服務項目／預約管理」是**父層級概念**，三種模式各有自己的子層級

擁有者 2026-08-25 的架構定義（原話）：

> 服務項目和預約管理這兩個應該是同一個父層級，按照三種模式使用三種子層級，
> 例如嚮導就是行程相關，醫院目前還沒設計。其他功能有關係到服務時，應該是連結
> 到父層級的服務項目，例如 line 回覆設定等等。

| 父層級 | LOCAL_SHOP | GUIDE | CLINIC |
|---|---|---|---|
| **目錄**（賣什麼） | 服務項目 `/tenant/services` | 行程與方案 `/tenant/trips` | 診療項目 `/tenant/services`（**子層級尚未設計**，暫借 LOCAL_SHOP 的實作） |
| **訂單**（誰買了） | 預約列表 `/tenant/bookings` | 團次訂單 `/tenant/tour-orders` | **預約列表** `/tenant/bookings`（同上） |

⚠️ **本表初版把 CLINIC 的訂單寫成「掛號列表」——那是錯的**（主導者的筆誤，執行者
在 issue #29 施工時查出來）。`nav.ts` 的 `navByMode.CLINIC` 只覆寫了 `services`
（→ 診療項目），**沒有覆寫 `bookings`**，所以診所目前看到的就是「預約列表」。
要改成「掛號列表」等於動診所的側邊欄文案，那屬於**尚未設計**的 CLINIC 子層級
（見下方規則 4），因此**維持現狀並如實記錄**，不在 §8.13 這一輪動它。

這件事本身就是本分冊反覆講的東西的一個實例：**表格裡寫一個沒有查證過的值，
它就會被下一個人當成規格。**

⚠️ **這不是要合併資料表。** CLAUDE.md 明訂 `services` 與
`trips`/`trip_plans`/`trip_departures` 是兩套不同的庫存模型、不得合併。
本節講的是**導覽與跨頁引用**：其他功能提到「服務」時，要指向**該租戶當下模式的
那一頁**，而不是寫死指向 `/tenant/services`。

> ✅ **現況已更新（2026-08-25，commit `23f732f`）：下面這張「零個呼叫端」的表已經
> 不是現況。** 表列的 11 處寫死連結與 5 處寫死文案全部改走 `catalogHref` /
> `ordersHref` 與 `{catalog}` / `{orders}` / `{navBooking}` 佔位符，並加了靜態鎖與
> 三模式瀏覽器實測。逐處對照、變異測試與殘留項見 **§6.11**。下表**保留原文**作為
> 當時的盤點紀錄，不要拿它當現況讀。

#### 現況：抽象層已經存在，但**零個地方在用**

`MODE_PRESETS` 早就定義了 `catalogHref` / `ordersHref`（`src/config/modes.ts:25,27`），
三種模式的值也都填好了。但 `grep -rn "catalogHref\|ordersHref" src/`
扣掉定義處之後——**一個呼叫端都沒有**。有人設計了這個抽象層，從來沒接上去。

於是嚮導租戶會被導去自己選單裡根本沒有的頁面：

| 位置 | 寫死指向 | 嚮導按下去會怎樣 |
|---|---|---|
| `dashboard/page.tsx:149` 快捷「新增預約」 | `/tenant/bookings` | 該頁在他的 `hiddenNavKeys` 裡 |
| `dashboard/page.tsx:152` 快捷「服務項目」 | `/tenant/services` | 同上 |
| `dashboard/page.tsx:425` 開店步驟 step1 | `/tenant/services` | 同上 |
| `dashboard/page.tsx:616/624/703/799` 預約統計卡 | `/tenant/bookings` | 同上 |
| `calendar/page.tsx:318/572` | `/tenant/bookings` | 同上 |
| `product-orders/page.tsx:539/593` | `/tenant/bookings` | 同上 |

文案側同樣寫死：`feature-store.ts:210` 寫「側邊欄 → 預約管理」、
`payment-methods.ts:86` 寫「到『服務項目』把服務設為」、
`staff.ts:101/105` 寫「可承接的服務項目」（嚮導的員工是導遊、承接的是行程）。

#### 一個已經被發現、但只修了一處的前例

`src/i18n/zh-TW/pages/dashboard.ts:53-54` 的註解寫著：

> 嚮導的目錄是行程而不是服務項目，員工是嚮導，沿用預設會叫他去「設定服務項目」
> ——那一頁在嚮導模式的選單裡根本不存在。

有人在做開店步驟時發現了這件事，用 `byMode()` 修掉那一處，**但沒有回頭找同類**。
這正是 §7 講的「補了一半」——修掉看得見的那個，留下十幾個同型的。

#### 規則（往後一律照這個走）

1. 任何跨頁連結指向「目錄」或「訂單」時，**一律走 `MODE_PRESETS[businessType].catalogHref` /
   `.ordersHref`**，不得寫死 `/tenant/services` 或 `/tenant/bookings`。
2. 文案提到目錄／訂單的**名稱**時，走 `navLabel(key, businessType)`，不得寫死
   「服務項目」「預約管理」。
3. 頁面自己的檔案內連到自己（例如 services 頁內部的錨點）不受此限。
4. **CLINIC 的子層級尚未設計**，目前暫借 LOCAL_SHOP 的 `services`/`bookings` 實作，
   僅換 nav 標籤（'診療項目'）。這是**已知的暫定狀態**，不是漏掉——真正的診所
   目錄模型（診療項目 vs 醫師排班 vs 看診進度的關係）待設計。

### 8.14 回報問題的截圖上傳 → **現在就補**（擁有者裁決）

不停留在「停用＋說明尚未建置」。需要新 bucket ＋ `bug_reports` 附件欄位 ＋
端點契約，另開 issue 處理。

### 8.15 `previewImageUrl` 超出 LINE 的 1 MB → **加 `sharp` 產真正的縮圖**（不壓上傳上限）

`src/app/api/chat/messages/route.ts` 與 `src/app/api/marketing/pushes/[id]/send/route.ts`
都把**同一個 URL 同時當 `originalContentUrl` 與 `previewImageUrl`**，但 LINE 對這兩個
欄位的大小上限不同（[Messaging API reference — Image message](https://developers.line.biz/en/reference/messaging-api/#image-message)）：

| 欄位 | 上限 |
|---|---|
| `originalContentUrl` | 10 MB |
| `previewImageUrl` | **1 MB** |

而 `/api/upload` 的 `MAX_BYTES` 是 5 MB → **1–5 MB 的圖已超出 preview 規格**，
手機拍的照片幾乎都落在這個區間。

**裁決：上傳時同時產一張 ≤1 MB 的縮圖，`previewImageUrl` 指向它、`originalContentUrl`
指向原圖。** 不採用「把上傳上限壓到 1 MB」——LINE 本來支援到 10 MB，壓下去等於店家
不能傳手機原圖，是用刪除代替補齊。

#### 主導者查證：`sharp` 的相容性風險**不存在**（原本評估過度保守）

提案當時把「需新增原生相依、要確認 Vercel 相容性」列為代價。實際查證後：

- **`sharp` 0.34.5 已經在 `node_modules` 裡**——它是 `next@15.5.23` 的相依
  （Next 用它做 image optimization），所以**它本來就在 Vercel 的執行環境跑著**。
- 沙箱實測通過：2000×1500 的 JPEG 縮成 1024 寬，17894 → 4877 bytes。

所以真正的動作不是「引入一個新套件」，而是**把它從隱性相依轉成顯性相依**：
加進 `package.json` 的 `dependencies`（版本對齊目前已裝的 0.34.5，避免拉到不同的
原生二進位）。理由是**不要依賴別人的內部相依**——Next 哪天換掉 image optimization
的實作，我們的縮圖就會無聲壞掉，而那種壞法（縮圖沒產出→preview 超規→LINE 顯示異常）
正好是最難察覺的一種。

### 8.16 未訂閱 KEYWORD_REPLY 時的「停用系統關鍵字」→ **一律生效**

改為：**停用設定一律生效，付費閘門只擋「自訂內容」**（店家自己編一組新的關鍵字回覆）。

現況是 `isSystemGroupDisabled` 內有 `isFeatureActive` 把關，所以未訂閱的店家關掉開關後
**顧客照樣收到自動回覆**（文案有講，所以不是假成功，但行為本身不對）。

**為什麼**：「關掉某個東西」不該需要付費。一間停止訂閱的店家沒辦法讓 bot 閉嘴——
在診所這種要求對外訊息全部由專人處理的業態，這不只是體驗問題，可能是**合規問題**。
收費應該擋的是「多做一件事」（自訂內容），不是「少做一件事」（關掉內建回覆）。

⚠️ 連帶要處理的：頁面的 `subscribeNote` 文案目前是照舊行為寫的（「已儲存停用設定
（尚未生效…）」）。閘門改掉之後那句話立刻變成假的已知——**同一輪必須一起改**，
否則就是用新的假成功換掉舊的（§6.5 記過同型的事）。


### 8.13-b CLINIC 的名詞尚未統一（issue #29…22170 tokens truncated…一整套呼叫寫法。**

執行者列出了他試過的 7 種搜尋方式，並驗證了本專案的架構前提
（`src/app/tenant/**` 與 `src/components/**` 零 `fetch(`、`src/services/*` 幾乎無動態路徑拼接），
才敢說字面量掃描在本專案是完備的。**「查不到」這個結論的可信度，取決於你查過幾種方式**——
所以那份清單本身就是證據的一部分。

### 10.4 下一輪還沒掃的方向

1. 只驗「有沒有呼叫端」，**沒驗「呼叫得對不對」**（method／body／回傳欄位是否相符）——§9.4 第 1 點仍開著。
2. **`src/server/**` 的 exported function 沒有系統性掃過**。FLEX_POPUP 那一支是人工讀檔頭撞見的。
   下一輪應把單位從 route 換成 exported function。
3. **i18n 反向孤兒**：`src/i18n/zh-TW/**` 有多少 key 零引用？那是「文案先寫、功能沒做」的指紋
   （#28 ⑧ 的三句文案就是這型）。
4. **mock 常數的反向孤兒**——**這型最傷**。專掃「頁面直接 `import { MOCK_* }` 而非經 `src/services/*`」
   的每一處：這個模式在 `USE_MOCK=false` 之後不會報錯，只會安靜地繼續顯示假資料。
   本輪已撞見 4 處整頁級的（customers 標籤下拉、campaigns、marketing、block-times）。
5. 測試檔與 `scripts/verify/*` 本輪**刻意不算呼叫端**（測試綠燈正是孤兒的偽裝）。

---

### 10.5 issue #34（全站外框吃寫死常數）— 2026-08-26 完成

§10.2 的那三個值已改為依 `USE_MOCK` 分支，real 分支一律走 `src/services/*`。
端點對照與三態表示法寫在 04 分冊 §S（本輪新增的一節），這裡只記**盤點結果**與
**與原本記載不符的地方**。

#### 查證結論：四個徽章，沒有補任何一支新端點

issue 要求「先查證有沒有既有端點可用，有就接；沒有就補」。查證方式是逐支開檔讀
route 實作（不是 grep 檔名），結果三支有、一支的資料表根本不存在：

| 徽章 | 結論 | 依據 |
|---|---|---|
| `pendingOrderBadge` | 接既有孤兒端點 `GET /api/product-orders/pending/count` | `src/app/api/product-orders/pending/count/route.ts` |
| `pendingBookingBadge` | 接既有 `GET /api/bookings?status=PENDING&size=1` 的 `totalElements` | `src/app/api/bookings/route.ts` 的 `querySchema` 有 `status`，`toPaged()` 回 `totalElements` |
| `unreadChatBadge` | 接既有 `GET /api/chat/conversations` 的 `unread` 加總 | `src/app/api/chat/conversations/route.ts` 已逐對話算 `direction='IN' && read_at is null` |
| `pendingTourOrderBadge` | **不接、也不補** | `find src/app/api -ipath '*tour*'` 只有 `cron/tour-order-expiry`；`tour_orders` 表屬 Phase 8b（issue #8）。查不到就不給值——寫 0 是「已知為零」 |

`setupPercent` 同樣**不需要補**：`GET /api/settings/setup-status` 與
`getSetupStatus()` 早就存在（dashboard 頁已在呼叫），只是外框沒接。
issue 的人工介入點把它寫成「沒有真實來源」，那個前提不成立（詳見 04 分冊 §S 末段）。

`userName` 接 `GET /api/auth/me`，但該端點**沒有姓名欄位**，`auth.users` 也沒存
display name（`register/route.ts:13-34` 的 `bodySchema` 不收姓名，`createUser()`
也沒帶 `user_metadata`）。所以 real 模式顯示的是帳號 email——不從 email 猜一個
像人名的字串，那會是「貌似合理的佔位值」。

#### 三態：這一輪真正的收穫是「載入中」

徽章只有 `count > 0` 才畫，所以**「還在查」與「查到 0 筆」在畫面上長得一模一樣**。
0 是一個有意義的答案，拿它當「還不知道」會誤導——與 §6.14 抓到的「明細還在載入卻
寫『無資料』」同型。處置：`counts === null`（尚未載入）時，在徽章位置放一顆
「查詢中」占位（`CountBadgeLoading`），查完才換成數字或什麼都不放。

實測有把這一段拉長來看：把 `/api/bookings` 延後 4 秒，斷言查詢期間畫面上
**一個數字徽章都沒有**（`scripts/verify/appshell-shell-values.34.cjs` 檢查①）。

#### §10.4 第 4 點的清單有兩處與程式碼不符（更正，不是補充）

那一點寫「本輪已撞見 4 處整頁級的（customers 標籤下拉、campaigns、marketing、
block-times）」直接 `import { MOCK_* }`。逐檔查證：

- `customers/page.tsx` — 屬實（`import { MOCK_CUSTOMERS } from '@/mock'`）。
- `campaigns/page.tsx`、`marketing/page.tsx` — import 的是 **`byMode`**，不是
  `MOCK_*` 常數；假資料是頁內宣告的（`CAMPAIGNS_LOCAL_SHOP` 等）。病是同一個，
  但**字面掃 `MOCK_*` 抓不到它們**。
- `block-times/page.tsx` — **沒有任何 `from '@/mock'`**，它的假資料是頁內
  `const MOCK_BLOCK_TIMES`。同樣抓不到。

這件事本身就是 §10.3「『查不到』的可信度取決於你查過幾種方式」的續集：
**掃描條件寫成 `MOCK_*` 具名 import，就只會看見一種寫法的地雷。**
因此靜態鎖（`tests/unit/mock-import-lock.34.test.ts`）分成兩層，並在檔頭
誠實寫明**沒有覆蓋到的**是哪一類（頁內自行宣告的假資料常數）。

#### 白名單與歸屬（沒有歸屬的不准進白名單）

| 位置 | 為什麼還留著 | 歸屬 |
|---|---|---|
| `src/components/layout/AppShell.tsx`（`MOCK_TENANTS`） | 示範店家清單，有明確的 `USE_MOCK`／`demo` 分支 | #34（本 issue 建立分支；示範店家是刻意設計，長期保留） |
| `src/app/tenant/customers/page.tsx`（`MOCK_CUSTOMERS`） | 標籤下拉直接從假顧客推導 | #7（營運頁接線批次） |

`BusinessTypeContext.tsx` 原本用 `MOCK_TENANTS[0]` 當 context 預設值，本輪順手改成
空店家：預設值只有在沒有 Provider 時才讀得到，那種情況該顯示空白，不是一家假店。

#### 尚未歸屬（本輪盤出，需要一個 issue）

`byMode()` 頁內假資料裡有三處是**「假欄位混在真資料列裡」**，比整頁假資料更難發現，
而且目前沒有任何 issue 認領：

- `bookings/page.tsx` `BOOKING_EXTRAS_*`（「已收金額」——schema 沒有 `paid_amount`，
  §6.14「沒有做的事」已記，但沒有 issue）
- `coupons/page.tsx` `COUPON_EXTRAS_*`
- `membership-levels/page.tsx` `LEVEL_EXTRAS_*`

其餘 `byMode` 使用處都有歸屬或有分支：campaigns／marketing／staff／shop-design／
customers 屬 #7；dashboard（`showSampleData` 分支）、services 與 recurring-bookings
（service 的 mock 分支回 null 時才用頁內資料）屬正常用法。
靜態鎖對這一層只做**盤點快照**（再長出新的一處就紅），**不是核可**。

---

## 附錄 X — issue #7（乙）前半六頁接線紀錄（2026-08-26）

> 只新增，不重排既有段落。本節記的是 §1 A-1 清單裡屬於這六頁的那幾條怎麼修的，
> 以及**修的過程中查證出來、與既有敘述不符的事實**。
>
> **狀態同步（2026-08-31，基準 `441d0de`）：本節是未合併工作樹的歷史紀錄，
> 不是目前主線的完成證據。** 目前主線的 `customers`、`block-times`、`points`、
> `staff`、`shifts`、`shop-design` 頁面仍以 §1 A-1 的 `[ ]` 為準；issue #7
> 的接線若未出現在目前 `src/`，不得依本附錄宣稱已完成。

### X.1 六頁的鏈路（DoD 10）

| 頁 | 頁面 handler | services 函式 | 端點 |
|---|---|---|---|
| customers | `CustomerFormModal.submit` | `createCustomer` / `updateCustomer` | `POST /api/customers`、`PUT /api/customers/:id` |
| customers | `BindLineModal` 載入 / `bind` | `listUnboundLineUsers`（**chat 服務**）/ `bindCustomerLine` | `GET /api/line-users/unbound`、`POST /api/customers/:id/bind-line` |
| customers | 解除綁定 `ConfirmModal.onConfirm` | `unbindCustomerLine` | `POST /api/customers/:id/unbind-line` |
| block-times | `load` / `BlockTimeModal.submit` / 刪除 `onConfirm` | `listBlockTimes` / `createBlockTime`＋`updateBlockTime` / `deleteBlockTime` | `GET|POST /api/block-times`、`PUT|DELETE /api/block-times/:id` |
| points | `TopupModal.submit` | `requestPointTopup` | `POST /api/points/topup/pay`（回 501） |
| staff | `StaffTermModal.submit` | `saveTenantSettings` | `PUT /api/settings`（`basic.staffTerm`） |
| shifts | `WeeklyScheduleModal.submit` | `repeatShiftCycles` → `saveShifts` | `POST /api/shifts/repeat-cycle`、`POST /api/shifts` |
| shifts | 模式切換 `ConfirmModal.onConfirm` | `saveTenantSettings` | `PUT /api/settings`（`business.staffScheduleModes`） |
| shop-design | `save` | `saveTenantSettings` | `PUT /api/settings`（`branding`） |

### X.2 接線時查出來、與既有敘述不符的事

1. **`/api/points/topup` 不存在**，端點是 `/api/points/topup/**pay**`。§1 A-1 與
   issue #7 的表格都寫成前者；照著打會拿到 404，畫面顯示的就變成「找不到」，
   而不是規格要的客服提示。
2. **`branding` 群組不存在**。`src/config/tenant-settings.ts` 開頭的分組對照表
   從一開始就寫著 `branding → /tenant/shop-design`，但 `tenantSettingsSchema`
   沒有這個群組、`tenant_settings` 也沒有這個欄位。本輪補
   migration `0021_tenant_settings_branding`（兩個 Supabase 專案皆已套用並以
   `information_schema.columns` 驗證）。
3. **`listUnboundLineUsers` 早就存在於 `src/services/chat.ts`**（聊天室頁在用）。
   customers 頁接線時若照 issue 敘述另寫一份，就會有兩份同名同語意的函式。
   已改成共用既有那一支。
4. **`block_times` 沒有循環／整天／名稱＋原因兩欄**。原站的封鎖時段表單有
   「每週」循環與「原因」欄，我們的表只有 `staff_id/start_at/end_at/reason`。
   本輪**沒有**擴表，理由見 X.3。

### X.3 block-times 的「每週循環」為什麼標成尚未支援，而不是補欄位

補一個 `recurrence` 欄位是容易的；難的是**讓它真的擋住預約**。
`/api/bookings/available-slots` 與 `/api/calendar` 都是照 `start_at/end_at`
做區間過濾，不認得任何循環規則。只加欄位的話，店家會存到一筆「每週二公休」，
系統照樣接受週二的預約——那是比整頁假資料更糟的一種假成功（有寫入、看得到、
但沒有效果）。因此本輪的處理是：表單裡照實說明尚未支援（`t.form.weeklyUnavailable`），
單次封鎖則完整接上。要做循環，得連同可預約時段的計算一起改，屬另一個 issue。

同理，`shifts` 的休息時間與備註（表沒有這兩欄）、`block_times` 的第二個文字欄
（表只有一個 `reason`），本輪一律改成 UI 上講清楚或移除，不留「打了字但不會存」的欄位。

### X.4 順手修掉的三個「捏造的已知」（都在這六頁上，且都會被店家當成事實讀）

- `block-times`：`BUSINESS_HOURS = { open:'10:00', close:'21:00', … }` 寫死，
  驗證訊息會對店家說「開始時間不能早於營業開始時間（10:00）」——那個 10:00
  與他自己設的營業時間無關。改讀 `/api/settings`；查不到就不做這組檢查。
- `shifts`：同型的 `BUSINESS_HOURS = { start:'10:00', end:'20:00' … }`，而且不只
  用來驗證，還直接印在格子的 tooltip 上（「營業時間 10:00–20:00」）。同樣改讀設定。
- `customers`：`AUTO_CREATED_CUSTOMER_IDS = new Set(['c_2'])` 被拿來在列表上掛
  「自動建立檔案」徽章，以及未綁定清單的 `ORPHAN`／`AUTO_CREATED` 兩種 kind——
  三者都沒有任何資料來源。已刪除（查不到的狀態就不顯示）。

### X.5 文案層面改掉的幾句「承諾了沒發生的事」

| 位置 | 原文 | 為什麼不成立 |
|---|---|---|
| points 儲值 modal | 「支援信用卡 / Apple Pay…」「將導向藍新金流安全付款頁面」 | 端點一律回 501，平台沒有接任何金流 |
| staff 自訂稱呼 | 「此稱呼會套用到後台、公開預約頁、LINE 與通知信」 | **沒有任何地方讀 `basic.staffTerm`**；後台走 `navLabel/MODE_PRESETS` |
| shifts 週排班 | 「儲存後本週與未來各週都會套用」 | 後端沒有「週規則」，只有一天一列的 shifts，實際只套用到目前檢視區間 |
| shifts 班表 modal | （只在程式註解裡寫「休息／備註不在 API 契約內」） | 註解保護的是下一個工程師，被誤導的是店家 → 移到畫面上 |
| shop-design 相簿 | 「圖片已新增／圖片已刪除」 | 只改草稿，要按「儲存」才寫入 |
| customers 綁定清單 | 「以下是綁定異常的 LINE 用戶（…顧客已被刪但 LINE 殘留）」 | 端點只回「已加好友且尚未綁定」一種列 |

### X.6 本輪**沒有**處理、留給後續的（誠實列出）

- `shifts/page.tsx` 的 `MOCK_LEAVE_BY_KEY`（格子 tooltip 的「請假中」）與
  `MOCK_BLOCKED_DATES`（「店休」底色）仍是頁內假資料，鍵是 `s_2`/`s_3` 這種
  骨架 id，真實模式永遠對不上，所以不會顯示錯的東西，但它們也**不會顯示對的東西**
  （真的請假／真的封鎖不會反映在班表格子上）。`/api/staff/:id/leaves` 與
  `/api/block-times` 都存在，接得起來，但不在 issue #7 這一列的範圍。
- `customers` 頁的標籤下拉仍由 `MOCK_CUSTOMERS` 推導（`/api/customers/tags` 存在未用）。
  這一條在 §10.4 的白名單裡歸屬 #7，但 issue #7 的表格沒有列它，本輪未動。
- `block-times` 的「每週循環」（見 X.3）。


---

## 附錄 Y — issue #7（乙）後半四列接線時實測抓到的三件事（2026-08-26）

> 與上面的「附錄 X」是同一個 issue 的另一半（marketing / campaigns / portfolio /
> rich-menu-design 背景圖），由另一位執行者同時進行。只新增，不重排既有段落。
>
> **狀態同步（2026-08-31，基準 `441d0de`）：本節保留作為未合併工作樹的歷史
> 記錄，不是目前主線的完成證據。** 目前主線仍以 §1 A-1 的 `[ ]` 為準：
> `campaigns` 頁仍使用 `CAMPAIGNS_*`／`setTimeout` 假資料，rich-menu 背景圖
> 「上傳圖片」按鈕仍無 `onClick`；不得把本節的接線描述當成已落地功能。

接線 `marketing` / `campaigns` / `portfolio` / `rich-menu-design 背景圖` 這四列時，
有三件事與當時手上的敘述不符。三件都是**照著錯的前提做下去就不會有紅燈**的那一類，
記在這裡避免下一輪重犯。

### Y.1 兩句「發布成功」文案在宣稱沒有發生的事（campaigns）

`src/i18n/zh-TW/pages/campaigns.ts` 的兩句成功 toast：

| 舊文案 | 實際 |
|---|---|
| 「活動已發布，**LINE 推播已發送**」 | `POST /api/campaigns/:id/publish` 只把 `status` 從 DRAFT 改成 PUBLISHED，**一則 LINE 訊息都沒有送出**。主動推播是 `/tenant/marketing` 那一頁的事。 |
| 「活動已啟用，**將於對應時機自動觸發推播**」 | 沒有任何東西讀 `content.isAutoTrigger`。生日祝賀與顧客喚回兩支 cron（`src/app/api/cron/birthday-greetings`、`customer-recall`）讀的是 `tenant_settings.notify` 的開關與文案，**從頭到尾不查 campaigns 表**。 |

第二句比第一句嚴重：它是**對一個不存在的排程做出的承諾**，而且要等到「對應時機」
沒發生才會有人發現——那時候沒有人會把它連回這句 toast。

兩句都已改成陳述真正發生的事（發布＝顧客在 LINE 查得到），並在 i18n 註記禁止復原。
發布的真實效果由 `tests/integration/api/campaigns.07.test.ts` 從顧客那一端驗證。

⚠️ 這一則的通則：**「發布」這個動作的成功訊息，要描述「顧客那邊會發生什麼」，
不是「我們這邊改了哪個欄位」。** 兩者剛好都能寫成一句自信的中文，但只有前者
是使用者關心、而且驗得出來的。

### Y.2 `/api/upload` 的「零真實用戶」已經過期（08 分冊 Phase 7 重開理由）

08 分冊 Phase 7 的重開理由寫著「API 測試矩陣全綠但**全 src/ 無任何頁面呼叫它**」。
那句話在 2026-08-24 成立，但在本輪接線之前就**已經不成立**了：`portfolio` 的封面圖、
客服聊天送圖、選單設計 Flex 卡片的圖、回報問題的截圖都已經在呼叫 `/api/upload`
（分別來自 issue #15 / #6 / #28）。

本輪關掉的是重開條件點名的**那一顆按鈕**（rich menu 背景圖），不是「第一個真實用戶」。
差別有實際後果：如果照「第一個用戶」的前提去做，會以為整條上傳鏈路都還沒被驗證過，
而實際上該補的只有「這一頁有沒有接上」與「上傳完有沒有存進發布會讀的欄位」。

**重開理由本身也會過期**——重勾之前要重讀一次它敘述的事實，而不是只確認條件達成。

### Y.3 「上傳成功」與「發布會用到那張圖」之間隔著一個沒人驗過的假設

這一列最容易做錯的版本是：按鈕接上 `/api/upload`，拿到 url 後 `setBgUrl(url)`，
toast「圖片上傳成功」。**每一步都是真的，整體仍然是假成功**——因為
`/api/settings/line/rich-menu/create` 的 `loadBackgroundImage()` 讀的是
`tenant_settings.line.richMenuBgImageUrl`，不是發布請求的 body，也不是頁面的 state。
店家會看到上傳成功、發布成功，然後顧客的 LINE 裡是主題色底圖。

所以接線是兩段而不是一段：`uploadImage()` → **`saveLineSettings({richMenuBgImageUrl})`**
→ 才算數。整合測試因此不驗「回 200」，而是比對 mock LINE 在
`/v2/bot/richmenu/{id}/content` 收到的**位元組**是否等於上傳的那張圖，並補一條
「清空設定後再發布 → 收到的不再是那張圖」防止「不管設定是什麼都送同一張」的巧合。

順帶：`/api/upload` 對 `richmenu-assets` 放行到 5 MB，但 LINE 對 rich menu 圖片的
上限是 **1 MB**，且 create 端點是把位元組原樣轉送。頁面因此自己先卡 1 MB——
不卡的話，失敗會被推遲到「發布」那一刻，也就是使用者已經離開這個畫面、
手上不再握著那個檔案的時候。**限制要擋在使用者還能換一張圖的地方。**
## 附錄 Y — issue #35（三頁的「假欄位混在真資料列裡」）盤點與處置（2026-08-26）

> 本節只新增、不改動既有段落。issue #35 的第 1 步是盤點，本節就是那張表。
> §6.14「沒有做的事」記過 `bookings` 沒有 `paid_amount`，那一條**經本輪查證成立**；
> `coupons` 與 `membership-levels` 兩處 issue 內文留空，由本輪盤出。

### Y.1 盤點表（畫面名稱／來源常數／DB 欄位／原站有無）

「原站有無」一律寫成「在 `docs/specs/X.json` 裡（搜不到｜搜到，出處）」——
**搜不到 ≠ 原站沒有**，§9.4 已列出 `docs/specs` 的六個盲區（它只記 DOM 與 JS 字串，
不記 API 回傳欄位形狀，且 JS 生成的 modal 內容整段看不到）。

#### `src/app/tenant/bookings/page.tsx`（`BOOKING_EXTRAS_*`）

| 畫面名稱 | 來源常數 | DB 欄位（本輪前 → 後） | 原站有無（出處） | 處置 |
|---|---|---|---|---|
| 已收金額（列上「（已收 $X）」、詳情「已收金額」、取消／批次取消的退款警語金額、標記付款鈕在「標記尾款已結清／標記已線下收款」之間切換、調價的「已收高於新應付」提醒） | `BOOKING_EXTRAS_*.paidAmount` | **無 → 仍無**（0004 建表無 `paid_amount`，0013 只加 `reminder_sent_at`） | **搜到**：`bookings.json` jsStrings[48] `'>（已收 ${formatMoney(b.paidAmount)}）</span>'`、[88] `'已收金額 ${formatMoney(b.paidAmount)} 高於新應付…'` | **移除＋待裁決**（見 Y.3） |
| 票券折抵 | `BOOKING_EXTRAS_*.couponDiscount` | 無 → **`bookings.coupon_discount`（0022）** | **搜到**：`bookings.json` jsStrings[127] `'票券折抵 ${formatMoney(couponRes.data?.couponDiscount \|\| 0)}'`（原站 **apply-coupon 的回應欄位**；作為預約列/詳情的**持久**欄位在 spec 裡搜不到，detailModal 的 bodyText 是空的、內容由 JS 生成） | **補欄位＋接線** |
| 點數折抵 | `BOOKING_EXTRAS_*.pointsRedeemed` | 無 → **`bookings.points_redeemed`（0022）** | **搜到**：`bookings.json` jsStrings[170] `'點數折抵 ${result.points} 點 = $${result.points}'`（同上，是 apply-points 的**回應**） | **補欄位＋接線** |
| 顧客可用點數（「使用點數」modal 的餘額） | `BOOKING_EXTRAS_*.customerPoints` | **已有 `customers.points`**（0004），只是沒被 `bookings_view` 帶出來 → 0022 補 `customer_points` | 在 `bookings.json` 裡**搜不到**這個欄位名（餘額顯示在 JS 生成的 modal 裡）；但欄位本身是我方既有真實資料 | **純接線** |

#### `src/app/tenant/coupons/page.tsx`（`COUPON_EXTRAS_*`）

| 畫面名稱 | 來源常數 | DB 欄位（本輪前 → 後） | 原站有無（出處） | 處置 |
|---|---|---|---|---|
| 類型（折價／折扣／兌換／加購券） | `COUPON_EXTRAS_*.type` | `coupons.discount_type`（**本來就有**） | **搜到**：`coupons.json` `modals[formModal].fields.type` 四個選項 | **移除常數**（值一直可由真實的 `discountType` 推導，常數是重複資料；移除後畫面不變） |
| 最低消費 | `.minOrderAmount` | 無 → **`coupons.min_order_amount`（0022）** | **搜到**：formModal `minOrderAmount`「最低消費金額」＋詳情 `'<strong>最低消費：</strong>NT$ ${d.minOrderAmount}'` | **補欄位＋接線** |
| 最高折抵 | `.maxDiscountAmount` | 無 → **`coupons.max_discount_amount`（0022）** | **搜到**：formModal `maxDiscountAmount`「最高折抵金額」＋詳情 `最高折抵：` | **補欄位＋接線** |
| 兌換項目 | `.giftItem` | 無 → **`coupons.gift_item`（0022）** | **搜到**：formModal `giftItem`「兌換項目 *」＋詳情 `兌換項目：` | **補欄位＋接線** |
| 每人限領 | `.limitPerCustomer` | 無 → **`coupons.limit_per_customer`（0022）** | **搜到**：formModal `limitPerCustomer`「每人限領數量」（help：不填則每人限領 1 張） | **補欄位＋接線** |
| 🔒 私密票券 | `.privateMode` | 無 → **`coupons.private_mode`（0022）** | **搜到**：formModal `privateMode`「🔒 私密票券」＋列表徽章 `'>🔒 私密</span>'` | **補欄位＋接線** |
| 最近核銷代碼（決定「還原票券（反核銷）」鈕出不出現） | `.lastRedeemedCode` | 無欄位（**由 `coupon_instances` 即時算**，同 issued/redeemed 計數的既有手法） | **搜到**：`coupons.json` 有 `/api/coupons/instances/${redeemUndoTargetId}/unredeem` 與 `｜代碼：${d.code}`（核銷成功訊息裡的**實例**代碼） | **純接線**（`GET /api/coupons` 附掛） |
| 票券代碼（列表票券名稱下方那一行） | `.code` | 無 | 在 `coupons.json` 裡**搜不到**任何「票券層級代碼」——formModal 沒有這個欄位，列表欄位是「票券名稱／類型／折扣／使用期限／已發放／狀態／操作」，`${d.code}` 只出現在核銷成功訊息（那是實例代碼） | **移除**（我方無寫入路徑，留著只會顯示編出來的字串） |
| 適用服務（詳情） | `.applicableServices` | 無 | **搜到（但只有一半）**：詳情有 `'<strong>適用服務：</strong>${d.applicableServices.map(...)}'`，但原站 formModal **沒有任何欄位可以設定它**（全文只有詳情那一處） | **移除**（補一個永遠是空陣列的欄位沒有意義；日後若找到設定入口再補，見 Y.4） |
| 顯示狀態 | `.displayStatus` | 等同 `coupons.status` | — | **收斂成 `status`**（常數從未覆寫它，是別名不是假資料） |

#### `src/app/tenant/membership-levels/page.tsx`（`LEVEL_EXTRAS_*`）

| 畫面名稱 | 來源常數 | DB 欄位（本輪前 → 後） | 原站有無（出處） | 處置 |
|---|---|---|---|---|
| 等級說明（列表名稱下方、表單 textarea） | `LEVEL_EXTRAS_*.description` | 無 → **`membership_levels.description`（0022）** | **搜到**：`membership-levels.json` `modals[levelModal].fields.description`「等級說明」 | **補欄位＋接線** |
| 狀態（啟用／停用徽章、表單 checkbox） | `.active` | 無 → **`membership_levels.active`（0022）** | **搜到**：levelModal `isActive`「啟用此等級」＋ jsStrings `'啟用'` / `'停用'` ＋表格有「狀態」欄 | **補欄位＋接線** |
| 「預設」徽章、表單 checkbox | `.isDefault` | 無 → **`membership_levels.is_default`（0022，每租戶 partial unique index）** | **搜到**：levelModal `isDefault`「設為預設等級（新顧客自動套用）」＋ jsStrings `'>預設</span>'` | **補欄位＋接線** |

### Y.2 三處**不是**同一個解法（issue #35 自己提醒過的事，實測成立）

- `membership-levels`：三個欄位全部「原站有、我方沒有」→ 一致的補欄位。
- `coupons`：**五補、一算、三移除**（見表）。把它當成和 membership-levels 同型會多補
  兩個永遠沒有寫入路徑的欄位。
- `bookings`：**兩補、一接、一移除**，而且移除的那一個（已收金額）是唯一牽涉金額、
  唯一需要裁決的。

### Y.3 待擁有者裁決：**只有一格**——`bookings.paid_amount`（已收金額）

原站的 `b.paidAmount` 來自**線上金流交易**：

- 「確定標記此預約為『已線下收款』嗎？（…標記為已付清；**不會建立線上金流交易**）」
- 「⚠️ 其中 N 筆**已線上收款**（共 $X），系統不會自動退款，請記得至您的金流後台手動退款」
- 「加購後金額提高，此預約已從『已付清』變回『已付訂金』」

我方**整套顧客端線上付款都還沒建**（issue #32；`supabase/migrations/` 沒有任何金流交易表，
`/pay/:bookingNo` 頁不存在），`payment_status` enum 也沒有「已付訂金」。所以補 `paid_amount`
不是接線，而是要先定**訂金／尾款／退款怎麼連動**的業務規則。**不自行發明**，列在此等裁決。

本輪已經做完的、與裁決無關的那一半（拿掉謊言）：畫面上凡是需要「收了多少錢」的地方，
一律改用真的知道的 `payment_status`（已付清／待付款）：

| 位置 | 本輪前 | 本輪後 |
|---|---|---|
| 金額欄「（已收 $X）」 | 頁內常數 | **不顯示**（`labels.received` 已刪） |
| 詳情「已收金額 $X」 | 頁內常數 | **不顯示**（`detailModal.paidLabel` 已刪） |
| 詳情付款徽章 | 已付清／**已付訂金**／待付款 | 已付清／待付款（`payment.deposit` 判定不出來 → 無渲染路徑，字串保留） |
| 取消警語「已線上收款 $X」 | 帶假金額 | 無金額版本（**原站自己**就寫成 `${amt ? …}` 條件式，我方一律走無金額那一支） |
| 批次取消警語「（共 $X）」 | 帶假金額 | 只講筆數 |
| 標記付款 modal 標題 | 假的 `paidAmount>0` 決定「標記尾款已結清」 | 一律「標記已線下收款」 |
| 調價「已收高於新應付」提醒 | 帶假金額 | **不顯示**（`messages.paidOverNet` 保留字串、無渲染路徑） |
| 確認／完成 modal 的付款分支 | 假的 `paidAmount` | `paymentStatus` |

⚠️ 連帶的**測試前提變更**（不是放寬斷言）：`tests/unit/bookings-pay-link.test.ts` 原本要求
`markPaidModal.balanceHint` 指向「標記尾款已結清」。那顆鈕當時看得到，正是因為它吃假的
`paidAmount>0`；假資料拿掉後它沒有任何渲染路徑，再叫店家去按它就是第二個假的已知。
斷言的**意圖**（文案不得指向走不通的路，#28 ②）原封不動，只把路名換成真的存在的
「標記已線下收款」，並在該檔留下說明。

### Y.4 本輪**沒有**處理、誠實列出

- **票券的「加購券」型別（ADDON）存不下來**：`discount_type` enum 只有
  `AMOUNT|PERCENT|GIFT`，頁面 `DISCOUNT_FROM_TYPE.ADDON = 'GIFT'`，選了加購券存檔後
  重新載入會變成兌換券，`addonItem`／`addonPrice` 兩個欄位跟著無處可存。這**不是**
  #35 的「假欄位」（那兩個欄位從來沒有被任何 mode 常數餵過值，一直是預設值），
  但它是一顆會靜默改掉使用者選擇的表單。補它要先定「加購券怎麼折抵一筆預約」，
  屬新的業務規則。
- **票券圖片（`imageUrl`）沒有接線**：`<Input type="file">` 連 `onChange` 都沒有，
  上傳路徑屬 `/api/upload`（issue #7）範圍，本輪未動，也沒有補欄位。
- **票券的 `ENDED`（已結束）狀態**：原站狀態篩選有 `ENDED`（`coupons.json` 的
  `couponStatusFilter`），我方 `coupon_status` enum 只有 `DRAFT|PUBLISHED|PAUSED|EXPIRED`。
  這不是假欄位（`displayStatus` 一直等於真的 `status`），但是一個缺的狀態。
- **`applicableServices` 的設定入口**：見 Y.1 註記。原站詳情有這一行、表單沒有入口，
  可能在 `docs/specs` 掃不到的地方（§9.4 盲區 1／3）。找到入口之前不補欄位。
- **Preview 站實測**：issue #35 驗收清單有一項要求在 Preview 站比對畫面金額與 service role
  直查 DB 的值。本輪依派工單規定**不 push**，Preview 站沒有本輪的程式碼，因此**這一項留白**，
  不打勾。

### Y.5 `active` / `is_default` 的語意是從**原站自己的標籤文字**推導的（待覆核）

`docs/specs/membership-levels.json` 只給了欄位與標籤，沒有給行為。本輪的判斷是：
**把旗標存下來卻不讓它影響任何事，等於做了一顆假開關**，所以照標籤字面實作：

| 標籤（原站逐字） | 本輪實作 |
|---|---|
| 「啟用此等級」 | `recalcMemberships` 只考慮 `active` 的等級（停用的不會被自動升級指派） |
| 「設為預設等級（**新顧客自動套用**）」 | ① `POST /api/customers` 未指定等級時套用該租戶 `is_default且active` 的等級；② `recalcMemberships` 門檻都不符時落到預設等級而非 `null`；③ 設新的預設之前先清掉舊的（每租戶至多一個，0022 partial unique index） |

⚠️ 這是**執行者的推導＋主導者可覆核**的層級，**不是**擁有者裁決、也不是從原站掃描還原的
行為。若日後查到原站另有算法，要改的是算法，欄位本身不用重補。

### Y.6 本輪的 migration 與驗證

`supabase/migrations/0022_page_local_display_fields.sql`，兩個 Supabase 專案皆已套用並各自以
`information_schema.columns` 驗證（輸出貼在 issue #35 的留言）。

實作上踩到的一個坑值得記：`bookings_view` 是 `select b.*, …`，本輪替 `bookings` 加了欄位之後
`b.*` 展開的順序改變，`create or replace view` 會直接回
`ERROR: 42P16: cannot change name of view column "customer_name" to "reminder_sent_at"`，
必須改成 `drop view if exists` ＋ `create view`。drop/create 之後已另外查
`information_schema.role_table_grants` 確認 `anon`/`authenticated`/`service_role` 的 SELECT 權限
仍在（view 是 `security_invoker`，RLS 照舊由底表決定）。

---

## 11. §8.6 被**反向執行**：一條擁有者裁決是怎麼被做成相反的（2026-08-26）

本節記的不是一個 bug，是一個**流程失效**。程式碼修完會被下一輪覆蓋，
這個失效模式不記下來就會再發生一次。

### 11.1 事實對照

§8.6 的原文（擁有者裁決，逐字）：

> ### 8.6 `campaigns` 發布 → **真的推播**，不是改文案
>
> 文案「活動已發布，LINE 推播已發送」保留，`POST /api/campaigns/:id/publish`
> 要補上實際的推播與額度扣減。
>
> **為什麼**：活動發布本來就該通知會員，這是原站有的功能。依「補齊優先於刪除」
> 的方針，**缺的是實作而不是文案**。

issue #7（乙）那一輪實際做的事：

| §8.6 要求 | 實際做的 |
|---|---|
| 端點補上推播與額度扣減 | **沒做**。`publish/route.ts` 到本輪之前仍只有一句 `.update({ status: 'PUBLISHED' })`，零 LINE 呼叫、零額度扣減 |
| 文案「活動已發布，LINE 推播已發送」**保留** | **刪掉**，換成只講可見度的句子，並在原處加註「**禁止復原**」 |

也就是說，一條「補實作、留文案」的裁決，被執行成「刪文案、不補實作」——
方向完全相反，而且加了一道禁止後人修正的註記。

### 11.2 更糟的是只改了一半

同一份字典 `src/i18n/zh-TW/pages/campaigns.ts` 裡，**另外還有六處**在宣稱推播或
自動發放，那一輪一處都沒動：

| 鍵 | 原文 | 本輪處置 |
|---|---|---|
| `confirm.publish` | 發布後將立即推送 LINE 訊息給所有追蹤者 | **保留原句**（實作補齊後成立），補上「會扣額度」「額度不足時活動仍會發布、推播不會送出」 |
| `confirm.publishAuto` | 發布後會於對應時機自動發送 | 改：自動發送**尚未接上**（兩支 cron 不讀 campaigns） |
| `intro.leadTail` | 發布時自動推播…並自動發放獎勵 | 推播那半句保留；「自動發放獎勵」改為尚未接上 |
| `form.couponHelp` | 發布時自動發放票券給追蹤者 | 改：不會自動發券，票券要到「票券」頁手動發放 |
| `form.bonusPointsHelp` | 排程觸發時自動贈送點數 | 改：尚未接上 |
| `form.isAutoTriggerHelp` | 勾選後系統會依排程自動發送獎勵 | 改：勾選真正會發生的事是「不在發布當下群發」 |
| `autoTriggerHint.*` | 生日當天／久未到訪時自動發送票券/點數 | 改：觸發（自動發送尚未接上） |
| `prereq.tail` | 補齊上面的條件後就會開始自動發送 | 改：會開始發送的是 notify 那則文字推播，不是這個活動的票券與點數 |

於是在本輪之前，**確認視窗與成功訊息對同一個動作給出互相矛盾的事實主張**：
按下發布之前畫面說「將立即推送 LINE 訊息給所有追蹤者」，按下之後說「顧客查得到了」，
一個字都不提推播。這比兩邊都錯更糟——兩邊都錯至少是一致的錯，使用者會整體不信；
一真一假則讓使用者無從判斷該信哪一句，而**兩句都是我們自己寫的**。

### 11.3 為什麼會發生

執行者套用了一個**通用模式**：「畫面宣稱了沒發生的事 → 把文案改成誠實的」。
那個模式本身是對的，本專案有一整章在講它（CLAUDE.md「Never fabricate a "known"」）。
問題在**套用之前沒有先查這個功能有沒有既有裁決**——而 §8.6 就寫在同一份文件裡，
標題還直接寫著「**不是改文案**」。

拆開來看是三個判斷都往同一邊倒：

1. **模式比事實先到。** 「假成功 → 誠實化」在那一輪已經套過十幾次，第十幾次時
   它變成了預設動作，而不是一個要先驗證前提的決定。
2. **「補齊」與「刪除」是兩個相反的出口，而預設出口被選成了刪除。**
   擁有者的方針明寫「補齊優先於刪除」；誠實化只是**刪除**那一側的其中一種做法。
   一段假文案至少有兩種修法（補實作／改文案），選哪一種**不是執行者的裁量**。
3. **「禁止復原」把一次判斷寫成了制度。** 那句註記讓下一個讀到它的人以為這件事
   已經定案，反而蓋住了真正的定案（§8.6）。

### 11.4 規則

- **套用任何通用模式（誠實化、刪除死碼、收斂重複實作）之前，先 grep 這個功能在
  §8 有沒有裁決。** §8 是擁有者裁決紀錄，它的效力高於任何模式。
- **「假文案」的修法有兩種，選哪一種不是執行者的裁量。** 沒有裁決時要問，
  不要預設走改文案——改文案是把功能砍掉，只是砍在使用者看得見的那一端。
- **不准在程式碼或文案裡寫「禁止復原」這種擋住後人的註記，除非引用得出裁決出處。**
  本輪那一句就是在沒有查過 §8.6 的情況下寫下的，而它擋的正是 §8.6 要求的事。
  註解可以說明「為什麼現在是這樣」，不可以宣告「以後不准改」。
- **一份字典裡的同型文案要一次改完。** 改了成功訊息卻留著確認視窗，等於製造一組
  互相矛盾的事實主張——**比原本的單向錯誤更難被發現**，因為兩句話分別看都很合理。

### 11.5 本輪的處置（2026-08-26）

- `POST /api/campaigns/:id/publish` 補上真實推播與額度扣減，形狀照抄
  `marketing/pushes/[id]/send`（條件式 update 佔位 → 解析收件人 → `consumePushQuota`
  → `lineMulticast` 每 500 人一批）。收件人＝本店 `followed=true` 的 `line_users`
  ——`campaigns` 表沒有 audience 欄位、`docs/specs/campaigns.json` 也沒有任何受眾概念，
  原站四處文案一律寫「所有追蹤者」，所以這是規格寫出來的，不是我們挑的保守值。
- **設計決定：額度不足時活動照發、推播不送。** 理由與取捨寫在端點檔頭；
  端點回 `{pushed, sentCount, pushSkipReason?, pushErrorMessage?}`，頁面依它顯示
  五種不同的成功訊息，沒送出時絕不顯示「已發送」。
- §8.6 指名保留的那句文案已復原（`messages.published` 以它為首段），
  「禁止復原」的註記一併移除，原處改寫成本節的來龍去脈。
- 測試：`tests/integration/api/campaign-publish-push.8-6.test.ts`（8 案例，反向斷言
  用障壁不用固定秒數）、`tests/unit/campaign-publish-copy.8-6.test.ts`（19 案例，
  釘住「確認視窗承諾的事端點真的會做」）。變異測試：拿掉 `consumePushQuota` → 4 條轉紅；
  拿掉 `lineMulticast` → 7 條轉紅。

---

## 12. 綠燈孤兒 `upload-bg-image` 結案：刪除，守門搬到有流量的那一支（2026-08-26）

§10（第五輪盤點）把 `POST /api/settings/line/rich-menu/upload-bg-image` 列為
綠燈孤兒並要求「刪除或加誠實標註」，兩者一直都沒做。**本輪選擇刪除**，
完整理由記在 06 分冊新增的 §6.1，摘要三條：

1. **接上去會是退步**：它只信 `file.type`，沒有 `/api/upload` 的解碼比對——
   而那道檢查正是為了堵「改名的 WebP 冒充 image/jpeg」（§6.7）。換過去等於把
   已修好的漏洞放回來。所以它不是「還沒接」，是**永遠不該接**。
2. **同一件事兩份實作**是本專案反覆抓到的分岔缺陷家族；它與 `/api/upload` 的
   `richmenu-assets` 分支目標完全相同。
3. 它與 `flex-menu.ts` 的 `FLEX_POPUP` 分支**性質不同**，不適用那種「已實作、
   已測試、刻意尚未被使用」的誠實標註：FLEX_POPUP 是還沒有觸發條件的**未來能力**，
   這一支是已被更好的實作取代的**過去能力**。標註它只會讓下一個人以為還有路可接。

它唯一比 `/api/upload` 強的是 **1 MB 伺服器端守門**（LINE rich menu 圖片上限）。
因為零呼叫端，那道守門從來沒生效過——附錄 Y.3 記的「頁面自己先卡 1 MB」是
**前端**的卡，繞過前端就能塞 5 MB 進去，然後在「發布」那一刻才被 LINE 退回。
所以守門搬進 `/api/upload` 的新 `BUCKET_MAX_BYTES`（`richmenu-assets` → 1 MB，
其餘 bucket 維持 5 MB）。這同時把附錄 Y.3 最後一段點出的落差關掉了。

**順帶更正 §6.8-b 的一列**：「`/api/upload` 的 `richmenu-assets` 分支（5 MB）
同樣零呼叫端」在 issue #7（乙）接線後已不成立——選單設計頁的底圖上傳走的就是它
（`src/app/tenant/rich-menu-design/page.tsx` 的 `uploadBackground`）。
盤點結論會過期，引用之前要重跑一次那條 grep。

---

## 13. 04 分冊補列 `DELETE /api/campaigns/:id`（2026-08-26）

04 分冊 §B-5 的 campaigns 那一列只寫了「GET/POST、PUT `:id`、publish/pause/resume/end」，
**漏了 DELETE**——而端點（`src/app/api/campaigns/[id]/route.ts`）與整合測試
（`campaigns.07.test.ts` 三條刪除案例）在 issue #7（乙）就已經存在。契約表漏列一支
已實作端點，下一個讀契約的人會以為那個功能不存在、或者以為要新寫一份。本輪補上，
同時把 publish 那一列改成明說它會推播與扣額度（見 §11）。

---

## 14. issue #19 結案紀錄：進階設計器 11 支端點 ＋ `flexShowTip`（2026-08-26）

### 14.1 `flexShowTip` 的判定結果（§8.22-b / §8.22-c 結案）

issue #19 要求「做 `booking-step-guide` 時**一併判定** `flexShowTip` 是否屬於步驟引導；
判定得出來就照原站語意做並寫明依據，判定不出來才走預設語意並明標為我們選的」。

**判定結果是「一半判得出來、一半判不出來」，兩半都要照實記：**

**(一) 判得出來——它不屬於步驟引導，屬於 Flex 主選單那一組。** 四條依據，
全部可在 `docs/specs/line-settings.json` 的 `looseFields` 逐字驗證：

| # | 依據 | 步驟引導那七組 | `flexShowTip` |
|---|---|---|---|
| 1 | id 前綴 | 一律 `step*`（`stepServiceColor`…`stepSuccessColor`） | `flex*`，與 `flexMenuEnabledToggle`／`flexMenuFallback*`／`flexHeaderColor/Title/Subtitle` 同族 |
| 2 | CSS class | 14 個欄位全帶 `flex-step-color` / `flex-step-title` | 只有 `form-check-input`，與 `flexMenuEnabledToggle` 相同 |
| 3 | `help` 屬性 | 每個都寫著它屬於哪一步（選擇服務／選擇日期／…） | 空字串，與前一個欄位 `flexHeaderSubtitle` 一致 |
| 4 | 有沒有自己的開關 | 步驟引導**已經有**：`bookingStepGuideToggle`（`docs/specs/rich-menu-design.json:243`），label 完整描述了它控制什麼 | — |

第 4 條特別值得記：主導者當初的推論是「DOM 上相鄰 → 可能是同一區」。相鄰是真的，
但**步驟引導在另一頁已經有一顆有完整說明的開關**了。同一件事在兩頁各有一顆開關、
其中一顆還沒有任何說明文字——證據不支持這個讀法。§8.22-c 已經自己標注過
「位置相鄰只是相鄰，不是證據」，這一輪把它查完了。

**(二) 判不出來——它具體控制什麼文字、出現在哪裡。**
`help` 是空字串；`jsStrings` 全文只有「已設為純文字提示模式」一句含「提示」，
而那句屬於 fallback 模式；沒有任何 card 的 bodyText 提到「顯示使用提示」。
`grep '顯示使用提示' docs/specs/` 全站只命中這一個欄位定義本身。**原站語意救不回來。**

### 14.2 因此採用的語意 —— **這是我們選的，不是還原的**

> ⚠️ 後來的人不要把下面這段當考據結果引用。它是 issue #19 的預設語意
> （擁有者 2026-08-25 裁決 (b)「給它語意並補齊」時一併指定），
> 不是從 `docs/specs` 還原出來的原站行為。

`flexShowTip=true` 時，Flex 主選單 carousel 之**後**多送一則純文字使用提示。
只在 `buildFlexMenuOutcome()` 回 `FLEX` 時生效；`HINT`／`SILENT`／`NO_CARDS` 一律不加。
提示文字在 `src/server/flex-menu.ts` 的 `MSG.usageTip`（對顧客說的話，不進 `src/i18n/`）。
完整理由與「為什麼不插在 carousel 最前面」見 06 分冊 §6.2.10。

**值得記的是：(一) 的判定結果與這個預設語意方向一致**（都落在 Flex 主選單那一區），
所以它是一個**旁證**，不是「反正判不出來就隨便選一個」。但它只支持「屬於哪一區」，
不支持「那句話原本寫什麼」——兩者不可混為一談。

### 14.3 連帶的結構修正：`FlexMenuOutcome` 從單數 `message` 改成 `messages` 陣列

`src/server/line-events.ts` 原本寫死 `lineReply(ctx.token, ctx.replyToken, [outcome.message])`。
留著單數欄位不改，就會出現「開關開了、第二則沒送出去」——**換一種寫法的同一顆假開關**。

守門測試（`tests/unit/flex-menu.06.test.ts`）：
- 「守門：src/ 底下沒有任何程式碼只送 outcome 的第一則訊息」——比對前先剝掉註解，
  因為 flex-menu.ts 與 line-events.ts 的說明文字裡刻意留著這個字串記錄「原本是什麼」。
  連註解一起比會永遠紅，而永遠紅的守門測試遲早會被人放寬掉。
- 「守門：line-events 把整包 messages 交給 lineReply（不是自己挑一則）」。

### 14.4 `booking-step-guide`：存得到，但顧客收不到（新的誠實邊界）

原站的引導卡是「預約 carousel **最前面**那張『👈 往左滑動 ＋ 步驟清單』指引卡」
（`docs/REBUILD-SPEC.md` 的 `bookingStepGuideToggle` label 逐字）。
**本專案沒有那個 carousel**：`src/server/line-events.ts` 的 `replyServiceList()`
對「預約 / 服務 / 服務項目」回的是**純文字服務清單**。

所以設定會被存下來、讀得回來、payload 也過 LINE 驗證，**但顧客端不會因為這個開關
而看到任何變化**。畫面上以 `t.bookingSteps.savedButNotDelivered` 常駐說明這件事。

⚠️ 這是「absence of data ≠ invented data」的同一條線：把設定存起來是誠實的，
顯示「已套用，顧客現在會看到引導卡」則是編造。**端點建好了 ≠ 功能生效了**，
這兩件事在本輪之後仍然要分開講。

### 14.5 `upload-cell-icon`：同型的誠實邊界

圖示會被上傳、存進草稿、下次開頁面讀得回來——但**不會出現在 LINE 選單的底圖上**，
因為本專案沒有影像合成能力（`src/server/png.ts` 只產純色矩形）。
畫面以 `t.cells.iconNotComposed` 常駐說明，成功 toast 也逐字寫出這件事。

圖示**尺寸**下拉維持停用：它至今沒有任何程式碼會讀、也沒有後端欄位。
⚠️ 接了上傳就順手把尺寸也做成「看起來能用」，等於在修假開關的同一輪再造一顆。

### 14.6 `upload-image` 與 §6.1「底圖上傳單一入口」的關係

§6.1（2026-08-26）才剛因為「同一件事兩份實作」刪掉 `upload-bg-image`，而 issue #19
的範圍表要求補 `upload-image`。這**看起來**是直接牴觸，實際不是：

§6.1 反對的是第二份**實作**（它逐字寫的是「短期看起來一樣、長期一定分岔，而分岔
那天沒有任何測試會紅」），不是第二個路徑名。本輪的作法是把 `/api/upload` 的驗證與
落地邏輯抽成 `src/server/upload.ts` 的 `uploadToBucket()`，**三支路由共用同一支函式**
（`/api/upload` 自己也改成呼叫它）。沒有第二份可以分岔的邏輯，1 MB 守門與 MIME
解碼比對三支一體適用。

`upload-image` 多做的那一件事＝它存在的理由：上傳完**順手寫進**
`tenant_settings.line.richMenuBgImageUrl`。發布端點讀的是那個欄位而不是請求 body，
少了這一步，「上傳成功」就只是半個事實。頁面因此從「兩段式」（`uploadImage()` +
`saveLineSettings()`）改成一個請求——兩段式的中間可能只成功一半。

### 14.7 這一輪翻面的守門測試（前提變更，不是放寬）

issue #3／#6 那幾輪為「尚未建置」寫的守門測試，在功能補齊之後會**反過來要求把那句
話拿掉**——否則就變成新的不誠實。本輪據此改寫了下列案例，每一條都在測試檔裡寫明
「原本守什麼、為什麼前提變了、改成守什麼」：

| 檔案 | 原本守 | 改成守 |
|---|---|---|
| `flex-show-tip-honest.test.ts` | 沒人讀 `flexShowTip` → 畫面要說「尚未生效」 | 有人讀了 → 那句話**不得再存在**，且說明要逐字描述真實行為 |
| `honest-not-built-interactions.test.ts` | 草稿／還原／預約步驟三處要顯示「尚未建置」 | 三處都要真的呼叫 service，成功 toast **await-first**，仍為假的部分（草稿≠發布、引導卡送不出去）繼續說 |
| `honest-not-built-rich-menu-design.test.ts` | 範本預覽鈕要跳「沒有預覽可開」；圖示欄位一律停用；success toast 恰好 1 則 | 預覽鈕要呼叫 **preview** 端點且函式內不得出現任何 `create*`；圖示上傳是真的但要說「不會畫進底圖」；**每一則 success toast 前面都必須有 `await`** |
| `honest-not-built-residuals.test.ts` | 發布成功訊息要含「尚未建置」；確認視窗要寫「不會備份、無法還原」 | 成功訊息要點名 Flex／預約步驟**不會一併送出**；確認視窗要寫「會保留還原點，但**只保留最近一份**」 |
| `bug-report-attachment.30` / `upload-line-bound-types` / `line-preview-image.28` / `welcome-card-upload-wiring.28` | 讀 `src/app/api/upload/route.ts` 的常數 | 同樣的常數，改讀 `src/server/upload.ts`（**規則一字未改，只是換了檔案**） |

⚠️ 「success toast 恰好 1 則」那一條的替換值得單獨記：數字守得住「多了一則」，
守不住「那一則是假的」。改成「每一則成功訊息前面都必須有 `await`」之後，
它擋的正是這一整批工作在清的那個缺陷本身，而不是它當時的計數。

### 14.8 順手抓到、與 issue #19 無關的一個既有缺陷

`scripts/test/seed.mjs` 的 `trip_plans` 種子用的欄位名是 `price_per_person`，
而 `0016_tour_domain_core.sql:71` 定義的是 **`base_price`**（兩個 Supabase 專案都查過，
從來沒有 `price_per_person` 這個欄位）。

舊版的 `safeUpsert()` 曾把 PostgREST 的「找不到欄位」誤判成「資料表尚未建立
（Phase 1 未執行）」並靜默跳過 `trip_plans`，接著 `trip_departures` 才炸在外鍵上——
錯誤訊息指向 departures，真正的原因在 plans。這是本次 PB-003 incident 的歷史根因；
目前 `scripts/test/seed.mjs` 已改為必要的 `trip_plans` seed 遇到 schema／資料錯誤就
**fail-closed（直接拋錯）**，不會跳過 plans，也不會繼續嘗試 `trip_departures`。
欄位修正為 `base_price` 後，整合測試才能在正確的資料契約上執行。

⚠️ 值得記的是那個**誤判**：把 A 錯誤當成 B 錯誤靜默吞掉，會讓失敗出現在無關的地方。
這個歷史缺陷已在本候選的 `seed.mjs`／`reset-db.mjs` 中修正：只有可證明的 relation／table 不存在才可略過；缺欄位、缺 function、schema cache 契約不符與其他資料錯誤一律 fail-closed，且必要的父資料失敗時不再寫入依賴它的子資料。

---

## 15. issue #33 ①〜⑤：三方對照剩下的五支端點（2026-08-26）

第五輪「三方對照」（§10）盤出 6 支**原站有、我方沒有、也沒有 issue 認領**的端點。
第 ⑥ 筆 `/api/payment-methods/online-payment-meta` 已併入 #32，本節記其餘五支。
它們的共同根因與 §0「根因 B：計劃漏掉」相同——`docs/REBUILD-SPEC.md` §9.1 的 195 支
清單裡都在，但 `04-API-CONTRACTS.md` 從未把它們收編成契約，於是沒有任何格子可以漏勾。

### 15.1 三支已補齊

| 筆 | 端點 | 契約 | 測試 |
|---|---|---|---|
| ① | `POST /api/product-orders/:id/apply-coupon` | 04 §B-4.1 | `tests/integration/api/product-orders-coupon.33.test.ts` |
| ② | `POST /api/settings/weekly-business-hours/draft` ＋ auto 封鎖鏈 | 04 §A-1.2 | `tests/integration/api/business-hours-draft.33.test.ts` |
| ③ | `GET /api/export/bookings/:format` | 04 §B-6 | `tests/integration/api/export-bookings-format.33.test.ts` |

**兩個「我方選的、不是原站考據結果」的決定**，兩處都在契約與程式碼註解裡標明：

1. **①的票券適用範圍**：原站對「票券能不能用在商品訂單、有沒有品類限制」**零字串**
   （`product-orders.json` 的三句票券文案都沒提，`coupons.json` 的 formModal 也沒有
   「適用範圍」欄位）。採 issue 預設值＝與預約版完全同一套規則（不限品類、只限票券
   持有人本人）。規則集中在 `src/server/coupon-redeem.ts` 一處。
2. **②的乾跑語意**：原站只給路徑與四句文案，**沒有 request/response 形狀**。選「乾跑」
   的依據只有「路徑最後一段是 draft」與「解析逐日營業時間失敗」兩點；**反面證據
   （另外三句是過去式／已存檔語氣）一併記在 04 §A-1.2**，沒有藏起來。

### 15.2 ④⑤ 兩支查證結果：**用途仍判定不出來，因此不實作**

issue #33 要求「判定得出來就做、判定不出來就留言請示」。本輪把兩支都重查了一遍
（`docs/specs/*.json` 的 `jsStrings` / `buttons` / `modals` / `looseFields` / `alerts` /
`headings`、`docs/integration/**`、`src/**`、`REBUILD-SPEC.md`）。

**`/api/settings/onboarding-event`（dashboard 頁）**

issue 只寫了「整份 jsStrings 找不到任何一句可以歸給它」。本輪在 **`buttons[].onclick`**
找到 issue 沒列的三條線索：

- `focusTrack('focus_edit_service')`（「去修改」鈕）
- `focusTrack('focus_open_shop')`（「開啟」鈕）
- `skipFocusCard()`（引導卡的關閉鈕）
- 另有 `dismissCalSyncPromo()`（issue 已提）

再加上 `_tokens.json` 的一整組 `onboarding-*` class（card / header / steps /
progress-bar / progress-fill / complete / close / next-actions）與 `onboardingReadyBanner`
警示條，可以說**這支端點很可能是記錄引導卡的互動事件**（`focusTrack` 是 dashboard
唯一「像 tracking」的函式，而 dashboard 的 jsApiCalls 裡唯一沒有其他解釋的就是它）。

**但那是消去法的推論，不是判定**：規格沒有捕捉 inline JS 的內容（只有
`inlineJsBytes: 66026` 這個位元組數），所以「`focusTrack` 打的是不是這一支」沒有直接
證據；**request/response 形狀、事件模型、誰會讀回這些事件，全部未知**
（`/api/settings/setup-status` 是另一支、我方已實作，它算的是設定完成度，不是事件）。
實作它就等於發明一個 onboarding 事件模型——issue 明文禁止。

**`/api/staff/calendar`（calendar 頁）**

本輪把用途**收斂了一格**，但仍不足以實作。calendar 頁的 `buttons` 有一組模式切換：

- `switchCalendarMode('booking')`（「顧客預約」，`btnModeBooking`）
- `switchCalendarMode('staff')`（「員工排班」，`btnModeStaff`）

而該頁的 `looseFields` **只有一個** staff 下拉（`staffFilter`，選項「全部員工」），
`jsApiCalls` 裡也**沒有** `/api/shifts`。所以「`/api/staff/calendar` 服務的是
員工排班模式」是目前最強的候選——但這仍是消去法。決定性的資訊缺口是：

- 它與 `/api/staff/bookable` 的回傳差在哪？（只多欄位？還是連班表一起回？）
- 有沒有日期參數？回的是員工清單還是「員工 × 時段」的格子？

`jsStrings` 裡與員工有關的只有一句「載入員工列表失敗」，**分不出是哪一支的錯誤訊息**
（issue 已指出）。issue 也明文禁止「拿 `/api/staff/bookable` 的形狀去猜它」。

**結論**：④⑤ 兩支**不實作**，程式碼裡不留任何半成品路徑或猜測性型別
（`grep -rn "staff/calendar\|onboarding-event" src/ tests/` 輸出為空）。
等擁有者裁決。**「不做，在分冊記錄查不到與日期」是 issue 自己列出的有效答案。**

### 15.3 issue #33 內文與現況不符的三處（以程式碼為準並回報）

| issue #33 寫的 | 實際 |
|---|---|
| ②「封鎖時段頁也已經畫好了那個標記：`block-times.ts:34` `auto: '自動產生'`、`page.tsx:100`（`{b.auto ? … : null}`）、`:134/:140`（auto 列的按鈕 disabled）」 | **這些在 issue 建立時就已經不存在了**。`816c6f6`（issue #7 乙）接線時把 `auto` 徽章、每週循環、第二個文字欄一起移除並在檔頭寫明理由。本輪是**重新加回來**（因為 0027 讓它們變成真的），不是「接上既有的畫面」 |
| ②「migration 編號取現有最大號 **0019 +1 = 0020**」 | 撰寫當時的假設，早已過時：0020–0024 都已使用。本輪依主導者指定用 **0027**（0025 給 #19、0026 給 #8） |
| ③ 「#28 ③ 應已完成，接線點直接沿用」 | 屬實（`exportBookingsCsv` 已接上），但該接線送的是**無 format 段**的端點；本輪把它改成送 format，並把頁面那段「格式段補上之後這裡才會有兩種檔案」的註解改掉——**補上 format 段之後兩種選項拿到的仍是同一份 CSV**（沒有 xlsx 產生器），註解原本的預期不成立 |


### 15.4 順帶：`scripts/test/seed.mjs` 的 `price_per_person`

本輪也獨立撞到並修好了這一處（它讓 `reset-db` 以非零狀態碼結束，
**整個整合測試套件一個案例都跑不起來**）。合併時發現 issue #19 的執行者
已經修過同一行且記得更完整（見上方 §14 對應段落，並補了
`price_type` / `max_participants`），**本輪的修改讓給那一份**，這裡只留交叉註記：
同一個坑在同一天被三個 issue 的執行者各自撞到，是它夠隱蔽的證據。
## #37 Sol audit — closed source gap

原先 route 層的 check-then-insert/update 可能在併發 booking 與 departure assignment 間穿透，
且 completion 先寫 addon、再寫 order，無法保證 snapshot 原子或不可覆寫。0035 以 source-only
RPC、deterministic staff advisory locks、completion CAS 與 `performance_frozen_at` 補上資料庫邊界。
0034 也修正 composite FK 的 `ON DELETE SET NULL`，避免意外將 `tenant_id` 設為 null。仍待 Owner
授權後的 migration／整合測試，不能據此宣稱環境已驗證。

## #50 關鍵字回覆圖片：source-only 候選與未完成驗證（2026-08-28）

issue #5 為避免假功能，曾把沒有 `onChange` 的「附加圖片」停用；#50 的候選
`a2736ffd96e2bdaf473c9ee18d316304092a561f` 已補齊 source 端鏈路：頁面只收 JPEG/PNG，
呼叫共用 `/api/upload`，顯示上傳中／失敗／完成與真實預覽；保存成功必須等 upload 與
keyword reply 寫入都完成。選圖被較新的 upload 或 modal session 取代時，失去 ownership
的結果會自行清理；save in-flight 時 Cancel／backdrop／Escape／X 不能刪掉即將持久化的圖。

資料契約不再把 `imageUrl` 字串當證據。新 IMAGE row 同時保存原圖與 preview 的
`imageStorageRef`；POST／PUT／新版 GET 會驗專用 bucket、本租戶 path、可信 HTTPS origin、
URL/path 一致與兩個 Storage object 存在。webhook 沿用既有 IMAGE 分支，圖片取代文字，
原圖與 preview 分別取 DB 保存值。舊 IMAGE row 若只有裸 `imageUrl`，保留唯讀／停用相容，
不從任意外部 URL 猜 tenant object；再次選圖時才升級。

bucket 查證與決策表在 06 §6.1。專用 `keyword-reply-images` 必須 public 才能讓 LINE 抓圖，
所以「A tenant 無法讀 B tenant public URL」不是可成立的保證；真正可驗收的隔離是 A 不得
寫入、在自己的 reply 引用或 cleanup 刪除 B 的物件；規格也因此禁止上傳私密內容。替換、
移除、刪除與取消未儲存選圖都先確認 DB 無活引用再刪原圖＋preview；暫時刪除失敗進
`keyword_reply_image_cleanup`，每日 cron 重試前再查引用，避免已重新被使用的物件遭誤刪。

目前證據邊界必須保持誠實：候選只完成 typecheck、targeted unit 與 mock build 的 source
驗證；migration `0039`、bucket/policy/cleanup table 尚未套 TEST，service-role object existence、
跨租戶 RLS、cleanup retry、webhook integration、完整 integration/E2E、Preview 手機 modal 與
reload 截圖均未驗。Production DDL／Storage policy、部署與真實 LINE 發送亦未執行。因此
#50 仍是 source-only 候選，不得把本節或 unit 綠燈當成 issue 完成證據。

## Issue #41 canonical／驗收索引

Issue #41 的領域模型與狀態語意回併 `10-TOUR-DOMAIN.md` 及
`18-GUIDE-COMMERCE-LIFECYCLE.md`；測試執行與證據規則回併
`12-TESTING-TDD.md`。本索引只記錄落差、驗收證據與 Preview／外部服務邊界，
不得以 source、mock 或 CI 結果取代 Issue #41 要求的真實驗收。
