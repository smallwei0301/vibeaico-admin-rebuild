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
- [ ] 關鍵字回覆整頁 CRUD 全假：載入吃 mock、儲存/刪除/啟停只 setState（keyword-replies/page.tsx；`/api/settings/line/keyword-replies` 已存在且已被 gating 測試打過）——**顧客端後果：店家在 UI 設的關鍵字永遠進不了 DB，Bot 不會照設定回**
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
- [ ] 預約加購 modal（謊報「顧客將收到 LINE 消費明細」）
- [ ] 行事曆同步頁（ICS token 重生＝假安全操作、外部行事曆 CRUD）＋設定頁 ICS token 重生（硬編碼輪替陣列）
- [ ] 贊助頁假送出、推薦頁硬編碼假推薦碼、兩處「QR 已下載」沒下載
- [ ] rich-menu-design 殘留：FlexMenuTab 發布/重設/刪卡、每格彈窗、儲存草稿、還原、預約步驟、背景圖「上傳圖片」死按鈕（無 onClick）

### A-2 API 有測試但無人使用（綠燈孤兒）

- [ ] `/api/upload`：測試矩陣完整全綠，但全 src/ 無任何頁面呼叫——「圖片上傳」對使用者不存在
- [ ] `/api/bookings/available-slots`：有整合測試，services 層連包裝函式都沒有

---

## 2. 根因 B 清單：計劃漏掉（規格要補寫、工作要補做）

- [ ] **webhook 關鍵字覆蓋不足**：實作只比對 4 個字面值（預約/服務/我的預約/行程佔位）。
      keyword-replies i18n 定義的 15 組系統關鍵字（含同義詞）與 `MODE_PRESETS.richMenuCells`
      的格子文字（服務項目/會員卡/優惠/聯絡我們/團次/我的訂單/常見問題/看診進度/營業時間…）
      大多無 handler，按了落到 defaultReply。**新增規格**：已回寫 06 §3——「Rich Menu 每個
      格子送出的文字、與系統關鍵字組全部同義詞，webhook 必須有對應分支；系統組的
      啟停開關（systemGroupDisabled）webhook 必須讀」
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
| 6 | 預約加購 `booking_addons` | 3 | 04 §B-1 零記載 | #17 |
| 7 | LINE 老闆通知 owner-notify | 4 | 06 分冊零記載 | #18 |
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
