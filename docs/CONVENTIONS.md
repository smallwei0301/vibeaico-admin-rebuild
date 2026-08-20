# 開發約定（給所有貢獻者 / AI agent 讀）

本專案是 **VibeAI 店家後台**（vibeaico.com/tenant/*）的乾淨重建骨架。
目標：照著這份文件 + 原始碼，可以做出與原站 **100% 一致** 的後台，且能本地跑起來。

## 技術棧
Next.js 15 App Router · React 19 · TypeScript strict · Tailwind CSS 3 · lucide-react · zod

> 原站實作是 **Bootstrap 5 + 原生 JS + 伺服器端 HTML 樣板**。
> 本骨架把它的設計語言完整搬進 Tailwind：所有 Bootstrap 自訂 class
> （`.card` `.data-table-*` `.badge` `.btn` `.form-control` …）在
> `src/styles/globals.css` 的 `@layer components` 有等價實作，視覺 1:1。

## 目錄
```
src/
  app/tenant/<route>/page.tsx   每個後台頁面，路由與原站完全相同
  components/ui/                設計系統元件（Button / Card / DataTable / Modal …）
  components/layout/            AppShell / Sidebar / Topbar / Footer / 全站 widget
  config/nav.ts                 側邊欄結構（1:1 對應原站）
  config/env.ts                 平台層環境變數（zod 驗證）
  config/tenant-settings.ts     ★ 租戶設定 schema（LINE token 等，每家店一份）
  config/features.ts            功能商店旗標
  i18n/zh-TW/common.ts          全站共用文案
  i18n/zh-TW/nav.ts             側邊欄文案
  i18n/zh-TW/pages/<page>.ts    ★ 每頁的所有文案
  lib/types.ts                  領域型別 = 前後端契約
  lib/api.ts                    API adapter（mock ⇄ 真實後端切換）
  services/                     頁面唯一的資料入口
  mock/                         骨架模式假資料
  styles/tokens.css             ★ 設計 token 單一事實來源
```

## 硬規則

1. **文案零硬編碼。** 頁面裡不可以出現中文字串字面值。
   全部放 `src/i18n/zh-TW/pages/<page>.ts`，用 `import { xxxPage as t }` 取用。
   共用字（儲存/取消/載入中/確定要執行此操作嗎？）用 `common`。

2. **顏色、圓角、陰影、字級零硬編碼。** 只用 Tailwind token
   （`bg-primary` `rounded-lg` `shadow-md` `text-xs`）或 `var(--…)`。
   要改主題只改 `src/styles/tokens.css`。

3. **頁面不 fetch。** 一律呼叫 `src/services/*` 的函式。
   service 用 `adapt(mock, real)` 包起來，`NEXT_PUBLIC_USE_MOCK=false` 時自動改打真實 API。

4. **每個 client 頁面第一行 `'use client';`**（後台頁幾乎都有互動狀態）。

5. **每頁的標準結構：**
   ```tsx
   <PageHeader eyebrow="群組名" title={t.title} actions={…} />
   <DataTableContainer>
     <DataTableHeader title={t.tableTitle} actions={篩選器} />
     <DataTable columns={…} rows={…} loading empty={<EmptyState …/>} rowKey={…} />
     <DataTableFooter><Pagination …/></DataTableFooter>
   </DataTableContainer>
   ```
   表單頁則用 `<Card>` + `<Tabs>`。

6. **金額欄位** 用 `formatCurrency()` 且 `numeric: true`（右對齊 + tabular-nums）。

7. **狀態欄位** 一律 `<Badge tone="…">`，文案取 `common.bookingStatus` 之類的映射表。

8. **每頁都要有**：loading 態、空狀態（`EmptyState`，含標題與說明）、
   刪除確認（`ConfirmModal`）、操作成功 toast（`useToast()`）。

## 可用元件（`@/components/ui`）
`Button`(variant: primary/secondary/success/danger/warning/outline/outlineDanger/ghost/line；size: sm/md/lg/icon；`loading` `loadingText`)
`Badge`(tone: primary/success/warning/danger/info/purple/neutral) · `CountBadge`
`Card` `CardHeader` `CardTitle` `CardBody` `CardFooter`
`DataTableContainer` `DataTableHeader` `DataTable` `DataTableFooter` `Column<T>`
`Pagination` · `Modal` `ConfirmModal` · `Alert`(tone) · `StatCard` · `EmptyState` · `Tabs` `TabPanel`
`PageHeader` · `useToast()`
表單：`FormGroup` `Label`(required) `Input` `Textarea` `Select` `FormText` `FormError` `CharCounter` `Switch` `SwitchField`

Icon 一律 lucide-react（原站用 Bootstrap Icons，已在 `config/nav.ts` 建立對照）。

## 多租戶客製化（重要）
- **平台級**設定（資料庫、寄信、平台 OAuth）→ `.env` → `src/config/env.ts`
- **每家店**的設定（LINE Channel ID/Secret/Access Token、營業時間、通知、點數規則、
  品牌色）→ **資料庫的 tenant_settings**，由店家在後台自己填 → `src/config/tenant-settings.ts`

> ⚠️ 絕不可以把 LINE Channel Token 放進 `.env`。那樣整個平台只能服務一家店。
> Secret 類欄位入庫前用 `SETTINGS_ENCRYPTION_KEY` 加密，回前端一律 `maskSecret()` 遮罩，
> 使用者沒重新輸入就送空字串代表「不變更」。
