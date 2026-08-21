# 真實後端串接 — 總計畫（Master Plan）

> **這份文件是入口。** 依序讀完本檔後，按照 Phase 順序執行各分冊。
> 執行者假設是一個 AI 編碼模型：**每一步都必須照文件字面執行，不要自行發明架構。**

---

## 0. 目標

把目前「純 mock 骨架」的 VibeAI 店家後台，接上真實服務：

| 項目 | 選型 | 分冊 |
|---|---|---|
| 資料庫 + 登入系統 + 檔案儲存 | **Supabase**（Postgres + Auth + Storage） | 02、03 |
| API 層 | **Next.js Route Handlers**（同一個 repo，`src/app/api/**`） | 01、04 |
| 寄信 | **Resend** | 05 |
| LINE 官方帳號連動 | **LINE Messaging API**（多租戶，每店一組 token） | 06 |
| 部署 | **Vercel**（已完成，push `main` 即自動部署） | 07 |

---

## 1. 不可違反的鐵則（Guardrails）

執行任何 Phase 之前先讀完這一節。違反任何一條就算做錯。

1. **不改頁面元件。** `src/app/tenant/**/page.tsx`、`src/components/**` 一律不動
   （唯二例外：03 認證分冊明確列出的登入 4 頁接線，與各分冊「頁面接線」小節明確點名的檔案）。
   頁面只認得 `src/services/*` 的函式 —— 換後端時頁面本來就不必動，這是本專案的核心架構。
2. **回應信封格式固定**：所有 `/api/*` 回應一律是
   `{ success: boolean, data?, message?, code? }`（見 `src/lib/types.ts` 的 `ApiResponse`）。
   成功 → `{ success: true, data }`；失敗 → `{ success: false, message, code }` + 正確 HTTP status。
3. **型別契約在 `src/lib/types.ts`。** API 回傳的 `data` 形狀必須與該檔型別完全一致
   （欄位名、大小寫、null 規則）。資料庫欄位是 snake_case，**回傳前必須轉成 camelCase**。
4. **分頁格式固定**（Spring 風格，見 `Paged<T>`）：
   `{ content: T[], totalElements, totalPages, number, size }`，`number` 從 0 起算。
5. **多租戶隔離是安全邊界。** 每一張業務資料表都有 `tenant_id`，每一條查詢都必須
   經過 RLS 或明確的 `tenant_id` 過濾。**任何一個 API 都不允許跨店讀寫。**
6. **秘密欄位絕不明文**：`line.channelSecret`、`line.channelAccessToken`
   入庫前用 `SETTINGS_ENCRYPTION_KEY` AES-256-GCM 加密（見 01 分冊 §4），
   回傳前端一律 `maskSecret()`（`src/config/tenant-settings.ts` 已有）。
   前端送空字串 = 「不變更」，**收到空字串時保留 DB 舊值**。
7. **`SUPABASE_SERVICE_ROLE_KEY` 只能在這三種地方使用**：
   LINE webhook、Vercel Cron、auth 註冊流程。一般 API 一律走帶使用者 session 的
   client（RLS 生效）。service role key 絕不能出現在任何 `NEXT_PUBLIC_*` 變數或前端 bundle。
8. **每完成一個 Phase 都要過驗收**：`npm run typecheck` 零錯誤、`npm run build` 成功、
   該 Phase 的驗收清單（08 分冊）全數打勾，才能進下一個 Phase。
9. **不新增依賴，除非分冊點名。** 各分冊明確列出允許安裝的套件與版本，其餘不裝。
10. **mock 模式必須永遠可用。** `NEXT_PUBLIC_USE_MOCK=true` 時全站行為與現在完全相同。
    所有真實邏輯都寫在 `adapt(mock, real)` 的 real 分支與 `src/app/api/**`、`src/server/**`。
11. **一切工作照 12 分冊的 TDD 紀律進行**：先寫測試（紅）→ 實作（綠）→ 回歸全綠
    才算完成；12 分冊 §4 列名的測試檔是任務清單的一部分；**永遠不准為了過關而
    改測試**（12 §2.4 的禁止清單，違反 = 該輪工作無效）；紅燈不得 merge。

---

## 2. Phase 順序（不可跳關）

```
Phase 0  環境準備        01 分冊     建 Supabase 專案、填 env、裝套件、建 server 基礎設施
Phase 1  資料庫 schema    02 分冊     跑 migrations、RLS、seed
Phase 2  登入系統        03 分冊     Supabase Auth + 註冊/登入/忘記密碼/重設 + middleware
Phase 3  核心 API        04 分冊§A   settings / bookings / customers / catalog / reports
Phase 4  寄信            05 分冊     Resend：驗證碼、密碼重設、預約通知
Phase 5  進階 API        04 分冊§B   coupons / products 寫入面 / points / marketing…
Phase 5.5 功能商店訂閱制  09 分冊     22 項功能目錄、扣點訂閱、套裝方案、功能閘門、到期副作用
Phase 6  LINE 連動       06 分冊     webhook、推播、rich menu、顧客綁定
Phase 7  排程與收尾      07 分冊     Vercel Cron、Storage、上線檢查
Phase 8  行程領域        10 分冊     行程/方案/團次/名額、旅遊訂單、導遊自訂金流（綠界/匯款）
Phase 9  旅客與公開 API   11 分冊     共用旅客帳號、VibeAI 商店頁、評論、顧客自動建檔
Phase 10 Midao 整合      11 分冊§4   Midao 前台接入、Partner API、Midao 金流退役
```

依賴關係：Phase 2 依賴 1；Phase 3 依賴 2；Phase 4 可與 3 並行（但驗證碼寄信被
Phase 2 的註冊流程用到，故建議順序執行）；Phase 6 依賴 3 的 settings API。

---

## 3. 目錄與檔案地圖（做完後長這樣）

```
src/
├── app/
│   ├── api/                       ★ 新增 — 所有 Route Handlers（04 分冊）
│   │   ├── auth/…                 03 分冊
│   │   ├── bookings/…             04 分冊
│   │   ├── customers/…            04 分冊
│   │   ├── settings/…             04 分冊
│   │   ├── line/webhook/[shopCode]/route.ts   06 分冊
│   │   └── cron/…                 07 分冊
│   └── tenant/…                   既有頁面（不動）
├── server/                        ★ 新增 — 只在伺服器端 import 的模組（01 分冊）
│   ├── http.ts                    ok()/fail() 信封 + 錯誤碼
│   ├── supabase.ts                createServerSupabase / createAdminSupabase
│   ├── tenant.ts                  requireUser() / requireTenant()
│   ├── crypto.ts                  encryptSecret / decryptSecret
│   ├── mappers.ts                 snake_case row → camelCase 型別
│   └── email/                     05 分冊（Resend + 模板）
├── services/                      既有；只把 real 分支的路徑核對一次，不改函式簽名
├── lib/types.ts                   契約；如需擴充只可「新增」型別，不可改既有欄位
└── config/…                       既有（env.ts 依 01 分冊擴充）
supabase/
└── migrations/                    ★ 新增 — SQL migrations（02 分冊）
```

---

## 4. 分冊清單

| 檔案 | 內容 |
|---|---|
| [`01-ARCHITECTURE.md`](01-ARCHITECTURE.md) | 目標架構、環境變數總表、`src/server/*` 基礎設施完整程式碼 |
| [`02-SUPABASE-SCHEMA.md`](02-SUPABASE-SCHEMA.md) | 全部資料表 SQL、enum、RLS、index、seed |
| [`03-AUTH.md`](03-AUTH.md) | 登入系統：註冊 / 登入 / 忘記密碼 / 重設 / session / middleware / 多店切換 |
| [`04-API-CONTRACTS.md`](04-API-CONTRACTS.md) | 每一個端點的 method / query / body / 回應 / 錯誤碼 |
| [`05-EMAIL-RESEND.md`](05-EMAIL-RESEND.md) | Resend 設定、寄信模組、6 種信件模板、通知開關對應 |
| [`06-LINE-INTEGRATION.md`](06-LINE-INTEGRATION.md) | LINE Messaging API：webhook、簽章驗證、推播、rich menu、綁定 |
| [`07-DEPLOYMENT-CRON.md`](07-DEPLOYMENT-CRON.md) | Vercel 環境變數、Cron Jobs、Storage buckets、上線檢查表 |
| [`08-CHECKLIST.md`](08-CHECKLIST.md) | 全部 Phase 的逐條驗收清單（執行時照抄成 todo） |
| [`09-FEATURE-STORE.md`](09-FEATURE-STORE.md) | 功能商店訂閱制：22 項功能目錄、點數扣款、套裝方案、功能閘門對應表、到期副作用、AI 客服（Claude API） |
| [`10-TOUR-DOMAIN.md`](10-TOUR-DOMAIN.md) | 行程領域：行程/方案/團次 schema、名額原子扣減、旅遊訂單、導遊自訂金流（綠界/匯款）、後台新頁面 |
| [`11-PARTNER-API.md`](11-PARTNER-API.md) | 共用旅客帳號、公開商店 API、評論、顧客自動建檔、Midao Partner API 與退役路線 |
| [`12-TESTING-TDD.md`](12-TESTING-TDD.md) | **強制**：TDD 循環、單元/整合/E2E 標準、每 Phase 必寫測試矩陣、TEST 資料庫、CI 關卡、Definition of Done |
| [`13-BUSINESS-MODES.md`](13-BUSINESS-MODES.md) | 業態模式（當地商店/嚮導/醫院）：註冊三選一決定選單/名詞/預設功能包；模式換門牌不換倉庫 |

---

## 5. 名詞對照

| 名詞 | 意義 |
|---|---|
| 租戶 / tenant | 一家店。一個部署服務多家店 |
| shopCode | 店家唯一代碼（小寫英數連字號），用於登入、webhook URL、公開頁 `/s/{shopCode}` |
| 平台層設定 | `.env` 裡的東西：資料庫、Resend key、加密金鑰 —— 部署者填一次 |
| 租戶層設定 | `tenant_settings` 表：LINE token、營業時間… —— 每家店自己在後台填 |
| 骨架 / mock 模式 | `NEXT_PUBLIC_USE_MOCK=true`，全站走 `src/mock`，不需要任何後端 |
