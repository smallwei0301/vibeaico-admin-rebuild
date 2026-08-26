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

- [x] 【新增】老闆通知 owner-notify（issue #18 / 補齊-3；契約 06 分冊 §5.5，2026-08-26）
      **（打勾依據＝下列逐條證據；未達成的兩項寫在最後，沒有打勾。）**
      - migration `0023_owner_notify` 已套用**兩個** Supabase 專案，各自以
        `information_schema.columns` / `pg_indexes` / `pg_policies` 查詢驗證
        （含「一租戶最多一位 `is_primary`」的部分唯一索引
        `u_owner_notify_recipients_primary … WHERE is_primary`，兩份輸出）
      - 整合 23 綠：`tests/integration/api/owner-notify.18.test.ts`
        - `:「只回「已加入好友、且尚未在名單中」的人（已在名單者與已封鎖者都被排除）」`
        - `:「本人認領後名單寫入 DB（service role 直查有這一列）」`、
          `:「名單原本為空時，第一位自動成為主要（直查 is_primary=true）」`
        - `:「加入第二位後，主要仍是第一位（新加入者不是主要）」`、
          `:「達 maxRecipients（3 位）時第 4 位被拒，錯誤訊息說得出上限是幾位」`
        - `:「移除非主要 → 其他接收者不受影響（主要沒有換人）」`、
          `:「移除主要 → 下一位自動遞補為主要（直查 is_primary）」`、
          `:「移除最後一位 → 名單為空（規格逐字：之後不再收到 LINE 即時通知）」`
        - `:「解除全部後名單為空」`、
          `:「解除全部後建立預約 → 整個 mock 一個請求都沒有（只有障壁那一則），額度不變」`
        - **額度與人數連動（至少兩種 n）**：`:「名單 1 位 → mock LINE 恰好 1 則、push_quota_usage +1」`、
          `:「名單 3 位 → mock LINE 恰好 3 則（收件者＝名單三位）、push_quota_usage +3」`、
          `:「名單 0 位 → 零 LINE 請求、額度 +0」`
        - `:「訂閱到期提醒：名單 3 位時 mock LINE 恰好 1 則，且收件者＝is_primary 那位」`、
          `:「儲值提醒：點數不足時同樣只發主要一位」`、
          `:「同一張訂閱不會重複提醒：連打兩次 cron，第二次零 LINE 請求」`
        - `:「(a) 有名單且 LINE 回得動 → ENABLED」`、
          `:「(b) 有名單但 LINE 連線異常 → DISCONNECTED，且不謊報通知會送達」`、
          `:「(c) 未設定 LINE Channel → NOT_CONFIGURED」`
        - `:「B 店讀不到 A 店的接收者，也不能移除 A 店的接收者」`（RLS）
      - 單元 15 綠：`tests/unit/owner-notify.18.test.ts`（三種推播文案的內容、
        儀表板 → `src/services/settings.ts` → 端點的靜態鏈路、規格逐字文案不可回歸、
        「綁定碼」殘留檢查）
      - 變異測試（證明上面那些斷言真的在防東西）：
        額度改寫死 `1` → `:「名單 3 位 → …+3」` 轉紅（`expected 1 to be 3`）；
        提醒改發給全部人 → `:「訂閱到期提醒：…恰好 1 則…」` 轉紅；
        移除主要時不遞補 → `:「移除主要 → 下一位自動遞補為主要」` 轉紅
      - 真實 LINE（Midao 頻道，不耗推播額度）：三種推播文案過
        `POST /v2/bot/message/validate/push`，皆回 `200 OK {}`
      - ⚠️ **未做、未打勾的兩項**（見 14 分冊 §6.17「沒有做的事」）：
        「額度用盡時狀態標示 `notified:false` 與原因」（fire-and-forget 沒有承載處）、
        Playwright 對 Preview 站的實測（本輪未 push，Preview 上還沒有這些端點）

## Phase 7 — 收尾（07 分冊)
- [ ] `vercel.json` 四個 cron + `CRON_SECRET` 保護
- [x] `/api/upload` 圖片上傳
      **（重開 2026-08-24：API 測試矩陣全綠但全 src/ 無任何頁面呼叫它——對使用者
      「圖片上傳」不存在。重勾條件：至少一個頁面（rich menu 背景圖上傳是現成的
      死按鈕）真的接上並有接線證據）**
      **重勾 2026-08-26（issue #7 (乙)）：重開條件點名的那顆死按鈕已接上。**
      - 鏈路：`src/app/tenant/rich-menu-design/page.tsx` `uploadBackground()`
        → `uploadImage(file,'richmenu-assets')`（`src/services/upload.ts`）
        → `POST /api/upload` → 接著 `saveLineSettings({richMenuBgImageUrl})`
        → `PUT /api/settings/line`（**這一步不可省**：發布端點
        `/api/settings/line/rich-menu/create` 的 `loadBackgroundImage()` 讀的是
        `tenant_settings.line.richMenuBgImageUrl`，不是發布請求的 body）。
      - `tests/integration/api/rich-menu-bg-upload.07.test.ts`（5/5 綠）
        `:「上傳 PNG → 200，且 service role 直查 storage.objects 時該物件真的在 bucket 裡」`
        `:「上傳 → 存進 line.richMenuBgImageUrl → 發布：LINE 收到的位元組就是我們上傳的那張圖」`
        `:「清空 richMenuBgImageUrl 後再發布 → LINE 收到的不再是那張圖（退回主題底圖）」`
        `:「上傳 WebP → 400，且 bucket 裡不會多出任何物件（LINE 只收 JPEG/PNG）」`
      - 頁面層：`scripts/verify/rich-menu-bg-upload.07.cjs` 實跑 5/5 PASS
        （判準是直查 `storage.objects` 與 `tenant_settings`，不是 toast）。
      - `tests/unit/honest-not-built-rich-menu-design.test.ts`
        `:「背景圖上傳真的接上 /api/upload，且結果有寫進 tenant_settings（否則發布用不到）」`
      - ⚠️ 更正重開理由的一句事實：**「全 src/ 無任何頁面呼叫它」在 2026-08-24 成立，
        今天已不成立**——`portfolio`（封面圖）、客服聊天送圖、選單設計的 Flex 卡片圖、
        回報問題的截圖都已在呼叫 `/api/upload`（分別來自 issue #15 / #6 / #28）。
        本輪關掉的是重開條件點名的**那一顆按鈕**，不是「第一個真實用戶」。
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

---

## 附錄 — issue #7（乙）前半六頁接線（2026-08-26）

> 只新增，不重排既有項目。issue #7 的表格共十列，本節記的是其中**六列**；
> 另外四列（marketing / campaigns / portfolio / rich-menu 底圖上傳）由另一位執行者處理。

- [x] customers：新增／編輯真的落庫；LINE 綁定與解除綁定改打專用端點
      證據：`tests/integration/api/ops-pages-wiring.07.test.ts:「POST /api/customers/:id/bind-line → 兩張表都寫上（雙向），且該好友離開未綁定清單」`／
      `:「POST /api/customers/:id/unbind-line → 兩張表都清空（不是只清顧客那一側）」`／
      `:「GET /api/line-users/unbound 含這位尚未綁定的好友（綁定 modal 的清單來源）」`；
      頁面鏈路靜態鎖 `tests/unit/ops-pages-wiring.07.test.ts:「表單 submit：await createCustomer / updateCustomer 在 onSaved(isEdit) 之前」` 等 6 例
- [x] block-times：整頁改吃 `/api/block-times`（含本輪新增的 PUT）
      證據：`tests/integration/api/ops-pages-wiring.07.test.ts:「POST 後 GET /api/block-times 查得到剛建立的那筆（頁面重新整理仍在）」`／
      `:「PUT /api/block-times/:id 改時間與名稱 → service role 直查資料庫是新值」`／
      `:「PUT 只送 endAt 且早於既有 startAt → 400 REQ_001，且資料庫沒被改到」`；
      實測 `scripts/verify/ops-pages-wiring.07.cjs`（新增 → 重整仍在 → 刪除，10/10 通過）
- [x] points 儲值：如實呈現 501 客服文案，不做成成功
      證據：`tests/integration/api/ops-pages-wiring.07.test.ts:「回 501 且訊息是客服提示 —— 頁面要如實顯示這句話，不是顯示成功」`；
      實測 `scripts/verify/ops-pages-wiring.07.cjs`「畫面顯示後端 501 的原文『請聯絡平台客服儲值』」＋
      「儲值 modal 沒有關閉」＋「畫面沒有任何成功字樣」＋「沒有任何 TOPUP 交易被寫進資料庫」
- [x] staff 自訂稱呼 → `tenant_settings.basic.staffTerm`
      證據：`tests/integration/api/ops-pages-wiring.07.test.ts:「PUT /api/settings { basic } 帶 staffTerm → 直查 tenant_settings.basic.staffTerm 是新值」`
- [x] shifts 週班表 → `/api/shifts`；排班模式 → `tenant_settings.business.staffScheduleModes`
      證據：`tests/integration/api/ops-pages-wiring.07.test.ts:「repeat-cycle 七天全 null 清空 → POST /api/shifts 寫入上班日 → 直查 shifts 只剩新排的那幾天」`／
      `:「PUT /api/settings { business } → 直查 business jsonb 含 staffScheduleModes；GET 回讀相同」`
- [x] shop-design 儲存送出真的 branding patch（migration `0021_tenant_settings_branding`，兩個 Supabase 專案皆已套用並以 `information_schema.columns` 驗證）
      證據：`tests/integration/api/ops-pages-wiring.07.test.ts:「PUT /api/settings { branding } → service role 直查 tenant_settings.branding 是送出的值；GET 回讀相同」`／
      `:「只送 branding 不會動到 basic（群組彼此獨立…）」`

⚠️ 尚未關閉、屬於這六頁但不在 issue #7 表格範圍內的，見 `14-GAP-AUDIT.md` 附錄 X.6。


---

## Phase 6 追加：進階選單設計器 11 支端點 ＋ `flexShowTip`（issue #19，2026-08-26）

規格出處：`docs/integration/06-LINE-INTEGRATION.md` **§6.2**（本 issue 第 1 步把原本那一句
「標為 Phase 6+」展開成的完整章節：11 支端點契約、狀態機、回滾、還原點策略）。
判定與誠實邊界的沿革見 `14-GAP-AUDIT.md` §14。

- [x] 06 §6 展開為完整章節（§6.2.0–§6.2.10）
      11 支端點的 request/response 契約、對 LINE 的呼叫序列、**兩種孤兒的回滾**、
      草稿 vs 已發布的狀態欄位、`restore-previous` 的還原點存哪裡與保留幾份，全部到齊。
      ⚠️ §6.2.0 開頭三條事實先講清楚：原站 spec **只留下路徑**（method 與形狀＝我方設計）、
      `booking-step-guide` **不在 `rich-menu/` 底下**、不存在 `preview-custom`。
- [x] migration `0025_rich_menu_designs.sql`（`(tenant_id, kind)` 主鍵，kind ∈
      DRAFT／PUBLISHED／RESTORE_POINT）**兩個 Supabase 專案都已套用並各自查詢驗證**
      （`information_schema.columns` 5 欄一致、4 條 RLS policy、`relrowsecurity=true`）。
      「保留最近 1 份」由主鍵保證，不是設定值——沒有可被改壞的份數參數，也沒有清理排程。
- [x] 三支 create-*：`tests/integration/api/rich-menu-advanced.test.ts`
      `:「create-advanced：mock LINE 依序收到三個請求，DB 的 richMenuId 被更新」`、
      `:「create-custom：座標由呼叫端給，三連請求照樣完成且 richMenuId 寫回 DB」`、
      `:「create-scene：依 SCENE_TEMPLATES 建立，主題跟著範本走、richMenuId 寫回 DB」`
- [x] 三支 preview-*：**mock LINE 零發布呼叫**（斷言 `mock.requests` 整個為空，
      不只是「richmenu 建立次數為 0」）
      `:「preview-advanced：回得出 areas 與預覽圖，且 mock LINE 零呼叫」`、
      `:「preview-scene：回得出範本預覽，且 mock LINE 零呼叫」`、
      `:「preview-scene-flex：回得出顧客會收到的 Flex 訊息包，且 mock LINE 零呼叫」`
      ＋ 靜態守門 `tests/unit/honest-not-built-rich-menu-design.test.ts`
      `:「⚠️ 預覽的處理函式裡沒有任何發布呼叫（按預覽把選單換掉是本組最大的風險）」`
- [x] `restore-previous` 有／無還原點兩條路徑
      `:「有還原點時還原成功：切回上一張選單，PUBLISHED 與 RESTORE_POINT 對調」`、
      `:「沒有還原點時回 404 並說得出原因——**不得靜默成功**」`
      ＋ `:「只保留最近 1 份：發布三次之後，還原點是第二次那一份（不是第一次）」`
- [x] `advanced-config` 往返一致、兩支上傳端點回可用 URL
      `:「PUT 存什麼、GET 就拿回什麼（含 cells 順序與空字串欄位）」`、
      `:「upload-image：回可用 URL，且**順手寫進 line.richMenuBgImageUrl**（發布讀的是那個欄位）」`、
      `:「upload-cell-icon：回可用 URL 並寫進草稿那一格，且誠實回報不會合成進底圖」`
- [x] `booking-step-guide` 的 payload
      `:「存得進、讀得回，七步補齊，且產出的 card payload 結構合法」`
      （斷言含「無空字串 text」——LINE 的 text 元件不收空字串，塞了整包退回 400）
- [x] 建立失敗不留孤兒（**兩個方向都堵**）
      `:「LINE 傳圖失敗 → 已建立的選單被刪，DB 一列都沒寫」`、
      `:「LINE 全成功但 DB 寫入失敗 → 剛建立的選單被刪、預設切回舊的，DB 維持原狀」`
      ⚠️ 第二條用 jsonb 存不下的 U+0000 製造真實 DB 失敗，走的是真的資料庫，不 mock client。
- [x] 租戶隔離 `:「跨租戶隔離：B 店讀不到 A 店的草稿」`、
      `:「B 店發布不會動到 A 店的資料列（rich_menu_designs 依租戶隔離）」`
      ＋ 閘門 `:「未訂閱 CUSTOM_RICH_MENU → 進階發布 403 FEAT_001，且 LINE 零呼叫」`、
      `:「未登入 → 401，所有進階端點一致」`
- [x] `flexShowTip` 落地（7 條見下）
- [ ] **Playwright 實測（playbook §5）＋真實 LINE 驗證（playbook §6）——未執行，留白**
      理由：本輪未 push，Preview 站上沒有這些端點；真實 LINE 驗證亦未執行。
      這兩項是本 issue 唯二沒有證據的驗收格子，**不得由「整合測試全綠」代打**
      （12 分冊 §6 items 9–11：API 綠不是頁面級功能的證據）。
      靜態鏈路證據（handler → services → 端點）已在 issue 留言逐列列出。

### `flexShowTip` 那一段的 7 條

- [x] 判定結果寫進 14 分冊 §14.1／§14.2：**一半判得出來**（屬 Flex 主選單、不屬步驟引導，
      四條 spec 依據）、**一半判不出來**（原本顯示什麼文字救不回來），
      因此採預設語意並**明標為「我們選的，不是還原的」**
- [x] `FlexMenuOutcome` 已改 `messages` 陣列、`line-events.ts` 整包送
      `tests/integration/api/flex-menu.06.test.ts:「flexShowTip=true → mock LINE 收到的 messages 長度為 2，第 1 則 flex、第 2 則 text」`
- [x] 守門：`tests/unit/flex-menu.06.test.ts:「守門：src/ 底下沒有任何程式碼只送 outcome 的第一則訊息」`
      （比對前剝掉註解——那兩個檔案的說明文字裡刻意留著這個字串記錄「原本是什麼」，
      連註解一起比會永遠紅，而永遠紅的守門遲早被人放寬）
      ＋ `:「守門：line-events 把整包 messages 交給 lineReply（不是自己挑一則）」`
- [x] `flexShowTip=false` 只送 1 則
      `tests/integration/api/flex-menu.06.test.ts:「flexShowTip=false → 只送 1 則（開關真的是開關，不是裝飾）」`
- [x] `HINT` / `SILENT` / `NO_CARDS` 三態不受影響
      `:「HINT 不受 flexShowTip 影響：開或關都只回一句提示文字」`、
      `:「SILENT 不受 flexShowTip 影響：整個 mock.requests 為空（不是「/reply 沒被打」）」`、
      `:「NO_CARDS 不受 flexShowTip 影響：回關鍵字清單純文字，不多送提示」`
- [ ] **LINE 官方 `validate/reply` 驗證兩則 payload——未執行，留白**
      理由同上（真實 LINE 驗證本輪未跑）。`scripts/verify/**` 另有執行者在用，本輪未動。
- [x] 變異測試（單元層與整合層各跑一次）
      常數 `true` → 單元 `:「flexShowTip=false → 只送 1 則（開關真的是開關）」` 轉紅；
      整合 `:「flexShowTip=false → 只送 1 則（開關真的是開關，不是裝飾）」` 轉紅。
      常數 `false` → 單元三條轉紅
      （`:「flexShowTip=true → 送兩則…」`、`:「沒有 flexShowTip 這個鍵時預設開啟…」`、
      `:「提示卡不插在 carousel 最前面——12 張卡片時 bubble 數仍是 12，一張都沒被擠掉」`）；
      整合 10 條轉紅（`replyMessageFor()` 的型別契約守門全數命中）。
- [x] `showTipHelp` 文案已上並逐字描述真實行為（多一則／哪些情況不會出現）
      `tests/unit/flex-show-tip-honest.test.ts:「文案逐字描述真實行為：多一則、以及哪些情況不會出現」`
      ＋ 同檔 `:「畫面不得再說它「尚未生效」——功能已生效，那句話現在才是謊」`
      （⚠️ 該檔是一條**會隨事實翻面**的守門測試，本輪正是它翻面的時刻）
      ⚠️ Playwright 截圖未附（見上方留白說明）。
## issue #33 ①〜⑤ — 三方對照剩餘 5 支無人認領端點（2026-08-26）

> 第 ⑥ 筆 `/api/payment-methods/online-payment-meta` 已併入 #32，不在本輪範圍。
> 契約見 `04-API-CONTRACTS.md` §A-1.2 / §B-4.1 / §B-6；盤點與裁決記錄見
> `14-GAP-AUDIT.md` §15。

**① `POST /api/product-orders/:id/apply-coupon`**

- [x] 04 分冊補上契約（§B-4.1：request/response、六種錯誤碼、交易邊界、金額語意、
      「適用範圍是我方選的」標註）
- [x] 核銷邏輯只有一份：`src/server/coupon-redeem.ts`，三個呼叫端共用
      （`redeem-by-code`／`bookings/:id/apply-coupon`／`product-orders/:id/apply-coupon`）
      證據：`grep -rn "redeemed_at: new Date" src/` → **只有一行**
      `src/server/coupon-redeem.ts:116`（＝全站只有一個地方會把票券標成已核銷；
      `coupons/instances/:id/unredeem` 寫的是 `redeemed_at: null`，那是**取消**核銷，
      不是同一件事）；
      `tests/unit/product-order-coupon.33.test.ts:「核銷邏輯不是第三份拷貝：端點呼叫 src/server/coupon-redeem.ts 的共用函式」`
- [x] 折抵金額由後端算並回傳
      證據：`tests/integration/api/product-orders-coupon.33.test.ts:「AMOUNT 100：回應 couponDiscount=100，DB 的 total_amount / coupon_discount / redeemed_at 三者一致」`／
      `:「PERCENT 10：折抵金額由後端依「目前應付金額」算（1000 → 900，折抵 100）」`／
      `:「GIFT：只核銷不影響金額（couponDiscount = 0，total_amount 不動）」`／
      `:「同一張訂單套第二張票券 → coupon_discount 累加、total_amount 再扣」`
- [x] 四種拒絕情況各回對應錯誤碼且訂單金額不變
      證據：同檔 `:「票券不存在 → 404 REQ_002，訂單金額前後相同」`／
      `:「票券已核銷 → 409 REQ_003，訂單金額前後相同」`／
      `:「票券已過期（coupons.end_at 在過去）→ 409 REQ_003，訂單金額不變且票券**沒有被核銷**」`／
      `:「票券不屬於這張訂單的顧客 → 409 REQ_003，訂單金額不變且票券沒有被核銷」`／
      `:「已完成的訂單不再接受套券 → 409 REQ_003（套券入口只出現在還沒完成的單）」`
- [x] RLS：A 店的訂單不能用 B 店的票券
      證據：同檔 `:「RLS：A 店的訂單不能用 B 店的票券（回 404，B 店的票券不會被核銷）」`／
      `:「A 店的訂單，B 店的 owner 打不到（回 404，金額不變）」`
- [x] 「套用票券成功但完成訂單失敗」符合分冊定案的兩段語意
      證據：同檔 `:「兩段語意：套券成功之後「完成訂單」失敗，核銷仍然留著（原站 jsStrings[77]）」`
- [x] `grep -n "withCoupon ? 100 : 0" src/` 輸出為空
      證據：指令輸出為空；`tests/unit/product-order-coupon.33.test.ts:「原始碼不再出現 withCoupon ? 100 這種寫死折抵金額的三元運算」`
- [x] 頁面接線靜態鏈路：`src/app/tenant/product-orders/page.tsx` `finish()`
      → `src/services/products.ts` `applyProductOrderCoupon()`
      → `POST /api/product-orders/:id/apply-coupon`
      證據：`tests/unit/product-order-coupon.33.test.ts:「頁面 → service：finish() 呼叫 applyProductOrderCoupon(order.id, code)」`／
      `:「service → 端點：applyProductOrderCoupon 打的是 /api/product-orders/:id/apply-coupon」`／
      `:「finish() 裡出現的折抵金額只有一個來源：applyProductOrderCoupon 的回應」`；
      整合測試檔＝`tests/integration/api/product-orders-coupon.33.test.ts`
- [ ] Playwright 對 Preview 站實測 —— **留白**：本輪的指示是不 push，Preview 站上還沒有
      這支端點。分支 push、Preview 重新部署之後才補得了（15 分冊「打 Preview 站補驗收時的三個坑」§坑 1：
      「本機 next dev ＋ 正式專案」不滿足「對 Preview 站實測」的字面要求）

**② `POST /api/settings/weekly-business-hours/draft` ＋自動封鎖鏈**

- [x] 04 §A-1.2 補上契約，且**明寫「乾跑」是我方選定的語意、依據哪兩句、
      反面證據是哪三句**（不得寫成考據結果）
- [x] migration `0027_block_times_weekly_and_product_order_coupon.sql` 補齊
      `title / recurrence / day_of_week / full_day / auto`，**兩個 Supabase 專案都套用並各自查詢驗證**
      證據：`information_schema.columns` 兩份輸出（見本輪 issue 留言）
- [x] `src/app/api/block-times/route.ts` 的 select 與回傳型別已含新欄位
      證據：`tests/integration/api/business-hours-draft.33.test.ts:「GET /api/block-times 帶回 0027 的新欄位，且 WEEKLY 列不會被區間過濾掉」`
- [x] 改逐日營業時間 → auto 封鎖被建立，筆數等於端點回報數（直查 DB 對照）
      證據：同檔 `:「存逐日營業時間 → DB 的 auto 列筆數 === 回報的 autoBlockCreated，且欄位齊全」`
- [x] **手動建立的封鎖一律不被刪除**
      證據：同檔 `:「重建 auto 封鎖之後，兩筆手動封鎖都還在（前後直查同一列）」`／
      `:「端點回報的 manualWeeklyBlockCount 與直查 DB 一致（且此刻非零）」`
- [x] 衝突預約筆數與直查 DB 一致；零衝突時回 0 且頁面不顯示警告句
      證據：同檔 `:「零衝突時回 0（沒有任何未來預約落在非營業時段）」`／
      `:「塞一筆落在非營業時段的未來預約 → 回報數與直查 DB 一致（非零）」`／
      `:「刪掉那筆預約 → 回報數剛好少 1（證明數字真的跟著資料動，不是常數）」`；
      頁面端 `saveBusiness()` 的 `if (conflicts > 0)` 守門（`src/app/tenant/settings/page.tsx`）
- [x] 再次修改逐日時間時 auto 封鎖全刪重建、不累積膨脹
      證據：同檔 `:「再次修改逐日時間 → 全刪重建，auto 筆數不累積膨脹」`／
      `:「關閉逐日模式 → auto 列全部清掉（回報 0）」`／
      `:「不含 business 群組的 PUT 不會動到 auto 封鎖，也不回報數字」`
- [x] RLS 跨租戶擋
      證據：同檔 `:「B 店的 draft 只看得到自己的資料（A 店的手動每週封鎖不算進 B 店）」`／
      `:「B 店存營業設定，不會刪掉 A 店的 auto 封鎖」`／
      `:「B 店動不了 A 店的 auto 封鎖（PUT/DELETE 回 404，不是 409）」`
- [x] 四句既有文案（`settings.ts` `autoBlockCreated` / `conflictWarning` /
      `conflictWarningHours` / `manualBlockKept`）已被引用
      證據：`grep -rn "autoBlockCreated\|conflictWarning\|conflictWarningHours\|manualBlockKept" src/app/`
      → `src/app/tenant/settings/page.tsx` 四處（本輪之前為 0）
- [x] 頁面接線靜態鏈路：`src/app/tenant/settings/page.tsx` `saveBusiness()`
      → `src/services/settings.ts` `previewBusinessHours()` / `saveTenantSettings()`
      → `POST /api/settings/weekly-business-hours/draft` / `PUT /api/settings`
- [ ] Playwright 實測 —— **留白**，同 ① 的理由（本輪不 push）

**③ `GET /api/export/bookings/:format`**

- [x] 建立，白名單與 `/api/export/reports/[format]` 一致；非白名單格式回 400
      證據：`tests/integration/api/export-bookings-format.33.test.ts:「白名單外的 format → 400 REQ_001，且回的是 JSON 信封不是檔案」`
- [x] CSV 有 UTF-8 BOM（**位元組層級斷言**）、`Content-Type` 正確、
      `Content-Disposition: attachment`、不走 `{success,data}` 信封；excel 分支同一組斷言
      證據：同檔 `:「csv：回 text/csv + attachment 檔名 + UTF-8 BOM，不走 { success, data } 信封」`／
      `:「excel：回 text/csv + attachment 檔名 + UTF-8 BOM，不走 { success, data } 信封」`／
      `:「csv 與 excel 兩個分支拿到的是同一份內容（共用同一個產生器，不是兩份實作）」`／
      `:「與無 format 段的舊端點內容一致（#28 ③ 的接線點不會因本輪改動而變）」`
- [x] 頁面匯出入口的檔名一律取自後端 `Content-Disposition`
      證據：`src/services/reports.ts` `exportBookingsCsv` 走 `downloadAttachment()`
      （檔名唯一來源是 Content-Disposition，見 `src/lib/download.ts`）；
      頁面兩個選單項各送自己的 format，不自組檔名
- [ ] Playwright download 事件輸出 —— **留白**，同 ① 的理由（本輪不 push）

**④⑤ 兩支用途未明**

- [x] `/api/settings/onboarding-event`：判定結果＝**查不到**，已列出查過的位置與各自結果
      證據：`14-GAP-AUDIT.md` §15.2 ＋本輪 issue #33 留言
- [x] `/api/staff/calendar`：判定結果＝**查不到**（方向收斂到「員工排班模式」，
      但形狀無從判定），已列出查過的位置
      證據：`14-GAP-AUDIT.md` §15.2 ＋本輪 issue #33 留言
- [x] `grep` 證明程式碼中沒有為這兩支留下半成品路徑或猜測性型別
      證據：`grep -rn "staff/calendar\|onboarding-event\|onboardingEvent\|staffCalendar\|focusTrack" src/ tests/` → 輸出為空

**共通**

- [x] i18n：無新增硬編碼中文（`tests/unit/honest-not-built-interactions.test.ts` 的
      「六個頁面元件都沒有中文字面量文案」涵蓋 settings 頁）；設計值全走 token
- [x] `npm run typecheck` / `npm run build` / `npx vitest run tests/unit/` 全綠
- [x] 整合測試：**逐檔跑，非全量**（多 agent 同時在改 `src/app/api/**`，
      15 分冊「跑整合測試前」那一節）。跑了 12 檔 132 例全綠，清單見本輪 issue 留言
