# VibeAI 店家後台 — 完整重建規格

> 這份文件加上 `src/` 的原始碼骨架，目標是讓任何人（或任何 AI）能做出與 vibeaico.com
> 店家後台 **100% 一致** 的系統。所有規格皆由實際抓取原站頁面反推，非臆測。

---

## 0. 調查方法與可信度

原站 `/tenant/*` 是**伺服器端渲染**，且未登入也會回傳完整 HTML（權限只擋在 API 層），
因此整套後台的版面、每個欄位、每個 modal、每一句文案都能完整取得。

| 來源 | 內容 |
|---|---|
| 37 份頁面 HTML（約 3.5 MB） | 版面結構、表格欄位、表單欄位、modal、alert、空狀態 |
| `css/tenant.css`（95 KB）+ `css/common.css`（25 KB） | 完整設計系統，含原站 UX 評審的決策註解 |
| `js/tenant.js`（81 KB）+ `js/common.js`（51 KB） | toast／驗證訊息／動態文案、API 端點 |
| `docs/specs/*.json` | 上述資料的結構化萃取，每頁一份，是本重建的依據 |

原站技術棧：**Bootstrap 5.3.2 + Bootstrap Icons 1.11.1 + 原生 JS + 伺服器端 HTML 樣板**，
部署在 Railway（`server: railway-hikari`），字體用 Google Fonts 的 Inter + Noto Sans TC，
有 PWA manifest 與 Service Worker，GA4 追蹤 ID `G-YP724H56BX`。

---

## 1. 設計系統（Design Tokens）

全部定義在 `src/styles/tokens.css`，Tailwind theme 只是指向它們的別名。

### 1.1 色彩

#### 品牌與語意色（原站 `:root` 原值）

| Token | 值 | 用途 |
|---|---|---|
| `--primary-color` | `#4361ee` | 主色：按鈕、連結、active 導航、focus ring |
| `--primary-hover` | `#3a56d4` | 主要按鈕 hover |
| `--secondary-color` | `#86868b` | 次要文字、說明文字 |
| `--success-color` | `#34c759` | 成功、已完成 |
| `--info-color` | `#5ac8fa` | 資訊提示 |
| `--warning-color` | `#ff9f0a` | 警告、待確認 |
| `--danger-color` | `#ff3b30` | 危險、刪除、未讀數字 |
| `--light-color` | `#f5f5f7` | 內容區底色 |
| `--dark-color` | `#1d1d1f` | 側邊欄底色、主要文字 |

> 這組色票是 Apple 系統色（`#34c759` `#ff9f0a` `#ff3b30` `#5ac8fa`）配上藍紫主色 `#4361ee`，
> 深色為 `#1d1d1f`、淺灰為 `#f5f5f7` —— 明顯是 Apple HIG 取向的選色。

#### 中性階（自原站高頻用色彙整）

| Token | 值 | 用途 |
|---|---|---|
| `--neutral-0` | `#ffffff` | 卡片底 |
| `--neutral-25` | `#fafafa` | 極淺底 |
| `--neutral-50` | `#f8f9fa` | 表頭底 |
| `--neutral-100` | `#f5f5f7` | 頁面底 |
| `--neutral-150` | `#f2f3f7` | 表格 hover / 斑馬紋 |
| `--neutral-200` | `#eeeef0` | 分隔、次要按鈕底 |
| `--neutral-250` | `#e8e8ed` | **主要邊框色** |
| `--neutral-300` | `#dee2e6` | 表單邊框 |
| `--neutral-400` | `#adb5bd` | placeholder |
| `--neutral-500` | `#86868b` | 次要文字 |
| `--neutral-600` | `#6e6e73` | 一般說明文字 |
| `--neutral-700` | `#55555b` | 標籤文字 |
| `--neutral-800` | `#2c2c2e` | 表單 label |
| `--neutral-900` | `#1d1d1f` | 主要文字 |

#### 狀態徽章 — 淺色實心底 + 深色字

原站刻意**不用半透明**，因為徽章會疊在斑馬紋 / hover 列上，半透明會變色。

| 語意 | 底色 | 文字色 | 對應狀態 |
|---|---|---|---|
| `primary` | `#e4eaff` | `#24358f` | 已確認、進行中 |
| `success` | `#ddf5e6` | `#146c37` | 已完成、正常、已啟用 |
| `warning` | `#fff1d6` | `#7a4f00` | 待確認、流失風險、即將到期 |
| `danger` | `#fce0d0` | `#9c3600` | 已取消、爽約、已過期 |
| `info` | `#d9f0fb` | `#1a6b8f` | 一般資訊 |
| `purple` | `#ece2fb` | `#4d2b8c` | 會員等級 |
| `neutral` | `#eeeef0` | `#55555b` | 未設定、已停用 |

另有紅色計數圓標 `.badge-count`：底 `--danger-color`、白字、`border-radius: 999px`、
`font-size: 11px`、`min-width: 18px`，用於側邊欄的待確認預約 / 未讀訊息數字。

#### 第三方品牌色

| Token | 值 | 用途 |
|---|---|---|
| `--line-green` | `#06c755` | LINE 官方綠，用於「用 LINE 登入」「LINE 主題」 |
| `--line-green-dark` | `#1db446` | LINE 綠 hover |
| `--google-blue` | `#4285f4` | Google 登入 |

#### 漸層（原站 `:root` 原值）

| Token | 值 |
|---|---|
| `--bg-gradient-primary` | `linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%)` |
| `--bg-gradient-success` | `linear-gradient(135deg, #34c759 0%, #30b350 100%)` |
| `--bg-gradient-info` | `linear-gradient(135deg, #5ac8fa 0%, #32ade6 100%)` |
| `--bg-gradient-warning` | `linear-gradient(135deg, #ff9f0a 0%, #ff8800 100%)` |
| `--bg-gradient-danger` | `linear-gradient(135deg, #ff3b30 0%, #d70015 100%)` |

### 1.2 字體

```css
--font-family: "Inter", "Noto Sans TC", -apple-system, BlinkMacSystemFont,
               "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```
Google Fonts 載入 `Inter:wght@400;500;600;700` + `Noto+Sans+TC:wght@400;500;600;700`。
英數走 Inter、中文走 Noto Sans TC，是台灣 SaaS 的標準組合。

#### 字級（1rem = 16px）

| Token | rem | px | 用途 | 原站出現次數 |
|---|---|---|---|---|
| `--text-2xs` | `0.65rem` | 10.4px | 側欄分類標題、極小標籤 | 6 |
| `--text-xs` | `0.75rem` | 12px | **全站最高頻小字**：表格附註、help text、徽章 | 21 |
| `--text-sm` | `0.8125rem` | 13px | 表格內文 | 7 |
| `--text-base` | `0.875rem` | 14px | **內文基準**：表單、按鈕、一般文字 | 14 |
| `--text-md` | `1rem` | 16px | 卡片標題、側欄品牌字 | 7 |
| `--text-lg` | `1.125rem` | 18px | 小標題（手機版頁面標題） | 3 |
| `--text-xl` | `1.25rem` | 20px | 區塊標題 | 6 |
| `--text-2xl` | `1.5rem` | 24px | **頁面標題、統計數字** | 9 |
| `--text-3xl` | `2rem` | 32px | 大型數字 | 2 |
| `--text-4xl` | `2.5rem` | 40px | 超大統計數字 | 2 |

> 注意基準字級是 **14px（0.875rem）不是 16px** —— 這是後台密集資訊介面的常見選擇。

#### 字重

| Token | 值 | 原站次數 | 用途 |
|---|---|---|---|
| `--font-normal` | 400 | — | 一般內文 |
| `--font-medium` | 500 | 4 | 次級導航 |
| `--font-semibold` | 600 | **24（最高頻）** | 導航、按鈕、label、徽章 |
| `--font-bold` | 700 | 20 | 標題、統計數字、卡片標題 |

字距：所有標題 `letter-spacing: -0.01em`，`.page-title` 更緊為 `-0.015em`。
原站註解寫明理由：「中英混排在 700 字重下預設偏鬆」。

### 1.3 圓角

| Token | 值 | 用途 |
|---|---|---|
| `--radius-xs` | `2px` | 進度條 |
| `--radius-sm` | `6px` | **按鈕、表單、徽章** |
| `--radius` | `8px` | **卡片、表格容器**（原站 `--border-radius`，出現 15 次） |
| `--radius-md` | `10px` | 統計卡 icon 底 |
| `--radius-lg` | `12px` | Modal（原站 `--border-radius-lg`） |
| `--radius-pill` | `999px` | 計數圓標、標籤膠囊 |
| `--radius-circle` | `50%` | 頭像 |

### 1.4 陰影

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.03)` | 極輕 |
| `--shadow` | `0 2px 12px rgba(0,0,0,.06)` | 原站預設卡片陰影（11 次） |
| `--shadow-md` | `0 4px 20px rgba(0,0,0,.08)` | 浮起狀態 |
| `--shadow-lg` | `0 8px 30px rgba(0,0,0,.12)` | 下拉選單 |
| `--shadow-xl` | `0 10px 40px rgba(0,0,0,.30)` | Modal |
| `--shadow-focus` | `0 0 0 3px rgba(67,97,238,.25)` | **統一 focus ring** |
| `--shadow-nav-active` | `inset 3px 0 0 #8ea4ff` | 側欄當前頁左指示條 |

> ⚠️ **卡片實際用的不是 `--shadow`。** 原站 2026-08-01 的「美觀程度」專項改版把卡片從
> 「純陰影浮空」改成「髮絲邊框 + 更輕的陰影」：
> ```css
> .card, .data-table-container, .settings-card {
>   border: 1px solid rgba(0, 0, 0, 0.06);
>   box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
> }
> ```
> 原站註解：「邊框讓卡片在淺灰底上有明確、銳利的邊界（Linear/Stripe 系的作法），
> 陰影退居輔助，整體更乾淨、不糊。」本骨架照搬這個決定。

### 1.5 間距與版面

| Token | 值 | 說明 |
|---|---|---|
| `--content-padding` | `1.5rem` | 內容區內距（手機 `1rem 0.75rem`） |
| `--sidebar-width` | `250px` | 側邊欄展開寬 |
| `--sidebar-collapsed-width` | `80px` | 側邊欄收合寬 |
| `--topbar-height` | `4.375rem`（70px） | 與 `.sidebar-brand` 同高（手機 `3.5rem`） |

間距階：`0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 2.5 / 3 rem`，主節奏為 `1.5rem`。

### 1.6 動效

| Token | 值 | 用途 |
|---|---|---|
| `--transition-fast` | `0.15s ease` | 卡片、表格列、按鈕、徽章的狀態變化 |
| `--transition-base` | `0.2s ease` | 導航、一般互動 |
| `--transition-slow` | `0.3s ease` | 側邊欄收合 |

動畫（`@keyframes`）：`spin`（載入）、`pulse-dot` / `pulse-dot-green`（狀態燈）、
`pendingPulse`（待確認徽章）、`pwaSlideUp`（安裝 App 提示）、`lt-bounce`、`fade-in`。

### 1.7 響應式斷點

沿用 Bootstrap 5：`576px` / `768px` / `992px` / `1200px`。關鍵行為：

| 斷點 | 行為 |
|---|---|
| `< 992px` | 側邊欄改為抽屜（`fixed` + 遮罩），頂欄改 `sticky` 常駐、高度降為 `3.5rem` |
| `992–1199px` | 表格長文字欄收窄到 `150px`，避免右側「狀態／操作」欄被擠出畫面 |
| `≥ 1200px` | 表格不套收窄規則（本來就塞得下，硬加會製造不必要的橫捲） |

> 原站 CSS 註解記錄了實測數據：「1024×768 /tenant/bookings：整個『狀態』欄被蓋 130px＝100% 看不到，
> 金額 $1,200 被蓋 60px，共 22 格。」這些決策已完整保留在 `globals.css` 的註解裡。

### 1.8 z-index 疊層

`sidebar 1` → `content 1` → `topbar 1020` → `backdrop 1040` → `modal 1050` → `toast 1080` → `flyout 1090`

---

## 2. 版面骨架

```
.app-wrapper                     display:flex; min-height:100vh
├── nav.sidebar                  250px / 80px（收合）；sticky；底色 #1d1d1f
│   ├── .sidebar-brand           70px 高，logo 包成白底圓角 7px + 內距 4/5px
│   ├── hr.sidebar-divider       rgba(255,255,255,.15)
│   └── ul                       37 個導航項目，7 個可收合群組
└── .content-wrapper             flex:1；底色 #f5f5f7
    ├── header.topbar            70px；白底；box-shadow 0 1px 0 rgba(0,0,0,.04)
    ├── main.content-area        padding 1.5rem
    └── footer                   Copyright © 瓦比艾有限公司 VibeAI Co., Ltd. 2026
```

另有兩個全站常駐 widget：左下角「回報問題」圓鈕、右下角「AI 客服助理」圓鈕。

**側邊欄背景延伸**：`.app-wrapper::before` 畫一條與側欄同寬的深色偽元素，
防止右側內容滾動時左側出現空白。

**當前頁樣式**：主色底 `#4361ee` + 左側指示條 `inset 3px 0 0 #8ea4ff`。
原站註解說明理由：「原本 active/hover/群組展開三層白霧亮度接近，店家要盯著看才知道自己在哪一頁。」
這是側邊欄唯一帶彩度的狀態。

### 2.1 側邊欄完整結構

| 群組 | 項目 | 路由 | 功能旗標 | 徽章 |
|---|---|---|---|---|
| — | 儀表板 | `/tenant/dashboard` | — | — |
| 預約管理 | 預約列表 | `/tenant/bookings` | — | pendingBookingBadge |
| 　 | 定期預約 | `/tenant/recurring-bookings` | — | — |
| 　 | 行事曆 | `/tenant/calendar` | — | — |
| 　 | 營運報表 | `/tenant/reports` | BASIC_REPORT | — |
| 　 | 行事曆同步 | `/tenant/calendar-sync` | — | — |
| 顧客管理 | 顧客列表 | `/tenant/customers` | — | — |
| 　 | 會員等級 | `/tenant/membership-levels` | MEMBERSHIP_SYSTEM | — |
| — | 顧客訊息 | `/tenant/chat` | — | unreadChatBadge |
| 店家營運 | 員工管理 | `/tenant/staff` | — | — |
| 　 | 服務項目 | `/tenant/services` | — | — |
| 　 | 封鎖時段 | `/tenant/block-times` | — | — |
| 　 | 看診號碼掛號 | `/tenant/clinic-queue` | — | — |
| 　 | 班表管理 | `/tenant/shifts` | — | — |
| 　 | 收款方式 | `/tenant/payment-methods` | — | — |
| 　 | 票券管理 | `/tenant/coupons` | COUPON_SYSTEM | — |
| 　 | 商品管理 | `/tenant/products` | PRODUCT_SALES | — |
| 　 | 商品訂單 | `/tenant/product-orders` | PRODUCT_SALES | pendingOrderBadge |
| 　 | 庫存異動 | `/tenant/inventory` | INVENTORY | — |
| 　 | 關鍵字回覆 | `/tenant/keyword-replies` | KEYWORD_REPLY | — |
| 　 | AI 客服設定 | `/tenant/ai-settings` | AI_ASSISTANT | — |
| 行銷推廣 | 推廣中心 | `/tenant/promote` | — | — |
| 　 | 行銷活動 | `/tenant/campaigns` | — | — |
| 　 | 行銷推播 | `/tenant/marketing` | — | — |
| 　 | 推薦好友 | `/tenant/referrals` | — | — |
| 公開頁面 | 店面設計 | `/tenant/shop-design` | — | — |
| 　 | 作品展示 | `/tenant/portfolio` | PORTFOLIO_SHOWCASE | — |
| 系統設定 | 店家設定 | `/tenant/settings` | — | — |
| 　 | LINE 設定 | `/tenant/line-settings` | — | — |
| 　 | 選單設計 | `/tenant/rich-menu-design` | CUSTOM_RICH_MENU | — |
| 　 | 功能商店 | `/tenant/feature-store` | — | — |
| 　 | 點數管理 | `/tenant/points` | — | — |
| — | 贊助我們 | `/tenant/donate` | — | — |
| — | 回報問題 | `#` | — | — |

功能旗標未訂閱時，原站行為是**仍然顯示該項目**，但點進去會引導到
`/tenant/feature-store?feature=<CODE>`。訂閱到期時資料完整保留、對外功能暫停
（票券暫停、商品下架），續訂後自動恢復。

---
## 3. 元件庫

位於 `src/components/ui/`，14 個檔案。全部對應原站的自訂 class。

| 元件 | 對應原站 class | 變體 / 重點 |
|---|---|---|
| `Button` | `.btn` `.btn-primary` `.btn-ghost`… | variant：primary / secondary / success / danger / warning / outline / outlineDanger / ghost / line；size：sm / md / lg / icon；內建 `loading` + `loadingText`（原站每個按鈕都有「儲存中...」這類狀態） |
| `Badge` `CountBadge` | `.badge` `.badge-count` | tone 7 種；徽章 `white-space: nowrap`「永不折行/截斷」 |
| `Card` 系列 | `.card` `.card-header` `.card-body` `.card-footer` | 髮絲邊框 + 極輕陰影 |
| `DataTable` 系列 | `.data-table-container` `-header` `-body` `-footer` | 表頭 sticky 吸頂；列底色統一走 `--row-bg` 變數（避免 hover 時出現雙色接縫）；`numeric` 欄右對齊 + `tabular-nums` |
| `Pagination` | `.data-table-footer` 內 | 「顯示第 X–Y 筆，共 Z 筆」+ 上一頁 / 下一頁 |
| `Modal` `ConfirmModal` | `.modal` `.modal-dialog` | size：md / lg / xl；`ConfirmModal` 即原站每頁共用的 `#confirmModal`（標題「確認」、內文「確定要執行此操作嗎？」） |
| `Alert` | `.alert` | tone 6 種，內建 icon 與 `action` 插槽 |
| `StatCard` | `.stat-card` | 2026-08-01 UX 評審拿掉裝飾性四色左邊框，顏色只留在 icon |
| `EmptyState` | `.empty-state` | icon + 標題 + 說明 + 行動按鈕 |
| `Tabs` `TabPanel` | `.nav-tabs` | 命名刻意用 `.tab-link` 而非 Bootstrap 的 `.nav-link`，避免側邊欄 active 樣式污染分頁（原站踩過這個坑） |
| `PageHeader` | `.page-eyebrow` `.page-title` | eyebrow 是 UX 評審加的：深層頁只有一個 h1，看不出屬於哪個群組 |
| `Toast` `useToast()` | 原站的 toast | success / danger / warning / info，3.5 秒自動消失 |
| 表單元件 | `.form-label` `.form-control` `.form-select` `.form-text` | `Label(required)` 自動加紅色 `*`；`CharCounter`（原站多處「0 /500」）；`Switch` / `SwitchField`（設定頁大量使用） |

圖示：原站用 Bootstrap Icons，本骨架改用 **lucide-react**，對照表在 `src/config/nav.ts`。

---

## 4. 頁面規格（37 頁）

每頁的完整 DOM 規格在 `docs/specs/<page>.json`，完整文案在 `src/i18n/zh-TW/pages/<page>.ts`。
下表是索引與規模。

| # | 群組 | 頁面 | 路由 | 標題區塊 | 卡片 | 表格 | 對話框 | 按鈕 | JS 文案 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 儀表板 | 儀表板 | `/tenant/dashboard` | 9 | 17 | 2 | 2 | 18 | 88 |
| 2 | 預約管理 | 預約管理 | `/tenant/bookings` | 2 | 0 | 1 | 8 | 6 | 176 |
| 3 | 預約管理 | 定期預約 | `/tenant/recurring-bookings` | 2 | 1 | 1 | 3 | 1 | 51 |
| 4 | 預約管理 | 行事曆 | `/tenant/calendar` | 1 | 0 | 0 | 3 | 3 | 87 |
| 5 | 預約管理 | 營運報表 | `/tenant/reports` | 9 | 16 | 4 | 1 | 5 | 38 |
| 6 | 預約管理 | 行事曆同步 | `/tenant/calendar-sync` | 6 | 4 | 0 | 1 | 4 | 32 |
| 7 | 顧客管理 | 顧客管理 | `/tenant/customers` | 2 | 0 | 1 | 4 | 6 | 67 |
| 8 | 顧客管理 | 會員等級 | `/tenant/membership-levels` | 2 | 0 | 1 | 2 | 2 | 27 |
| 9 | 顧客管理 | 顧客訊息 | `/tenant/chat` | 1 | 1 | 0 | 1 | 3 | 28 |
| 10 | 店家營運 | 員工管理 | `/tenant/staff` | 2 | 0 | 1 | 5 | 1 | 79 |
| 11 | 店家營運 | 服務項目 | `/tenant/services` | 2 | 2 | 1 | 4 | 7 | 113 |
| 12 | 店家營運 | 封鎖時段 | `/tenant/block-times` | 2 | 0 | 1 | 3 | 1 | 47 |
| 13 | 店家營運 | 看診號碼掛號 | `/tenant/clinic-queue` | 5 | 1 | 2 | 6 | 6 | 101 |
| 14 | 店家營運 | 班表管理 | `/tenant/shifts` | 1 | 0 | 1 | 5 | 10 | 112 |
| 15 | 店家營運 | 收款方式 | `/tenant/payment-methods` | 1 | 0 | 0 | 3 | 1 | 101 |
| 16 | 店家營運 | 票券管理 | `/tenant/coupons` | 2 | 0 | 1 | 7 | 2 | 100 |
| 17 | 店家營運 | 商品管理 | `/tenant/products` | 2 | 2 | 1 | 5 | 8 | 103 |
| 18 | 店家營運 | 商品訂單 | `/tenant/product-orders` | 2 | 1 | 1 | 3 | 1 | 100 |
| 19 | 店家營運 | 庫存異動 | `/tenant/inventory` | 2 | 0 | 1 | 1 | 0 | 25 |
| 20 | 店家營運 | 關鍵字回覆 | `/tenant/keyword-replies` | 3 | 2 | 1 | 3 | 5 | 118 |
| 21 | 店家營運 | AI 客服設定 | `/tenant/ai-settings` | 5 | 4 | 0 | 1 | 9 | 31 |
| 22 | 行銷推廣 | 推廣中心 | `/tenant/promote` | 5 | 4 | 1 | 1 | 3 | 48 |
| 23 | 行銷推廣 | 行銷活動 | `/tenant/campaigns` | 2 | 1 | 1 | 3 | 2 | 82 |
| 24 | 行銷推廣 | 行銷推播 | `/tenant/marketing` | 3 | 0 | 1 | 3 | 1 | 58 |
| 25 | 行銷推廣 | 推薦好友 | `/tenant/referrals` | 3 | 6 | 1 | 1 | 3 | 21 |
| 26 | 公開頁面 | 公開頁面設計 | `/tenant/shop-design` | 9 | 7 | 0 | 1 | 11 | 49 |
| 27 | 公開頁面 | 作品展示 | `/tenant/portfolio` | 1 | 4 | 0 | 3 | 4 | 65 |
| 28 | 系統設定 | 店家設定 | `/tenant/settings` | 16 | 3 | 0 | 1 | 10 | 99 |
| 29 | 系統設定 | LINE 設定 | `/tenant/line-settings` | 19 | 11 | 0 | 3 | 39 | 283 |
| 30 | 系統設定 | 選單設計 | `/tenant/rich-menu-design` | 13 | 10 | 1 | 3 | 16 | 790 |
| 31 | 系統設定 | 功能商店 | `/tenant/feature-store` | 1 | 0 | 0 | 2 | 8 | 235 |
| 32 | 系統設定 | 點數管理 | `/tenant/points` | 2 | 4 | 1 | 4 | 3 | 51 |
| 33 | 其他 | 贊助我們 | `/tenant/donate` | 2 | 2 | 1 | 2 | 5 | 27 |
| 34 | 認證頁（不套後台版面） | 店家登入 | `/tenant/login` | 1 | 0 | 0 | 0 | 4 | 4 |
| 35 | 認證頁（不套後台版面） | 免費註冊 | `/tenant/register` | 1 | 0 | 0 | 0 | 5 | 19 |
| 36 | 認證頁（不套後台版面） | 忘記密碼 - VibeAI | `/tenant/forgot-password` | 1 | 0 | 0 | 0 | 1 | 3 |
| 37 | 認證頁（不套後台版面） | 重設密碼 - VibeAI | `/tenant/reset-password` | 1 | 0 | 0 | 0 | 2 | 5 |

### 4.x 各頁細節

#### 群組：儀表板

##### `/tenant/dashboard` — 儀表板

* **HTML `<title>`**：`儀表板 - 店家後台`
* **檔案**：`src/app/tenant/dashboard/page.tsx` · 文案 `src/i18n/zh-TW/pages/dashboard.ts`
* **區塊標題**：儀表板 · 3 分鐘開始收單 · 快速開始設定您的店家 · 快速操作 · 今日預約 · 最近活動 · 員工業績（本月） · 本週預約趨勢 · 本月預約來源
* **表格欄位**：時間 | 顧客 | 服務 | 員工 | 狀態
* **表格欄位**：員工 | 預約 | 完成率 | 營收
* **對話框**：回報問題
* **表單欄位（5 個）**：
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：你的預約頁已可以收單： 開啟 ／ 預約截止日期已過（ ） 顧客目前無法透過 LINE / 公開頁面預約任何日期。請前往店家設定更新或清除截止日。 前往設定 ／ 把預約自動同步到您的 Google / Apple 行事曆 一次設定，所有新預約自動出現在您平常看的行事曆上 立即設定 ／ 您的公開預約網址： 複製 開啟


#### 群組：預約管理

##### `/tenant/bookings` — 預約管理

* **HTML `<title>`**：`預約管理 - 店家後台`
* **檔案**：`src/app/tenant/bookings/page.tsx` · 文案 `src/i18n/zh-TW/pages/bookings.ts`
* **區塊標題**：預約管理 · 預約列表
* **表格欄位**：編號 | 日期時間 | 顧客 | 服務 | 員工 | 金額 | 狀態 | 操作
* **對話框**：加購項目 · 取消預約 · 新增預約 · 預約詳情 · 編輯預約 · 套用票券折抵 · 回報問題
* **表單欄位（39 個）**：
  * `startDateFilter` — input date
  * `endDateFilter` — input date
  * `statusFilter` — select — 選項：全部狀態/未處理/待確認/已確認/已完成/已取消
  * `showCancelledToggle` — input checkbox — 標籤「含已取消」
  * `searchKeyword` — input text — 提示「搜尋顧客姓名或電話...」
  * `selectAllCheckbox` — input checkbox
  * `addonServiceSelect` — select — 選項：— 自由輸入（耗材/商品類）—
  * `addonItemName` — input text — 提示「例如：刮痧 / 青草膏」
  * `addonPrice` — input number — 標籤「加購價 *」 — 提示「優惠價」
  * `addonDuration` — select — 標籤「佔用時長」 — 選項：不佔時間/10 分鐘/20 分鐘/30 分鐘/40 分鐘/50 分鐘
  * `addonQty` — input number — 標籤「數量」
  * `addonStaffSelect` — select — 選項：同本預約的人員
  * `addonNotify` — input checkbox — 標籤「通知顧客消費明細（連續加多項時可先勾掉、最後一項再通知，避免顧客連收多則）」
  * `cancelReason` — textarea — 標籤「取消原因」 — 提示「例：店家臨時公休、員工請假、時段調整...」
  * `newCustomerToggle` — input checkbox — 標籤「新顧客（直接輸入姓名與電話）」
  * `bookingCustomer` — select — 標籤「顧客 *」 — 選項：請選擇顧客
  * `newCustomerName` — input text — 標籤「顧客 *」 — 提示「顧客姓名」
  * `newCustomerPhone` — input tel — 標籤「顧客 *」 — 提示「台灣 0912345678；外籍含國碼 +81...」
  * `bookingService` — select — 標籤「服務項目 *」 — 選項：請選擇服務
  * `bookingStaff` — select — 標籤「服務人員」 — 選項：不指定（系統自動分配）
  * `bookingDate` — input date — 標籤「預約日期 *」
  * `checkoutDate` — input date — 標籤「退房日期 *」
  * `bookingTime` — select — 標籤「開始時間 *」
  * `bookingDuration` — input text — 標籤「服務時長」 — 提示「選擇服務後自動填入」
  * `bookingNote` — textarea — 標籤「備註」 — 提示「可填寫顧客特殊需求或注意事項...」
  * `editBookingId` — input hidden
  * `editBookingCustomer` — input text — 標籤「顧客」
  * `editBookingService` — select — 標籤「服務項目 *」 — 選項：請選擇服務
  * `editBookingStaff` — select — 標籤「服務人員」 — 選項：不指定（系統自動分配）
  * `editBookingDate` — input date — 標籤「預約日期 *」
  * `editBookingTime` — select — 標籤「開始時間 *」
  * `editBookingDuration` — input number — 標籤「服務時長 *」
  * `editBookingNoteToCustomer` — textarea — 標籤「給顧客的備註」 — 提示「此備註會透過 LINE 通知顧客...」
  * `applyCouponCode` — input text — 標籤「票券代碼 *」 — 提示「請輸入票券代碼」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/recurring-bookings` — 定期預約

* **HTML `<title>`**：`定期預約 - 店家後台`
* **檔案**：`src/app/tenant/recurring-bookings/page.tsx` · 文案 `src/i18n/zh-TW/pages/recurring-bookings.ts`
* **區塊標題**：定期預約 · 定期預約清單
* **表格欄位**：顧客 | 服務 | 服務人員 | 週期 | 次數 | 狀態 | 最後生成 | 操作
* **對話框**：新增定期預約 · 回報問題
* **表單欄位（16 個）**：
  * `recNewCustomerToggle` — input checkbox — 標籤「新顧客（直接輸入姓名與電話）」
  * `recCustomer` — select — 標籤「顧客 *」 — 選項：請選擇顧客
  * `recNewCustomerName` — input text — 標籤「顧客 *」 — 提示「顧客姓名」
  * `recNewCustomerPhone` — input tel — 標籤「顧客 *」 — 提示「台灣 0912345678；外籍含國碼 +81...」
  * `recService` — select — 標籤「服務項目 *」 — 選項：請選擇服務
  * `recStaff` — select — 標籤「服務人員」 — 選項：不指定（系統自動分配）
  * `recDayOfWeek` — select — 標籤「星期幾 *」 — 選項：請選擇/週一/週二/週三/週四/週五
  * `recIntervalWeeks` — select — 標籤「頻率 *」 — 選項：每週/每 2 週/每 3 週/每 4 週/每 5 週/每 6 週
  * `recStartTime` — select — 標籤「開始時間 *」
  * `recWeeks` — select — 標籤「預約次數 *」 — 選項：4 次/8 次/12 次/16 次/24 次
  * `recNote` — input text — 標籤「備註（選填）」 — 提示「每筆預約共用的備註」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：系統會逐次呼叫一般預約建立流程， 自動沿用 營業時間、午休、員工排班/請假、容量與時段衝突檢查。 遇到公休、客滿或員工不在的週次會 自動略過並回報 ，不會硬建或重複佔位。 顧客只會收到 一則摘要通知 （已綁定 LINE 

##### `/tenant/calendar` — 行事曆

* **HTML `<title>`**：`行事曆 - 店家後台`
* **檔案**：`src/app/tenant/calendar/page.tsx` · 文案 `src/i18n/zh-TW/pages/calendar.ts`
* **區塊標題**：行事曆
* **對話框**：預約詳情 · 取消預約 · 回報問題
* **表單欄位（7 個）**：
  * `staffFilter` — select — 選項：全部員工
  * `cancelReason` — textarea — 標籤「取消原因」 — 提示「例：店家臨時公休、員工請假、時段調整...」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/reports` — 營運報表

* **HTML `<title>`**：`營運報表 - 店家後台`
* **檔案**：`src/app/tenant/reports/page.tsx` · 文案 `src/i18n/zh-TW/pages/reports.ts`
* **區塊標題**：營運報表 · 每日預約與營收趨勢 · 熱門服務分布 · 熱門服務 TOP 5 · 員工業績 TOP 5 · 熱門商品 TOP 10 · 預約時段分布 · 服務趨勢分析 · 解鎖進階報表分析
* **表格欄位**：排名 | 服務名稱 | 預約數 | 營收
* **表格欄位**：排名 | 員工姓名 | 服務數 | 營收
* **表格欄位**：排名 | 商品名稱 | 銷售數量 | 營收 | 佔比
* **表格欄位**：服務名稱 | 當期預約數 | 成長率
* **對話框**：回報問題
* **表單欄位（5 個）**：
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/calendar-sync` — 行事曆同步

* **HTML `<title>`**：`行事曆同步 - 店家後台`
* **檔案**：`src/app/tenant/calendar-sync/page.tsx` · 文案 `src/i18n/zh-TW/pages/calendar-sync.ts`
* **區塊標題**：行事曆同步 · 如何加入 Google Calendar · 同步頻率 · 員工個人行事曆 · 匯入外部行事曆 · 怎麼拿 Google 的 ICS 網址
* **對話框**：回報問題
* **表單欄位（9 個）**：
  * `calIcsUrl` — input text
  * `extName` — input text — 標籤「名稱」 — 提示「例如：Booking.com 名單」
  * `extUrl` — input url — 標籤「ICS 網址（https）」 — 提示「https://calendar.google.com/calendar/ical/.../basic.ics」
  * `extColor` — input color — 標籤「顏色」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：密鑰網址等同憑證，本系統 加密儲存 ，請勿外流。


#### 群組：顧客管理

##### `/tenant/customers` — 顧客管理

* **HTML `<title>`**：`顧客管理 - 店家後台`
* **檔案**：`src/app/tenant/customers/page.tsx` · 文案 `src/i18n/zh-TW/pages/customers.ts`
* **區塊標題**：顧客管理 · 顧客列表
* **表格欄位**：顧客資訊 | 聯絡方式 | 會員等級 | 預約次數 | 消費金額 | 狀態 | 操作
* **對話框**：新增顧客 · 綁定 LINE 用戶 — · 回報問題
* **表單欄位（19 個）**：
  * `customerStatusFilter` — select — 選項：全部顧客/流失風險
  * `searchKeyword` — input text — 提示「輸入姓名或電話搜尋...」
  * `filterLevel` — select — 標籤「會員等級」 — 選項：全部等級
  * `filterTag` — select — 標籤「標籤篩選」 — 選項：全部標籤
  * `filterMinSpent` — input number — 標籤「最低消費」 — 提示「0」
  * `filterMaxSpent` — input number — 標籤「最高消費」 — 提示「不限」
  * `filterMinVisits` — input number — 標籤「最低次數」 — 提示「0」
  * `dataId` — input hidden
  * `name` — input text — 標籤「姓名 *」 — 提示「請輸入顧客姓名」
  * `phone` — input tel — 標籤「電話 *」 — 提示「例如：0912-345-678」
  * `email` — input email — 標籤「電子郵件」 — 提示「example@email.com」
  * `gender` — select — 標籤「性別」 — 選項：未指定/男/女/不公開
  * `birthday` — input date — 標籤「生日」
  * `note` — textarea — 標籤「備註」 — 提示「記錄顧客的特殊需求、偏好或注意事項...」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：提示： 您可以透過搜尋欄位快速找到顧客，點擊「新增顧客」建立新的顧客資料。

##### `/tenant/membership-levels` — 會員等級

* **HTML `<title>`**：`會員等級 - 店家後台`
* **檔案**：`src/app/tenant/membership-levels/page.tsx` · 文案 `src/i18n/zh-TW/pages/membership-levels.ts`
* **區塊標題**：會員等級 · 等級列表
* **表格欄位**：排序 | 等級名稱 | 升級門檻 | 折扣 (%) | 點數倍率 | 狀態 | 操作
* **對話框**：新增會員等級 · 回報問題
* **表單欄位（14 個）**：
  * `levelId` — input hidden
  * `levelName` — input text — 標籤「等級名稱 *」 — 提示「例：銀卡會員」
  * `thresholdAmount` — input number — 標籤「升級門檻 (累計消費金額)」
  * `discountPercent` — input number — 標籤「折扣比例 (%)」
  * `pointMultiplier` — input number — 標籤「點數倍率」
  * `description` — textarea — 標籤「等級說明」 — 提示「此等級的專屬權益說明」
  * `sortOrder` — input number — 標籤「排序」
  * `isActive` — input checkbox — 標籤「啟用此等級」
  * `isDefault` — input checkbox — 標籤「設為預設等級（新顧客自動套用）」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：提示： 設定不同會員等級，依消費金額自動升級，並給予專屬折扣與優惠。

##### `/tenant/chat` — 顧客訊息

* **HTML `<title>`**：`顧客訊息 - 店家後台`
* **檔案**：`src/app/tenant/chat/page.tsx` · 文案 `src/i18n/zh-TW/pages/chat.ts`
* **區塊標題**：顧客訊息
* **對話框**：回報問題
* **表單欄位（8 個）**：
  * `searchConversation` — input text — 提示「搜尋顧客...」
  * `messageInput` — textarea — 提示「輸入訊息...」
  * `chatImageInput` — input file
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」


#### 群組：店家營運

##### `/tenant/staff` — 員工管理

* **HTML `<title>`**：`員工管理 - 店家後台`
* **檔案**：`src/app/tenant/staff/page.tsx` · 文案 `src/i18n/zh-TW/pages/staff.ts`
* **區塊標題**：員工管理 · 員工列表
* **表格欄位**：# | 員工資訊 | 聯絡方式 | 可預約 | 狀態 | 操作
* **對話框**：自訂員工稱呼 · 新增員工 · 請假管理 - · 回報問題
* **表單欄位（26 個）**：
  * `staffTermInput` — input text — 提示「服務人員（預設）」
  * `dataId` — input hidden
  * `avatarInput` — input file — 標籤「頭像」
  * `name` — input text — 標籤「姓名 *」
  * `displayName` — input text — 標籤「顯示名稱」
  * `phone` — input tel — 標籤「電話」
  * `email` — input email — 標籤「電子郵件」
  * `bio` — textarea — 標籤「簡介」
  * `maxConcurrentBookings` — input number — 標籤「同時段最大預約數」 — 提示「1」
  * `isBookable` — input checkbox — 標籤「可接受預約」
  * `isVisible` — input checkbox — 標籤「顯示於前台」
  * `leaveStaffId` — input hidden
  * `leaveType` — select — 標籤「請假類型」 — 選項：事假/病假/休假/特休/其他/封鎖時段
  * `leaveSingle` — input radio — 標籤「單次」
  * `leaveWeekly` — input radio — 標籤「每週」
  * `leaveDate` — input date — 標籤「請假日期 *」
  * `leaveDayOfWeek` — select — 標籤「星期幾 *」 — 選項：週日/週一/週二/週三/週四/週五
  * `leaveReason` — input text — 標籤「請假原因（選填）」 — 提示「例如：家中有事、身體不適等」
  * `leaveFullDay` — input checkbox — 標籤「整天」
  * `leaveStartTime` — select — 標籤「開始時間」
  * `leaveEndTime` — select — 標籤「結束時間」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：上班時段、輪休、班別範本請至 班表管理 ；此頁僅管理員工基本資料與請假。

##### `/tenant/services` — 服務項目

* **HTML `<title>`**：`服務項目 - 店家後台`
* **檔案**：`src/app/tenant/services/page.tsx` · 文案 `src/i18n/zh-TW/pages/services.ts`
* **區塊標題**：服務項目 · 服務列表
* **表格欄位**：服務名稱 | 分類 | 價格 | 時長 | 狀態 | LINE | 操作
* **對話框**：新增服務 · 管理服務分類 · 回報問題
* **表單欄位（24 個）**：
  * `dataId` — input hidden
  * `name` — input text — 標籤「服務名稱 *」 — 提示「例如：男士剪髮」
  * `categoryId` — select — 標籤「分類」 — 選項：請選擇分類
  * `price` — input number — 標籤「價格 *」 — 提示「0」
  * `duration` — select — 標籤「時長 *」 — 選項：請選擇時長/30 分鐘/1 小時/1.5 小時/2 小時/2.5 小時
  * `overnightMode` — input checkbox — 標籤「🌙 過夜 / 住宿模式」
  * `checkInTime` — input time — 標籤「入住時間」
  * `checkOutTime` — input time — 標籤「退房時間」
  * `queueModeEnabled` — input checkbox — 標籤「🔢 號碼掛號模式（診所看診號碼）」
  * `requiresStaff` — input checkbox — 標籤「需要指定員工」
  * `maxCapacity` — input number — 標籤「每時段最大預約數」 — 提示「1」
  * `bufferAfter` — select — 標籤「後置緩衝時間」 — 選項：無（預設）/10 分鐘/15 分鐘/20 分鐘/30 分鐘/45 分鐘
  * `onlinePaymentMode` — select — 標籤「預約線上收款」 — 選項：不收（預設）/收訂金（固定金額）/收訂金（比例 %）/全額付清
  * `onlineDepositValue` — input number — 標籤「訂金金額」 — 提示「0」
  * `description` — textarea — 標籤「描述」 — 提示「服務描述（選填）」
  * `serviceImageInput` — input file — 標籤「主圖」
  * `serviceExtraImageFiles` — input file — 標籤「其他圖片（選填，最多 8 張）」
  * `newCategoryName` — input text — 標籤「分類名稱 *」 — 提示「例如：剪髮、燙染」
  * `newCategoryDesc` — input text — 標籤「描述」 — 提示「選填」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/block-times` — 封鎖時段

* **HTML `<title>`**：`封鎖時段 - 店家後台`
* **檔案**：`src/app/tenant/block-times/page.tsx` · 文案 `src/i18n/zh-TW/pages/block-times.ts`
* **區塊標題**：封鎖時段 · 封鎖時段列表
* **表格欄位**：名稱 | 類型 | 日期/星期 | 時段 | 原因 | 操作
* **對話框**：新增封鎖時段 · 回報問題
* **表單欄位（15 個）**：
  * `blockTimeId` — input hidden
  * `btTitle` — input text — 標籤「封鎖名稱 *」 — 提示「例如：店休、團隊會議」
  * `btReason` — input text — 標籤「原因」 — 提示「選填」
  * `btSingle` — input radio — 標籤「單次」
  * `btWeekly` — input radio — 標籤「每週」
  * `btDate` — input date — 標籤「日期 *」
  * `btDayOfWeek` — select — 標籤「星期幾 *」 — 選項：週日/週一/週二/週三/週四/週五
  * `btFullDay` — input checkbox — 標籤「整天封鎖」
  * `btStartTime` — select — 標籤「開始時間」
  * `btEndTime` — select — 標籤「結束時間」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：封鎖時段內不接受預約，適用所有預約入口（公開頁面、LINE Bot、後台新增預約）

##### `/tenant/clinic-queue` — 看診號碼掛號

* **HTML `<title>`**：`看診號碼掛號 - 店家後台`
* **檔案**：`src/app/tenant/clinic-queue/page.tsx` · 文案 `src/i18n/zh-TW/pages/clinic-queue.ts`
* **區塊標題**：看診號碼掛號 · 先建立你的「看診項目」 · 診次設定 · 逐號看板 · 今日掛號名單 （病患來電取消，點該列「取消」即可）
* **表格欄位**：診次 | 總號數 | 前N現場 | 奇偶分流 | 顯示時間 | 操作
* **表格欄位**：號碼 | 病患 | 電話 | 狀態 | 操作
* **對話框**：建立看診項目 · 新增診次 · 代客掛號 · 當日設定 / 鎖號 / 休診 · 回報問題
* **表單欄位（25 個）**：
  * `serviceSelect` — select — 標籤「號碼掛號服務」 — 選項：載入中...
  * `boardSessionSelect` — select — 標籤「診次」 — 選項：請先新增診次
  * `boardDate` — input date — 標籤「日期」
  * `qsName` — input text — 標籤「項目名稱 *」 — 提示「例：看診、門診掛號」
  * `sessionId` — input hidden
  * `sessionName` — input text — 標籤「診次名稱 *」 — 提示「例：早診」
  * `sessionTotal` — input number — 標籤「當日總號數 *」
  * `sessionReserve` — input number — 標籤「前 N 號現場保留」
  * `sessionOddEven` — input checkbox — 標籤「奇偶分流（線上只發偶數號，奇數留給現場）」
  * `sessionStart` — input time — 標籤「顯示起始時間（選填）」
  * `sessionEnd` — input time — 標籤「顯示結束時間（選填）」
  * `sessionAvg` — input number — 提示「例：5」
  * `regChOnline` — input radio — 標籤「📞 電話／線上預約」
  * `regChWalkIn` — input radio — 標籤「🚶 現場」
  * `regPhone` — input tel — 標籤「病患電話」 — 提示「手機或市話皆可（例：0912345678 / 0212345678）」
  * `regName` — input text — 提示「例：王小明」
  * `lockClosed` — input checkbox — 標籤「整天休診 （該日該診次不發任何號）」
  * `lockTotal` — input number — 標籤「當日號數上限（選填）」 — 提示「留空＝用診次預設」
  * `lockNumbers` — input text — 標籤「鎖定號碼（逗號分隔）」 — 提示「例：6,10」
  * `lockReason` — input text — 提示「例：國定假日休診」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/shifts` — 班表管理

* **HTML `<title>`**：`班表管理 - 店家後台`
* **檔案**：`src/app/tenant/shifts/page.tsx` · 文案 `src/i18n/zh-TW/pages/shifts.ts`
* **區塊標題**：班表管理
* **表格欄位**：員工 | 排班模式
* **對話框**：設定班別 · 編輯週排班 · 班別範本管理 · 回報問題
* **表單欄位（27 個）**：
  * `jumpDate` — input date — 標籤「自訂日期：」
  * `vw1` — input radio — 標籤「1 週」
  * `vw2` — input radio — 標籤「2 週」
  * `vw4` — input radio — 標籤「4 週」
  * `editStaffId` — input hidden
  * `editShiftDate` — input hidden
  * `sfWorking` — input radio — 標籤「上班」
  * `sfOff` — input radio — 標籤「休」
  * `sfStart` — select — 標籤「開始時間 *」
  * `sfEnd` — select — 標籤「結束時間 *」
  * `sfBreakStart` — select — 標籤「休息開始（選填）」
  * `sfBreakEnd` — select — 標籤「休息結束（選填）」
  * `sfNote` — input text — 標籤「備註（班別名稱，選填）」 — 提示「例如：早班、晚班、加班」
  * `sfTemplateId` — input hidden — 標籤「備註（班別名稱，選填）」
  * `wsStaffId` — input hidden
  * `tplEditId` — input hidden — 標籤「班別名稱 *」
  * `tplName` — input text — 標籤「班別名稱 *」 — 提示「例：早班」
  * `tplStart` — select — 標籤「開始時間 *」
  * `tplEnd` — select — 標籤「結束時間 *」
  * `tplColor` — input color — 標籤「顯示色」
  * `tplBreakStart` — select — 標籤「休息開始（選填）」
  * `tplBreakEnd` — select — 標籤「休息結束（選填）」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：優先序： 店家封鎖 > 班表（指定日）> 請假 > 週排班。有班表記錄時，該員工當日以班表為準，忽略請假與週排班。

##### `/tenant/payment-methods` — 收款方式

* **HTML `<title>`**：`收款方式 - 店家後台`
* **檔案**：`src/app/tenant/payment-methods/page.tsx` · 文案 `src/i18n/zh-TW/pages/payment-methods.ts`
* **區塊標題**：收款方式
* **對話框**：新增收款方式 · 回報問題
* **表單欄位（23 個）**：
  * `editId` — input hidden
  * `methodType` — select — 標籤「收款類型 *」 — 選項：請選擇/LINE Pay/街口支付/銀行轉帳/現金/線上刷卡付款（顧客直接刷卡給你）
  * `displayName` — input text — 標籤「顯示名稱 *」 — 提示「如：LINE Pay、國泰世華銀行」
  * `qrUpload` — input file — 標籤「QR Code 圖片」
  * `bankName` — input text — 標籤「銀行名稱 *」 — 提示「點擊選擇或輸入銀行名稱」
  * `bankCode` — input text — 標籤「銀行代碼 (自動帶入)」 — 提示「如 013」
  * `accountNumber` — input text — 標籤「銀行帳號 *」 — 提示「純數字，可加 - 分隔」
  * `accountHolderName` — input text — 標籤「戶名 (選填)」 — 提示「如：王小明」
  * `gatewaySourceOwn` — input radio — 標籤「用我自己的金流帳號（正式收款，錢進你帳戶）」
  * `gatewaySourceDemo` — input radio — 標籤「🧪 用示範測試金流（免申請、免帳號，先試整個流程）」
  * `gatewayProvider` — select — 標籤「金流服務商 *」 — 選項：藍新金流 Newebpay（需商業登記）/綠界科技 ECPay（個人可申請、免商業登記）
  * `gatewayMerchantId` — input text — 標籤「商店代號 MerchantID *」 — 提示「如 MS12345678」
  * `gatewayHashKey` — input text — 標籤「HashKey *」 — 提示「32 字元」
  * `gatewayHashIv` — input text — 標籤「HashIV *」 — 提示「16 字元」
  * `gatewaySandbox` — input checkbox — 標籤「測試環境（藍新沙箱 ccore，用測試卡不扣真錢）」
  * `sortOrder` — input number — 標籤「排序」
  * `isActive` — input checkbox — 標籤「啟用」
  * `instructions` — textarea — 標籤「付款說明」 — 提示「填寫付款備註或注意事項（選填）」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/coupons` — 票券管理

* **HTML `<title>`**：`票券管理 - 店家後台`
* **檔案**：`src/app/tenant/coupons/page.tsx` · 文案 `src/i18n/zh-TW/pages/coupons.ts`
* **區塊標題**：票券管理 · 票券列表
* **表格欄位**：票券名稱 | 類型 | 折扣 | 使用期限 | 已發放/上限 | 狀態 | 操作
* **對話框**：還原票券（反核銷） · 新增票券 · 核銷票券 · 發放給指定顧客 — · 票券詳情 · 回報問題
* **表單欄位（33 個）**：
  * `couponSearch` — input search — 提示「搜尋票券名稱...」
  * `couponStatusFilter` — select — 選項：全部狀態/草稿/已發布/已暫停/已過期/已結束
  * `redeemUndoReason` — input text — 標籤「還原原因 *」 — 提示「例：店員誤核銷／顧客當場表示要留到下次」
  * `dataId` — input hidden
  * `name` — input text — 標籤「票券名稱 *」
  * `type` — select — 標籤「類型 *」 — 選項：折價券（固定金額）/折扣券（百分比）/兌換券/加購券
  * `discountAmount` — input number — 標籤「折抵金額 *」
  * `minOrderAmount` — input number — 標籤「最低消費金額」
  * `discountPercent` — input number — 標籤「折扣 *」 — 提示「例如：10 表示打9折」
  * `maxDiscountAmount` — input number — 標籤「最高折抵金額」
  * `giftItem` — input text — 標籤「兌換項目 *」 — 提示「例如：免費護髮一次」
  * `addonItem` — input text — 標籤「加購項目 *」 — 提示「例如：精油護理」
  * `addonPrice` — input number — 標籤「加購價 *」
  * `validStartAt` — input datetime-local — 標籤「使用期限開始」
  * `validEndAt` — input datetime-local — 標籤「使用期限結束」
  * `totalQuantity` — input number — 標籤「發行數量」
  * `limitPerCustomer` — input number — 標籤「每人限領數量」
  * `privateMode` — input checkbox — 標籤「🔒 私密票券」
  * `description` — textarea — 標籤「使用說明」
  * `couponImageInput` — input file — 標籤「票券圖片」
  * `couponCode` — input text — 標籤「輸入票券代碼」 — 提示「例如: ABC12345」
  * `redeemOrderAmount` — input number — 標籤「消費金額 (選填，折扣券必填)」 — 提示「輸入顧客消費金額」
  * `issueKeyword` — input search — 提示「搜尋姓名/電話...」
  * `issueTag` — input text — 提示「標籤（如：社區）」
  * `issueMinVisits` — input number — 提示「來店 ≥ N 次」
  * `issueSelectAll` — input checkbox — 標籤「全選本頁」
  * `issueSourceDesc` — input text — 提示「例如：社區專屬優惠 / 來店滿10次獎勵」
  * `issueNotifyLine` — input checkbox — 標籤「同時發送 LINE 通知（ 已綁 LINE 的顧客才會收到 ，每則消耗 1 推播額度）」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/products` — 商品管理

* **HTML `<title>`**：`商品管理 - 店家後台`
* **檔案**：`src/app/tenant/products/page.tsx` · 文案 `src/i18n/zh-TW/pages/products.ts`
* **區塊標題**：商品管理 · 商品列表
* **表格欄位**：商品名稱 | 分類 | 售價 | 庫存 | 狀態 | LINE | 操作
* **對話框**：新增商品 · 調整庫存 · 商品分類管理 · 回報問題
* **表單欄位（25 個）**：
  * `dataId` — input hidden
  * `name` — input text — 標籤「商品名稱 *」
  * `categoryId` — select — 標籤「分類 * 管理分類」 — 選項：請選擇分類
  * `price` — input number — 標籤「售價 *」
  * `stockQuantity` — input number — 標籤「庫存數量」
  * `safetyStock` — input number — 標籤「安全庫存量」 — 提示「低於此數量會提醒」
  * `trackInventory` — input checkbox — 標籤「啟用庫存追蹤」
  * `maxPerOrder` — input number — 標籤「單次最多購買數量」 — 提示「留空不限，以庫存為上限」
  * `sortOrder` — input number — 標籤「排序（公開頁面顯示順序）」
  * `imageFile` — input file — 標籤「主圖（第一張，必填）」
  * `extraImageFiles` — input file — 標籤「其他圖片（選填，最多 8 張）」
  * `description` — textarea — 標籤「商品描述」
  * `stockProductId` — input hidden
  * `stockAdjustQty` — input number — 標籤「調整數量 *」
  * `stockReasonSelect` — select — 標籤「調整原因」 — 選項：請選擇原因/進貨補充/銷售出貨/盤點調整/損耗報廢/退貨入庫
  * `stockReason` — input text — 標籤「其他原因」 — 提示「請輸入原因」
  * `catEditId` — input hidden — 標籤「分類名稱 *」
  * `catName` — input text — 標籤「分類名稱 *」 — 提示「例：熱門商品」
  * `catSortOrder` — input number — 標籤「排序」
  * `catIsActive` — input checkbox — 標籤「啟用」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/product-orders` — 商品訂單

* **HTML `<title>`**：`商品訂單 - 店家後台`
* **檔案**：`src/app/tenant/product-orders/page.tsx` · 文案 `src/i18n/zh-TW/pages/product-orders.ts`
* **區塊標題**：商品訂單 · 訂單列表
* **表格欄位**：訂單編號 | 顧客 | 商品 | 數量 | 金額 | 狀態 | 建立時間 | 操作
* **對話框**：新增訂單（現場加購記帳） · 回報問題
* **表單欄位（20 個）**：
  * `statusFilter` — select — 選項：全部/待確認/已確認/已完成/已取消
  * `moModeExisting` — input radio — 標籤「既有顧客」
  * `moModeNew` — input radio — 標籤「新顧客」
  * `moCustKeyword` — input search — 提示「搜尋姓名/電話...」
  * `moCustomerId` — select — 選項：請先搜尋顧客
  * `moNewName` — input text — 提示「姓名」
  * `moNewPhone` — input tel — 提示「電話（手機或市話）」
  * `moProductSelect` — select
  * `moProductQty` — input number
  * `moStaffId` — select — 標籤「經手員工（僅記錄供日後查詢，不計入業績報表，選填）」 — 選項：不指定
  * `moPaymentMethodId` — select — 標籤「付款方式（選填）」 — 選項：未指定
  * `moBookingId` — select — 標籤「關聯今日預約（選填，對帳用）」 — 選項：不關聯
  * `moNote` — input text — 標籤「備註」 — 提示「選填」
  * `moPaidCompleted` — input checkbox — 標籤「已當場收款完成（自動完成訂單：集點/累計消費即時入帳）」
  * `moNotify` — input checkbox — 標籤「LINE 通知顧客消費明細（未綁 LINE 自動改寄 Email；每則扣 1 推播額度）」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/inventory` — 庫存異動

* **HTML `<title>`**：`庫存異動 - 店家後台`
* **檔案**：`src/app/tenant/inventory/page.tsx` · 文案 `src/i18n/zh-TW/pages/inventory.ts`
* **區塊標題**：庫存異動歷史 · 異動記錄
* **表格欄位**：時間 | 商品 | 異動類型 | 數量 | 異動前 | 異動後 | 原因 | 操作者
* **對話框**：回報問題
* **表單欄位（5 個）**：
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/keyword-replies` — 關鍵字回覆

* **HTML `<title>`**：`關鍵字回覆 - 店家後台`
* **檔案**：`src/app/tenant/keyword-replies/page.tsx` · 文案 `src/i18n/zh-TW/pages/keyword-replies.ts`
* **區塊標題**：關鍵字回覆 33 點/月・專業版含 · 我的自訂關鍵字 · 系統內建關鍵字（預約、選單、取消…）
* **表格欄位**：關鍵字 | 觸發方式 | 動作 | 啟用 | 操作
* **對話框**：新增自訂關鍵字 · 回報問題
* **表單欄位（15 個）**：
  * `kwId` — input hidden
  * `kwKeyword` — input text — 提示「例：價格、地址、營業時間」
  * `kwMatchType` — select — 標籤「觸發方式」 — 選項：訊息就是這個字才回（一字不差）/訊息裡有這個字就回（建議）
  * `kwActionType` — select — 標籤「動作」 — 選項：回覆自訂內容/啟動個資收集（問姓名/手機）
  * `kwReplyText` — textarea — 提示「顧客打此關鍵字時 Bot 回覆的文字」
  * `kwImageFile` — input file
  * `kwImageUrl` — input hidden
  * `kwLinkUrl` — input url — 標籤「附加連結按鈕（選填）」 — 提示「https://...」
  * `kwLinkLabel` — input text — 標籤「按鈕文字」 — 提示「查看更多」
  * `kwEnabled` — input checkbox — 標籤「啟用」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：💡 尚未訂閱「自訂關鍵字回覆」——你可以先把內容設定好（含下方系統內建關鍵字的停用/覆蓋）， 訂閱後立即生效 ；訂閱前顧客端維持系統預設行為。 前往功能商店訂閱 → ／ 💡 尚未訂閱——下方開關/覆蓋可先設定儲存，但 訂閱前顧客端不會生效 （系統關鍵字照常回應）。

##### `/tenant/ai-settings` — AI 客服設定

* **HTML `<title>`**：`AI 客服設定 - 店家後台`
* **檔案**：`src/app/tenant/ai-settings/page.tsx` · 文案 `src/i18n/zh-TW/pages/ai-settings.ts`
* **區塊標題**：AI 客服設定 · 快速套用行業範本 · 自訂提示詞 · AI 如何回覆？ · 撰寫建議
* **對話框**：回報問題
* **表單欄位（8 個）**：
  * `aiAssistantEnabled` — input checkbox — 標籤「啟用 AI 自動回覆」
  * `aiStrictMode` — input checkbox — 標籤「嚴格模式：閒聊 / 亂碼 由專人處理」
  * `aiCustomPrompt` — textarea — 提示「選擇上方行業範本，或直接輸入您的自訂提示詞...」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：小技巧： 寫得越具體，AI 回覆越精準。例如「停車場在巷口左轉 50 公尺」比「附近有停車場」好。


#### 群組：行銷推廣

##### `/tenant/promote` — 推廣中心

* **HTML `<title>`**：`推廣中心 - 店家後台`
* **檔案**：`src/app/tenant/promote/page.tsx` · 文案 `src/i18n/zh-TW/pages/promote.ts`
* **區塊標題**：推廣中心 · 你的線上預約頁 · 預約 QR Code · 把預約頁放上各通路（複製即用） · 推廣成效（各通路帶來的瀏覽）
* **表格欄位**：通路來源 | 瀏覽次數 (PV) | 不重複訪客 (UV)
* **對話框**：回報問題
* **表單欄位（7 個）**：
  * `publicUrl` — input text
  * `statsDays` — select — 選項：最近 7 天/最近 30 天/最近 90 天
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/campaigns` — 行銷活動

* **HTML `<title>`**：`行銷活動 - 店家後台`
* **檔案**：`src/app/tenant/campaigns/page.tsx` · 文案 `src/i18n/zh-TW/pages/campaigns.ts`
* **區塊標題**：行銷活動 · 活動列表
* **表格欄位**：活動名稱 | 類型 | 活動期間 | 參與人數 | 狀態 | 操作
* **對話框**：新增活動 · 回報問題
* **表單欄位（18 個）**：
  * `dataId` — input hidden
  * `name` — input text — 標籤「活動名稱 *」 — 提示「例如：新春限時優惠」
  * `type` — select — 標籤「活動類型 *」 — 選項：生日活動/新客活動/滿額活動/限時活動/喚回活動
  * `startAt` — input datetime-local — 標籤「開始時間」
  * `endAt` — input datetime-local — 標籤「結束時間」
  * `description` — textarea — 標籤「活動描述」 — 提示「描述活動內容、優惠方式等...」
  * `campaignImageInput` — input file — 標籤「活動圖片」
  * `pushMessage` — textarea — 標籤「推播訊息 *」 — 提示「發布活動時將推送此訊息給所有 LINE 追蹤者」
  * `couponId` — select — 標籤「關聯票券」 — 選項：不關聯票券
  * `bonusPoints` — input number — 標籤「贈送點數」 — 提示「0」
  * `thresholdAmount` — input number — 標籤「滿額門檻金額 *」 — 提示「例如：1000」
  * `recallDays` — input number — 標籤「未到訪天數門檻」 — 提示「例如：30」
  * `isAutoTrigger` — input checkbox — 標籤「啟用排程自動觸發」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：本月推送額度 載入中...

##### `/tenant/marketing` — 行銷推播

* **HTML `<title>`**：`行銷推播 - 店家後台`
* **檔案**：`src/app/tenant/marketing/page.tsx` · 文案 `src/i18n/zh-TW/pages/marketing.ts`
* **區塊標題**：行銷推播 · 行銷推播是什麼？ · 推播列表
* **表格欄位**：標題 | 目標對象 | 預估人數 | 發送結果 | 狀態 | 操作
* **對話框**：建立推播 · 回報問題
* **表單欄位（15 個）**：
  * `dataId` — input hidden
  * `title` — input text — 標籤「推播標題 *」 — 提示「例如：本週特惠活動通知」
  * `pushContent` — textarea — 標籤「推播內容 *」 — 提示「輸入要發送給顧客的訊息內容...」
  * `targetType` — select — 標籤「目標對象 *」 — 選項：全部顧客/指定會員等級/自訂名單
  * `targetValue` — select — 標籤「會員等級」 — 選項：請選擇
  * `customTargets` — textarea — 標籤「自訂名單（LINE User ID，每行一個）」 — 提示「U1234567890abcdef
U0987654321fedcba」
  * `pushImageInput` — input file — 標籤「圖片」
  * `imageUrl` — input url — 標籤「圖片網址（選填）」 — 提示「https://example.com/image.jpg」
  * `scheduledAt` — input datetime-local — 標籤「排程發送時間（選填）」
  * `note` — input text — 標籤「備註」 — 提示「內部備註，顧客不會看到」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：行銷推播是什麼？ 行銷推播可以 發送一則 LINE 訊息 給顧客，支援篩選受眾（全部/會員等級/標籤），可立即發送或排程。 適合用來： 公休通知、新品上架、節日問候、限時優惠通知、只給 VIP 的訊息 如果需要搭配票券或 ／ 草稿 尚未發送 排程中 等待發送 發送中 正在發送 已完成 發送完畢 失敗 發送失敗 ／ 本月推送額度 載入中...

##### `/tenant/referrals` — 推薦好友

* **HTML `<title>`**：`推薦好友 - 店家後台`
* **檔案**：`src/app/tenant/referrals/page.tsx` · 文案 `src/i18n/zh-TW/pages/referrals.ts`
* **區塊標題**：推薦好友 · 您的推薦碼 · 推薦歷史
* **表格欄位**：被推薦店家 | 店家代碼 | 狀態 | 獎勵點數 | 推薦時間 | 完成時間
* **對話框**：回報問題
* **表單欄位（6 個）**：
  * `referralLink` — input text — 標籤「推薦連結」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：推薦機制說明： 將推薦碼或推薦連結分享給其他店家，對方註冊成功 並完成首次儲值 後，雙方各獲得 500 點獎勵（註冊當下尚不會發放）。點數可用於訂閱付費功能。


#### 群組：公開頁面

##### `/tenant/shop-design` — 公開頁面設計

* **HTML `<title>`**：`公開頁面設計 - 店家後台`
* **檔案**：`src/app/tenant/shop-design/page.tsx` · 文案 `src/i18n/zh-TW/pages/shop-design.ts`
* **分頁**：店家資訊 / 橫幅封面 / 關於我們 / 圖片展示 / 主題外觀 / 社群連結
* **區塊標題**：公開頁面設計 · 店家資訊 · 橫幅封面 · 橫幅影片（選填） · 公告文字 · 關於我們 · 圖片展示 · 主題外觀 · 社群連結
* **對話框**：回報問題
* **表單欄位（24 個）**：
  * `shopNameInput` — input text — 標籤「店家名稱」 — 提示「例如：Lucy Lin Beauty Studio」
  * `logoInput` — input file — 標籤「店家頭像 / Logo」
  * `logoHiddenToggle` — input checkbox — 標籤「在公開頁隱藏 Logo」
  * `bannerInput` — input file — 標籤「店家名稱」
  * `bannerVideoInput` — input file — 標籤「店家名稱」
  * `bannerVideoSoundToggle` — input checkbox — 標籤「顧客互動後自動開啟聲音（關閉＝永遠靜音，顧客可自行按影片喇叭鈕開聲）」
  * `announcementInput` — input text — 標籤「店家名稱」 — 提示「例如：本週特惠活動進行中！」
  * `aboutTitleInput` — input text — 標籤「標題」 — 提示「例如：關於我們」
  * `aboutContentInput` — textarea — 標籤「內容」 — 提示「分享你的店家故事...」
  * `aboutImageInput` — input file — 標籤「介紹圖片」
  * `galleryInput` — input file — 標籤「店家名稱」
  * `themeColorPicker` — input color — 標籤「主題色」
  * `themeColorHex` — input text — 標籤「主題色」 — 提示「#6366f1」
  * `facebookInput` — input url — 標籤「Facebook」 — 提示「https://facebook.com/你的粉專」
  * `instagramInput` — input url — 標籤「Instagram」 — 提示「https://instagram.com/你的帳號」
  * `lineInput` — input url — 標籤「LINE 官方帳號」 — 提示「https://line.me/R/ti/p/@你的帳號」
  * `threadsInput` — input url — 標籤「Threads」 — 提示「https://threads.net/@你的帳號」
  * `googleMapsInput` — input url — 標籤「Google Maps」 — 提示「https://maps.google.com/...」
  * `contactEmailInput` — input email — 標籤「Email」 — 提示「your@company.com」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」

##### `/tenant/portfolio` — 作品展示

* **HTML `<title>`**：`作品展示 - 店家後台`
* **檔案**：`src/app/tenant/portfolio/page.tsx` · 文案 `src/i18n/zh-TW/pages/portfolio.ts`
* **區塊標題**：作品展示
* **對話框**：新增作品 · 回報問題
* **表單欄位（12 個）**：
  * `editId` — input hidden
  * `titleInput` — input text — 標籤「標題 *」
  * `descriptionInput` — textarea — 標籤「描述」
  * `imageInput` — input file — 標籤「作品主圖」
  * `portfolioExtraImageFiles` — input file — 標籤「其他圖片（選填，最多 8 張）」
  * `sortOrderInput` — input number — 標籤「排序」
  * `isActiveSwitch` — input checkbox — 標籤「啟用」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」


#### 群組：系統設定

##### `/tenant/settings` — 店家設定

* **HTML `<title>`**：`店家設定 - 店家後台`
* **檔案**：`src/app/tenant/settings/page.tsx` · 文案 `src/i18n/zh-TW/pages/settings.ts`
* **分頁**：基本資訊 / 營業設定 / 通知設定 / 點數設定 / 行事曆同步 / 帳號安全
* **區塊標題**：店家設定 · 基本資訊 · 營業設定 · 通知設定 · 顧客通知 · 生日祝福與顧客喚回 · LINE 預約狀態推播 · Email 預約通知 · 預約自動確認 · 商品訂單線上收款 · 強制指定 服務人員 · 隱私防護 · 顧客點數累積設定 · 點數試算
* **對話框**：回報問題
* **表單欄位（70 個）**：
  * `publicShopUrl` — input text — 標籤「店家名稱 *」
  * `calIcsUrl` — input text
  * `tenantName` — input text — 標籤「店家名稱 *」
  * `tenantPhone` — input tel — 標籤「聯絡電話」 — 提示「例如：02-1234-5678」
  * `tenantEmail` — input email — 標籤「電子郵件」 — 提示「contact@example.com」
  * `tenantAddress` — input text — 標籤「地址」 — 提示「店家地址」
  * `tenantDescription` — textarea — 標籤「店家簡介」 — 提示「簡單介紹您的店家特色...」
  * `perDayModeToggle` — input checkbox — 標籤「每天營業時間不同 開啟後可逐日設定不同營業時段（甚至同一天分上、下午多段）。系統會自動換算成營業時間與封鎖時段，無須手動設定封鎖。」
  * `businessStart` — select — 標籤「營業開始時間 *」
  * `businessEnd` — select — 標籤「營業結束時間 *」
  * `breakStart` — select — 標籤「休息開始時間」
  * `breakEnd` — select — 標籤「休息結束時間」
  * `slotInterval` — select — 標籤「預約時段間隔」 — 選項：30 分鐘/60 分鐘/90 分鐘/120 分鐘
  * `advanceBookingValue` — input number — 標籤「可提前預約時間」
  * `advanceBookingUnit` — select — 標籤「可提前預約時間」 — 選項：月/天
  * `advanceBookingDays` — input hidden — 標籤「可提前預約時間」
  * `bookingCutoffDate` — input date — 標籤「預約截止日期 (選填)」
  * `minAdvanceBookingDays` — input number — 標籤「最快可預約 (前置時間)」
  * `closedDay0` — input checkbox — 標籤「週日」
  * `closedDay1` — input checkbox — 標籤「週一」
  * `closedDay2` — input checkbox — 標籤「週二」
  * `closedDay3` — input checkbox — 標籤「週三」
  * `closedDay4` — input checkbox — 標籤「週四」
  * `closedDay5` — input checkbox — 標籤「週五」
  * `closedDay6` — input checkbox — 標籤「週六」
  * `notifyBookingReminder` — input checkbox — 標籤「預約提醒 自動提醒顧客即將到來的預約（LINE / Email 自動切換）」
  * `reminderHoursBefore` — select — 標籤「提醒時間」 — 選項：預約前 1 小時/預約前 2 小時/預約前 3 小時/預約前 6 小時/預約前 12 小時/預約前 1 天
  * `enableBirthdayGreeting` — input checkbox — 標籤「生日祝福 每天早上 9:00 自動發送給當天生日的顧客」
  * `birthdayGreetingMessage` — textarea — 標籤「祝福訊息」
  * `enableCustomerRecall` — input checkbox — 標籤「顧客喚回 每天下午 2:00 自動發送給久未到訪的顧客（每家店每天最多 50 位）」
  * `customerRecallDays` — input number — 標籤「多久沒來就喚回」
  * `customerRecallMessage` — textarea — 標籤「多久沒來就喚回」
  * `notifyBookingConfirmed` — input checkbox — 標籤「預約已確認 確認預約時推播 LINE 通知顧客」
  * `notifyBookingCompleted` — input checkbox — 標籤「預約已完成 服務完成時推播 LINE 通知顧客（預設關閉）」
  * `notifyBookingCancelled` — input checkbox — 標籤「預約已取消 取消預約時推播 LINE 通知顧客」
  * `notifyBookingModified` — input checkbox — 標籤「預約被修改 預約時間、人員等變更時推播 LINE 通知顧客」
  * `notifyBookingNoShow` — input checkbox — 標籤「顧客爽約 標記爽約時推播 LINE 通知顧客（預設關閉）」
  * `notifyNewBooking` — input checkbox — 標籤「店家：新預約 / 確認通知 新預約建立和確認時，Email 通知店家」
  * `notifyBookingCancel` — input checkbox — 標籤「店家：取消預約通知 預約被取消時，Email 通知店家」
  * `notifyStaffBooking` — input checkbox — 標籤「員工：預約 Email 通知 員工被指派預約時，Email 通知該員工（需在員工管理填寫 Email）」
  * …另 30 個，見 `docs/specs/settings.json`
* **提示條**：公開預約網址 複製 分享此連結，顧客即可直接在網頁上預約（不需 LINE） ／ 設定營業時間會影響顧客可預約的時段 ／ 逐日設定後，系統會自動把「沒開放的時段」建立成 每週封鎖時段 （在「封鎖時段」頁會看到「自動產生」標記，請勿手動刪除——要調整請回此頁）。下方「預約間隔／可提前預約／截止日」設定仍適用於所有日子。 ／ 設定何時要收到系統通知

##### `/tenant/line-settings` — LINE 設定

* **HTML `<title>`**：`LINE 設定 - 店家後台`
* **檔案**：`src/app/tenant/line-settings/page.tsx` · 文案 `src/i18n/zh-TW/pages/line-settings.ts`
* **區塊標題**：LINE 設定 · LINE Official Account 設定 · 設定完成後必做！否則 Bot 不會回應 · 步驟一：建立 LINE 官方帳號 · 步驟二：啟用 Messaging API · 步驟三：取得 Channel ID 與 Channel Secret · 步驟四：取得 Access Token · 步驟五：儲存並啟用 · 自動回覆設定 · 解除 LINE 帳號綁定 · 連線狀態 · LINE 設定檢查報告 · 您的 LINE 官方帳號 · 如何讓顧客加入？
* **對話框**：自訂 Flex 彈窗設定 · LINE 設定圖文教學（跟著紅框做） · 回報問題
* **表單欄位（46 個）**：
  * `autoReplyEnabled` — input checkbox — 標籤「啟用自動回覆」
  * `defaultReply` — textarea — 標籤「預設回覆」 — 提示「無法識別訊息時的預設回覆...」
  * `defaultBgImage` — input file — 標籤「或上傳自訂背景」
  * `noOverlayCheckbox` — input checkbox — 標籤「直接使用背景圖（不疊加系統文字圖示）」
  * `customTextColor` — input color — 標籤「文字顏色」
  * `advSizeHalf` — input radio — 標籤「標準 (2行)」
  * `advSizeFull` — input radio — 標籤「大尺寸 (3行+)」
  * `advCustomRows` — select — 標籤「1 選擇尺寸與佈局」 — 選項：1/2/3/4
  * `advCustomCols` — select — 標籤「1 選擇尺寸與佈局」 — 選項：1/2/3/4/5
  * `advBgImage` — input file — 標籤「2 背景設定」
  * `advBgColor` — input color — 標籤「2 背景設定」
  * `flexMenuEnabledToggle` — input checkbox — 標籤「啟用 Flex 主選單」
  * `flexMenuFallbackHint` — input radio — 標籤「回提示文字「請點選下方選單使用 👇」（避免 Bot 看起來像死掉）」
  * `flexMenuFallbackSilent` — input radio — 標籤「完全靜默（店家在 LINE OA Manager 自己手動回覆）」
  * `campaignKeywordToggle` — input checkbox — 標籤「顧客打「活動」等文字時自動回覆活動列表」
  * `flexHeaderColor` — input color — 標籤「Header 顏色」
  * `flexHeaderColorText` — input text — 標籤「Header 顏色」
  * `flexHeaderTitle` — input text — 標籤「Header 標題」 — 提示「例：✨ {shopName}」
  * `flexHeaderSubtitle` — input text — 標籤「歡迎語」
  * `flexShowTip` — input checkbox — 標籤「顯示使用提示」
  * `stepServiceColor` — input color
  * `stepServiceTitle` — input text — 提示「✂️ 選擇您的服務」
  * `stepDateColor` — input color
  * `stepDateTitle` — input text — 提示「📅 選擇預約日期」
  * `stepStaffColor` — input color
  * `stepStaffTitle` — input text — 提示「👤 選擇服務人員」
  * `stepTimeColor` — input color
  * `stepTimeTitle` — input text — 提示「⏰ 選擇時段」
  * `stepNoteColor` — input color
  * `stepNoteTitle` — input text — 提示「📝 備註事項」
  * `stepConfirmColor` — input color
  * `stepConfirmTitle` — input text — 提示「📋 確認預約資訊」
  * `stepSuccessColor` — input color
  * `channelId` — input text — 標籤「Channel ID * 從 LINE 後台複製」 — 提示「純數字，例如：2005459361」
  * `channelSecret` — input text — 標籤「Channel Secret * 從 LINE 後台複製」 — 提示「32 字元英數字，例如：ab2d0a47249da385b1dfda6d5adcb865」
  * `channelAccessToken` — input text — 標籤「Channel Access Token * 從 LINE Developers Console 複製」 — 提示「很長的一串英數字（約 170 字元），例如：G6e//SU+Bv9k00q2cidc...」
  * `webhookUrl` — input text — 標籤「Webhook URL」
  * `lineBasicId` — input text — 標籤「LINE 官方帳號基本 ID （選填）」 — 提示「例如：@abc1234x」
  * `flexPopupCellIndex` — input hidden
  * `flexPopupSingle` — input radio — 標籤「單一卡片」
  * …另 6 個，見 `docs/specs/line-settings.json`
* **提示條**：設定完成後必做！否則 Bot 不會回應 請到 LINE Official Account Manager 關閉自動回應： 進入您的官方帳號 → 設定 → 回應設定 「回應方式」改為只有「 手動聊天 」 不要 勾選「自動回 ／ 設定教學 看不懂文字？右邊改看圖文步驟 → 查看詳細教學 看圖文教學 ／ 注意：一旦與服務提供者連動 即無法變更或解除 ／ 必做三件事！ 缺一不可，否則 Bot 不會回應： ① 回應設定 →「手動聊天」（關閉自動回應） ② Messaging API → Webhook URL 已填入 ③ LINE Developers Console →「

##### `/tenant/rich-menu-design` — 選單設計

* **HTML `<title>`**：`選單設計 - 店家後台`
* **檔案**：`src/app/tenant/rich-menu-design/page.tsx` · 文案 `src/i18n/zh-TW/pages/rich-menu-design.ts`
* **分頁**：Rich Menu（底部選單） / Flex 主選單（氣泡選單）
* **區塊標題**：選單設計 · Rich Menu（底部快捷選單） · Flex 主選單（對話氣泡選單） · 一頁式設計範本（整張構圖 · 一鍵發布） · 快速套用範本（選一個開始，再微調） · 主題風格 · 佈局 · 背景圖片（選填） · 每格設定 · Rich Menu 預覽 · 預約流程步驟自訂 · 功能頁面樣式自訂 · 輪播卡片預覽
* **表格欄位**：# | 標籤 | 動作 | 圖示
* **對話框**：Flex 彈窗卡片設定 · 回報問題
* **表單欄位（13 個）**：
  * `rmBgImage` — input file
  * `rmFlexMenuEnabledToggle` — input checkbox — 標籤「啟用 Flex 主選單」
  * `rmFlexMenuFallbackHint` — input radio — 標籤「回提示文字「請點選下方選單使用 👇」（避免 Bot 看起來像死掉）」
  * `rmFlexMenuFallbackSilent` — input radio — 標籤「完全靜默（店家在 LINE OA Manager 自己手動回覆）」
  * `bookingStepGuideToggle` — input checkbox — 標籤「顯示「步驟說明卡」 預約 carousel 最前面那張「👈 往左滑動 + 步驟清單」指引卡。關閉後顧客直接看到服務卡，「取消預約」鈕會自動補在每張服務卡上。此設定即時生效、與發布 Rich Menu 無關。」
  * `fpTypeSingle` — input radio — 標籤「單一卡片」
  * `fpTypeCarousel` — input radio — 標籤「輪播卡片（可左右滑）」
  * `fpImageRatio` — select — 標籤「圖片比例」 — 選項：20:13（預設 LINE 比例）/1:1（正方形）/4:3/16:9（寬螢幕）
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：如何使用選單設計？ Rich Menu（底部快捷選單） 顧客打開 LINE 聊天室時， 固定在螢幕底部 的圖片選單。 選擇 主題風格 （精品風、LINE綠、藍等配色） 選擇 佈局 （3+4 = 7格、3+4+4 = 11 ／ 發布範本前的原設計已自動備份，隨時可一鍵還原。 還原發布前的設計 ／ 還原套用前的設定 不用了 ／ 自訂每格 文字／動作 、 背景圖／自訂圖示 、 非 3+4 版型 、 打開網址／Flex 彈窗 屬「 進階自訂選單 」付費功能（99 點/月）。未訂閱時發布只會套用 系統預設款 ，您的這些修改不會出現在 LINE 選單上

##### `/tenant/feature-store` — 功能商店

* **HTML `<title>`**：`功能商店 - 店家後台`
* **檔案**：`src/app/tenant/feature-store/page.tsx` · 文案 `src/i18n/zh-TW/pages/feature-store.ts`
* **區塊標題**：功能商店
* **對話框**：回報問題
* **表單欄位（6 個）**：
  * `onlyUnsubscribed` — input checkbox — 標籤「只看未訂閱」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：訂閱方式 套裝方案 ：輕量版（$399/月）或專業版（$799/月），一次開通多項功能更划算 單買功能 ：也可個別訂閱需要的功能（$49~$249/月） 升級 ：輕量版可隨時升級為專業版，剩餘天數不退點 方案+單買共存 

##### `/tenant/points` — 點數管理

* **HTML `<title>`**：`點數管理 - 店家後台`
* **檔案**：`src/app/tenant/points/page.tsx` · 文案 `src/i18n/zh-TW/pages/points.ts`
* **區塊標題**：點數管理 · 點數異動記錄
* **表格欄位**：時間 | 類型 | 異動點數 | 餘額 | 說明
* **對話框**：申請儲值 · 轉點到其他分店 · 回報問題
* **表單欄位（11 個）**：
  * `topupAmount` — select — 標籤「儲值方案 *」 — 選項：請選擇儲值方案/NT$ 100（獲得 100 點）/NT$ 300（獲得 300 點）/NT$ 500（獲得 525 點，贈送 5%）/NT$ 800（獲得 800 點，剛好續專業版一個月）/NT$ 1,000（獲得 1,100 點，贈送 10%）
  * `topupInvoiceUbn` — input text — 標籤「統一編號 （選填）」 — 提示「8 碼數字，需開三聯式發票時填寫」
  * `topupInvoiceTitle` — input text — 標籤「發票抬頭 （選填）」 — 提示「公司登記名稱，未填以店家名稱開立」
  * `topupRemark` — textarea — 標籤「備註」 — 提示「如有特殊需求可在此說明...」
  * `transferTarget` — select — 標籤「目標店家 *」
  * `transferPoints` — input number — 標籤「轉出點數 *」 — 提示「輸入要轉出的點數」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：付款處理中… 點數通常於數秒內入帳，若餘額尚未更新請稍候片刻再重新整理。 前往功能商店訂閱 ／ 付款未完成 ，如有疑問請聯絡管理員： vibeaico@gmail.com ／ 點數用途： 點數可用於訂閱付費功能（如無限員工、AI 客服、票券系統等）。1 點 = NT$1。


#### 群組：其他

##### `/tenant/donate` — 贊助我們

* **HTML `<title>`**：`贊助我們 - 店家後台`
* **檔案**：`src/app/tenant/donate/page.tsx` · 文案 `src/i18n/zh-TW/pages/donate.ts`
* **區塊標題**：贊助我們 · 感謝這些店家
* **表格欄位**：店家 | 贊助時間
* **對話框**：回報問題
* **表單欄位（7 個）**：
  * `donateAmount` — input number — 標籤「自訂金額」 — 提示「NT$ 10 ~ 100,000」
  * `donateDisplayName` — input text — 標籤「名單顯示名稱」 — 提示「預設使用店家名稱」
  * `bugCategory` — select — 標籤「問題類別 *」 — 選項：請選擇類別/功能異常/顯示問題/操作困難/其他
  * `bugTitle` — input text — 標籤「問題標題 *」 — 提示「簡短描述問題」
  * `bugDescription` — textarea — 標籤「詳細說明 *」 — 提示「請描述問題的重現步驟、發生時間、錯誤訊息等...」
  * `bugScreenshot` — input file — 標籤「附上截圖（選填）」
  * `bugEmail` — input email — 標籤「聯絡信箱」 — 提示「方便我們聯繫您」
* **提示條**：謝謝你的支持！❤ 付款處理中，你的名字通常會在一分鐘內出現在贊助名單上。 ／ 付款未完成 ，沒有關係，心意我們收到了！如有疑問請聯絡： vibeaico@gmail.com ／ 贊助是自願支持平台營運， 不是功能購買、也不會轉成點數 ； 需要儲值點數訂閱功能請到 點數管理 。


#### 群組：認證頁（不套後台版面）

##### `/tenant/login` — 店家登入

* **HTML `<title>`**：`店家登入 | VibeAI管理系統`
* **meta description**：登入VibeAI店家後台，管理您的預約、顧客、員工和營運報表。免費線上預約系統，整合 LINE 預約機器人。立即免費試用！
* **檔案**：`src/app/tenant/login/page.tsx` · 文案 `src/i18n/zh-TW/pages/login.ts`
* **區塊標題**：LINE 智慧預約系統
* **表單欄位（2 個）**：
  * `username` — input text — 標籤「帳號」 — 提示「請輸入帳號」
  * `password` — input password — 標籤「密碼」 — 提示「請輸入密碼」

##### `/tenant/register` — 免費註冊

* **HTML `<title>`**：`免費註冊 | VibeAI - 線上預約系統`
* **meta description**：立即免費註冊VibeAI，5分鐘快速開通。整合 LINE 預約機器人，自動提醒、顧客管理、營運報表。適合美容美髮、按摩SPA、健身教練等服務業。超過 150+ 店家使用。
* **檔案**：`src/app/tenant/register/page.tsx` · 文案 `src/i18n/zh-TW/pages/register.ts`
* **區塊標題**：VibeAI
* **表單欄位（9 個）**：
  * `code` — input text — 標籤「店家代碼 *」 — 提示「例如：my-shop」
  * `name` — input text — 標籤「店家名稱 *」 — 提示「請輸入店家名稱」
  * `email` — input email — 標籤「電子郵件 *」 — 提示「請輸入電子郵件」
  * `verificationCode` — input text — 標籤「驗證碼 *」 — 提示「請輸入 6 位數驗證碼」
  * `phone` — input tel — 標籤「聯絡電話 *」 — 提示「請輸入聯絡電話」
  * `password` — input password — 標籤「密碼 *」 — 提示「請輸入密碼（至少 8 位）」
  * `confirmPassword` — input password — 標籤「確認密碼 *」 — 提示「請再次輸入密碼」
  * `referralCode` — input text — 標籤「推薦碼 （選填）」 — 提示「輸入推薦碼」
  * `agentReferralCode` — input hidden

##### `/tenant/forgot-password` — 忘記密碼

* **HTML `<title>`**：`忘記密碼 - VibeAI`
* **檔案**：`src/app/tenant/forgot-password/page.tsx` · 文案 `src/i18n/zh-TW/pages/forgot-password.ts`
* **區塊標題**：VibeAI
* **表單欄位（1 個）**：
  * `email` — input email — 標籤「電子郵件」 — 提示「請輸入電子郵件」

##### `/tenant/reset-password` — 重設密碼

* **HTML `<title>`**：`重設密碼 - VibeAI`
* **檔案**：`src/app/tenant/reset-password/page.tsx` · 文案 `src/i18n/zh-TW/pages/reset-password.ts`
* **區塊標題**：VibeAI
* **表單欄位（2 個）**：
  * `newPassword` — input password — 標籤「新密碼」 — 提示「請輸入新密碼（至少 8 位）」
  * `confirmPassword` — input password — 標籤「確認新密碼」 — 提示「請再次輸入新密碼」


---

## 5. API 契約

原站共 **195 個端點**（完整清單見 `docs/_endpoints.json`）。統一回應格式：

```json
{ "success": true,  "data": { ... } }
{ "success": false, "code": "AUTH_005", "message": "此帳號尚未設定密碼，請使用「忘記密碼」功能設定新密碼" }
```
分頁回應為 Spring Data 格式：`{ content, totalElements, totalPages, number, size }`。

### 端點分類

| 分類 | 端點數 | 主要端點 |
|---|---|---|
| `settings` | 40 | `/api/settings`, `/api/settings/calendar`, `/api/settings/calendar/regenerate`, `/api/settings/line` |
| `bookings` | 15 | `/api/bookings`, `/api/bookings/:id`, `/api/bookings/:id/addons`, `/api/bookings/:id/addons/:id` |
| `reports` | 10 | `/api/reports/advanced`, `/api/reports/daily`, `/api/reports/dashboard`, `/api/reports/dashboard-alerts` |
| `auth` | 9 | `/api/auth/change-password`, `/api/auth/forgot-password`, `/api/auth/impersonate`, `/api/auth/my-tenants` |
| `coupons` | 9 | `/api/coupons`, `/api/coupons/:id`, `/api/coupons/:id/batch-issue`, `/api/coupons/:id/pause` |
| `staff` | 9 | `/api/staff`, `/api/staff/${encodeURIComponent`, `/api/staff/:id`, `/api/staff/:id/leaves` |
| `product-orders` | 8 | `/api/product-orders`, `/api/product-orders/:id/apply-coupon`, `/api/product-orders/:id/cancel:id`, `/api/product-orders/:id/complete` |
| `products` | 7 | `/api/products`, `/api/products/:id`, `/api/products/:id/:id`, `/api/products/:id/adjust-stock` |
| `campaigns` | 6 | `/api/campaigns`, `/api/campaigns/:id`, `/api/campaigns/:id/end`, `/api/campaigns/:id/pause` |
| `customers` | 6 | `/api/customers`, `/api/customers/:id`, `/api/customers/:id/bind-line`, `/api/customers/:id/unbind-line` |
| `payment-methods` | 6 | `/api/payment-methods`, `/api/payment-methods/:id`, `/api/payment-methods/:id/test-charge`, `/api/payment-methods/:id/test-connection` |
| `portfolios` | 6 | `/api/portfolios`, `/api/portfolios/:id`, `/api/portfolios/:id/toggle-active`, `/api/portfolios/:id/toggle-line-featured` |
| `services` | 6 | `/api/services`, `/api/services/:id`, `/api/services/:id/duplicate`, `/api/services/:id/toggle-line-featured` |
| `chat` | 5 | `/api/chat/conversations`, `/api/chat/messages`, `/api/chat/messages/:id`, `/api/chat/messages/:id/image` |
| `clinic-queue` | 5 | `/api/clinic-queue/sessions`, `/api/clinic-queue/sessions/:id`, `/api/clinic-queue/sessions/:id/day-board`, `/api/clinic-queue/sessions/:id/day-override` |
| `export` | 5 | `/api/export/bookings`, `/api/export/bookings/:id`, `/api/export/customers/excel`, `/api/export/reports` |
| `feature-store` | 4 | `/api/feature-store`, `/api/feature-store/:id/apply`, `/api/feature-store/:id/cancel`, `/api/feature-store/:id/restore` |
| `marketing` | 4 | `/api/marketing/pushes`, `/api/marketing/pushes/:id`, `/api/marketing/pushes/:id/cancel`, `/api/marketing/pushes/:id/send` |
| `points` | 4 | `/api/points/balance`, `/api/points/topup/pay`, `/api/points/transactions`, `/api/points/transfer` |
| `support-chat` | 4 | `/api/support-chat/history`, `/api/support-chat/message`, `/api/support-chat/new-session`, `/api/support-chat/status` |
| `product-categories` | 3 | `/api/product-categories`, `/api/product-categories/:id`, `/api/product-categories/reorder` |
| `recurring-bookings` | 3 | `/api/recurring-bookings`, `/api/recurring-bookings/:id`, `/api/recurring-bookings/:id/renew` |
| `service-categories` | 3 | `/api/service-categories`, `/api/service-categories/:id`, `/api/service-categories/reorder` |
| `block-times` | 2 | `/api/block-times`, `/api/block-times/:id` |
| `donations` | 2 | `/api/donations`, `/api/donations/summary` |
| `external-calendars` | 2 | `/api/external-calendars`, `/api/external-calendars/events` |
| `membership-levels` | 2 | `/api/membership-levels`, `/api/membership-levels/:id` |
| `shift-templates` | 2 | `/api/shift-templates`, `/api/shift-templates/:id` |
| `shifts` | 2 | `/api/shifts`, `/api/shifts/repeat-cycle` |
| `bug-report` | 1 | `/api/bug-report` |
| `inventory` | 1 | `/api/inventory/logs` |
| `line-users` | 1 | `/api/line-users/unbound` |
| `line` | 1 | `/api/line/webhook` |
| `promotion` | 1 | `/api/promotion/stats` |
| `referrals` | 1 | `/api/referrals/dashboard` |

本骨架的 `src/lib/types.ts` 已依這些端點的回傳結構定義好領域型別，
`src/services/*` 則是對應的呼叫函式。接真實後端只需把 `NEXT_PUBLIC_USE_MOCK` 設成 `false`。

---
## 6. 多租戶客製化設定層

這是本重建最重要的架構決策。原站是 SaaS：一份部署服務數百家店，每家店有自己的
LINE 官方帳號、營業時間、通知規則。因此設定必須分成兩層。

### 6.1 平台層（`.env` → `src/config/env.ts`）

部署者設定一次，店家看不到也改不到。

| 變數 | 用途 |
|---|---|
| `DATABASE_URL` | 資料庫連線 |
| `AUTH_SECRET` | 簽發租戶 session / JWT |
| `SETTINGS_ENCRYPTION_KEY` | **加密租戶的 LINE Secret / Access Token**（32 bytes hex） |
| `LINE_LOGIN_CHANNEL_ID` / `_SECRET` | 平台的「用 LINE 登入」OAuth（與店家自己的官方帳號無關） |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | 平台的「用 Google 登入」 |
| `SMTP_*` / `MAIL_FROM` | 註冊驗證碼、密碼重設、預約通知信 |
| `STORAGE_DRIVER` / `S3_*` | QR Code、Rich Menu 底圖、作品集圖片 |
| `VAPID_*` | Web Push（後台「開啟新預約推播」） |
| `NEXT_PUBLIC_APP_URL` | 組出公開預約頁連結與 LINE Webhook URL |
| `NEXT_PUBLIC_USE_MOCK` | `true` = 骨架模式，不需後端 |

全部經 zod 驗證，缺漏會在啟動時就報錯而不是執行時才炸。

### 6.2 租戶層（資料庫 → `src/config/tenant-settings.ts`）

**每家店一份，由店家自己在後台前台輸入。** schema 分六組：

| 分組 | 對應頁面 | 內容 |
|---|---|---|
| `basic` | `/tenant/settings#basic` | 店名、店家代碼、電話、Email、地址、簡介、服務人員稱呼 |
| `business` | `/tenant/settings#business` | 營業時間（支援逐日不同時段）、休息時段、預約間隔、可提前預約、預約截止日、公休日、自動確認、強制指定人員、線上收款、預約自訂欄位 |
| `notify` | `/tenant/settings#notification` | 預約提醒、5 種 LINE 狀態推播、4 種 Email 通知、生日祝福、顧客喚回、加好友歡迎訊息 |
| `privacy` | `/tenant/settings#notification` | 隱私防護模式、收集 Email／生日／性別、延後收集 |
| `points` | `/tenant/settings#points` | 啟用累積、累積比例、進位方式（捨去／四捨五入／進位） |
| `line` | `/tenant/line-settings` | **Channel ID / Secret / Access Token**、Webhook URL、官方帳號 ID、自動回覆、Flex 主選單、Rich Menu 主題 |

### 6.3 機密欄位的處理（重點）

```ts
export const SECRET_FIELDS = ['line.channelSecret', 'line.channelAccessToken'] as const;

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 12) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(12)}${value.slice(-4)}`;
}
```

完整流程：

1. 店家在 `/tenant/line-settings` 輸入 Channel Secret / Access Token
2. 後端用 `SETTINGS_ENCRYPTION_KEY` 加密後存進 `tenant_settings`
3. 讀取時**永遠不回傳明文**，一律 `maskSecret()` 遮罩
4. 前端預設顯示遮罩且唯讀；使用者按「重新輸入」才變成可編輯的空欄位
5. 儲存時，**沒重新輸入就送空字串**，後端視為「此欄位不變更」

這個行為實作在 `src/app/tenant/line-settings/page.tsx`，程式碼內有完整註解。

### 6.4 Webhook URL 的產生規則

```ts
buildWebhookUrl(APP_URL, shopCode)   // {APP_URL}/api/line/webhook/{shopCode}
buildPublicBookingUrl(APP_URL, shopCode)  // {APP_URL}/s/{shopCode}
```

`shopCode` 在註冊時決定，規則是「僅限小寫英文、數字、連字號（-）」，
同時用於登入帳號與 LINE Webhook URL —— 這是每家店路由分流的 key。

### 6.5 功能商店旗標

```ts
export const FEATURE_CODES = [
  'BASIC_REPORT', 'MEMBERSHIP_SYSTEM', 'COUPON_SYSTEM', 'PRODUCT_SALES',
  'INVENTORY', 'KEYWORD_REPLY', 'AI_ASSISTANT', 'PORTFOLIO_SHOWCASE',
  'CUSTOM_RICH_MENU', 'EXTRA_PUSH',
] as const;
```

行為規則（原站文案原文）：

* 未訂閱：側邊欄仍顯示，點進去引導到 `/tenant/feature-store?feature=<CODE>`
* 已到期：「相關的票券已暫停、商品已下架（顧客暫時看不到）。你的設定與資料都完整保留，**續訂後系統會自動恢復原狀**。」
* 即將到期：到期前 10 天在儀表板出現提醒（`FEATURE_EXPIRY_WARNING_DAYS = 10`）
* LINE 免費方案每月推播上限 200 則（`LINE_FREE_PUSH_QUOTA`）

---

## 7. 文案系統

### 7.1 結構

```
src/i18n/zh-TW/
├── common.ts          全站共用：動作、狀態、確認彈窗、分頁、訊息、驗證、
│                      頂部列、回報問題、AI 客服、預約狀態、付款狀態、性別、星期
├── nav.ts             側邊欄 37 個項目
└── pages/
    ├── dashboard.ts
    ├── bookings.ts
    └── …（37 份）
```

規模：**7,600+ 行、約 15 萬字**，逐字取自原站 HTML 與 JS。

### 7.2 硬規則

頁面元件裡**不可以出現任何中文字面值**。所有文字都必須來自字典：

```tsx
import { common } from '@/i18n/zh-TW/common';
import { customersPage as t } from '@/i18n/zh-TW/pages/customers';

<Button>{common.save}</Button>
<h1 className="page-title">{t.title}</h1>
```

帶參數的文案寫成函式：

```ts
range: (from: number, to: number, total: number) => `顯示第 ${from}–${to} 筆，共 ${total} 筆`,
```

### 7.3 收錄範圍

每頁字典完整收錄：頁面標題、meta、分頁名稱、區塊標題、表格欄位、
表單 label / placeholder / help text / 下拉選項、按鈕文字、對話框標題與內文、
提示條全文、空狀態、**所有 toast 與錯誤訊息**、驗證訊息、確認對話框的多行內文。

要出英文版：複製 `src/i18n/zh-TW/` 成 `en-US/` 改譯即可，程式碼一行不用動。

---

## 8. 資料層

### 8.1 三層架構

```
頁面元件  →  src/services/*  →  adapt(mock, real)  →  src/mock/ 或 真實 API
```

頁面**不 fetch**。這樣換後端時頁面完全不用動。

```ts
export function listBookings(q: BookingQuery = {}): Promise<Paged<Booking>> {
  return adapt(
    () => { /* 從 MOCK_BOOKINGS 篩選、分頁 */ },
    () => request<Paged<Booking>>('/api/bookings', { query: q }),
  );
}
```

`adapt()` 在 mock 模式會加 320ms 延遲，讓 loading 狀態在骨架模式下也看得到。

### 8.2 領域型別（`src/lib/types.ts`）

`Booking` `Customer` `Service` `Staff` `Product` `ProductOrder` `Coupon`
`MembershipLevel` `DashboardStats` `DashboardAlerts` `StaffPerformance`
`PointTransaction` `TenantSummary` `SetupStatus`

狀態列舉（與原站一致）：

| 型別 | 值 |
|---|---|
| `BookingStatus` | `PENDING` 待確認 · `CONFIRMED` 已確認 · `COMPLETED` 已完成 · `CANCELLED` 已取消 · `NO_SHOW` 爽約 |
| `PaymentStatus` | `UNPAID` · `PAID_ONLINE` · `PAID_OFFLINE` · `REFUNDED` |
| `Booking.source` | `LINE` · `PUBLIC_PAGE` · `MANUAL` · `RECURRING` |
| `Gender` | `''` 未指定 · `MALE` 男 · `FEMALE` 女 · `OTHER` 不公開 |
| `CouponStatus` | `DRAFT` · `PUBLISHED` · `PAUSED` · `EXPIRED` |

---

## 9. 還原度說明

### 9.1 完全還原

* 37 個路由與 HTML `<title>`
* 側邊欄 7 群組 37 項目、圖示、功能旗標、紅點徽章
* 全套設計 token（配色、字級、圓角、陰影、間距、動效、斷點、z-index）
* 頁面版面骨架、卡片結構、表格欄位、分頁列
* **所有可見文案**（含 toast、驗證訊息、多行確認對話框內文）
* 表單欄位的 name / type / placeholder / help text / 下拉選項
* 租戶設定 schema（六組、上百個欄位）
* 195 個 API 端點清單與統一回應格式

### 9.2 需要接後端才會動的部分

骨架用 mock 資料 + 本地 state 模擬，行為正確但不落地：

* 檔案上傳（頭像、商品圖、Rich Menu 底圖、作品集）—— UI 與驗證訊息都在，缺 upload endpoint
* ~~QR Code 產生~~ —— **已補齊，不需要後端**（2026-08-25，[#16 補齊-1](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/16)，
  commit `e958b1d`）。原站就是前端 JS 產圖（見下方勘誤），本專案同樣在前端產：
  擁有者裁決安裝 **`qrcode` 1.5.4（精確版本，不用 caret）**，不得自寫編碼器
  （鐵則 9 要求的「分冊點名」落在 [01 分冊 §4](integration/01-ARCHITECTURE.md)
  的相依清單，裁決紀錄在 14 分冊 §8.2）。共用實作 `src/lib/qr.ts`，
  `promote`（公開預約網址，檔名「預約QRcode.png」）與 `line-settings`
  （LINE 加好友連結，檔名「LINE加好友QRcode.png」）兩頁共用同一支，不各寫一份
* 圖表 —— 原站用圖表套件，骨架用純 CSS bar（刻意不引入相依）
* 拖曳排序 —— 原站用 SortableJS，骨架用上移／下移按鈕
* 即時推播（Web Push、聊天）

> **勘誤（2026-08-25）：QR Code 那一條原本寫「原站由後端出圖」，是錯的。**
> 證據全部來自 `docs/specs/promote.json`（原站 DOM 抓取，本專案 fidelity 的
> 唯一真實來源）：
>
> | 證據 | 位置 | 說明 |
> |---|---|---|
> | `"onclick": "downloadQr()"` | `promote.json:147` | 下載動作是**頁面 inline JS 函式**，不是連結到某支端點 |
> | `"QR 元件載入失敗"` | `promote.json:261` | 「元件」載入失敗＝前端有一個 QR **產生元件**；後端出圖不會有這種錯誤字串 |
> | `"QR 尚未產生"` | `promote.json:271` | 「尚未產生」是前端渲染前的狀態，不是「尚未下載」 |
> | `"預約QRcode.png"` | `promote.json:305` | 檔名由前端指定給 `<a download>`，非 `Content-Disposition` |
> | 195 支端點清單中**無任何 QR 端點** | §9.1 端點清單 | 若由後端出圖，清單裡必然有一支 |
>
> 這條錯誤的實際後果：修復-1（#3）處理「兩處『QR 已下載』沒下載」時，處置寫的是
> 「做不到就移除按鈕」——因為本專案既沒有 QR 套件也沒有 QR 端點，執行者依這條
> 誤述會以為要等後端，於是走了「移除」那條路，功能就此缺著。擁有者方向是
> 「**對齊原站功能是首要目的；若有缺少功能，請用補齊的方式，而不是刪除**」，
> 補齊工作見 #16（該 issue 含「編碼器從哪來」的待裁決依賴選項）。
>
> 一般化的教訓，與 CLAUDE.md「Never fabricate a known」同源：**規格文件裡的
> 「原站是這樣做的」也是一種「已知」，一樣需要證據。** 這句話當初沒有任何
> spec 佐證，卻被後續施工當成事實依賴了一輪。寫「原站如何如何」時請附
> `docs/specs/*.json` 的行號。

### 9.3 已知的規格缺口

以下在原站是 inline JS 產生、`docs/specs` 只抓到扁平字串，無法還原對應關係。
相關 i18n 檔案的檔頭都有註記：

1. **`rich-menu-design` 的一頁式範本庫** —— 風格描述、店名、標語、格子標籤都收錄了，
   但「哪一句屬於哪一個範本」已遺失。字典以完整清單保存（一字未改），
   頁面用 `SCENE_TEMPLATES` 常數示範性組出幾組。
2. **`line-settings` 步驟三～五的內文**在 spec JSON 中被截斷，已用同頁 `jsStrings`
   的逐字稿重組，語意一致但非逐字。
3. **部分 `jsStrings` 是 HTML 片段**（例如 `"></i>自取</span>"`），只取可見文字。
4. **`feature-store` 各功能的實際月費**：spec 只給範圍 `$49~$249/月`，個別價格為推估。
5. **少數 spec 的 label 抽取串位**（例如 `publicShopUrl` 被抽成「店家名稱 *」），
   已依語意修正並在字典中註記。

### 9.4 沒有登入也能還原的原因

原站的 `/tenant/*` 路由對未登入請求回傳 **HTTP 200 + 完整 HTML**（不是 302 轉址），
權限只在 API 層擋。因此整套後台的 DOM 與文案都能取得，不需要有效帳號。

> 順帶一提：這也是原站的一個資安考量點。頁面骨架、內部欄位命名、
> 功能旗標代碼、195 個 API 端點路徑都對外公開。若要收斂，
> 建議在 `/tenant/*` 加上伺服器端的登入檢查與 302 轉址。

---

## 10. 接真實後端的步驟

1. `.env.local` 設 `NEXT_PUBLIC_USE_MOCK=false` 與 `DATABASE_URL`
2. 依 `src/lib/types.ts` 建資料表（或直接沿用原站的 schema）
3. 實作 `docs/_endpoints.json` 的端點，回應格式照 §5
4. `src/services/*` 的 `adapt(mock, real)` 第二個參數已經寫好呼叫，不用改
5. 刪掉 `src/mock/` 整個資料夾
6. 補上租戶 session 中介層，讓 `src/config/env.ts` 的 `AUTH_SECRET` 生效

頁面元件在整個過程中**一行都不用改**。
