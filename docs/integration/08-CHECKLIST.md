# 08 — 總驗收清單（執行時照抄成 todo，逐項打勾）

> 每個 Phase 結束都要：`npm run typecheck` ✅、`npm run build` ✅、
> `NEXT_PUBLIC_USE_MOCK=true` 模式全站行為不變 ✅，
> **12 分冊 §4 該 Phase 的測試矩陣全綠 ✅（Definition of Done = 12 §6）**，
> 再加該 Phase 專屬項目。本清單的每一項都必須有對應的自動化測試，
> 只有無法自動化的（收信、LINE 手機實測）才允許人工驗收並記錄。

## 打勾規則（2026-08-24 稽核後加嚴；14 分冊記錄了為什麼）

1. **每一勾必須在打勾處註明證據**：`測試檔名:案例名`，或人工驗收的
   `日期＋操作步驟＋觀察到的結果`。寫不出證據＝不得打勾。
2. **驗收項描述的是使用者功能時，「API 測試綠」不是打勾證據。**
   必須舉證頁面 handler → `src/services/*` → 端點這條鏈路完整
   （E2E 斷言副作用，或最低標準：靜態核對 + 該端點的整合測試綠，12 §6 第 10 條）。
   先前「rich menu 建立/發布」就是只憑 API 測試打勾，頁面按鈕其實從未呼叫後端。
3. **成功訊息是驗收對象**：操作後顯示成功的每一條路徑，都要能回答
   「副作用寫到哪裡了？重新整理後還在嗎？外部系統（LINE/DB）真的變了嗎？」
   三題任一答不出來就是假成功（鐵則 12），該項不但不能打勾，還要立案修。
4. 曾打過的勾若被稽核推翻，作廢重開（見 14 分冊 §4 的重開清單），
   重勾照本規則重新舉證。

## Phase 0 追加 — 測試基礎設施（12 分冊）
- [ ] vitest + playwright、tests/ 骨架、fixtures、TEST Supabase 專案、reset-db 安全鎖
- [ ] CI（check + integration jobs）上線，故意紅燈驗證關卡有效

## Phase 0 — 環境（01 分冊）
- [ ] Supabase 專案建立，四組憑證取得
- [ ] `.env.local` 與 Vercel env 填妥；`.env.example` 更新
- [ ] `@supabase/supabase-js`、`@supabase/ssr`、`resend` 安裝完成
- [ ] `src/server/{http,supabase,tenant,crypto,mappers,paging}.ts` 建立
- [ ] env 全空 + mock 模式仍可 build（鐵則 10）

## Phase 1 — Schema（02 分冊）
- [ ] migrations 0001–0008 依序執行成功
- [ ] 未登入 anon 查 customers 回空（RLS）
- [ ] 重疊預約被排除約束擋下
- [ ] `bookings_view` / `customers_view` 正常
- [ ] dev seed 建立 demo-shop（選用）

## Phase 2 — 登入（03 分冊）
- [ ] 10 個 auth 端點全部實作且回信封格式
- [ ] `src/middleware.ts` 保護 `/tenant/*`，4 個認證頁例外
- [ ] `src/services/auth.ts` 建立並在 index.ts export
- [ ] 4 個認證頁接線（只動 handler，不動版面）
- [ ] 註冊→登入→登出→忘記→重設 全流程通
      **（重開 2026-08-24：Topbar 登出只是 `<Link>` 導頁，從未呼叫 POST /api/auth/logout，
      session 不失效；e2e 用 clearCookies 代打遮掉了這件事。重勾條件：登出按鈕真的
      呼叫端點＋e2e 改為點按鈕後斷言 session cookie 已失效）**
- [ ] 跨租戶隔離測試通過（兩帳號兩店互看不到）

## Phase 3 — 核心 API（04 分冊 §A）
- [ ] A-1 settings 7 端點（含 secret 遮罩/空字串不覆蓋規則）
- [ ] A-2 bookings 5 端點 + 狀態機
- [ ] A-3 customers 4 端點
- [ ] A-4 catalog 6 端點
- [ ] A-5 reports 3 端點
- [ ] `USE_MOCK=false` 後 11 個核心頁面正常載入真資料
- [ ] 錯誤碼表行為抽查：401/403/404/409 各測一例

## Phase 4 — 寄信（05 分冊）
- [ ] Resend key + 網域（或過渡 resend.dev）
- [ ] `src/server/email/{send,templates}.ts`
- [ ] 驗證碼信、預約通知信實際收到
- [ ] notify 開關生效；寄信失敗不影響 API

## Phase 5 — 進階 API（04 分冊 §B）
建議實作順序（前面的頁面使用率最高）：
- [ ] B-1 預約進階（available-slots、手動建立、calendar、block-times）
      **（重開 2026-08-24：block-times 頁完全未接線、available-slots 無任何頁面使用）**
- [x] B-1.1 預約加購 `booking_addons`（issue #17，2026-08-25）
      證據：契約 `04-API-CONTRACTS.md §B-1.1`；migration `0020_booking_addons`（兩個
      Supabase 專案皆已套用並以 `information_schema.columns` / `pg_policy` 驗證，
      輸出貼在 issue #17 留言）；端點測試
      `tests/integration/api/booking-addons.17.test.ts`（17 例全綠：CRUD／回沖／0 元與
      負數邊界／加購後調價再刪除／跨租戶 404／notify 三態／額度 409 零請求）；
      頁面接線鏈路對照表與單元守門
      `tests/unit/honest-not-built-interactions.test.ts:「bookings 加購 modal（已接上真實後端，且不得宣稱超出實際發生的事）」`
- [ ] B-2 服務/員工/班表 CRUD
- [ ] B-3 商品/訂單/庫存
- [ ] B-4 票券/會員/點數
- [ ] B-6 報表進階/匯出 **（重開 2026-08-24：零測試檔）**
      **2026-08-26（issue #7 甲）：重開理由「零測試檔」已消除，但本項仍不打勾。**
      測試檔已建立並全綠：`tests/integration/api/reports-advanced.b6.test.ts` 20/20，
      含 `:「顯式區間：totalBookings／totalRevenue／completedBookings／newCustomers 與直查資料庫現算相符」`、
      `:「totalCustomers／activeCustomers／avgVisitCycle／avgCustomerValue／serviceTrends 與直查現算相符」`、
      top-services／top-products／top-staff 各一條、
      `:「表頭八欄、資料筆數等於資料庫筆數、UTF-8 BOM 與 attachment 標頭」`、
      `:「表頭八欄、筆數等於該店顧客數（含停用），檔名為 .csv 而非謊報 .xlsx」`、
      `:「csv：五個區塊表頭齊全、統計區間正確、每日趨勢逐日補 0（區間天數）」`。
      變異驗證：把 summary 的營收口徑改成「不分狀態全算」、把 export/bookings 的
      UTF-8 BOM 拿掉 → 對應三條轉紅。
      **不打勾的理由**：本項的範圍不只端點——bookings 頁與 customers 頁的「匯出」
      按鈕目前仍是死按鈕（`/api/export/bookings`、`/api/export/customers/excel`
      零呼叫端，已列入 issue #28 第 ③④ 筆）。端點有測試 ≠ 使用者匯得出來
      （12 分冊 §6 DoD 10、鐵則 12）。頁面接線關閉後才可打勾。
- [ ] 每做完一組，對應頁面實測 CRUD 一輪
      **（重開 2026-08-24：無完成紀錄；依打勾規則 1，每頁的實測要留下日期＋步驟＋結果）**
- [ ] 【新增】頁面接線驗收：本 Phase 涉及的每個頁面，其所有寫入按鈕都經過
      `src/services/*` 呼叫真端點——逐頁列出「按鈕 → service 函式 → 端點」對照表
      作為證據；發現本地假成功（只 setState + toast）＝該頁不通過（14 分冊 §1 有已知清單）

## Phase 5.5 — 功能商店（09 分冊）
- [ ] migration 0011（訂閱欄位擴充 + subscribe_feature rpc + ai jsonb）
- [ ] `FEATURE_CATALOG`（22 項）移入 `src/config/features.ts`
- [ ] 訂閱/續訂/取消/恢復 + 套裝 LITE/PRO + 升級規則
- [ ] `src/server/features.ts` 閘門 + 對應表逐條套用（3 位員工上限、20 組關鍵字、EXTRA_PUSH 額度 700）
- [ ] cron feature-expiry 副作用與 restore 自動還原
- [ ] 點數儲值 MVP（501 + 客服文案）；金流供應商決策留待平台擁有者
- [ ] AI 客服（選配）：ai-settings 儲存 + webhook AI 回覆 + UNSURE 轉人工

## Phase 6 — LINE（06 分冊）
- [ ] `src/server/line.ts`、webhook route、簽章驗證
- [ ] follow/message 事件處理 + keyword replies + 預設回覆
      **（重開 2026-08-24：webhook 側 OK，但 keyword-replies 管理頁整頁假——載入吃
      mock、儲存/刪除/啟停只 setState，店家設的關鍵字進不了 DB。重勾條件：頁面接線
      ＋端到端案例「UI 存一組關鍵字 → webhook 收該字 → mock LINE 收到設定的回覆」）**
- [ ] chat 頁雙向訊息
- [x] 預約狀態推播 + 額度控管
      **（重開 2026-08-24：line-notify 實作在但 tests/ 全域零引用，推播路徑的額度
      控管零覆蓋。重勾條件：12 §4 補列的 line-notify 案例綠）**
      **重勾 2026-08-26（issue #7 甲，14 分冊 §6.16）**：
      `tests/integration/api/line-booking-notify.06.test.ts:「confirm → mock LINE 收到「預約已確認」push，推播額度 -1」`、
      `:「cancel → mock LINE 收到「預約已取消」push，推播額度 -1」`、
      `:「complete → mock LINE 收到「感謝您今日的光臨」push，推播額度 -1」`、
      `:「no-show → mock LINE 收到「我們今日未能等到您」push，推播額度 -1」`、
      `:「confirm：額度填滿 → 整個 mock 一個請求都沒收到，API 仍 200、預約仍轉成 CONFIRMED」`、
      `:「complete：額度填滿 → 零 LINE 請求，但完成動作與其副作用照常成立」`、
      `:「notifyBookingNoShow=false → no-show 仍 200，但零 LINE 請求、額度不變」`（7/7 綠）。
      變異驗證：拿掉 `src/server/line-notify.ts` 的額度閘門 → 上列兩條「額度填滿」轉紅（14 分冊 §6.16-a）。
- [x] rich menu 基本建立/發布
      **（重開 2026-08-24：原勾時頁面按鈕從未呼叫後端＝假發布，已於 commit 3a7429b
      修正接線並用真實 LINE 頻道驗證；重勾條件：12 §4 補列的 create/delete 整合案例綠）**
      **重勾 2026-08-26（issue #7 甲）**：
      `tests/integration/api/line-rich-menu.06.test.ts:「建立 → 傳圖 → 設預設：mock LINE 依序收到三個請求，richMenuId 寫回 tenant_settings.line」`、
      `:「無自訂底圖且 bucket 無主題圖 → 退回現生成的純色 PNG（不是 404）」`、
      `:「傳圖失敗 → 剛建立的選單被刪掉（LINE 端不留孤兒）、不設預設、richMenuId 不落庫」`、
      `:「已發布 → mock LINE 收到 DELETE，且 jsonb 的 richMenuId 被清空」`、
      `:「沒有已發布選單 → 冪等回成功，且不打 LINE」`（7/7 綠）。
      變異驗證：拿掉 create 的 `lineSetDefaultRichMenu` 呼叫 → 第一條轉紅。
- [x] verify 五項檢查
      **（重開 2026-08-24：端點零測試，曾長期帶著 AUTO_REPLY 假錯誤無人發現。
      重勾條件：五項各自的 pass/WARN/FAIL 分支都有 line-mock 整合案例）**
      **重勾 2026-08-26（issue #7 甲）**：`tests/integration/api/line-verify.06.test.ts` 16/16 綠，
      含 `:「五項全部通過：報告在正常設定下真的能是全綠（沒有任何 FAIL，也沒有任何 WARN）」`、
      `:「未設定 Channel Access Token → 五項全 fail、統一提示，且一個 LINE 請求都不發」`、
      chatMode 三態 `:「chatMode=bot → AUTO_REPLY 通過（不是永遠的紅色失敗）」`／
      `:「chatMode=chat → AUTO_REPLY 是 WARN 而非 FAIL，其餘四項仍全綠」`／
      `:「chatMode 讀不到（/v2/bot/info 回應沒有這個欄位）→ AUTO_REPLY 是 WARN 提醒，不是失敗」`，
      以及 TOKEN／WEBHOOK／RICH_MENU／QUOTA 各自的 pass 與 FAIL/WARN 分支。
      變異驗證：把 AUTO_REPLY 改回「永遠 `pass:false`」→ 「五項全部通過」那條轉紅
      （＝那條斷言真的在防「報告永遠不可能全綠」）。
- [ ] 【新增】webhook 關鍵字覆蓋：`MODE_PRESETS.richMenuCells` 三業態每個格子送出的
      文字都有對應回覆分支；系統關鍵字 15 組含同義詞正確分派；`systemGroupDisabled`
      停用的組不回應（06 §3 修正後規格）
- [x] 【新增】flex-menu 端到端：設定頁存主選單 → webhook 收「選單」→ mock LINE
      收到依設定組出的 Flex Message；flexMenuEnabled=false 時依 fallback 設定回應
      **（2026-08-25 打勾。打勾的依據是本項自己的定義——「存主選單 → webhook 收
      『選單』→ mock LINE 收到 Flex；關閉時依 fallback 回應」——這幾件事逐條有證據；
      §6.9-c 當初卡住這一項的「Preview ＋ 真實 LINE 實測」也補做了。
      ⚠️ 但 issue #6 的第 5 條驗收**仍留白**，見底下最後一行；14 分冊 §6.9-d 記完整證據。）**
      - 單元 100 綠：`tests/unit/flex-menu.06.test.ts`（空卡片／1 張／12 張／
        含廣告卡／`{shopName}` 替換／HINT・SILENT 分支）
      - 整合 38 綠：`tests/integration/api/flex-menu.06.test.ts`
        （`存 N 張卡片 → 顧客打「選單」→ 收到 flex，carousel 有 N 個 bubble`、
        `SILENT → **整個 mock.requests 為空**（bot 真的閉嘴，一則請求都沒發）`）
      - 真實 LINE：`scripts/verify/flex-menu-validate.cjs`
        （官方 `POST /v2/bot/message/validate/reply`，正向 11／負向對照 4／
        scheme 探測 21，不符預期 0；不耗推播額度）
      - Preview 站自主實測：`scripts/verify/flex-menu-preview-live.cjs`
        （編卡→發布→重整仍在→簽章 webhook「選單」→ 正式 DB 留下該事件的
        chat_messages 列 → 逐字還原並清理）
      - 出站 reply 側錄：`scripts/verify/flex-menu-reply-capture.cjs`
        （同一 commit、同一份正式資料，`LINE_API_BASE` 指向側錄轉發器，
        逐字證明我們真的對 `api.line.me/v2/bot/message/reply` 送出了那份 Flex）
      - ⚠️ **仍未驗到、也不打算假裝驗到的一段**：「訊息真的出現在顧客手機上」。
        `replyToken` 是 LINE 在真實事件裡發的一次性 token，偽造不出來
        （文件上那兩個「測試用」token 實測一樣回 400 Invalid reply token），
        而 Midao 頻道目前零追蹤者（`line_users` 空、
        `GET /v2/bot/followers/ids` 回 403 未開放），也沒有可推播的真實 userId。
        這一段的完成條件是**有真人對 Midao 帳號打一次「選單」**，屬人工介入點。

## Phase 7 — 收尾（07 分冊)
- [ ] `vercel.json` 四個 cron + `CRON_SECRET` 保護
- [ ] `/api/upload` 圖片上傳
      **（重開 2026-08-24：API 測試矩陣全綠但全 src/ 無任何頁面呼叫它——對使用者
      「圖片上傳」不存在。重勾條件：至少一個頁面（rich menu 背景圖上傳是現成的
      死按鈕）真的接上並有接線證據）**
- [ ] 上線前檢查表全過
- [ ] `NEXT_PUBLIC_USE_MOCK=false` 正式切換

## Phase 8 — 行程領域（10 分冊）

> ⚠️ 2026-08-24 稽核：Phase 8a（trips/trip_plans、migration 0016、匯入/匯出）曾對外
> 宣稱完成，實況是：讀取面有接線；**寫入面頁面全假**（trips 列表的上下架/刪除/
> Midao 申請、詳情頁的全部儲存都只 setState + toast，「新增行程」是空 onClick）；
> `src/services/tours.ts` real 分支呼叫的 publish/departures/tour-orders 等多支
> route **不存在**（接上即 404）；12 §4 指定的 tours.10 測試零檔。詳見 14 分冊。

- [ ] migration 0012（trips/plans/departures/tour_orders/tenant_payment_methods + reserve_seats rpc）
- [ ] 並發下單搶最後一席恰好一成一敗（TOUR_001）
- [ ] 綠界 sandbox 全流程 + callback 冪等；匯款後五碼回報 + 確認收款
- [ ] cron tour-order-expiry 釋放逾期單名額
- [ ] 後台三個新頁（行程/團次/旅遊訂單）+ TOUR_MODULE 功能旗標
- [ ] LINE「行程」指令回 Flex 輪播

## Phase 9 — 旅客與公開 API（11 分冊）
- [ ] migration 0013（traveler_profiles/trip_reviews/partner_clients + customers.traveler_user_id）
- [ ] 旅客註冊/登入；一人雙角色（店家帳號自動補 traveler profile）
- [ ] `/api/public/**` 全組端點 + 白名單欄位 + CORS
- [ ] VibeAI 商店頁 `/s/{shopCode}`（行程列表/詳情/下單/我的訂單）
- [ ] 下單自動建檔導遊顧客（重複下單不重複建檔）
- [ ] 評論：限 COMPLETED 訂單、一單一評、導遊可回覆/隱藏

## Phase 10 — Midao 整合（11 分冊 §4；Midao 側工作照 tour-platform harness 進行）
- [ ] 既有行程資料一次性搬遷（導遊↔租戶對應 + activities/plans/檔期 → trips/*）
- [ ] Midao 上架審核流：申請 → 待審清單 → 核准/退回（含 webhook 通知）
- [ ] Midao 前台行程/名額改接公開 API（名額永遠即時，不快取；LISTED+PUBLISHED 過濾）
- [ ] 旅客帳號遷移到共用 Supabase（bcrypt 匯入，密碼無感）
- [ ] Midao 頁內下單打 `/api/public/checkout`
- [ ] Partner API：簽章驗證、代建行程、訂單查詢、webhook 事件
- [ ] Midao 平台金流（ECPay 代收/payout）標記退役

## 端對端情境（最終驗收，全部在正式站操作）
1. 新店註冊 → 收驗證碼信 → 開店 → 登入
2. 設定：店家資訊、營業時間、儲存後重整仍在
3. 建服務、員工（綁服務）、手動建顧客
4. 手動建預約 → 確認 → 完成 → 顧客點數正確累積
5. 設定 LINE channel → verify 通過 → 加好友收到歡迎訊息
6. 傳「預約」關鍵字 → 收到公開頁連結；後台 chat 看得到訊息
7. 綁定顧客 LINE → 再建一筆預約並確認 → LINE 收到通知
8. 第二家店註冊 → 看不到第一家店任何資料
9. 忘記密碼 → 重設 → 新密碼登入
10. Dashboard 數字與實際資料一致
