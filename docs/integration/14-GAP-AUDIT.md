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
> 驗證方式以自動化為原則（單元/整合/Playwright 對 Preview 站實測，憑證自
> Google Drive「#Supabase#midao」文件自主撈取）；人工只保留各 issue 列名的
> 決策點與缺 token 時的 env 補填。

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
