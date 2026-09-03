# 07 — 部署、排程與收尾（Phase 7）

---

## 1. Vercel 環境變數

Vercel → 專案 → Settings → Environment Variables，依 01 分冊 §3 總表填。
規則：

- Production 與 Preview 都填；Preview 可指到**另一個** Supabase 專案（測試庫）以免髒資料。
- `NEXT_PUBLIC_USE_MOCK`：正式切換前保持 `true` 部署也安全（全站走 mock）；
  切 `false` 那次部署 = 正式啟用後端。
- `NEXT_PUBLIC_APP_URL` = 正式網址（自訂網域綁好後記得更新，webhook URL 由它組出）。
- 改 env 後要 **Redeploy** 才生效。

---

## 2. Vercel Cron Jobs

新增 `vercel.json`（repo 根目錄）：

```json
{
  "crons": [
    { "path": "/api/cron/booking-reminders", "schedule": "0 * * * *" },
    { "path": "/api/cron/birthday-greetings", "schedule": "0 1 * * *" },
    { "path": "/api/cron/customer-recall",    "schedule": "0 6 * * *" },
    { "path": "/api/cron/recurring-bookings", "schedule": "30 16 * * *" },
    { "path": "/api/cron/feature-expiry",     "schedule": "0 17 * * *" },
    { "path": "/api/cron/tour-order-expiry",  "schedule": "30 * * * *" }
  ]
}
```

（cron 是 **UTC**：`0 1` = 台北 09:00 生日祝福；`0 6` = 台北 14:00 喚回，
與原站文案一致；`30 16` = 台北 00:30 產生定期預約。）

> ⚠️ **實作時修正（Hobby 方案限制，實際踩到）**：上表的 booking-reminders
> （`0 * * * *`）與 tour-order-expiry（`30 * * * *`）是**每小時**，但 Vercel
> **Hobby 方案只允許每天一次的 cron**，更頻繁的運算式會讓**整個部署在設定
> 驗證階段被拒絕**（官方文件 *Usage & Pricing for Cron Jobs*：「Hobby accounts
> are limited to cron jobs that run once per day. Cron expressions that would
> run more frequently will fail during deployment.」Hobby 另有 ±59 分鐘的排程
> 精度誤差）。
>
> 因此 repo 內的 `vercel.json` 六支全部改為每日一次；連帶
> `booking-reminders` 的時間窗改為「節奏無關」的
> `(now, now + reminderHoursBefore]`（原本 ±30min 的窗在每日節奏下會漏掉
> 23/24 的預約），重複仍由 `reminder_sent_at` 擋掉。
>
> **升級 Pro 後**：把 `vercel.json` 的 booking-reminders 改回 `0 * * * *`、
> tour-order-expiry 改回 `30 * * * *` 即可，route 邏輯不需變動。

### 共用保護 — 每個 cron route 開頭

```ts
export const runtime = 'nodejs';
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });
  // …service role 逐店處理；單店失敗只 log，不中斷整批
}
```

Vercel 會自動帶 `Authorization: Bearer ${CRON_SECRET}`（專案 env 有設就會帶）。

### 各 job 邏輯

| job | 邏輯 |
|---|---|
| booking-reminders | 逐店：`notify.notifyBookingReminder` 開啟者，找 `start_at` 落在「now + reminderHoursBefore ± 30min」且 CONFIRMED 且未提醒過的預約 → `notifyBookingStatus(..,'REMINDER')`。防重發：bookings 加欄位 `reminder_sent_at timestamptz`（補一條 migration） |
| birthday-greetings | 逐店：`enableBirthdayGreeting` 開啟者，customers 生日=今天（月日比對）且已綁 LINE → 推 `birthdayGreetingMessage`，過額度就停 |
| customer-recall | 逐店：`enableCustomerRecall` 開啟者，customers_view `last_visit_at < now()-recallDays` 且綁 LINE，**每店每日上限 50 位**（原站規則）→ 推 `customerRecallMessage`。防重複：customers 加 `last_recall_at`，30 天內不重推 |
| recurring-bookings | active 的 recurring_bookings：依 rule 檢查未來 7 天應存在的場次，缺的補建 bookings（source='RECURRING'，status=CONFIRMED） |
| feature-expiry | 功能訂閱到期副作用（票券暫停/商品下架），邏輯見 09 分冊 §6（台北 01:00 執行） |
| tour-order-expiry | 逾期未付款旅遊訂單釋放名額（綠界 30 分鐘/匯款 3 天），邏輯見 10 分冊 §3 |

---

## 3. 圖片上傳（頁面用）

統一一個端點：`POST /api/upload`（multipart：`file`, `bucket`）

- 白名單 bucket：02 分冊 §0008 的五個，以及 #28⑥ 歡迎卡片圖片用的 `welcome-card-images`。
- 驗證：≤5MB，`image/jpeg|png|webp`。
- 路徑：`{tenantId}/{crypto.randomUUID()}.{ext}`（RLS 依第一段資料夾檢查）。
- 回 `{url}`（`supabase.storage.from(bucket).getPublicUrl()`）。
- 前端 services 有用到圖片欄位的（services/products/portfolio/staff/rich-menu），
  上傳一律先打這支拿 url，再把 url 塞進資源 payload。

---

## 4. 上線前檢查表

- [ ] `npm run typecheck`、`npm run build` 通過；`main` 綠燈部署
- [ ] Supabase：所有表 RLS enabled（跑一句檢查：
      `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;` → 必須空）
- [ ] Supabase Auth → URL Configuration：Site URL = 正式網址
- [ ] `SETTINGS_ENCRYPTION_KEY` 已備份到密碼管理器（遺失 = 所有店家 LINE token 作廢重填）
- [ ] Resend 網域已驗證，`MAIL_FROM` 不是 resend.dev
- [ ] `CRON_SECRET` 已設；手動打 cron 端點無 Bearer 回 401
- [ ] 完整跑一遍 08 分冊的端對端情境
- [ ] Vercel → Settings → Deployment Protection 依需求設定（後台本身有登入，
      Vercel 層可關；Preview 建議開 Vercel Authentication）
- [ ] 把 `NEXT_PUBLIC_USE_MOCK` 設為 `false` → Redeploy → 冒煙測試 → 完成

## 5. 例行維運

- Supabase：Database → Backups 確認每日備份開啟；Advisors 頁跑一次
  security/performance 建議並處理。
- Vercel：Functions 頁看 `/api/*` 錯誤率；`vercel logs` 或 Dashboard 查 500。
- LINE 額度：dashboard 首頁已顯示 pushQuota；接近上限提醒店家購買 EXTRA_PUSH。
