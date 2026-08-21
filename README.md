# VibeAI 店家後台 — 重建骨架

把 `vibeaico.com/tenant/*` 的整套店家後台，重建成一份乾淨、可維護、可本地部署的原始碼骨架。

* **37 個頁面**，路由與原站完全相同
* **完整設計 token**（配色 / 字級 / 圓角 / 陰影 / 間距 / 動效），全部集中在 `src/styles/tokens.css`
* **全站文案 i18n 化** — 37 份字典檔、7,600+ 行、約 15 萬字，逐字取自原站
* **多租戶設定層** — LINE Channel Token 等由店家在後台自行輸入，不寫死在環境變數
* **Mock 資料層** — 不需任何後端即可 `npm run dev` 跑起整套後台

---

## 快速開始

```bash
npm install
cp .env.example .env.local     # 骨架模式全部可留空
npm run dev                    # → http://localhost:3000/tenant/dashboard
```

`NEXT_PUBLIC_USE_MOCK=true`（預設）時完全不需要資料庫或後端服務。

```bash
npm run build      # 產出正式版
npm run start      # 啟動正式版
npm run typecheck  # TypeScript strict 檢查
```

---

## 文件

| 檔案 | 內容 |
|---|---|
| [`docs/integration/00-MASTER-PLAN.md`](docs/integration/00-MASTER-PLAN.md) | **真實後端串接總計畫**：Supabase / 登入系統 / Resend / LINE 連動，分 8 個 Phase 的完整實作規格（給 AI 或工程師照做） |
| [`docs/REBUILD-SPEC.md`](docs/REBUILD-SPEC.md) | **主文件**：設計系統規格、37 頁的區塊與文案清單、API 契約、還原度說明 |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | 開發約定（新增頁面時務必先讀） |
| [`docs/specs/`](docs/specs/) | 從原站抓下來的原始 DOM 規格 JSON，每頁一份，是所有還原工作的依據 |
| [`docs/_endpoints.json`](docs/_endpoints.json) | 原站 195 個 API 端點清單 |

---

## 架構重點

### 1. 設計 token 是單一事實來源

`src/styles/tokens.css` 定義所有 CSS 變數 → `tailwind.config.ts` 全部指向這些變數 →
元件只用 Tailwind class。**改主題只需要動 `tokens.css` 一個檔案。**

### 2. 文案零硬編碼

頁面裡不會出現任何中文字面值。所有文字都在 `src/i18n/zh-TW/`：

```
common.ts              全站共用（按鈕、狀態、驗證、確認彈窗…）
nav.ts                 側邊欄 37 個項目
pages/<page>.ts        每頁的標題、欄位、說明、錯誤訊息、toast…
```

要出英文版 / 日文版：複製 `zh-TW` 資料夾改譯即可，程式碼一行不用動。

### 3. 資料層可插拔

```
頁面 → services/*  →  adapt(mock, real)  →  mock/ 或 真實 API
```

頁面不 fetch。把 `NEXT_PUBLIC_USE_MOCK` 設成 `false`，同一組 service 函式就改打
`src/lib/api.ts` 定義的真實端點，頁面元件完全不用改。

### 4. 多租戶客製化（本專案的核心設計）

| 層級 | 存哪裡 | 誰設定 | 例子 |
|---|---|---|---|
| **平台層** | `.env` → `src/config/env.ts` | 部署者 | 資料庫連線、SMTP、平台 OAuth、加密金鑰 |
| **租戶層** | 資料庫 `tenant_settings` → `src/config/tenant-settings.ts` | **每家店自己在後台填** | LINE Channel ID / Secret / Access Token、營業時間、通知開關、點數規則、品牌配色 |

> ⚠️ **LINE Channel Token 絕不放 `.env`。** 那樣整個平台只能服務一家店。
> Secret 類欄位入庫前用 `SETTINGS_ENCRYPTION_KEY` 加密，回前端一律 `maskSecret()` 遮罩；
> 使用者沒點「重新輸入」就送空字串，代表「不變更」。行為實作在
> `src/app/tenant/line-settings/page.tsx`。

---

## 專案結構

```
src/
├── app/
│   ├── layout.tsx                 根 layout（字體、metadata、PWA manifest）
│   └── tenant/
│       ├── layout.tsx             依 pathname 分流：認證頁不套 AppShell
│       └── <37 個頁面>/page.tsx
├── components/
│   ├── ui/                        14 個設計系統元件
│   └── layout/                    AppShell / Sidebar / Topbar / Footer
│                                  + 全站 widget（回報問題、AI 客服助理）
├── config/
│   ├── nav.ts                     側邊欄結構 + 功能旗標對應
│   ├── env.ts                     平台環境變數（zod 驗證）
│   ├── tenant-settings.ts         ★ 租戶設定 schema
│   └── features.ts                功能商店旗標
├── i18n/zh-TW/                    全站文案
├── lib/
│   ├── types.ts                   領域型別 = 前後端契約
│   ├── api.ts                     API adapter
│   └── utils.ts                   cn / 貨幣 / 日期格式化
├── services/                      頁面唯一的資料入口
├── mock/                          骨架模式假資料
└── styles/
    ├── tokens.css                 ★ 設計 token
    └── globals.css                base + component layer
```

---

## 與原站的關係

原站是 **Bootstrap 5 + 原生 JS + 伺服器端 HTML 樣板**（Java / Railway 部署）。
本骨架用 **Next.js + Tailwind** 重建，但視覺 1:1：原站所有自訂 class
（`.card` `.data-table-*` `.badge` `.btn` `.form-control` `.sidebar-*` …）
在 `src/styles/globals.css` 的 `@layer components` 都有等價實作，
連原站 CSS 註解裡記錄的 UX 評審決策（為什麼表格欄位收窄到 150px、
為什麼 active 導航要用主色底＋左指示條）也一併搬過來了。

詳細對照見 `docs/REBUILD-SPEC.md`。
