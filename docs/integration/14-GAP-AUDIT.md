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
| LINE 對外行為三件（ai-settings 走錯端點／預約 MODIFIED 通知／商品訂單通知勾選框） | 3 | #27 | 施工中 |
| 單點與匯出批次（BugReportModal、`/pay` 死連結、班別範本文案、三處匯出、feature-store 丟棄回傳值、分類說明欄位） | 9 | #28 | ①⑧⑨ 已完成（`3aee55e`），其餘待前置 |

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

#### 由本輪衍生、尚未處理的三件

1. **分類的「編輯」（鉛筆）按鈕仍是假成功，而且本輪讓它更誤導。**
   `services/page.tsx:1164` 與 `products/page.tsx` 同型：只切本地 `active` 並
   toast「分類已更新」，從未打 `PUT /api/{service,product}-categories/:id`
   ——而那支路由的 `bodySchema` 目前也只有 `{ name }`。
   本輪把 `active` 變成真欄位之後，這顆按鈕的誤導性反而提高了（使用者現在
   有理由相信它存得進去）。**這是「補了一半反而更糟」的典型**，修正順序上
   應緊接本輪，不宜久放。
2. **回報問題的截圖上傳**：`bug_reports` 無附件欄位、Storage 白名單無可用
   bucket、`/api/bug-report` 契約無附件。本輪依 `SupportChatWidget` 的前例
   停用欄位並**在畫面上**說明尚未建置（不是只寫在註解）。要補齊需要
   新 bucket ＋ 欄位 ＋ 端點契約，屬另一個 issue 的量。
3. **⑧ 第三分支（`restoreSideEffectFailed`）在 CI 會 skip，不是假綠。**
   該分支純資料無法誘發（`coupons` / `products` 上無任何 check/trigger 可違反），
   測試改用 Management API 在 **TEST 專案**臨時裝一個只對哨兵名稱 raise 的
   trigger、`finally` 拆掉，因此需要 `SUPABASE_ACCESS_TOKEN`，而 CI 的
   `.env.test` 沒有這個 token。
   **這一格目前的證據是沙箱實跑，不是 CI 綠燈**——差別要講清楚，
   否則下一輪稽核會把它當成已被 CI 覆蓋。要讓 CI 也涵蓋，需要把 Management
   API token 加進 repo secrets（⚙ 只有擁有者能做）。