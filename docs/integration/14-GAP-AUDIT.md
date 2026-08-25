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

   ⚠️ **更正（2026-08-25，主導者）**：本節下文一度把「同型」擴大解釋成
   **新增與刪除**兩頁也都有缺陷，並據此發了派工單。實測不成立——商品頁的
   新增與刪除在 `c9e04f9` 就已經是 await-first，只有服務頁是舊寫法。
   執行者拒絕為了對齊派工單而重寫已經正確的程式碼，是對的。
   **教訓：「A 頁有這個問題，B 頁應該同型」是假設不是事實，寫進派工單前要先 grep。**
   本輪把 `active` 變成真欄位之後，這顆按鈕的誤導性反而提高了（使用者現在
   有理由相信它存得進去）。**這是「補了一半反而更糟」的典型**，修正順序上
   應緊接本輪，不宜久放。
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


### 8.13-b CLINIC 的名詞尚未統一（issue #29 執行者盤出，**待設計，不要逐處補丁**）

同一個東西在診所眼裡目前有**四個名字**：

| 出現位置 | 目前叫什麼 |
|---|---|
| 側邊欄（`nav.ts` navByMode.CLINIC） | 診療項目 |
| 開店步驟（`dashboard.ts` 既有覆寫） | 看診項目 |
| LINE 圖文選單格 label（`MODE_PRESETS.CLINIC.richMenuCells`） | 看診項目 |
| LINE 圖文選單格**送出的文字**（同上） | 服務項目 |
| 預約表單欄位（`bookings.ts`） | 服務項目 |

這是 CLINIC 子層級尚未設計的徵兆，**需要一次命名裁決，不是逐處補丁**——
逐處改只會讓下一個人看到第五種叫法。列在這裡等擁有者設計診所模式時一併處理。

### 8.13-c 其他同型缺口（issue #29 執行者盤出，未處理）

| 位置 | 問題 | 為什麼沒在 #29 處理 |
|---|---|---|
| `pages/ai-settings.ts:60` | 「所有服務項目與價格」（AI 知識庫來源清單） | 同型跨頁引用，#29 的 5 處清單漏列、不在白名單。**已列入該 issue 靜態鎖的例外清單，排到就刪那一行** |
| `feature-store.ts` SERVICE_CATALOG 的 `where` | 寫「側邊欄 → **服務管理**」，但這個群組**在任何模式都不存在**（實際群組是 店家營運／行程營運／診所營運） | 既有錯誤，非 #29 造成。主導者已查證屬實 |
| `pages/bookings.ts`（97/107/109/136/157/159 等） | 「服務項目 *」等寫死用語，CLINIC 也看得到這一頁 | #29 未提及、不在白名單 |
| `pages/{clinic-queue,recurring-bookings}.ts` | 同型 | #29 明列不在範圍 |
| GUIDE 的 `step1Title` 展開後是「確認行程與方案與價格」 | 兩個「與」連讀拗口 | 改前對嚮導是**錯的**，現在是**對但拗口**；執行者判斷不該為了通順自行發明文案（正確）。要順的話在 `dashboard.ts` 給 GUIDE 一個 `focus.step1Title` 覆寫 |
| `/tenant/tour-orders`、`/tenant/trips` 不讀 searchParams | 嚮導從統計卡帶過去的 `?status=PENDING` / `?action=create` 被忽略，落在未篩選列表 | 是**團次訂單頁的功能缺**，屬 issue #8 範圍。不是死路（頁面在他選單裡），但篩選條件失效 |


### 6.7 issue #30（回報問題的截圖上傳）— 2026-08-25 完成（commit `c6d99b0`）

migration 0019 ＋ 新 bucket `bug-report-attachments` ＋ `/api/upload` 白名單 ＋
`/api/bug-report` 契約 ＋ modal 解除停用。

**主導者獨立複驗**（不採信回報）：兩專案各查一次 →
`bucket_public=false`、`attachment_path` 欄位在、**RESTRICTIVE 政策在**、
且**沒有**混進 `p_storage_read` 的列舉白名單。`npm run build` 通過。

#### 執行者做的一個加固，值得記下來當往後的作法

派工只要求「bucket 不要照抄 `chat-images` 的 public」。執行者做到了，
但**多做了一層**：除了不把新 bucket 加進 `p_storage_read` / `p_storage_write`
的列舉白名單之外，另外加了一條 **RESTRICTIVE 政策**明確擋掉這個 bucket。

它的理由（原話大意）：**「只是沒被列進白名單」是負向保護**——
那六個 bucket 名字是一條列舉字串，未來任何一次重建政策時多打一個名字，
就會把整個 bucket 曝出去，而且**沒有任何測試會紅**。RESTRICTIVE 政策是
正向的：它必須被主動刪掉才會失效，而刪掉是一個顯眼的動作。

驗證方式也對：不是查政策存不存在就算，而是**用真的登入的 owner（role
`authenticated`）實際去操作**——`list → rows=0`、`download → BLOCKED`、
`upload → BLOCKED (RLS)`、`createSignedUrl → BLOCKED`。

**另一個正確的小決定**：DB 存的是 **storage path 而不是 URL**。
簽名 URL 會過期，存 URL 等於存一堆死連結——這正是 06 分冊 §8 已經替
`chat_messages` 記下的技術債，這裡沒有重蹈。

#### 執行者提出、需要決策的一點（尚未處理）

`PLATFORM_ADMIN_EMAIL` 目前未設定，所以 `/api/bug-report` 只寫 log 不寄信
（issue #28 的既有狀態，本輪未動）。

⚠️ 但情況已經變了：**回報現在可以夾帶含顧客資料的截圖**。所以在把那封通知信
接上去之前，要先決定**那封信裡到底能不能放簽名 URL**——
- 放了，等於把顧客資料的存取權從「有登入的平台人員」擴散到「收得到那封信、
  或轉寄到那封信的任何人」，而簽名 URL 在有效期內不需要任何身分驗證
- 不放，平台人員得自己登入後台去看，多一步但存取邊界清楚

執行者**沒有自行建那封信**，把問題交上來——這是對的。
### 8.16-b 閘門看的是「動作的方向」，不是「對象」（§8.16 的延伸，主導者判定）

§8.16 收工時，執行者交上一個它判斷「兩邊都沾、不敢自行歸類」的情況——**它交上來是對的**：

- webhook 分支 ②（`line-events.ts:305-318`）讀 `keyword_replies`
  **完全沒有 feature 閘門** → 退訂後，店家自訂的關鍵字**照樣回覆顧客**
- 但要停用它得走 `PUT /api/settings/line/keyword-replies/:id`、
  刪除走 `DELETE`，兩支都無條件 `requireFeature` → **403**

⇒ **店家退訂後，自己寫的話持續發給顧客，而他關不掉也刪不掉。**

它同時屬於「使用者想讓系統少做一點」（§8.16 說不該擋）與「自訂內容」
（§8.16 說要擋），所以執行者不自行歸類。

**主導者判定：§8.16 的原則本身就能解開——決定的是動作的「方向」，不是「對象」。**

| 動作 | 方向 | 閘門 |
|---|---|---|
| 新增自訂關鍵字（POST） | 多做一件事 | **擋** |
| 改內容（keywords／replyType／content／sortOrder） | 多做一件事 | **擋** |
| `active: true`（重新啟用） | 多做一件事 | **擋** |
| `active: false`（停用） | 少做一件事 | **不擋** |
| `DELETE` | 少做一件事 | **不擋** |

⚠️ **實作上有一個必須堵的後門**：判定寫成「**只有**停用、且沒有夾帶任何內容欄位」
才放行。否則送 `{ active: false, content: {...} }` 就能繞過付費改內容。
`tests/unit/keyword-gate-direction.test.ts` 有一條專門釘這件事，變異測試驗證過。

**為什麼這比系統內建關鍵字那一輪更嚴重**：那些是**店家自己名義**發出去的話——
可能是過期的優惠、舊價格、已停售的服務。系統內建關鍵字至少內容是平台寫的、中性的。

#### 這件事同時修正了一條既有測試的前提

`keyword-replies-wiring.05.test.ts` 原本釘「`[id]/route.ts` 裡 requireFeature 出現
**兩次**」。方向判定之後那個數量沒有意義了（PUT 變成有條件、DELETE 沒有），
改為只釘仍然成立的那一半（POST 必擋），完整覆蓋移到新的方向測試——
**那裡連夾帶繞過都釘住了，比原本的數數強。**

### 8.16-c 尚未處理：TOUR_MODULE 也有同型問題（執行者盤出）

退訂 `TOUR_MODULE` 後，`行程`／`出團日期` 兩組的**停用開關從畫面上消失**
（`page.tsx:77 visibleGroups` 用 `feature: 'TOUR_MODULE'` 過濾），
而 webhook 對這兩組關鍵字**沒有 TOUR_MODULE 閘門** → 照常回覆，一樣關不掉。

這是**另一個 feature**，§8.16／§8.16-b 都沒有涵蓋。依同一個方向原則，
「讓那兩組的停用開關在退訂後仍然可見可用」應該是對的，但那牽涉 TOUR_MODULE
的收費邊界，留給擁有者。**未處理，未打勾。**

### 6.8 issue #28 ⑬（LINE preview 縮圖）— 2026-08-25 完成（commit `5e5984e`）

`previewImageUrl` 不再與 `originalContentUrl` 共用同一個網址。新增 `src/server/image.ts`，
上傳到 `chat-images` 時同時產一張 ≤1 MB 的縮圖，路徑 `{uuid}.preview.{ext}`（純推導，
不進 DB）。**`MAX_BYTES` 維持 5 MB 未動**——沒有用壓上傳上限來迴避問題。

**主導者複驗**：`package.json` 是 `"sharp": "0.34.5"`（精確鎖版，非 caret——caret 達不到
裁決要的「同一個原生二進位」）；commit 11 檔全是自己的；
`tests/integration/api/chat-image.15.test.ts` 只 +6 行且**全在 `afterAll` 清理**，
零個斷言被改（先前主導者曾標記要逐條核對這個檔）。

#### 三個值得沿用的判斷

1. **量的是「LINE 實際收到的那個網址」，不是我們以為的那個。**
   測試從 `mock.requestsFor('/v2/bot/message/push')[0].body.messages[0].previewImageUrl`
   反推 path 再下載量 bytes，而不是量自己剛產的縮圖。素材用 **2400×1800 隨機雜訊 JPEG**
   （≈4.2 MB）——雜訊是壓縮率最差的素材，拿好壓的圖等於自己放水。
   `1 MB` 取 **1,000,000** 而非 1,048,576：官方只寫「1 MB」，取小的那個兩種解讀都合規。

2. **產不出縮圖時「當場擋下 400」，而不是靜默退回原圖。**
   執行者排除另外兩條路的理由值得記：
   - *靜默用原圖當 preview* ＝ 把本項要修的 bug 原封放回來，而且從此沒有任何訊號
     （`/api/upload` 200、DB 有列、畫面顯示已送出，只有顧客的 LINE 端不對）
   - *原圖照上、縮圖之後再說* ＝ 把失敗推遲到「使用者不在場、且正在對顧客發送」的那一刻
   - *當場擋下* ＝ 使用者手上還握著那個檔案，換一張就好
   並且**縮圖先產後上傳**，Storage 連半成品都不會留下。

3. **遇到壞夾具時，沒有把閘門改得更嚴。**
   全量跑抓到 `chat-image.15` 的 1×1 PNG 夾具其實是壞的（IHDR 宣告 RGBA、1×1 應有 5 bytes
   掃描列，IDAT 只 inflate 出 3 bytes；libpng／瀏覽器會補齊照顯示，sharp 底層的 libspng 會丟錯）。
   執行者原本寫 `failOn: 'error'`，等於把一張**別人都讀得出來**的圖擋在門口，於是改成
   `failOn: 'none'`——理由是「本項要擋的是**產不出縮圖**，不是檔案不夠完美；
   比改動前更嚴格等於拿本項當理由砍掉既有能力」。那正是擁有者方針的正確套用。

#### 順手補的一個洞（主導者複核通過）

`makeLinePreview` 會**實際解碼並比對宣告的 MIME**。先前 `/api/upload` 只信 `file.type`
（用戶端說了算），所以一張**改名的 WebP 能偽裝成 `image/jpeg`** 通過 `11a174d` 的格式閘門，
一路到 LINE 才失敗。現在會回 400。方向與 `11a174d` 一致，有測試覆蓋。

#### 06 分冊 §8.4 的「兩個規格違反」現在是**零個**

違反 1（WebP 送去 LINE）由 `11a174d` 修、違反 2（preview 超規）由本輪修。
06 分冊該節文字待更新。

### 6.8-b 兩支端點沒有任何呼叫端（執行者盤出，未處理）

| 端點 | 狀況 |
|---|---|
| `/api/marketing/pushes/*`（四支） | `marketing` 頁**完全沒接線**——頁內是 `byMode()` 假資料、零個 `@/services` import。所以本輪對 marketing 那一半**只有端點層被驗證過**，正是 CLAUDE.md 說的「頁面接線不屬於任何一層」的結構盲點 |
| `POST /api/settings/line/rich-menu/upload-bg-image` | `grep -rn "upload-bg-image" src/` 只有註解，零呼叫端 |
| `/api/upload` 的 `richmenu-assets` 分支（5 MB） | 同樣零呼叫端；真正的 rich menu 底圖走上面那支、且它自己擋在 1 MB |

⚠️ 執行者**沒有**把 marketing 寫成「鏈路完整」——它在 DoD 10 對照表裡明寫
「handler **不存在**、service **不存在**」。那是對的：寫成完整就是假的已知。

`marketing` 頁的接線屬 issue #7 乙段（已在該 issue 清單內）。

### 6.9 issue #6（Flex 主選單三層補齊）— 2026-08-25 完成（commit `38e2320`）

儲存層（`flexCards` 進 `tenant_settings.line` jsonb，無 migration）、webhook 層
（「選單」→ Flex carousel）、頁面層三層都接真了。

**主導者複驗**：commit 13 檔全是自己的、`npm run build` 通過
（**這同時關掉了 `sharp` 那輪一直壓著沒跑的原生相依驗證**）、
`comment-test-references` 由紅轉綠（`flex-menu.ts` 註解引用的測試檔已存在）。

#### 這一輪最有價值的證據，以及它為什麼有效

issue 要求把 Flex JSON 送去 LINE 官方的 `POST /v2/bot/message/validate/reply`
（不耗推播額度）。7 個案例全 200。

**但執行者自己補了一組負向對照**——因為七個 200 有可能只是端點在蓋橡皮圖章：

```
REJECTED  13 個 bubble        → 400 "must not be more than 12 items"
REJECTED  text 元件是空字串    → 400 "must be non-empty text"
REJECTED  hero 用 http        → 400 "invalid uri scheme"
REJECTED  backgroundColor 非 hex → 400 "invalid property"
```

這四條同時是它自己四道防線的獨立佐證，而且
`must not be more than 12 items` **就是 LINE 官方對 `MAX_FLEX_CARDS = 12` 的背書**。

⚠️ 這是 §6.5「否定式斷言要配對照組」的同一個道理換一個場景：
**「外部系統說 OK」本身也需要對照組**，否則分不出「它認可我們」與「它什麼都認可」。

#### 一個藏了很久的矛盾被順手清掉

字典裡同時有 `maxCards12`（'最多 12 張卡片'）與 `maxCards10`（'最多 10 張卡片'），
後者全站零引用——**同一個上限兩個數字**，正是 `MAX_PAGE_SIZE` 那次的同型缺陷
（頁面送的數字與後端收的數字不一致，整頁死掉）。

現在 `MAX_FLEX_CARDS` 是單一來源，四個消費端（zod／頁面／文案／組裝層）全部引用它，
並由 `「字典裡沒有任何寫死張數上限的句子」` 鎖住。

#### 誠實標註：已實作、已測試、**刻意尚未被使用**

`richMenuCellAction()` 的 `FLEX_POPUP` 分支目前**沒有任何設定能觸發**——
每格自訂的儲存後端屬 issue #7，`MODE_PRESETS.richMenuCells` 也沒有一格標成 FLEX_POPUP。

執行者比照 §8.8 對 `/api/bookings/available-slots` 的處理，把它標成
「已實作、已單元測試、**刻意**尚未被使用」，而不是寫成已生效的功能。**這個區分要保住**：
它不是假成功，也不是漏接。

#### 三件執行者拒絕自行決定的事（都對）

1. **廣告卡的「打開網址」是規格衝突。** 06 §6 的卡片契約只有
   `{title, subtitle, imageUrl, ad}` 四個欄位、**沒有網址可放**，但頁面文案寫著
   「插入廣告卡片（打開網址）」。它照契約做四欄、把文案改成實情，**沒有自行加欄位**。
2. **Flex 主選單要不要收費。** `POST /api/settings/line/flex-menu` **從來沒有
   `requireFeature`**，訂不訂閱存進去的都一樣。但頁面原本 toast
   「您未訂閱進階自訂選單，已存為免費的基本款氣泡主選單」——那句話宣稱了**兩件都沒發生
   的事**（① 當時根本沒有儲存 ② 平台沒有「基本款氣泡主選單」這種降級樣式）。
   它刪了那句假話，**沒有自行加閘門**（收費邊界）。
3. **`flexShowTip` 是存得下但沒人讀的欄位。** 分冊沒寫它該控制什麼，
   頁面也沒有對應 UI（所以目前**沒有**假宣稱）。它不猜也不接。

### 6.9-b 由 #6 衍生、待擁有者裁決的三項

| # | 事項 | 選項 |
|---|---|---|
| 1 | **廣告卡能不能開連結** | (a) 擴充卡片契約加 optional `linkUrl`（06 §6 要改）／(b) 維持四欄，廣告卡只是多一行標示 |
| 2 | **Flex 主選單要不要收費** | 若要擋，依 §8.16-b 的方向原則：新增／改卡片＝多做一件事→擋；`flexMenuEnabled: false`＝少做一件事→不擋。若不擋，維持現狀即可（現在沒有假宣稱了） |
| 3 | **`flexShowTip` 給語意還是刪掉** | 留著一個沒人讀的欄位，遲早有人以為它有作用 |

### 6.9-c 尚未完成：Preview 站 ＋ Midao 真實 webhook 實測

issue #6 的驗收有一條要求對 **Preview 站**做 Playwright ＋ 真實 LINE 實測。
執行者依派工「不要 push」而未做——**這個判斷是對的**：Preview 是從本分支自動部署，
不 push 的話上面跑的是舊程式碼，對它斷言只會得到與本輪無關的結果，那才是假證據。

**本輪的替代是本機 `next dev`（接 TEST 專案）**，已如實標註。
主導者已 push（`38e2320`），這一條可以補做——**但 08 分冊「flex-menu 端到端」
在補做之前不打勾**。

### 8.17 CLINIC 的三個名詞（擁有者裁決，解開 §8.13 規則 4 的「尚未設計」）

| 概念 | 診所叫什麼 |
|---|---|
| 目錄（賣什麼） | **診療項目** |
| 訂單（誰買了） | **掛號紀錄** |
| 員工 | **醫師** |

§8.13-b 盤出同一個東西在診所眼裡有四個名字，這一節把它收斂成一組。

⚠️ **改的時候有一個坑**：`MODE_PRESETS.CLINIC.richMenuCells` 的每一格有
`label`（顧客看到的按鈕字）與 `text`（按下去**送出的文字**）兩個欄位。
**`label` 可以自由改，`text` 不行**——`text` 必須是 webhook 認得的字串，
否則顧客按了那一格會完全沒反應（issue #5 抓到 18 格有 14 格是這樣壞的）。

要改 `text` 就必須同步更新 `RICH_MENU_TEXT_INTENT` 的對應。
`tests/unit/line-keyword-coverage.test.ts` 會逐格檢查，改錯會直接紅——
**那條測試就是為這件事存在的，不要繞過它**。

### 8.18 bug 回報的通知信 → **不放簽名 URL**（擁有者裁決）

信裡只寫「有一筆新回報，含 N 張截圖」＋後台連結，**不夾能直接看圖的簽名 URL**。

**為什麼**：簽名 URL 在有效期內**不需要任何身分驗證**。放進 email 等於把顧客資料的
存取權，從「能登入後台的人」擴散到「任何收得到那封信、或那封信被轉寄到的人」。
而回報截圖幾乎一定含店家當下螢幕上的顧客資料（§6.7）。多按一次登入的成本，
遠低於資料外流。

📌 現況：`PLATFORM_ADMIN_EMAIL` 未設定，那封信**還沒接上**（只寫 log）。
本節是**接的時候必須遵守的約束**，不是現在要做的事。

### 8.19 TOUR_MODULE 退訂後的停用開關 → **保持可見可用**（擁有者裁決，§8.16-c 結案）

`行程`／`出團日期` 兩組的停用開關，退訂 TOUR_MODULE 後不得從畫面消失。

**為什麼**：這與 §8.16／§8.16-b 是同一個原則——**收費擋的是「多做一件事」，
不是「少做一件事」**。退訂的嚮導無法讓 bot 對「行程」閉嘴，跟先前那兩個案例
一模一樣，只是換了一個模組。**同一個原則在專案裡不能只執行一半。**

### 8.20 廣告卡 → **加 optional `linkUrl`**（擁有者裁決，06 §6 契約要改）

Flex 卡片契約從 `{title, subtitle, imageUrl, ad}` 擴為
`{title, subtitle, imageUrl, ad, linkUrl?}`。

**為什麼**：「廣告卡不能點」本身沒有意義——廣告的目的就是把人帶去某個地方。
而且頁面文案原本就承諾了「打開網址」，補齊比改掉文案更符合擁有者方針。

⚠️ ~~**實作限制（LINE 已用 `validate/reply` 驗證過，見 §6.9）**：`uri` action 只收 https……~~
🔴 **這段是錯的，2026-08-25 由執行者實測推翻，見 §8.20-b。**

### 8.21 Flex 主選單 → **不收費**（擁有者裁決）

維持現狀：`POST /api/settings/line/flex-menu` **不加 `requireFeature`**。

**為什麼**：這個功能對「顧客體驗」的幫助大於對「店家省事」的幫助——選單好用，
顧客才願意用 LINE 下單，對平台是正循環。要收費該收在推播額度那種
**用越多花越多**的地方。

📌 那句假文案（「已存為免費的基本款氣泡主選單」——宣稱了兩件都沒發生的事）
已於 issue #6 移除，現在沒有假宣稱了。

### 8.22 `flexShowTip` → **刪掉**（擁有者裁決）

存得下、但全站沒有任何地方讀它，畫面也沒有對應 UI，分冊沒寫它該控制什麼。

**為什麼刪而不是給語意**：沒人讀的欄位是誤導的種子——遲早有人以為它有作用，
或照著它的名字寫出一段「以為會生效」的程式。之後若真需要「顯示使用提示」，
再加一個名字說得清楚的欄位。

（這一項與「補齊優先於刪除」不衝突：**那條方針講的是「使用者看得到、卻不能用」
的功能**。`flexShowTip` 使用者根本看不到，沒有任何功能因刪除而消失。）


### 6.10 §8.17 CLINIC 名詞統一 — 2026-08-25 完成（commit `b7ad2f2`）

| 概念 | LOCAL_SHOP | GUIDE | CLINIC |
|---|---|---|---|
| 目錄 | 服務項目 | 行程與方案 | **診療項目** |
| 訂單 | 預約列表 | 旅遊訂單 | **掛號紀錄**（本輪改，原為「預約列表」） |
| 員工 | 服務人員 | 導遊 | 醫師（原本就對） |

`§8.13-b` 記的「同一個東西四個名字」收斂完畢。執行者採用零風險路徑：
**只改 `richMenuCells` 的 `label`，`text` 一個字沒動**，`RICH_MENU_TEXT_INTENT`
與 `line-events.ts` 完全沒開過。

#### 一個測試覆蓋的缺口（執行者發現並補上）

`tests/unit/line-keyword-coverage.test.ts`（issue #5 建立的 18 格守門）
**只檢查 `text`，不檢查 `label`**。執行者用變異測試證明了這件事：
把 CLINIC 那一格的 label 改回「看診項目」，**那份 81 案的守門測試照樣全綠**。

這不是那份測試的缺陷——它防的是「按了沒反應」，而 label 改錯不會造成沒反應，
只會造成**名詞不一致**。但這代表命名統一需要**另一層**保護，所以執行者建了
`tests/unit/clinic-terminology.8-17.test.ts`（同一個變異下它會紅）。

⚠️ 值得記的是這個推理方式：**一份測試綠燈，只證明它防的那件事沒發生**，
不證明「這個檔案沒問題」。要知道它防什麼，得看它斷言了什麼。

#### 主導者的派工單有一處錯誤（執行者抓到）

派工單寫「`pages/bookings.ts` 與 `pages/clinic-queue.ts` 都在
`mode-parent-links.29.test.ts` 的例外清單上、註明待排」。
**`bookings.ts` 不在清單裡，也不需要在**——它是四個子層級的擁有者檔案之一
（`SUB_LEVEL_SEGMENTS` 含 `'bookings'`），結構上就豁免。
真正把它列為未處理缺口的是 §8.13-c 的表格，不是那個測試檔。

執行者照 §8.17 修了它的文案（該檔在白名單內），並回報「沒有例外清單行可刪」，
同時援引 15 分冊「表格裡寫一個沒查證過的值，它就會被下一個人當成規格」。

**這是主導者同一天第二次把推論寫成事實**（前一次是「商品頁同型」）。
已在 15 分冊新增一節，把「派工單裡的事實陳述也要先 grep」寫成規則。


### 8.20-b §8.20 的「實作限制」是錯的（主導者的引用錯誤，執行者實測推翻）

我在 §8.20 寫：

> ⚠️ **實作限制（LINE 已用 `validate/reply` 驗證過，見 §6.9）**：
> `uri` action 只收 **https**，`http` 會被回 `invalid uri scheme`。

**§6.9 沒有說這件事。** 它記的是
`REJECTED  hero 用 http → 400 "invalid uri scheme"`——那是 **hero 圖片的 `url`**，
不是 `uri` action。我把兩個不同欄位的規則混成一條，**還附上了一句「LINE 已驗證過」
的引用**，讓它看起來像有出處。

執行者照著寫完 schema 之後跑負向對照，發現 LINE **收下了** http（200），
把它當紅燈追下去，做了完整的 scheme 探測：

| 欄位 | https | http | `line://` | `tel:` | `javascript:` / `ftp:` / `data:` |
|---|---|---|---|---|---|
| `uri` action | 200 | **200** | 200 | 200 | 400 `invalid uri scheme` |
| hero 圖 `url` | 200 | **400** | — | — | — |

LINE 回的 `property` 路徑就是分辨兩者的關鍵：
`/contents/0/footer/contents/0/action/uri` vs `/contents/0/hero/url`。

#### 執行者的處置（主導者複核通過）

**https-only 照擁有者裁決保留**，沒有自行放寬——但把**每一處理由**改成事實：

| | 舊（假的） | 新 |
|---|---|---|
| 店家看到的文案 | 「LINE 的『打開網址』動作不收 http，會整包退回」 | 「本平台的規定；http 的連線未加密」 |
| schema／端點／測試註解 | 同上 | 標明是平台自訂規則，並附實測數據與這個誤植 |

理由是 CLAUDE.md 那條：**店家照文案去查 LINE 文件會發現對不上，那就是我們在說謊**；
而且下一個人會照著一個不存在的外部限制做決定。

驗證腳本因此多了第三類輸出「**scheme 探測**」，**不計入 failed**——
一條永遠亮紅的對照，跟永遠開著的警告一樣，只會讓人學會忽略整個面板。

#### 一個因此變重的觀察

> 既然 LINE 對 http 回 200，**沒有任何外部系統會替我們擋這條規則**——
> 它只剩 `tests/unit/flex-menu.06.test.ts` 的兩條 zod 斷言在守。

⚠️ **待擁有者裁決**：https-only 現在失去了原本的理由，要不要維持？
- **(a) 維持**（目前實作）：理由改成「不讓店家把顧客導去未加密網址」的平台政策
- **(b) 放寬成 LINE 的實際範圍**（http / https / `line://` / `tel:`），
  `line://` 這種加好友連結也能用
- **(c) 維持 https 但額外開放 `tel:`**——餐廳／診所的「打電話」卡片是很自然的用途

### 8.22-b §8.22 的兩句事實前提是錯的（需要重新裁決）

我在 §8.22 寫「畫面也沒有對應 UI」「使用者根本看不到，沒有任何功能因刪除而消失」。
**兩句都與程式碼不符**，執行者依派工指示「若發現有人在讀它，停下來回報，不要刪」
而停手——**那是對的**。

主導者複驗（不採信回報）：

| 位置 | 實際 |
|---|---|
| `src/app/tenant/line-settings/page.tsx:1066` | 有一個標著「顯示使用提示」的 `SwitchField` |
| `:155` | 讀 DB 值填進畫面 |
| `:330/334` | 存檔時送出 |
| `:351` | 「恢復預設」會重設它 |
| `docs/specs/line-settings.json:551` | **原站也有這個 checkbox** |
| `src/server/` | **零引用——切了沒有任何效果** |

所以它的真面目不是「沒人看得到的死欄位」，而是**一顆店家切得動、存得進去、
但什麼都不會發生的開關**——正是本專案一路在清的那一類。

⚠️ §8.22 自己引用的判準說「補齊優先於刪除**管的是「使用者看得到、卻不能用」的功能**」
——按那個判準，`flexShowTip` **落在補齊那一邊，不是刪除那一邊**。我當初的結論
建立在錯誤的事實上。

**待擁有者重新裁決：**
- **(a) 刪欄位，並且刪掉 line-settings 頁上那個開關**——使用者會少一個開關（原站有），要接受
- **(b) 給它語意並補齊**（例如控制 Flex carousel 最前面那張「使用提示」卡）
- **(c) 維持現狀但在畫面上誠實標註「尚未生效」**——比照 issue #3 的作法

無論選哪個，範圍都會超出當時的白名單（要納入 `line-settings/page.tsx` 與其 i18n）。
