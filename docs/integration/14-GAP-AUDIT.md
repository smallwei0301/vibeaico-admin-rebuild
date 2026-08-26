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
- [x] 預約加購 modal（謊報「顧客將收到 LINE 消費明細」）—— #3 已誠實化；**後端已於 issue #17 補齊並真實接線**（migration 0020 + 04 §B-1.1，見 §6.14），誠實化文案整組移除
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

### 6.9-d 補做完成：Preview ＋ 真實 LINE 實測（2026-08-25）

§6.9-c 那一條補做了，08 分冊「flex-menu 端到端」隨之打勾（依據是那一項自己的定義）。
⚠️ **issue #6 本身仍 open**：它的第 5 條驗收要求「以 Midao token 查證回覆**送達**」，
而送達這一段驗不到（原因見下表），依 08 打勾規則不打沒有證據的勾。受測的是
`c5bb50f`（linkUrl 五種 scheme）之後的當前程式碼，**不是 `38e2320` 當時的舊輸出**
——契約在中間擴充過，引用舊輸出等於引用另一個版本的證據。

腳本：`scripts/verify/flex-menu-preview-live.cjs`（Preview＋正式 Supabase）、
`scripts/verify/flex-menu-reply-capture.cjs`（出站 reply 側錄）、
`scripts/verify/flex-menu-validate.cjs`（LINE 官方 validate，重跑）。

⚠️ 閘門的範圍要看清楚：typecheck / build / unit 是在 rebase 後的 HEAD 上全量跑的；
**整合測試在 rebase 後只跑了與本 issue 相關的 4 支**（`flex-menu.06`／`line-webhook.06`／
`settings.a1`／`upload.07`，4 檔 64 例全綠）。這是主導者 2026-08-25 的流程調整——
多個執行者各排一輪 16〜18 分鐘的全量等於重跑幾乎相同的測試，全量改由主導者在
**合併後的樹**上跑一次。rebase 前的基底（`5d1b9b9`）上跑過全量並全綠
（38 檔 348 例），細節記在 issue #6 的驗收第 7 條。

#### 這一輪真正的價值：把「驗不到的那一段」量出邊界，而不是繞過它

issue 的措辭是「以 Midao token 查證回覆送達」。**送達驗不到**，原因是硬的：

| 想走的路 | 實測結果 | 結論 |
|---|---|---|
| 偽造 `replyToken` 讓 reply 成功 | `0`×32 / `f`×32 / 亂填 → 全部 `400 {"message":"Invalid reply token"}` | 走不通。連 LINE 文件上那兩個「測試用」token 都被退 |
| `POST /v2/bot/message/push` 推給真實 userId | 正式 DB `line_users` **零列**；`GET /v2/bot/followers/ids` → `403 Access to this API is not available for your account` | 沒有可推的對象。**推播額度一則都沒動**（`/v2/bot/message/quota/consumption` 測前測後皆 `totalUsage: 0`） |
| 從 Preview 外面看 server 到底有沒有打 reply | `/v1/deployments/:id/runtime-logs` → 404、`/v3/deployments/:id/events` → 403 Not authorized | 這個帳號的 Vercel token 讀不到 runtime logs |

所以做法是：**能量的逐段量、量不到的明寫量不到**。

⚠️ 特別記一條**沒有拿來當證據**的觀察，因為它很誘人：實測發現 LINE 是
**先驗訊息內容、再驗 replyToken**（同一個假 token 配一則 `text: ""` 的訊息，
回的是 `May not be empty` 而不是 `Invalid reply token`）。於是「reply 回
400 Invalid reply token」其實代表內容那一關過了——但那只等於 `validate/reply`
已經證過的事，**不等於送達**。本輪沒有用它冒充送達，這裡寫下來是為了讓
下一個人也不要用。

#### 逐段驗到了什麼

1. **LINE → 我們**（LINE 自己發、自己簽）：`POST /v2/bot/channel/webhook/test`
   → `{"success":true,"statusCode":200,"reason":"OK"}`。
   ⚠️ 這一條會**因 Vercel 冷啟動假紅**：第一次跑回 `REQUEST_TIMEOUT / statusCode 0`，
   先自己打一次把 function 叫醒後即 200。腳本已改成先暖機再重試三次並印出每一次原文
   ——一次逾時就判 FAIL，是把量測不確定性當成產品缺陷。
2. **驗簽**：無簽章／錯簽章 → `401 bad signature`；正確簽章 → `200 ok`。
3. **查店 + 進 onMessage**：事件送出後，正式 DB 出現該事件的 `chat_messages` 列
   （`content = {"text":"選單"}`）。這是從外部唯一看得到的「Preview 真的處理了它」。
4. **意圖 → 組裝 → 出站**：側錄轉發器（`LINE_API_BASE` → 127.0.0.1 → `api.line.me`）
   逐字錄到 `POST /v2/bot/message/reply`，body 是 `flex/carousel`、bubble 數＝店家
   發布的卡片數、含剛發布的卡片標題、兩張卡的 `linkUrl` 都成了 `uri` action
   （`https://` 與 `tel:`）、`{shopName}` 已替換。
5. **內容合法性**：同一份側錄到的 payload 再送官方 `validate/reply` → 200。
6. **送達**：❌ 沒有驗到。條件是**有真人對 Midao 帳號打一次「選單」**（人工介入點）。

#### 資料污染的處理

Preview 連的是**正式**專案（`egehnijjpgijmccagxac`），所以：測前把
`tenant_settings.line` 的**整塊 jsonb 原文**存下來當基準（不是 `GET /api/settings`
的回傳——後者會套 zod default，照著回寫會在 DB 裡多長出測前不存在的鍵，那不是還原），
測後 API 還原＋逐字比對，發現多了一個 `flexCards: []` 鍵就用 service role 寫回原文，
再查一次證明相同。探測事件用可辨識的假 userId（`U0000verify06probe…`），
測後刪除並貼出殘留 0 的查詢輸出；`message` 事件不寫 `line_users`，實查亦為 0。

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

> 📌 **這一小節是 2026-08-25 上半場的歷史紀錄，不是現行規則。**
> 當時執行者正確地保留了 §8.20 的 https-only 並只修正理由；同日下半場
> 擁有者重裁「廣告卡全開」，https-only 已**不再有效**——現行規則見本節下方
> 「擁有者裁決（2026-08-25）：**「廣告卡全開」**」。

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

⚠️ ~~**待擁有者裁決**：https-only 現在失去了原本的理由，要不要維持？~~
**已裁決，見下一節。**

#### 擁有者裁決（2026-08-25）：**「廣告卡全開」**

選項 (b)。**「全開」的工程定義**（主導者裁示，不是執行者猜的）：

> `linkUrl` 收 **LINE 實測會收的 scheme**，擋 **LINE 實測會退的 scheme**。
> 實作方式必須是**白名單**，不是黑名單。

**為什麼一定是白名單**：黑名單只擋得住我們今天想得到的字串，明天多一個沒人想過的
scheme 就會直接送到顧客手上，而**沒有任何測試會紅**——這正是本冊反覆抓到的那類
「負面保護」缺陷（同型討論見 §8 對 storage RESTRICTIVE 政策的那一段）。
白名單漏掉一個合法 scheme 只是少一個功能、店家會反映；黑名單漏掉一個危險 scheme
是顧客被導去 `javascript:`。**兩種錯的代價不對等。**

##### 每一個 scheme 的實測結果（`scripts/verify/flex-menu-validate.cjs`，2026-08-25 實跑）

送進 LINE 官方 `POST /v2/bot/message/validate/reply`（不耗推播額度），
受測 JSON 由 `src/server/flex-menu.ts` **本尊**產生（腳本不重寫一份組裝邏輯）。

| # | 送出的 `uri` | LINE 回應 | 進白名單 | 備註 |
|---|---|---|---|---|
| 1 | `https://a.example/` | **200** | ✅ | |
| 2 | `http://a.example/` | **200** | ✅ | §8.20 曾誤稱會被退 |
| 3 | `line://ti/p/@abc` | **200** | ✅ | 加好友／LINE 內頁 |
| 4 | `tel:0212345678` | **200** | ✅ | 餐廳／診所的「打電話」卡 |
| 5 | `mailto:shop@example.com` | **200** | ✅ | 本輪新量到 |
| 6 | `sms:0212345678` | 400 `invalid uri scheme` | ❌ | 本輪新量到——**LINE 不收**，不要憑「tel: 可以所以 sms: 應該也可以」推測 |
| 7 | `javascript:alert(1)` | 400 `invalid uri scheme` | ❌ | |
| 8 | `data:text/html,x` | 400 `invalid uri scheme` | ❌ | |
| 9 | `ftp://a.example/` | 400 `invalid uri scheme` | ❌ | |
| 10 | `file:///etc/passwd` | 400 `invalid uri scheme` | ❌ | 本輪新量到 |
| 11 | `/foo`（相對路徑） | 400 `invalid uri` + `invalid uri scheme` | ❌ | 沒有 scheme |
| 12 | `a.example/foo`（裸網域） | 400 同上 | ❌ | 沒有 scheme |

**實測 200 卻不進白名單的：一個都沒有。** 「全開」＝ LINE 收什麼就收什麼，
本平台沒有再自行扣掉任何一個。（先前 (a) 案「http 未加密」的平台政策**沒有**被採用。）

##### 變形的實測（這一組**不決定白名單**，只釘住我們自己的判斷函式）

| # | 送出的 `uri` | LINE 回應 | 本平台 |
|---|---|---|---|
| 13 | `HTTPS://A.EXAMPLE/` | **200** | ✅ 放行（比對 case-insensitive） |
| 14 | `JavaScript:alert(1)` | 400 | ❌ |
| 15 | `" https://a.example/"`（前置空白） | 400 | ✅ 放行，但**存 trim 後的值** |
| 16 | `" javascript:alert(1)"` | 400 | ❌ |
| 17 | `<TAB>javascript:alert(1)`（真 U+0009） | 400 | ❌ |
| 18 | `<LF>javascript:alert(1)`（真 U+000A） | 400 | ❌ |
| 19 | `java<TAB>script:alert(1)` | 400 | ❌ |
| 20 | 字面反斜線 `\t` + `javascript:`（兩個字元） | 400 | ❌ |
| 21 | 字面反斜線 `\n` + `javascript:`（兩個字元） | 400 | ❌ |

⚠️ **13–21 是「LINE 怎麼回」的紀錄，不是「我們要不要放行」的依據。**
`isAllowedFlexLinkUrl()` 一律走「**trim → 轉小寫 → 必須以白名單的某個 scheme 開頭**」，
就算 LINE 對某個變形回 200，本平台照樣擋。把兩者混起來，白名單就退化成
「LINE 沒退就放行」的黑名單。

##### 落地（2026-08-25）

| 位置 | 改動 |
|---|---|
| `src/config/tenant-settings.ts` | 新增 `FLEX_LINK_URL_SCHEMES` 與 `isAllowedFlexLinkUrl()`——**唯一出處**；`flexCardSchema.linkUrl` 的 refine 改呼叫它 |
| `src/server/flex-menu.ts` | `normalizeFlexCards()`（讀取搶救，改存 trim 後的值）與 `cardAction()` 都改呼叫同一支 |
| `src/app/tenant/rich-menu-design/page.tsx` | `publish()` 前端擋與輸入框下方即時提示都改呼叫同一支 |
| `src/i18n/zh-TW/pages/rich-menu-design.ts` | `linkUrlPlaceholder` / `linkUrlHint` / `linkUrlScheme` / `linkUrlSet` 與 `flexMenuSteps` 改成描述**可以填什麼**（列出五個 scheme 的例子），不再寫成 https-only |
| `src/app/api/settings/line/flex-menu/route.ts` | 檔頭「只收 https」註解改成白名單與實測回應碼 |
| `docs/integration/06-LINE-INTEGRATION.md` §6.1 | 卡片契約新增 `linkUrl` 規則與實測表 |

三處共用同一支函式是刻意的：本冊已反覆抓到「同一件事寫兩份，短期一樣、長期一定分岔，
而分岔的那一天沒有任何測試會紅」。`tests/unit/flex-menu.06.test.ts` 有一條
「三處共用同一支判斷函式（不得各寫一份 startsWith）」把它釘住。

##### 反轉的既有斷言（**前提變更，不是把測試改到綠**）

| 檔案 | 舊斷言 | 新斷言 |
|---|---|---|
| `tests/unit/flex-menu.06.test.ts` | `parse('http://…').success === false` | `=== true`（併入 `it.each(ALLOWED)` 的 zod 那一條） |
| 同上 | 「http 的網址：只丟掉那個連結，卡片留著並退回 message action」 | 「http 的連結網址現在會真的開」——按鈕是 `uri` action |
| 同上 | `normalizeFlexCards` 把 `http://a.example` 洗成 `''` | 原樣保留 |
| `tests/integration/api/flex-menu.06.test.ts` | 「非 https 的連結網址被端點擋下（400）」 | 「http 的連結網址現在存得下」——200 且逐欄回得來 |

理由一致：那幾條斷言守的是 §8.20 的 https-only，而 https-only 的**理由**已被實測推翻，
擁有者據此重裁「全開」。**前提變了，所以重新釘**——不是為了讓紅燈變綠而放寬。

##### 變異測試（證明新測試真的抓得到，不是擺著好看）

把 `isAllowedFlexLinkUrl()` 暫時改壞，各跑一次 `tests/unit/flex-menu.06.test.ts`：

| 變異 | 結果 | 紅掉的案例 |
|---|---|---|
| A：改回 `startsWith('https://')` | **17 failed / 83 passed** | `白名單 scheme http:// … / line:// / tel: / mailto:`（uri action、zod、normalizeFlexCards 各 4 條）、`http 的連結網址現在會真的開`、`前後空白會被去掉再判斷`、`scheme 比對不分大小寫`、`白名單常數與判斷函式一致`、`linkUrl 不是廣告卡專屬` |
| B：改成「什麼都收」 | **43 failed / 57 passed** | `zod（寫入路徑）擋下白名單以外的 …` ×14、`normalizeFlexCards（讀取路徑）把 … 洗成空字串` ×14、`組裝路徑：… 退回 message action` ×14、`白名單以外一律擋，即使是沒人列過的 scheme（證明不是黑名單）` |

兩個方向都紅 ⇒ 這組測試同時釘住「該收的沒收」與「該擋的沒擋」。還原後 100 passed。

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

### 8.22-c 擁有者重裁：選 **(b)**，但**保留到 issue #19 一起做**（2026-08-25）

擁有者的回覆是兩件事，不是一件：

1. **語意要給它**（選 (b)），不是刪欄位、也不是永遠停在誠實標註。
2. **不單獨施工**——併進 issue #19（Rich Menu 進階設計器 11 支端點）一起做。

#### 為什麼併進 #19 是對的（這一點擁有者比主導者準）

主導者原本打算單獨開一輪把語意補上。擁有者說保留到 #19 之後，回頭查
`docs/specs/line-settings.json` 才發現：`flexShowTip`（:546）的**下一個欄位就是
`stepServiceColor`**（:557），之後接連七組 `step*Color` / `step*Title`
（服務／日期／人員／時段／備註／確認／完成）——那七組正是 #19 的
`POST …/booking-step-guide`（預約步驟引導選單）。

也就是說 `flexShowTip` 在原站 DOM 上**緊鄰步驟引導那一區**。單獨做，只能靠猜；
跟 `booking-step-guide` 一起做，才有機會從那一區的規格判定它原本控制什麼。

⚠️ **但位置相鄰只是相鄰，不是證據。** 原站規格對這個欄位說的話只有 label 一行，
`help` 是空字串；附近唯一含「提示」的文案屬於另一個欄位（`flexMenuFallbackHint`）。
**原站語意救不回來**——這句話要照實寫進 #19 的實作註解，不得寫成考據結果。

#### 已寫進 issue #19 的裁示（摘要，全文見該 issue「併入範圍」一節）

- 做 `booking-step-guide` 時**一併判定** `flexShowTip` 是否屬於步驟引導；判定得出來就照
  原站語意做並寫明依據，判定不出來才走預設語意並明標為「我們選的」。
- **預設語意**：`flexShowTip=true` 時，Flex carousel 之**後**多送一則純文字使用提示，
  **只在 `buildFlexMenuOutcome()` 回 `FLEX` 時生效**。`HINT` / `SILENT` / `NO_CARDS`
  一律不加——fallback 本身就是一句提示，再補一句是重複；SILENT 是店家明講「完全不回」，
  加任何東西都是把開關做假。
- **不得**做成「carousel 最前面插一張提示卡」。carousel 上限 12 bubbles
  （`MAX_FLEX_CARDS`），店家編滿 12 張時提示卡會擠掉第 12 張：要嘛整包被 LINE 退回
  （顧客一張都收不到），要嘛我們自己砍一張而畫面說已儲存——後者正是
  `flex-menu/route.ts` 檔頭明文禁止的「沒人看得見的假成功」。
- **結構修正**：`FlexMenuOutcome` 目前是單數 `message`，`line-events.ts` 寫死
  `[outcome.message]`。要改成 `messages` 陣列並讓呼叫端整包送——留著單數欄位不改，
  就會變成「開關開了、第二則沒送出去」，換一種寫法的同一顆假開關。

#### 過渡期的處理（本次同時落地）

從現在到 #19 完成，那顆開關仍然是**切得動、存得進去、什麼都不會發生**的。依
CLAUDE.md 第一優先（不得有假功能），`line-settings` 頁那顆 `SwitchField` 底下補上
一句誠實標註，明說它尚未生效、排在哪一個 issue。#19 完成時要把這句換成真實行為
描述——該替換已列進 #19 的驗收清單，不是靠記得。

### 6.11 issue #28 的 ② ⑦ ⑩ — 2026-08-25 完成（`dcc7ce9` / `f959017` / `86ae5bb`）

三筆都屬「畫面宣稱一件不成立的事」，但值得記的不是修法，是**每一筆都在查證途中長大**。

| 筆 | 派工單寫的 | 執行者查證後實際的範圍 |
|---|---|---|
| ② `/pay/*` 死連結 | 一處假宣稱 | **兩處**——`messages.addonDowngradePaid` 是同一句話的第二個出處 |
| ⑦ 班別範本「已同步」 | 一句事後謊報 | **三句**——另外兩句是刪除範本的確認框與成功訊息 |
| ⑩ 商品訂單付款連結 | 一個捏造網址 | 網址背後是**一整塊沒有計劃的功能**（見下方 §6.11.3） |

#### 6.11.1 ⑦ 的第二、三句比第一句嚴重

`updated`「班別範本已更新（班表時間已同步）」是**事後**謊報。但
`deleteConfirm`「已套用此範本的班表會一併清除（日期變為「未排班」）」是**事前**謊報——
它請使用者確認一個不會發生的後果。店家可能因為「怕班表被清掉」而不敢刪範本，
或反過來以為刪掉就清乾淨了而沒去處理殘留的班表。

執行者的查證鏈（沒有採信派工單，也沒有採信程式註解，兩邊都自己驗）：
`0005_line_marketing_other.sql:101` 是 `on delete set null` 不是 cascade →
`shifts` 有自己的 `start_time`/`end_time` → `/api/shifts` 讀寫直接取自 `shifts` 列、
不從範本推導 → DELETE handler 沒有任何對 `shifts` 的寫入。**結論：註解是對的，畫面是假的。**

⚠️ 派工單當時明講「如果查證發現註解才是錯的、班表真的會被清除，就不要改文案，回報給我」。
這種「先給查證方向、再給兩種結論各自的行動」的寫法值得沿用——它讓執行者**可以推翻主導者**，
而不是只能選擇照做或停手。

#### 6.11.2 ⑩ 的示範資料取捨

`payLink` 直接清成 `''` 會讓示範資料失去「一張待線上付款的訂單長什麼樣」這個展示價值；
留著網址則是繼續騙人。執行者選的是第三條路：改成一個**不是網址**的旗標常數
（`PAY_LINK_NOT_BUILT`），只當「這張訂單原本需要線上付款」的標記，複製鈕停用並如實標示。

主導者複驗過**旗標不會外洩到畫面**：該值只出現在 truthy 判斷（badge 與按鈕的顯示條件），
沒有任何地方把它當字串渲染。這是採用「哨兵值」時必須驗的那一項——
哨兵一旦被印出來，就從「誠實」變成「畫面出現一串亂碼」。

#### 6.11.3 ⑩ 挖出一個新的缺口類型：**原站有、分冊沒有、所有 issue 都接不住**

執行者被要求「查證線上刷卡屬哪一個 issue，查到什麼寫什麼」，他查遍
`docs/integration/00`–`13` 與所有 open issue 之後回報「**沒有任何一冊或一個 issue 規劃它**」，
並且**拒絕虛構一個追蹤項目**——這一點是本輪最有價值的產出。

主導者複驗後發現缺口比他講的更大：

- `docs/specs/settings.json:735` `productOnlinePaymentEnabled` 定義了完整狀態機：
  「付全額成功 → 訂單自動變『已確認』；15 分鐘沒付 → 自動取消並把庫存還回來」
- 同檔 `autoConfirmEnabled` 提到**服務層級的「線上收款」**，以及付款完成後要不要自動確認
- `docs/specs/bookings.json` 的 jsStrings 有「複製付款連結」與「⚠️ 其中 N 筆**已線上收款**」

也就是說**一般預約也有線上收款**。而 #9 只做「收款方式」設定頁本身（它自己寫明
callback 屬建置-4）、#12 明確限定行程／團次訂單——整條顧客付款鏈從未進過任何計劃文件。
已開 **issue #32** 補齊。

⚠️ 這一類缺口與 §0 的根因 B（計劃漏掉）同源，但盤點方式不同：前幾輪是**從程式碼往回找**
（哪個按鈕沒接後端），這一筆是**從原站規格往前找**（原站有哪些行為，我們的計劃裡完全沒有
對應的章節）。後者抓得到前者抓不到的東西——因為一個從未被實作的功能，在程式碼裡沒有
任何痕跡可以被掃到。`docs/specs/*.json` 的 `jsStrings` 與 `jsApiCalls` 是這個方向的入口。

#### 6.11.4 指錯 issue 的文案，跟指錯的規格一樣會誤導人

② 停用付款連結時寫的是「詳見 issue #12」。查證後 #12 接不住它，已全部改指 #32
（`ad674ff`：i18n 文案、頁面註解、測試案例名一起改）。

留一個指向錯誤 issue 的「尚未建置」說明，比不留更糟：它看起來已經有人在追，
實際上那個 issue 不會做這件事——下一個人會因此不再檢查。
### 6.12 issue #29（跨頁引用走父層級）— 2026-08-25 完成（commit `23f732f`，驗收 2026-08-25 補齊）

§8.13 的現況表（「抽象層已經存在，但**零個地方在用**」）**已不再是現況**：
`MODE_PRESETS.catalogHref` / `.ordersHref` 現在有 11 個呼叫端，該表列的 11 處寫死
連結與 5 處寫死文案全部改走父層級。逐處 before/after 對照表貼在
[issue #29](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/29) 的驗收清單裡。

守門的東西（防止再長回來）：

| 種類 | 位置 | 變異測試（把任一處改回寫死時真的轉紅） |
|---|---|---|
| 路徑靜態鎖 | `tests/unit/mode-parent-links.29.test.ts`「src/app/tenant/** 與 src/i18n/zh-TW/pages/** 只有頁面自己可以出現 /tenant/{services,bookings,trips,tour-orders}」 | 把 `dashboard/page.tsx` 的「查看全部」改回 `/tenant/bookings` → FAIL |
| 文案靜態鎖 | 同檔「父層級的名稱只有四個子層級頁面自己可以寫死…」 | 把 `staff.ts` 的 `services` 改回「可承接的服務項目」→ FAIL |
| 三模式瀏覽器實測 | `scripts/verify/mode-parent-links.29.cjs` | GUIDE／LOCAL_SHOP／CLINIC 各跑一次，逐一比對頁面連結是否落在該租戶側邊欄內 |

⚠️ 該腳本對 `product-orders` 在 LOCAL_SHOP／GUIDE 量到了「來源預約／相關預約」兩條，
但在 **CLINIC 印的是 `[N/A]`**——那一組 mock 的 productOrders 沒有任何一筆帶
`bookingId`／`fromBooking`，瀏覽器實測**觸發不到**這兩條連結。腳本把它印成
「沒測到」而不是「通過」，這是對的（CLAUDE.md：FAIL 與「查不到」不可互相冒充），
該兩處改由路徑靜態鎖把關。

#### 由本輪驗收新發現、**未處理**的一處（§8.13-c 的補充）

`src/i18n/zh-TW/pages/product-orders.ts` 的 `labels.fromBooking`／`f.relatedBooking`
文案寫死「預約」用語：GUIDE 租戶的明細 Modal 會出現「本單為預約現場加購（至**預約列表**
查看）」，而連結本身已正確指向 `/tenant/tour-orders`。**連結對、名字不對**——同型於
§8.13-c 已列的 `bookings.ts`、`ai-settings.ts`，一樣落在 #29 的 5 處清單之外。
與 §8.13-b 一併等命名裁決，不要逐處補丁。

### 6.13 issue #16（QR Code 真實產生與下載）— 2026-08-25 完成（commit `e958b1d` ＋ `09d0c03`）

擁有者裁決見 §8.2（安裝 `qrcode`，不得自寫編碼器）。分冊點名落在
`01-ARCHITECTURE.md` §4（`qrcode` 1.5.4 精確版本；測試用 `jsqr` 1.4.0 ／ `pngjs` 5.0.0）；
`REBUILD-SPEC.md` §9.2 的「骨架用佔位框」已於本次驗收改寫為已完成狀態。

兩處實作共用 `src/lib/qr.ts`，內容各自不同且各自正確：

| 頁面 | QR 內容 | 下載檔名 |
|---|---|---|
| `/tenant/promote` | 公開預約網址（`publicUrl`） | `預約QRcode.png`（對齊 `docs/specs/promote.json:305`） |
| `/tenant/line-settings` | LINE 加好友連結（`addFriendUrl`） | `LINE加好友QRcode.png` |

#### 驗收補做的那一輪：**Preview 站**，不是骨架模式

施工當輪的 `scripts/verify/qr-download.cjs` 測的是本機 `next dev` 的骨架模式
（`NEXT_PUBLIC_USE_MOCK=true`，不登入、不連 Supabase）。在當時是合理的——那一輪還沒
push，Preview 上跑的是舊程式碼。但 issue #16 驗收清單寫的是「**登入 Preview 站**」，
兩者不是同一件事（真實登入、真實 Supabase、production build 的 client bundle，
骨架模式一項都沒走到）。因此本次補做 `scripts/verify/qr-download-preview.16.cjs`，
對 branch alias 的 Preview 站跑同一組斷言，**18/18 通過**，而不是把清單改成符合
已做過的事。

#### 一條沒打勾的驗收項（缺證據，留空）

清單第 3 項要求「對已知輸入的輸出與**公開標準向量**比對（version/mask），期望值
寫死並註明出處」。`tests/unit/qr-lib.test.ts` 的「已知輸入的健檢向量」只做了**往返**
（編→解 === 原字串），沒有任何公開標準向量的引用。可用的期望值只有 `qrcode` 自己
產出的中介資料——拿它來驗它自己等於自證，正是本冊反覆在清的那一類。
擁有者在 issue #16 的追加裁決留言已把驗收重點從「編碼正確性」移到「接線正確性」
並明說「不要花力氣去測 `qrcode` 套件本身」，這一項因此**可能已經作廢**，
但那是擁有者的裁決，不是執行者可以自行認定的——**留著不打勾，等裁決**。

### 6.14 issue #17（預約加購 `booking_addons` 後端全套）— 2026-08-25 完成

補齊 §5 點名的缺口：原站有預約加購（`docs/specs/bookings.json` 的 `jsApiCalls`
`/api/bookings/${b.id}/addons`、`/api/bookings/${bookingId}/addons/${itemId}`；
`REBUILD-SPEC.md:382–396` 的 6 個欄位含 `addonNotify`），我方後端零實作、
04 分冊 §B-1 零記載。本輪補：**04 分冊 §B-1.1 契約**（先寫規格再開工）、
migration **0020_booking_addons**（兩個 Supabase 專案皆已套用並以
`information_schema.columns` / `pg_policy` 驗證）、三支端點、`src/services/bookings.ts`
三支函式、`bookings` 頁真實接線。

#### ⚠️ issue #3 的「Phase 8b 排期」誤標：成因是**兩個同名但不同資料模型的 addons**

issue #3 把預約加購的後端標成「Phase 8b 排期」。Phase 8b／10 分冊 §5 的 addons 是
`/api/trips/:id/addons`（**行程加購**，資料表 `trip_addons`），與預約加購
（`booking_addons`）是兩個完全不同的資料模型：

| | 預約加購 | 行程加購 |
|---|---|---|
| 掛在 | `bookings`（服務預約） | `trip_departures` / `trip_plans`（行程團次） |
| 資料表 | `booking_addons`（0020） | `trip_addons`（Phase 8b） |
| 誰會用 | 三種模式**都會**用 | 只有開 `TOUR_MODULE` 的 GUIDE 租戶 |

CLAUDE.md 明令 `services` 與 `trips` 兩套庫存模型不得合併，所以這兩個 addons 從來
就不是同一件事；LOCAL_SHOP／CLINIC 租戶根本不會開 `TOUR_MODULE`，卻一樣需要預約加購。
**只因為名字一樣，一個「還沒排到」的功能就被歸到另一個功能的 Phase 底下，
於是它在計劃裡看起來「有人負責」，實際上沒有。** issue #3 內文已於本輪更正
（工作項 6），並在文首加了更正說明。

**同型風險（給日後看的）**：本專案還有其他同名不同模型的組合（例如「訂單」在
LOCAL_SHOP 是 `product_orders`、在 GUIDE 是 `tour_orders`；「加購」如上）。
在計劃文件裡看到一個名詞被歸到某個 Phase 時，要先確認**那個 Phase 講的是哪一個模型**，
不能只看名字對上就當成同一件事。

#### 「回沖」的定義（本輪定案，寫進 04 §B-1.1 與 route 檔頭）

`bookings.final_price` 是**流水餘額**而非推導值（`adjust-price` 絕對覆寫且不留紀錄、
`apply-coupon`／`apply-points` 都以目前的 `final_price` 為基底加減），所以刪除加購
**無法重算**，只能反向掉當初那一次異動：減去該列上存的 `applied_amount`
（建立當下真的加上去的數字），下限 0；時長同理。

已知**不精確**的兩種互動（不假裝沒有，且不猜）：

1. 加購後又套 **PERCENT 票券**：折扣連加購金額一起打了，回沖卻減全額 → 多減。
   例：1000＋加購200＝1200，九折→1080，刪加購→880（精確值 900）。
2. 加購後又**手動調價**：調價是絕對覆寫，回沖等於假設店家輸入的總價含這筆加購全額。

兩者都無法從資料判定，因此處置是**把確定的數字攤在使用者眼前**——刪除確認視窗直接
寫「預約金額將扣回 $X（這是該筆加購當初加上去的金額）」，並提醒調過價／用過打折票券
時要再確認總金額。這是 CLAUDE.md「不得已的取捨要寫在使用者讀得到的地方，不能只寫在
程式註解裡」的實作。整合測試把這個定義釘住
（`tests/integration/api/booking-addons.17.test.ts:「加購後手動調價、再刪除加購：回沖是「減去當初加上去的金額」，不是重算」`），
避免日後被「順手改成重算」。

#### 員工業績：**主導者裁示**的算法，不是原站考據結果

裁示（issue #1 comment-5412922443）：加購金額**計入**員工業績，算法為
「與主服務同一位服務人員、依實收金額全額計入」。實作上零額外程式——金額進
`final_price`，而 `/api/reports/staff-performance`、`/api/reports/top-staff` 就是
「`bookings.final_price` group by `bookings.staff_id`」。

⚠️ **算法是我們選的，不是從原站還原的**（裁示原文如此要求標註）。日後若查到原站
另有算法，要改的是算法，不是「要不要計入」。

##### 待覆核：原站文案指向的是「逐項歸戶」，與本裁示不同

`docs/specs/bookings.json` 的 `jsStrings[112]`（原站 DOM 掃描結果，不是我方文案）是：

> 此預約有 ${detailAddonCount} 筆加購明細。手動調整總價後，明細與總價將脫鉤
> （明細僅供參考、**師父業績仍按明細歸戶**）。確定要手動調價嗎？

而原站的加購表單有一個 `addonStaffSelect`，我方 i18n 原本照抄成
「執行 服務人員 （**業績歸戶**）」。兩者合起來指向的是**逐項歸戶**（依每筆加購自己的
服務人員），與本裁示的「一律歸本預約的服務人員」不同。

本輪**照裁示實作**（裁示本身已預告可被推翻），並做了兩件保命的事：

1. `booking_addons.staff_id` 照樣存下來——日後若改成逐項歸戶，不需要補資料。
2. **把會宣稱假事實的文案改掉**：加購表單的 `staffLabel` 拿掉「（業績歸戶）」並補
   `staffHelp` 明說業績實際歸給誰；`adjustPriceModal.withAddonsWarning` 不再說
   「師父業績仍按明細歸戶」，改講手動調價與回沖的真實互動。
   留著原句等於畫面宣稱一件程式沒有做的事（CLAUDE.md「Never fabricate a known」）。

**這一項需要擁有者覆核**：若原站確實是逐項歸戶，要改的是 `staff-performance` 的聚合
（把 `booking_addons.applied_amount` 依 `staff_id`／fallback 到 `bookings.staff_id` 分開計），
以及上述兩處文案。

#### `price = 0` 的判讀（issue 措辭有歧義，本輪定案並兩側都測）

issue #17 驗收寫「金額計算邊界（0 元／負數應拒絕）」，中文上可讀成「0 元與負數都拒絕」
或「列出 0 元與負數兩個邊界，其中負數應拒絕」。本輪採**後者**：`price = 0` 接受
（贈送／招待的項目要記得下來，只是不加錢；表單的加購價欄位提示就是「優惠價」），
`price < 0` 回 400。兩側都有測試案例，判讀寫進 04 §B-1.1，若擁有者認為 0 元也該拒絕，
改的是 `bodySchema` 一行與那一條測試。

#### `addonNotify` 未勾 → **零 LINE 請求**

斷言寫成「整個 `mock.requests` 為空」而不是「`/push` 沒有被打」（本專案既有慣例，
見 `line-events.ts` 的 SILENT 分支）。額度用盡時回 409 且零請求，**但加購本身仍寫入
且金額已生效**——409 的 message 因此必須寫明「加購已新增」，否則店家會以為整筆失敗
而重加一次。

#### Playwright 實測抓到的一個假的已知（本輪順手修掉）

第一輪對本機 dev server（接**正式** Supabase 專案＝Preview 站的同一個資料庫）跑
`scripts/verify/booking-addons.17.cjs` 時，「重整後加購仍在」那一條紅了。截圖顯示
**不是加購沒寫進去**——金額欄位已經是加購後的 `NT$1,700`——而是同一個視窗裡
「加購明細」寫著**無資料**。

成因：明細是開啟詳情之後才向 `/api/bookings/:id/addons` 取的（dev 模式一次 1〜5 秒），
那段期間畫面直接落到「空清單」的分支。也就是**「還不知道」被畫成「已知為空」**，
而且旁邊就擺著一個已經更新的金額——CLAUDE.md 說的「捏造的數值最糟的位置就是
擺在真實數值旁邊」，這裡是同一個形狀。

處置：明細區補上載入中狀態（`detailModal.addonLoading`），三態順序固定為
**載入中 → 載入失敗 → 無資料**，並以單元測試釘住
（`tests/unit/honest-not-built-interactions.test.ts:「明細載入中不得顯示「無資料」——那是把「還不知道」畫成「已知為空」」`）。
實測腳本也改成等「載入中…」消失，而不是睡固定秒數——睡太短就會在載入狀態下斷言，
那等於用一個不穩定的計時器決定紅綠。

⚠️ 值得記一筆的是：**這個缺陷單元測試與整合測試都抓不到**（一個不掛載元件、
一個不測 UI），是頁面層實測才看得見的那一類——正是 14 分冊 §1 C 項講的制度夾縫。

#### 沒有做的事（誠實列出）

- **付款狀態不隨加購變動**：舊文案 `messages.addonDowngradePaid` 講的是「加購把已付清
  推回已付訂金」，但我方 schema 的 `payment_status` 是 enum
  `UNPAID|PAID_ONLINE|PAID_OFFLINE|REFUNDED`，**沒有「已付訂金」這個狀態，也沒有
  `paid_amount` 欄位**（頁面上的「已收金額」目前是頁內假資料 `BOOKING_EXTRAS_*`）。
  在沒有金額型付款欄位之前，加購後降級付款狀態是做不到的，所以不做、也不宣稱做了。
  該鍵已於 `742f33d`（修復-1B）刪除，本輪沒有復活它。要真的做，前置是「預約的實收
  金額」欄位本身。

---

### 6.15 issue #31（webhook 同步處理完才回 200）— 2026-08-25

**缺陷**：`src/app/api/line/webhook/[shopCode]/route.ts` 把 LINE 的連線一路握到
所有事件處理完才回 200。LINE 逾時就丟掉那則訊息（redelivery 預設關閉），而**後端
每一步都成功**——錯誤只發生在 LINE 那一端，後台不會有任何異常可看。

**修法**：驗簽仍在回應之前，事件處理搬進 `after()`；驗簽前的兩趟 DB 併成一趟
（`tenants` 內嵌 `tenant_settings`）。規格與實測數據寫在 06 分冊 §3.1。

#### 這一節真正要留下來的，是量測方法（可複用）

**① mock 量不到真實延遲——這是一個結構性盲點，不是這次的個案。**

整合測試的假 LINE（`tests/helpers/line-mock.ts`）是瞬間回應的本地 server，
`next dev` 打它是 loopback。所以**「所有測試都綠」與「顧客收不到回覆」在這裡
完全可以並存**：測試量的是「有沒有呼叫」，不是「多久回得完」。

同型的盲點 CLAUDE.md「Never fabricate a 'known'」末段已經記過一次（單元測試不涵蓋
頁面、整合測試刻意不測 UI、e2e 只跑矩陣點名的地方 → 頁面接線不屬於任何一層；
本冊 §6.8-b 的 marketing 那一列也引用過同一句）。這次是**時間維度**的同一件事：
**沒有任何一層在量延遲**，所以延遲缺陷可以在全綠的情況下活很久。

> ⚠️ 順帶更正一個引用：issue #31 把這個盲點寫成「14 分冊 §7 記的」，但 §7 是
> 「三輪盤點：26 筆呼叫錯端點」，講的不是測試分層。出處是 CLAUDE.md，不是 §7。
> （這正是 15 分冊警告過的「附了一個不支持該主張的引用」——有引用比沒引用更可信，
> 所以引用錯的代價更高。）

> 規則：凡是「外部系統會等我們」的路徑（webhook、callback、OAuth redirect），
> 驗收證據必須包含**對真實外部系統的一次實測**，mock 不能代替。

**② 冷啟動要用「新部署的第一發」製造，不要靠等。**

「等到閒置再打」不可重現（要等多久沒有定論，而且別的 agent 隨時會打醒它）。
可重現的做法是：

```
# 用 Vercel CLI 從一份原始碼快照建立一個獨立的 preview 部署（不動分支別名）
npx vercel deploy <目錄> --yes --archive=tgz     # 目錄內放 .vercel/project.json 指向既有專案
# READY 後立刻打 LINE 官方測試端點，第一發就是冷啟動
POST https://api.line.me/v2/bot/channel/webhook/test  {"endpoint":"<新部署網址>/api/line/webhook/<shopCode>"}
```

兩個關鍵：
- `POST /v2/bot/channel/webhook/test` **收 `endpoint` 參數**（`line/line-openapi`
  的 `TestWebhookEndpointRequest`），可以指定任意網址，**不必動頻道設定**——
  改頻道 webhook 再改回來是會忘記還原的操作，能避就避。
- 「改前」也要用同一套流程量一次（同一份原始碼、同一種部署方式），否則你比的是
  兩種不同的冷啟動，不是同一個變因。

**③ 實測結果（原始 JSON 見 issue #31 回報）**

| | 改前（未修改的原始碼，新部署第一發） | 改後（同流程） |
|---|---|---|
| 冷啟動第一發 | `{"success":false,"statusCode":0,"reason":"REQUEST_TIMEOUT"}` | `{"success":true,"statusCode":200,"reason":"OK"}` |
| 接著連打 8 次 | 8/8 成功 | 8/8 成功 |
| 閒置 5–7 分鐘後第一發 | `REQUEST_TIMEOUT` | `success:true` |
| 閒置約 4 分鐘後第一發 | **`success:true`（沒重現）** | `success:true` |
| **閒置約 17 分鐘後第一發** | `REQUEST_TIMEOUT` | **`REQUEST_TIMEOUT`** |
| 零事件請求（我方直接打，暖機） | 1.15〜2.76s | 0.36〜1.39s |

⚠️ **第三列「改前也成功」如實留著**：這個缺陷是機率性的，閒置不夠久就不重現。
「跑一次沒事」不是沒問題的證據——所以冷啟動一定要用可重現的方式（新部署第一發）
製造，否則改前改後比的根本不是同一件事。

🔴 **第四列是本輪最該記住的一列：閒置夠久之後，改後的版本一樣逾時。**
所以 issue #31 那一格驗收（「改後必須看得到冷啟動那一發也回 success:true」）
**沒有達成，不能打勾**。`after()` 解決的是「事件處理佔用回應時間」，
解決不了「Lambda 冷啟本身佔用回應時間」——這兩件事被 issue 的標題綁在一起，
但它們是不同的原因。**量到什麼就寫什麼；四個回合裡有一個推翻了想要的結論，
那一個就是最有價值的資料。**（同一發在 Vercel Runtime Logs 是 `200`，
LINE 卻回報逾時——我們有回，是 LINE 先放棄。）

⚠️ **issue #31 原文說「暖機狀態下 8/8 成功」，重測發現不是永遠成立**：
2026-08-25 16:01 UTC 對當時的 Preview 連打 8 次，**第 1、第 4 發都逾時**。
所以精確的描述是「**我們的回應時間本來就壓在 LINE 的容忍線上**，冷啟動只是把它
推過去」——不是「只有冷啟動會出事」。

#### 順手更正兩處事實（issue #31 原文）

1. **webhook redelivery 的開關在 LINE Developers Console → 該 channel →
   Messaging API 分頁**，不是 LINE Official Account Manager。（官方文件原文；
   `line/line-openapi` 全文亦無寫入該開關的端點。）
2. **「AI 客服必逾時」目前在 Preview 上不成立**——`vercel env ls preview` 顯示
   Preview 環境**沒有 `ANTHROPIC_API_KEY`**，而 `src/server/ai-reply.ts:35` 在
   缺 key 時直接回 `null`，**LLM 從來沒被呼叫過**。也就是說 Preview 上的 AI 客服
   現在是完全靜默的（不是慢，是沒有跑）。程式路徑本身仍然真實，一旦補上 key
   就會照 issue 描述的方式吃掉回應時間——而那正是本次 `after()` 要擋的。
   **補 key 是擁有者的動作**（平台層 env，見 CLAUDE.md 的兩層設定表）。

#### 測試怎麼等 `after()`（不要用 sleep）

`await sleep(500)` 之後斷言有兩種壞法：正向斷言偶發紅燈，**反向斷言（「不該有
回覆」）偶發綠燈**——後者等於什麼都沒驗到，比沒有測試更糟。本輪用的是兩個
**確定性訊號**：

- **排空端點**：webhook route 在回 200 之前就把該次處理登記進模組內的 set，
  同路徑的 `GET`（**僅 `NODE_ENV!=production`**，正式部署維持 405）會 await 掉
  所有未完成的處理才回應，並回報 `scheduled`（累計排入過幾筆，單調遞增）。
  「驗簽失敗不得排入任何工作」就是拿 `scheduled` 前後相減來斷言的——
  不是「等了一下沒看到」。
- **把 mock LINE 的回應扣住**（`LineMockServer.holdNext()`）：事件處理卡在半路時，
  webhook 若還沒回應，測試就會一路等到逾時。**舊版跑這個案例必然紅、新版必然綠**，
  這條斷言真的有分辨力。

證據：`tests/integration/api/line-webhook.06.test.ts:「事件處理卡在 LINE 呼叫時，
webhook 早已回 200；放行後處理照常完成」`、`:「壞簽章 → 401；事件完全不進處理
（after() 沒有排入任何工作）」`、`:「LINE API 回 500 令 handler 丟錯 → webhook 仍
200、錯誤有留下紀錄，且同批後續事件照常處理」`。

### 6.16 issue #7（甲）Phase 6 零測試三組 ＋ B-6 報表測試 — 2026-08-26

§4「重開的 08 清單項」裡的四項，**重勾條件是「有對應的自動化案例且綠」**，
本輪補齊。四支測試檔全部只新增，未改動任何 `src/`（見本節末「未改動 src」）。

| 補的組 | 檔 | 案例數 |
|---|---|---|
| rich menu create/delete | `tests/integration/api/line-rich-menu.06.test.ts` | 7 |
| verify 五項全分支 | `tests/integration/api/line-verify.06.test.ts` | 16 |
| 預約狀態推播（line-notify） | `tests/integration/api/line-booking-notify.06.test.ts` | 7 |
| B-6 報表進階/匯出 | `tests/integration/api/reports-advanced.b6.test.ts` | 20 |

三處值得記下來的判斷：

**(1) 純色底圖那條不 import `src/server/png.ts`。** 拿受測程式自己的產生器當
期望值，等於用它證明它自己。改成依 PNG 規格自行解析上傳的位元組（簽章 → IHDR
寬高/位元深度/色彩型別 → inflate IDAT 讀第一個像素），期望值取自
`src/config/rich-menu-themes.ts` 的主題色。同一條案例也先斷言 bucket 真的沒有
`themes/{THEME}.png|jpg`——不驗前置條件的話，那條退路可能根本沒被走到。

**(2) verify 那一組除了逐項 pass/fail，另外釘死兩件事。** 這一節整個存在的理由
就是 CLAUDE.md 開頭那個「永遠紅的 AUTO_REPLY」，所以案例不只驗「各項回什麼」：
- **WARN 不得被算成 FAIL**：判準寫成 `!pass && severity !== 'WARN'`，逐案例斷言
  哪些是真失敗、哪些只是提醒。
- **報告在正常設定下真的能全綠**：`「五項全部通過」` 那一條。變異測試把
  AUTO_REPLY 改回「永遠 `pass:false`」時，紅的正是這一條——**一個永遠不可能全綠
  的檢查等於沒有檢查**，這條斷言就是它的探針。
`chatMode` 三態（`bot` / `chat` / 讀不到）各一條。

**(3) 「額度用盡 → 零請求」不能用固定秒數等。** 見下方 §6.16-a。

**未改動 `src/`**：本輪只新增 `tests/integration/api/*.test.ts` 四支，並在
`tests/helpers/line-mock.ts` 加了三個**純新增**的能力（`respondTo()` 覆寫單一路徑
回應、`failNextFor()` 只讓指定路徑的下一個請求失敗、紀錄裡多帶 `rawBuffer`
供驗二進位上傳）。既有預設行為一字未動，11 支既有的 line-mock 使用者實跑驗證
（見下）。

### 6.16-a 反向斷言不要用固定秒數：`expectNoPush` 的 1 秒窗口太短（實測）

`tests/integration/api/bookings-modified.27.test.ts` 的 `expectNoPush()` 是
「1 秒內持續斷言仍為零」。issue #7（甲）寫作時對 `src/server/line-notify.ts`
做變異測試（把額度閘門拿掉，讓額度用盡照樣推），結果：

- 本該轉紅的 `「confirm：額度填滿…」` **沒有紅**；
- 紅的是**後面兩個**案例——那則被錯誤送出的 push 在 1 秒之後才抵達 mock，
  於是汙染了下一個案例的紀錄，由它們去紅。

也就是說那種寫法的紅燈會落在**錯的案例**上，而在只有一個負向案例的檔案裡會
直接**假綠**。`notifyBookingStatus` 一趟要打 5~6 次遠端 Supabase 往返，
超過 1 秒是常態，不是機器慢。

**本檔改用障壁（barrier）**：受測動作觸發後，改在 **SHOP_B**（獨立的
`push_quota_usage` 列、獨立的 notify 設定、獨立的 LINE 憑證）觸發一則必定會推的
通知，等它抵達 mock，再斷言 mock 收到的請求**只有障壁那一則**。成立的理由是
兩條通知走同一支函式、同一組 DB 往返，而受測那次**更早**發動（障壁的 HTTP 請求
要等前一個回應完才送出）；兩次觸發之間**沒有任何 DB 寫入**（額度用不同租戶隔開，
不是靠改數字），所以也沒有「改到一半被讀走」的競態。換成障壁之後，同一個變異
紅在**正確的兩個案例**上。

斷言的對象是 **`mock.requests` 整個為空**（扣掉障壁），不是「`/push` 沒被呼叫」——
比照 `chat-link.06` 對 SILENT 分支的處理：斷言某一支沒被打，擋不住「改成打了別支」。

> **待處理（不在 #7（甲）範圍）**：`bookings-modified.27.test.ts` 的 `expectNoPush()`
> 仍是 1 秒窗口，依上面的實測它可能假綠。建議比照本檔改成障壁。

### 6.16-b `flex-menu.06.test.ts` 在整合分支上是紅的（16/38），與 #7（甲）無關

issue #7（甲）跑回歸時發現：`tests/integration/api/flex-menu.06.test.ts` 有 16 個
案例紅，症狀是「顧客打『選單』完全沒有回應」。

**不是 #7 造成的**——把 `tests/helpers/line-mock.ts` 還原成 HEAD 版本重跑，
16 個紅燈**一模一樣**。

根因：該檔的 `lineCallsFor()`（:66-85）在 webhook 回 200 之後**立刻**讀
`mock.requests`，沒有呼叫 `drainWebhook()`。issue #31（commit `d45c2ca`）把事件處理
搬到 `after()` 之後，200 就早於 reply 送出了——這支測試檔沒有跟著改。
`line-webhook.06` 已改（用 `tests/helpers/line-webhook.ts`），`flex-menu.06` 漏了。

修法：把 `lineCallsFor()` 的 `expect(res.status).toBe(200)` 之後補一行
`await drainWebhook(SHOP_A.shopCode, BASE_URL);` 再讀 `mock.requests`。
本輪未動它——它屬 issue #6 的驗收檔，改動應由該 issue 的負責人做，以免兩邊互踩。

### 6.17 issue #18（LINE 老闆通知 owner-notify 全套）— 2026-08-26 完成

補齊 §5 第 7 項：原站有一組「老闆通知」（`docs/specs/dashboard.json` 的 `jsApiCalls`
四支路徑＋二十餘句 `jsStrings`），我方 `grep -rn "owner-notify|ownerNotify|通知名單|接收者" src/`
零命中、06 分冊零記載。本輪補：**06 分冊 §5.5 契約**（先寫規格再開工）、
migration **0022_owner_notify**（兩個 Supabase 專案皆已套用並以
`information_schema.columns` / `pg_indexes` / `pg_policies` 驗證）、四支端點、
`src/server/owner-notify.ts`、`GET /api/cron/owner-reminders`、
`src/services/settings.ts` 六支函式、儀表板名單 UI。

#### 複驗結果：改寫後的 issue 與 `docs/specs/dashboard.json` **完全一致**

2026-08-25 的改寫（從「一次性綁定碼」改成「從好友清單挑人＋本人認領＋多接收者
＋一位主要」）逐條複驗過，四支端點路徑、二十餘句逐字文案全部對得上。
**只找到一筆與程式碼／規格不符的敘述，而且是在派工單而非 issue 內文**：

> 派工單提醒「`bind` 那一步是顧客在 LINE 裡點的，要用 `drainWebhook()` 等」。

實際：`bind` 是**後台儀表板上的按鈕**——`jsApiCalls` 把
`/api/settings/line/owner-notify/bind` 列在 dashboard 頁的呼叫清單裡，確認文案
「確認是您本人嗎？」是後台的 confirm 視窗。整條流程**不經過 webhook**，
`handleEvent`（§3）因此不需要、也不得為此新增任何分支。

#### 三件規格沒有回答、由我方決定並在文件標明的事

| 決定 | 是誰決定的 |
|---|---|
| `maxRecipients = 3` | **擁有者裁示**（issue #1 裁示總表）。理由：額度 200 則/月、每次發 n 位吃 n 則 |
| 不納入「顧客自行取消」觸發 | **擁有者裁示**。規格只載明新預約與訂閱到期／儲值提醒 |
| `:id` ＝ `line_user_id`；`NO_RECIPIENTS` 第四態；儲值提醒門檻＝「餘額 < 即將到期訂閱的續訂所需」 | **我方設計**，逐項寫在 06 §5.5 並標明 |

「移除最後一位」**不在**上表——它是規格逐字寫的：
`這是最後一位接收者，移除後將不再收到 LINE 即時通知。確定移除？`
所以行為就是「名單為空、之後不再發送」，不需要任何人裁決。

#### 這一輪特別要記的兩件測試設計

1. **額度斷言必須與人數連動，而且至少測兩種 n。**
   規格逐字是「每次通知會同時發給 ${n} 位（消耗 ${n} 則推播額度）」。
   驗收若寫成「收到恰好一則、額度 +1」就釘錯數字——n=1 時，
   `consumePushQuota(tenantId, 1)` 與 `consumePushQuota(tenantId, recipients.length)`
   看起來一模一樣。本檔因此有 n=1／n=3／n=0 三個案例；變異測試把它改回寫死 1
   之後，n=3 那條如預期轉紅（n=1 那條仍綠——這正是為什麼要兩種 n）。

2. **「一租戶最多一位主要」必須是 DB 約束，不是應用層判斷。**
   應用層的「先 count 再 insert」在併發下兩個請求都會讀到 0 位主要。
   0022 用部分唯一索引 `on (tenant_id) where is_primary`；
   `addOwnerNotifyRecipient` 撞 23505 時退回「非主要」再寫一次。

#### 沒有做的事（留白，不要當成做完）

- 驗收清單的「額度用盡時…狀態標示 `notified:false` 與原因」**沒有實作也沒有打勾**：
  老闆通道是 fire-and-forget（`void notifyOwnerNewBooking(...)`，同 §5 規約），
  建立預約的回應與 `bookings` 列都沒有地方承載這個結果。已驗的是
  「額度用盡 → 預約仍成立、一則都不發、額度不變」。要補這一格需要先決定
  它要顯示在哪裡（多一個欄位而沒有畫面讀它，就是另一種假的已知）。
- Playwright 對 Preview 站的實測**未執行**：本輪的程式碼還沒 push，Preview 上沒有
  這些端點與畫面；而在整合測試跑完之後另起第二個 `next dev` 會踩壞 `.next`
  快取（15 分冊「實測腳本的兩條慣例」）。合併並部署後補做。

## 9. 第四輪盤點（2026-08-25）：從**原站規格往前找**，而不是從程式碼往回找

前三輪都是從程式碼往回找——掃「哪個按鈕沒接後端」「哪個成功訊息不是它宣稱的端點做的」。
那個方向有一個結構性盲點：

> **一個從未被實作的功能，在程式碼裡沒有任何痕跡可以被掃到。**

本輪改成把每個 `docs/specs/*.json` 的 `jsApiCalls`（原站 JS 實際會呼叫的路徑）抽出來，
對照我方 `src/app/api/**` 的 145 支 route，再逐字讀 23 個 open issue 的**內文**判斷涵蓋範圍。

### 6.16-c 已修（`940dae4`），以及**主導者為什麼會漏掉它**

修法就是 §6.16-b 說的那一行：`lineCallsFor()` 拿到 200 之後 `await drainWebhook(...)`。
38/38 綠。

值得記的是漏掉的原因，因為它是一個會重複發生的形狀：

`#31` 的 commit 訊息寫著「**既有整合測試因此改用確定性的等待**」。主導者合併時
照單接受了那一句，只跑了 `line-webhook.06` / `chat-link.06` / `keyword-replies.05`
三檔就放行。**實際上「既有」只涵蓋 `line-webhook.06` 一檔**——`flex-menu.06`
也是既有的、也吃同一條路徑，但沒有被改。

> **一句「既有的都改了」不是證據，「既有的有哪些」才是。**
> 一個行為變更影響了哪些測試檔，要用機器列（例如 grep 出所有讀 `mock.requests`
> 的整合測試），不能靠寫 commit 的人記得。

這與 15 分冊「派工單裡的事實陳述也要先查證」是同一條原則，只是這次的來源不是
派工單而是 commit 訊息——**任何一句概括性的陳述（「都」「全部」「既有的」）
都要展開成清單才算數。**

⚠️ 連帶的教訓：**合併的閘門不能只跑「我覺得相關」的那幾檔。** 這一輪之所以會被
發現，純粹是因為下一位執行者剛好動到 `line-mock.ts` 而跑了那一檔，並且**自己
證明了不是他造成的**（還原 `line-mock.ts` 到 HEAD 仍重現同樣 16 條）才回報。
如果他沒動到那個檔，這 16 條紅燈會一路留著。

### 9.1 三方對照結果（195 支原站端點）

| 判定 | 支數 |
|---|---|
| 已實作（路徑直接對上） | 128 |
| 已實作（正規化雜訊，實為同一支） | 4 |
| 已實作（路徑不同但功能等價，且我方有明文理由） | 5 |
| 未實作但已有 issue 涵蓋 | 52 |
| **未實作且無人認領** | **6** → issue #33 |

6 支無人認領的裡面，`POST /api/product-orders/:id/apply-coupon` 不只是缺口，
它對應的前端是**活體假成功**：`product-orders/page.tsx` 寫死
`const discount = withCoupon ? 100 : 0`，然後顯示「票券已套用！折抵 NT$100」，
並把這個 100 加進訂單詳情的「票券折抵」欄位——**一個捏造的金額顯示在真實訂單金額旁邊**。
票券代碼從未離開瀏覽器。原站那句 toast 的金額來自 API 回應（`couponRes.data?.couponDiscount`）。

### 9.2 比缺口更有價值的發現：**六個 issue 的範圍與規格不符**

盤點的副產品，其中兩個嚴重到照現況施工會浪費整輪：

**#20 clinic-queue —— 端點、資料模型、狀態機三者全錯**

- 原站是 `/api/clinic-queue/sessions{,/:id,/day-board,/day-override,/lock-preview}`；
  #20 寫的五支（`/tickets`、`/tickets/:id/call`、`/skip`、`/settings`）**一支都不存在**。
- #20 明令「不得塞進 `bookings`」，但規格顯示掛號／取消／完診走的就是 `/api/bookings`，
  且 `calendar.json` 的 jsStrings 顯示 `queueNumber` / `queueSessionName` 是 **booking 的欄位**。
- **原站沒有「叫號」也沒有「過號」**。主導者複驗統計 `clinic-queue.json` 全文：
  `叫號` 0 次、`過號` 0 次、`發號` **6** 次、`看完診` 2 次、`爽約` 1 次。
  #20 的「併發叫號測試」釘的是不存在的動作——該保護的是**發號**的併發。

  ⚠️ 這裡原本寫「`發號` 5 次」，是主導者自己的統計腳本錯了：它用
  `set(re.findall('.{0,28}發號.{0,28}', s))` 收集**帶上下文的片段再去重**，
  兩個上下文相同的出現會被 `set()` 併成一筆。改用 `len(re.findall('發號', s))`
  才是 6。改寫 #20 的執行者發現並回報。
  0 次的那兩個不受影響（去重後是 0，去重前也是 0），本節的結論不變——
  但**一個把「出現次數」算成「不同上下文數」的統計，恰好也是一種「量了 A、寫成 B」**，
  記在這裡提醒下一個人：貼數字之前先確認那個數字是什麼的數字。

- **`爽約` 在本頁只是顯示，沒有動作**。`clinic-queue.json` 的 `jsApiCalls` 沒有
  `/no-show`，那支在 `calendar.json`。狀態機不能把它寫成本頁的一條轉移。
- 原站真正的核心規則（總號數／前 N 號現場保留／奇偶分流／鎖定號碼／整天休診／當日上限）
  **#20 一句未提**，而我方前端早就照這套寫好了。
- LINE 通知掛錯動作：規格是「發號**不**通知（請口頭告知）／取消**才**通知」，#20 掛在發號上。

**#18 owner-notify —— 單人綁定碼 vs 多接收者名單**

規格是「從已 follow 的好友清單挑人 → 本人確認綁定 → 加入/移除通知名單，有上限與一位
『主要』接收者」。#18 設計的是「後台產一次性綁定碼」——**規格裡沒有綁定碼**。
連帶讓 #18 的驗收「mock LINE 收到恰好一則、額度 +1」釘錯數字（規格：同時發給 n 位、消耗 n 則）。

其餘四則：#22 的「settings 三支雜項」實際是 0 支（會留下一個永遠打不了勾的格子）、
#19 的 `preview-custom` 不存在（規格有的是 `preview-scene-flex`）、
#24 把原站單支 `dashboard` 拆成兩支、#21 漏了 `/api/external-calendars/events`。

### 9.3 主導者因此撤回兩項裁示

見 issue #1 的[撤回留言](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/1#issuecomment-5413898457)。
教訓已寫進 15 分冊：**採用一個問題的預設答案，等於連同這個問題的前提一起簽收了**。
拿到人工介入點時要先問「這個概念在原站存在嗎」「規格是不是已經回答了」，
確認過才輪到「要不要採預設」。

### 9.4 本輪方法的侷限（給下一輪，這一節與結果同等重要）

`jsApiCalls` 抓得到「後台頁面會 fetch 哪些路徑」，抓不到以下六類——**這些方向本輪完全沒掃**：

1. **HTTP method 與 request/response 形狀**。判定「已實作」時只能確認路徑存在，
   無法確認 method、body、回傳欄位與原站一致。下一輪應改用 `docs/specs/*.json` 的
   `forms` / `modals` / `tables` 欄位反推契約。
2. **SSR／表單 POST／非 fetch 導頁**。`_endpoints.json` 沒有任何 `/pay/*`、`/s/{shopCode}`
   這類**頁面路由**——#32 那條顧客付款鏈是靠讀 jsStrings 才挖出來的。
   **公開站（顧客端）的整個路由樹在這份規格裡幾乎不可見。**
3. **純前端行為**。排序、篩選、驗證、彈窗狀態機全部不會出現——§7 抓的那類
   「只改本地 state 的假成功」，這個方法**結構上抓不到**。
4. **webhook 與外部進來的流量**。LINE webhook 的事件分支、cron、金流 callback 都不在
   `jsApiCalls`（那是「我們會打誰」，不是「誰會打我們」）。issue #31 那類問題不在射程內。
5. **反向差集：我方有、原站沒有的端點**。我方 145 支裡有 `/api/trips/*`、`/api/demo-data`、
   `/api/cron/*` 等不在原站清單裡的——**有沒有孤兒端點（有實作、有測試、零呼叫端）沒查**。
   issue #7 提過 `available-slots` 是「綠燈孤兒」，那一類值得單獨掃一輪。
6. **`docs/specs` 自身的覆蓋率**。40 個檔看起來對應約 40 頁，但**沒有任何檔對應 GUIDE
   業態的 trips / tour-orders 頁**。若原站有那些頁而規格沒抓到，這個方法對它們全盲；
   若原站沒有（行程域是新增功能），那 #8/#10/#11/#12/#13 整條 tour 鏈**沒有原站事實來源
   可對照**。這件事目前無法從現有材料判定，下一輪應先確認。

## 10. 第五輪盤點（2026-08-25）：**反向差集——孤兒端點**

§9.4 自己列的第 5 個盲區：前四輪都在問「原站有的我們有沒有」，沒問過**「我們做了但沒人用的有哪些」**。

一支端點**有實作、有整合測試、全綠**，卻沒有任何頁面呼叫它——這在本專案已經出現過
（`/api/bookings/available-slots`、`flex-menu.ts` 的 FLEX_POPUP 分支）。**找到一支意外孤兒，
通常代表某一頁有一顆假按鈕。**

### 10.1 結果：153 支 route × method，37 個孤兒

（順帶更正：§9 寫的「145 支 route」已過期，實際 153。）

- **(甲) 刻意孤兒 3 支**——功能未到接線階段，且**程式碼或分冊裡有誠實標註**。
  可接受；判定 (甲) 的必須指出標註寫在哪一行，找不到就不是 (甲)。
  ⚠️ `available-slots` 的標註只在 14 分冊 §4，**route 檔本身沒有**——標註應該寫在
  下一個人會讀到的地方。
- **(乙) 意外孤兒**——端點好了、測試綠了，頁面那頭還是假的。多數已有 issue 歸屬
  （#7 佔最多，其次 #8、#28），**8 支無人認領**。

### 10.2 最嚴重的一筆：全站外框吃寫死常數（已開 issue #34）

`src/components/layout/AppShell.tsx` 是每一頁都會經過的外框，它**無條件**（沒有任何
`USE_MOCK` 分支）把三個寫死的常數送進畫面：

```
:159  counts={MOCK_SIDEBAR_COUNTS}        → 側邊欄紅點數字 3 / 2 / 5
:170  setupPercent={MOCK_SETUP_STATUS.percent}  → 開店進度 60%
:169  userName={MOCK_USER.name}
```

**為什麼這比一般的假成功更嚴重**：一顆假按鈕，使用者按下去遲早會發現沒反應；
這三個值**不需要任何互動就會顯示，而且看起來完全正常**。店家一登入就看到
「待確認預約 3」，點開一筆都沒有；「開店進度 60%」在他把每一步做完之後還是 60%。

而且在 `NEXT_PUBLIC_USE_MOCK=false` 之後**不會報錯、不會變空、不會有任何跡象**，
**也沒有任何測試會紅**——測試也拿得到同一組常數。

更值得記的是：`GET /api/product-orders/pending/count` 與 `GET /api/auth/me`
**都已經實作好了，而且正是這塊外框該用的端點**——它們就在孤兒清單上。
後端做好了、前端沒接，中間隔著一組寫死的常數。**這不是「還沒做」，是
「做了但沒接上，而畫面用假資料補了空缺」**——後者難發現得多。

### 10.3 掃描方法本身值得記的兩件事

**一、自動掃描把 4 支誤判成「有呼叫端」**，因為命中的是頁面裡「原站 `/api/xxx`」
這種**註解**。執行者逐筆開檔複驗才發現。註解裡的路徑不是呼叫端。

**二、也抓到反方向的誤判**：`(cond ? a : b)(args)` 這種呼叫形式讓 6 支 reorder 函式
一度被誤判成孤兒；`import { switchTenant as switchTenantApi }` 的別名同理。
**「grep 不到」與「沒有呼叫端」之間隔著一整套呼叫寫法。**

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
