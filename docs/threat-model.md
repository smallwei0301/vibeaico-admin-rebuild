# VibeAI Admin Rebuild — 威脅模型（Threat Model）

> 狀態：**初版，待合入 `main` 才成為正式版本**。本文件是安全審查的「地圖」，**不是系統安全合格證明**。
>
> 建立日期：2026-10-16（台灣時間）。資料來源：當日以 GitHub 讀取的 `main` 程式及現行分冊；曾觀察到 `main` SHA `668ed06ab23a8cb9a993f773cf73da11cc1e7849`。此 SHA 是盤點參考點，正式合併前需重新取得當前 SHA 並核對變更。
>
> 適用：`smallwei0301/vibeaico-admin-rebuild`。不涵蓋 MIDAO／tour-platform 另一個儲存庫的所有實作；跨儲存庫互動需分別驗證兩邊。
>
> 審查者：開發者、獨立安全審查者、Codex Security Review。請從 `AGENTS.md` 與 `docs/AGENT-EXECUTION.md` 讀取**最新**授權與必要檢查；本文件不能取代它們。

## 1. 系統保護什麼

| 資產 | 為何重要 | 最需要防的事 |
|---|---|---|
| 店家與導遊的顧客、訂單、行程、員工資料 | 包含營運資料與個人資料 | A 店取得或修改 B 店資料 |
| 旅客姓名、聯絡資料與預約資訊 | 使用者隱私與行程安全 | 匿名端點洩露資料、偽造預約或大量灌單 |
| 租戶成員與平台管理員身分 | 決定誰能進哪家店 | 偽造身分、越權操作與代登入未留紀錄 |
| 訂單、名額、付款、退款、點數 | 涉及金錢與交易正確性 | 假付款、重複入帳、超賣、跨店金流混用 |
| LINE 憑證、商店金流憑證、環境密鑰 | 能冒用商店或存取高度敏感資源 | 機密外洩、跨租戶使用、紀錄中曝露明文 |
| 檔案與對外網址、預約提醒、通知 | 可能散播資料或產生大量成本 | 越權下載／刪除、偽造 Webhook、重複通知 |
| TEST／Production 資料庫及 migration 記錄 | 影響正式資料完整性 | 未核准變更、版本漂移、錯誤套用或資料遺失 |

**優先原則：** 跨店資料隔離 > 帳號／管理員權限 > 金流與重要狀態 > 個資／密鑰 > 外部接口與可用性。

## 2. 系統邊界與資料流

```text
[店家／導遊登入瀏覽器] ─ session cookie ─> [Next.js /api 與受保護頁面]
                                             ├─ 一般使用者身分 ─> [Supabase Auth + RLS] ─> [Postgres／Storage]
                                             └─ 特權操作 ──────> [server-only service role] ─> [Postgres／Storage]
[旅客／其他網站] ─ 公開頁、公開 API ────────────> [輸入檢查／節流／訂單與名額規則]
[LINE 伺服器] ─ 簽章 Webhook ─────────────────> [租戶解析、事件處理、通知]
[綠界／金流商] ─ 簽章 Callback ────────────────> [付款核對與不可重複寫入]
[Vercel Cron] ─ Bearer 祕密 ───────────────────> [定時任務、逐店處理]
[外部 ICS／合作平台] ─ URL 或跨站介接 ─────────> [來源限制／SSRF 防護／合作介面]
[GitHub main canonical migration] ─受控釋出───> [單一 TEST] ─審核與正式庫門檻─> [Production]
```

- **信任邊界 A（瀏覽器 → 伺服器）**：瀏覽器送來的 `tenantId`、角色、價格、訂單狀態與回傳網址均不可直接相信。由伺服器根據登入者與所屬店家決定權限。
- **邊界 B（一般資料存取 → service role）**：`SUPABASE_SERVICE_ROLE_KEY` 可以繞過 RLS（資料庫的逐店存取限制）。使用它的每個資料讀寫都需要獨立確認租戶歸屬、角色、父子資料關係與更新條件。
- **邊界 C（外部平台 → Webhook／Callback）**：不能只靠收到 HTTP 請求就承認 LINE 事件或付款成功；必須驗簽、比對商店／訂單／金額及防重放。
- **邊界 D（TEST → Production）**：TEST 通過不代表獲得正式資料庫寫入授權。必須由 current `main` 的 migration 與既有 G0–G7／Production Gate 放行。

相關實際程式入口：`src/middleware.ts`、`src/server/tenant.ts`、`src/server/supabase.ts`、`src/server/http.ts`、`src/server/platform-admin.ts`、`src/server/crypto.ts`、`src/app/api/public/**`、`src/app/api/line/**`、`src/app/api/donations/**`、`src/app/api/cron/**`、`src/app/api/upload/**`、`supabase/migrations/**`。

## 3. 主要攻擊情境與審查重點

以下的「既有防護」是**程式碼中可看到的設計／邏輯**，並不表示已在 Production 端對端測試成功。

| ID | 威脅與可能途徑 | 嚴重度 | 程式碼中可見的既有防護 | 修改時必須再次驗證 |
|---|---|---|---|---|
| TM-01 | A 店利用 B 店的資料 ID 讀寫 B 店訂單、客戶或圖檔 | **高** | `requireTenant()` 由 session 查成員資格；一般 client 使用 RLS；`0006_rls_policies.sql` 對多張核心表啟用 RLS | A/B 店雙向交叉測試；任何 service-role 查詢必須有店家篩選，連子表與上傳檔也要查 |
| TM-02 | 低權限職員或店主取得平台管理員權限，或冒用管理員代登入 | **高** | `requirePlatformAdmin()`、`loadActiveImpersonation()`；代登入 session 要求未結束、未到期且屬目前登入者 | 非管理員一律拒絕；權限撤銷後立即失效；跨帳號複製 cookie 失效；管理員操作有完整 audit |
| TM-03 | 代登入使用 service role 繞過資料庫隔離，漏掉店家條件造成跨店寫入 | **高** | `requireTenant()` 的代登入分支從可信 session row 取得 tenant ID；`handle()` 對代登入寫操作先建稽核紀錄 | 所有查詢／更新含正確 tenant 條件；稽核寫入失敗時拒絕業務寫入；未知 Auth／DB 故障不可假裝未登入 |
| TM-04 | 偽造、修改或重送付款通知；商店 A 的憑證更新 B 的訂單 | **高** | 贊助 Callback 有 CheckMacValue 驗證、訂單存在檢查、終態防重覆；導遊金流正式規格要求每店專屬憑證 | 正確店家與訂單、金額、狀態、重送與並發都驗證；所有付款／退款狀態轉換保持一次性；不得 fallback 共用商店 key |
| TM-05 | 偽造 LINE 事件或拿 A 店的 webhook 當 B 店使用 | **高** | `src/app/api/line/webhook/[shopCode]/route.ts` 依店家查 channel secret，對原始 body 驗 HMAC；無效簽章拒絕 | 正確／錯誤簽章、錯店碼、事件重送、事件失敗及通知副作用測試；不能將 token 原文回傳或記錄 |
| TM-06 | 未登入者大量灌入假旅客訂單、猜價格或搶名額 | **高** | 公開預約路由含請求大小限制、IP＋店家節流、方案可用與功能開關檢查 | 伺服器重新計價；最後一席並發僅能成交一次；限速不能只依可偽造的來源標頭；不可從公開介面取回其他旅客個資 |
| TM-07 | 秘密金鑰暴露到網頁、錯誤訊息、日誌、GitHub 或公開設定 API | **高** | `src/server/crypto.ts` 使用 AES-256-GCM；`createAdminSupabase()` 位於伺服器端 | `.env`／service key 不進版本庫；瀏覽器只能收到遮罩；換 key／權限異動有復原方案；日誌不寫金鑰與敏感個資 |
| TM-08 | 上傳假圖片、巨大檔案，或刪除其他店家圖檔 | **中／高** | `/api/upload` 限制 bucket、檔案類型與 5MB 大小，產生 `tenantId/UUID` 路徑並確認角色 | 實際檔案內容而非只信 MIME 宣稱；跨店刪除與 URL 偽造失敗；公開／私人 bucket 權限與生命週期驗證 |
| TM-09 | 日曆匯入的外部 URL 被利用去讀取伺服器內網資訊（SSRF，伺服器代人連結惡意網址） | **高** | `src/server/ssrf-guard.ts` 有私網位址、DNS 結果與重新導向檢查 | 內網／localhost／IPv6／重新導向／DNS 變更案例；所有外部下載都走同一保護入口 |
| TM-10 | 偽造排程要求，或重跑排程造成重複通知、更新狀態 | **中／高** | Cron 使用 `CRON_SECRET` Bearer 驗證；預約提醒使用條件式搶佔避免重發 | 不正確或缺失密鑰拒絕；跨店篩選；並發執行不重送；故障可追查且不把失敗偽裝成功 |
| TM-11 | 公開跨網域 API 意外被任意網站讀取 | **中** | `src/server/public-cors.ts` 精確列出允許網域、缺設定拒絕、不用萬用字元 | CORS 只控制瀏覽器跨站讀取，不能當身分驗證；公開資料欄位最小化，敏感端點仍有授權 |
| TM-12 | 不同環境的 DB 結構／權限政策與 `main` 不一致，導致部署繞過安全規則 | **高** | `AGENTS.md` 要求 schema 來源必須是 current `main` canonical migration；Production 使用既有分段 Release Gate | TEST／Production 的表、RLS、函式與 migration 紀錄比對；保留阻塞證據；不以 CI 綠、TEST 有表或 PR 存在取代 Production 授權 |
| TM-13 | 跨儲存庫的 MIDAO 管理員或代建功能互相信任過度 | **高** | `docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` 記載雙系統管理員身分不相同、跨專案信任需專門決策 | 不使用「另一站已登入」推定權限；簽章或一次性授權、租戶對應、過期／撤銷及雙邊稽核需獨立驗證 |

**判斷嚴重度的方法：** 高＝可能跨店讀寫、冒用登入／管理員、金流錯誤、敏感金鑰曝露或破壞正式資料；中＝需要較多條件才造成明顯影響。此分類供審查排序，不等於已經發現漏洞。

## 4. 最低驗收清單（有修改才做對應項，不是每個 PR 全部重跑）

1. **權限與租戶隔離：** 未登入 401、權限不足 403、A 店用 B 店 ID 讀寫被拒；對 service role 路徑再次核對 tenant filter。
2. **登入與代登入：** 當 Auth／DB 服務失敗，敏感操作不可意外放行；平台管理者身份與完整稽核不可省略。
3. **金流：** 錯誤簽章、跨店憑證、金額不符、重送、並發與部分失敗都不得造成重複成功付款或狀態漂移。
4. **LINE 與 Cron：** 未授權呼叫無法更新資料；簽章或金鑰錯誤拒絕；重送不重複發送。
5. **公開預約：** 伺服器重新計價；同一名額並發不得超賣；公開回應不包含其他人的個資。
6. **檔案／外部網址：** 檔案大小與真正格式、所有權、SSRF 與私網重新導向均測反例。
7. **環境：** 原始碼與 migration 必須綁 current `main`；TEST/Production 驗收與權限放行分開，未驗證要明列。

測試來源：`docs/integration/12-TESTING-TDD.md`；正式環境規則：`docs/AGENT-EXECUTION.md` §3.2 與 `docs/PRODUCTION-DB-RELEASE-WORKFLOW.md`。**本文件建立時未執行測試，也未查驗 Production 真實配置。**

## 5. 已知邊界／待驗證事項

- 此次為**有限範圍的 source 與 canonical 文件盤點**；不能據此宣稱所有 `/api/**` 路由或最新 84+ 個 migration 都逐一審查完成。
- `requireTenantManager()` 與代登入邏輯會改用 service-role client。這是高度敏感的設計，不等於已存在漏洞；需把跨租戶負例測試當作每次相關變更的放行依據。
- `docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` 的跨系統授權模型有歷史待裁示範圍；不得以舊分冊推定雙專案已安全串接。
- 金流商實際 sandbox／正式 callback 的端對端驗證證據，無法只靠演算法單元測試替代。
- 正式部署中的密鑰管理、Storage bucket 權限、Rate Limit 的跨節點效果與 DB 目前 RLS，需另以真實環境證據查證。
- 本文件不列出密碼、token、完整個資、真實商店憑證或可利用的內部服務地址。

## 6. 怎麼維護這份模型（避免每次安全審查重造一份）

### 更新時機

- **每次關鍵 PR：** 涉及 `src/server/{tenant,supabase,http,platform-admin,crypto,ecpay,ssrf-guard}.ts`、`src/app/api/{auth,platform,public,line,donations,cron,upload}/**`、`supabase/migrations/**`、`src/config/tenant-settings.ts`，或付款、退款、權限、通知、外部合作介面，就比對上表的威脅及驗收案例。**有新信任邊界／資料流才修改本文件**，不要每個小 PR 都重寫。
- **架構變動／事故／安全審查發現可重現問題時：** 更新受影響的資產、信任邊界、威脅 ID、既有防護、待驗證與來源，並在 PR 說明引用原威脅 ID。
- **至少每季做一次重新盤點**；沒有變更時只記盤點日期和來源 SHA，不製造無意義 commit。若要真正自動觸發監看，需另有已驗證的工作流程或排程；文件存在本身不會執行巡查。

### 更新規則

1. 先讀 current `main` 的 `AGENTS.md`、`docs/AGENT-EXECUTION.md`、相關 Owner Decision、程式及 canonical 分冊。
2. 保留原有 `TM-xx` 編號，不要刪掉已記錄的風險；已解決者改為「已驗證並附證據」，待驗證者不得變成已通過。
3. 以**實際程式行為**更新「既有防護」，只在有真實測試／CI／正式環境證據時寫已驗證。
4. 純文件修改走既有 docs-only PR／分支保護，安全檢查仍照專案規定；不要因這份模型新增阻塞所有開發的第二套 Gate。
5. 不在此放機密或完整弱點重現祕密；具體修復證據用 Issue／PR 與受控測試紀錄。

### Codex 設定

把 Codex 專案「**此程式碼庫中的威脅模型檔案路徑**」設為 `docs/threat-model.md`。這只提供審查脈絡，**無法保證減少多少額度**；是否真的省額度，需觀察設定前後的安全審查次數、執行時間與結果品質。同時選擇較省的「建立 PR 時」觸發方式，避免每次推送重新審查。

## 7. 來源索引與維護記錄

- Canonical 執行與文件規則：`AGENTS.md`、`CLAUDE.md`、`docs/AGENT-EXECUTION.md`、`docs/DOCUMENTATION-GOVERNANCE.md`。
- 架構與測試：`docs/integration/01-ARCHITECTURE.md`、`02-SUPABASE-SCHEMA.md`、`03-AUTH.md`、`12-TESTING-TDD.md`。
- 支付與代登入：`docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md`、`21-PLATFORM-ADMIN-IMPERSONATION.md`。
- 實作入口：`src/server/tenant.ts`、`src/server/http.ts`、`src/server/platform-admin.ts`、`src/server/supabase.ts`、`src/server/crypto.ts`、`src/server/ssrf-guard.ts`、`src/server/ecpay.ts`、`src/app/api/**`、`supabase/migrations/**`。

| 日期 | 類型 | 變更與依據 | 驗證狀態 |
|---|---|---|---|
| 2026-10-16 | 初版 | 依 GitHub `main` 的指定程式及 canonical 文件，建立 13 種威脅類型、信任邊界與更新規則 | 文件盤點完成；實際完整測試、Production 與合入 `main` **尚未驗證** |
