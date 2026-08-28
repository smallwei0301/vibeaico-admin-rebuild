# 01 — 目標架構與基礎設施（Phase 0）

> 本冊做完後：Supabase 專案存在、env 齊全、`src/server/*` 基礎模組可用、
> `npm run typecheck && npm run build` 通過。**本冊不建任何資料表**（那是 02 分冊）。

---

## 1. 架構總覽

```
瀏覽器（既有前端頁面，不動）
   │  fetch，同源、cookie session（credentials: 'include' 已寫好）
   ▼
Next.js Route Handlers  src/app/api/**        ← 部署在 Vercel，同一個 repo
   │           │                │
   │           │                └── Resend（寄信）
   │           └── LINE Messaging API（每店自己的 token，DB 解密後使用）
   ▼
Supabase
 ├─ Auth      登入 / session（cookie，@supabase/ssr）
 ├─ Postgres  所有業務資料（RLS 隔離租戶）
 └─ Storage   圖片（服務、商品、作品集、rich menu 底圖…）
```

決策理由（不要更動這些決策）：

- **API 寫在同一個 Next.js app**：前端 `src/lib/api.ts` 的 `request()` 以
  `NEXT_PUBLIC_API_BASE_URL ?? ''` 為 base，留空即同源 —— 不需要 CORS、不需要另一個部署。
- **Supabase Auth 而非自製 JWT**：密碼雜湊、session 續期、OAuth 全部交給 Supabase；
  Next.js 端用 `@supabase/ssr` 讓 session 存活在 httpOnly cookie。
- **RLS 為主要隔離手段**：一般 API 用「帶使用者 session 的 supabase client」查資料，
  Postgres 層面就擋掉跨租戶存取；程式寫錯也不會漏資料。

---

## 2. 前置作業（人工或用 Supabase MCP/CLI）

1. 建立 Supabase 專案（region 建議 `ap-northeast-1` 東京，離台灣近）。
2. 記下四個值：
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable (anon) key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Service role (secret) key → `SUPABASE_SERVICE_ROLE_KEY`
   - Database URL（僅 migration 工具用，不進 app env）
3. Supabase Dashboard → Authentication → Providers：開啟 **Email**（關閉
   "Confirm email"，因為我們用自己的驗證碼流程，見 03 分冊）。Google/LINE OAuth 屬
   後期加分項，見 03 分冊 §7。
4. 產生兩把金鑰（終端機執行 `openssl rand -hex 32` 兩次）：
   - `AUTH_SECRET`
   - `SETTINGS_ENCRYPTION_KEY`（**64 個 hex 字元**，env.ts 會驗長度）

---

## 3. 環境變數總表

`.env.local`（本機）與 Vercel（Production + Preview）都要填。
既有 `src/config/env.ts` 需**新增**下列欄位（只新增，不刪既有）：

| 變數 | 端 | 必填階段 | 說明 |
|---|---|---|---|
| `NEXT_PUBLIC_USE_MOCK` | client | 一直 | 串接完成前保持 `true`；切真後端時設 `false` |
| `NEXT_PUBLIC_APP_URL` | client | 一直 | 正式站網址，例如 `https://vibeaico-admin.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | client | Phase 0 | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Phase 0 | anon/publishable key（可公開，靠 RLS 保護） |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Phase 0 | ⚠️ 最高權限，僅 webhook/cron/註冊使用 |
| `AUTH_SECRET` | server | Phase 2 | 簽 CSRF/一次性 token 用 |
| `SETTINGS_ENCRYPTION_KEY` | server | Phase 2 | 64 hex，加密租戶 LINE secrets |
| `RESEND_API_KEY` | server | Phase 4 | Resend API key |
| `MAIL_FROM` | server | Phase 4 | 例如 `VibeAI <noreply@yourdomain.com>`（需在 Resend 驗證網域） |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_ID` / `TELEGRAM_BOT_USERNAME` | server | #40 | 平台單一 Telegram Bot；username 只用於產生後台 `/start <code>` deep link；不得放進 `NEXT_PUBLIC_*` |
| `TELEGRAM_WEBHOOK_SECRET` | server | #40 | Telegram webhook 的 secret header 驗證值；後台不得在它或 Bot token 未設定時發出無法完成的綁定連結 |
| `PLATFORM_OWNER_EMAIL` / `PLATFORM_TELEGRAM_CHAT_ID` | server | #40 | 每日 notification health digest 的平台收件端；不入 DB／前端 |
| `CRON_SECRET` | server | Phase 7 | Vercel Cron 呼叫 `/api/cron/*` 的 Bearer token |
| `ANTHROPIC_API_KEY` | server | Phase 5.5（選） | AI 客服（AI_ASSISTANT 功能），見 09 分冊 §7 |
| `PUBLIC_CORS_ORIGINS` | server | Phase 10 | 允許呼叫 `/api/public/**` 的外部網域（Midao），逗號分隔，見 11 分冊 §4.1 |

`env.ts` 的 serverSchema 新增：

```ts
NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
RESEND_API_KEY: z.string().optional(),
CRON_SECRET: z.string().optional(),
```

（維持 optional：mock 模式下必須能在全空 env 起動 —— 鐵則 10。改為在
`src/server/supabase.ts` 取用時做非空斷言。）

同步更新 `.env.example`，把上表全部列進去附註解。

---

## 4. 允許安裝的套件

00 分冊鐵則 9：**不新增依賴，除非分冊點名。** 這一節就是那份點名清單——
不在這裡的一律不裝，要裝先改這一節並說明理由。

### 4.1 Phase 0 的三個

```bash
npm install @supabase/supabase-js@^2 @supabase/ssr@^0.6 resend@^4
```

不要安裝 ORM（prisma/drizzle）。查詢一律用 supabase-js。

### 4.2 後續由擁有者裁決加入的（2026-08-25）

| 套件 | 版本 | 用途 | 裁決 |
|---|---|---|---|
| `sharp` | **0.34.5**（精確，非 caret） | LINE 圖片訊息的 `previewImageUrl` 縮圖（1 MB 上限） | 14 分冊 §8.15 |
| `qrcode` | **1.5.4**（精確） | promote／line-settings 兩處的 QR Code 產生 | 14 分冊 §8.2 |
| `@types/qrcode` | 1.5.6 | 型別（devDependency） | 同上 |
| `jsqr` | 1.4.0 | **測試用**的獨立解碼器（devDependency） | 同上 |
| `pngjs` | 5.0.0 | 測試把 PNG 還原成像素餵給 `jsqr`（devDependency） | 同上 |
| `@types/pngjs` | 6.0.5 | 型別（devDependency） | 同上 |

**三件要記住的事：**

1. **一律精確版本，不用 caret。** `sharp` 是原生二進位，caret 會在不同環境拉到不同的
   建置；`qrcode` 則是因為 QR 的正確性沒有便宜的驗證方式，版本飄移不會有紅燈告訴你。
2. **`sharp` 在裝之前就已經在 `node_modules` 裡了**——它是 `next` 的相依（Next 用它做
   image optimization）。所以那次的動作不是「引入新套件」，而是**把隱性相依轉成顯性**。
   理由是不要依賴別人的內部相依：Next 哪天換掉實作，我們的縮圖會**無聲壞掉**，
   而那種壞法（縮圖沒產出 → preview 超規 → LINE 顯示異常）最難察覺。
3. **`jsqr` 是刻意選的「第三方」解碼器。** 用 `qrcode` 自己的中介資料去驗證自己
   等於自證，證明不了「別人的掃描器讀得出來」。QR 自寫編碼器的典型失敗就是
   「看起來像 QR、掃不出來」，所以驗證必須來自編碼器以外的實作。

⚠️ **`npm ci` 會比對 `package-lock.json` 與 `package.json`**，CI 兩處都跑它。
裝套件時 lock 一定要一起更新（`npm install <pkg>@<版本> --save-exact`），
並用 `npm ci --dry-run` 驗證同步——只改一邊 CI 會直接失敗。

---

## 5. `src/server/*` 基礎模組（完整程式碼，照抄）

### 5.1 `src/server/http.ts` — 回應信封與錯誤碼

```ts
import { NextResponse } from 'next/server';

/** 統一錯誤碼。前端只認 message 顯示、code 做分支，新增碼時同步更新 04 分冊表格 */
export const ERR = {
  UNAUTHORIZED: 'AUTH_001',        // 未登入或 session 過期
  BAD_CREDENTIALS: 'AUTH_002',     // 帳號或密碼錯誤
  EMAIL_TAKEN: 'AUTH_003',         // Email 已註冊
  CODE_INVALID: 'AUTH_004',        // 驗證碼錯誤或過期
  FORBIDDEN: 'AUTH_005',           // 已登入但無權限（非該店成員／角色不足）
  SHOPCODE_TAKEN: 'AUTH_006',      // shopCode 已被使用
  VALIDATION: 'REQ_001',           // zod 驗證失敗
  NOT_FOUND: 'REQ_002',            // 資源不存在（或不屬於該租戶）
  CONFLICT: 'REQ_003',             // 狀態衝突（例：時段重疊、重複操作）
  FEATURE_LOCKED: 'FEAT_001',      // 功能未訂閱
  LINE_NOT_CONFIGURED: 'LINE_001', // 尚未設定 LINE channel
  LINE_API_ERROR: 'LINE_002',      // LINE 平台回傳錯誤
  INTERNAL: 'SYS_001',
} as const;

export function ok<T>(data?: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(status: number, message: string, code?: string) {
  return NextResponse.json({ success: false, message, code }, { status });
}

/** route handler 最外層包這個：zod 錯誤→400、ApiHttpError→對應狀態、其他→500 */
export class ApiHttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await fn(req, ctx);
    } catch (e: any) {
      if (e instanceof ApiHttpError) return fail(e.status, e.message, e.code);
      if (e?.name === 'ZodError')
        return fail(400, e.issues?.[0]?.message ?? '輸入格式錯誤', ERR.VALIDATION);
      console.error('[api]', req.method, new URL(req.url).pathname, e);
      return fail(500, '系統發生錯誤，請稍後再試', ERR.INTERNAL);
    }
  };
}
```

### 5.2 `src/server/supabase.ts` — 兩種 client

```ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const URL_ = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** 帶使用者 session（cookie）的 client —— 一般 API 一律用這個，RLS 生效 */
export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient(URL_(), ANON(), {
    cookies: {
      getAll: () => store.getAll(),
      // setAll 的參數必須明確標型別：createServerClient 有 deprecated 與現行兩個
      // 多載，TS 在多載解析時無法對回呼參數做上下文推導，寫成 `(all) =>` 在
      // strict 模式下會是 TS7006/TS7031 隱含 any，typecheck 不會過。
      setAll: (all: { name: string; value: string; options: CookieOptions }[]) =>
        all.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}

/** service role client —— 僅限 LINE webhook / cron / 註冊流程（鐵則 7） */
export function createAdminSupabase() {
  return createClient(URL_(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

### 5.3 `src/server/tenant.ts` — 認證 + 租戶解析

```ts
import { createServerSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';
import { cookies } from 'next/headers';

export const ACTIVE_TENANT_COOKIE = 'vibeai_active_tenant';

export async function requireUser() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ApiHttpError(401, '請先登入', ERR.UNAUTHORIZED);
  return { supabase, user };
}

/**
 * 解析目前操作的店家：
 * 1. cookie vibeai_active_tenant 指定且使用者是成員 → 用它
 * 2. 否則取使用者第一個成員資格
 * 回傳的 supabase client 已帶 session，之後查業務表都用它（RLS 把關）。
 */
export async function requireTenant(minRole: 'STAFF' | 'MANAGER' | 'OWNER' = 'STAFF') {
  const { supabase, user } = await requireUser();
  const { data: memberships, error } = await supabase
    .from('tenant_users')
    .select('tenant_id, role, tenants(shop_code, name)')
    .eq('user_id', user.id);
  if (error || !memberships?.length)
    throw new ApiHttpError(403, '此帳號未加入任何店家', ERR.FORBIDDEN);

  const want = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const m = memberships.find((x) => x.tenant_id === want) ?? memberships[0];

  const rank = { STAFF: 0, MANAGER: 1, OWNER: 2 } as const;
  if (rank[m.role as keyof typeof rank] < rank[minRole])
    throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);

  return { supabase, user, tenantId: m.tenant_id as string, role: m.role as string,
           shopCode: (m as any).tenants.shop_code as string,
           tenantName: (m as any).tenants.name as string };
}
```

### 5.4 `src/server/crypto.ts` — 租戶 secrets 加解密

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const key = () => Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, 'hex'); // 32 bytes

/** AES-256-GCM。輸出格式：iv(hex).tag(hex).cipher(hex)，存 DB 的 text 欄位 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('hex')}.${c.getAuthTag().toString('hex')}.${enc.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  const [iv, tag, data] = stored.split('.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8');
}
```

### 5.5 `src/server/mappers.ts` — snake_case → camelCase

DB 欄位全 snake_case，前端契約全 camelCase。**每個資源寫一個顯式 mapper 函式**
（不要用泛型自動轉換，低階模型容易在 join 欄位上出錯）。範例：

```ts
import type { Booking, Customer } from '@/lib/types';

export function mapBooking(r: any): Booking {
  return {
    id: r.id, bookingNo: r.booking_no,
    customerId: r.customer_id, customerName: r.customer_name, customerPhone: r.customer_phone,
    serviceId: r.service_id, serviceName: r.service_name,
    staffId: r.staff_id, staffName: r.staff_name,
    startAt: r.start_at, endAt: r.end_at, durationMinutes: r.duration_minutes,
    price: r.price, finalPrice: r.final_price,
    status: r.status, paymentStatus: r.payment_status, source: r.source,
    note: r.note ?? '', createdAt: r.created_at,
  };
}
// mapCustomer / mapService / mapStaff / mapProduct / … 依 src/lib/types.ts 逐一補齊
```

（`customer_name` 等冗餘欄位的來源見 02 分冊 §3 的 view 設計。）

### 5.6 分頁工具 — `src/server/paging.ts`

```ts
export function pageRange(page = 0, size = 20) {
  const from = page * size;
  return { from, to: from + size - 1, page, size };
}

export function toPaged<T>(rows: T[], count: number | null, page: number, size: number) {
  const total = count ?? 0;
  return { content: rows, totalElements: total,
           totalPages: Math.ceil(total / size), number: page, size };
}
```

---

## 6. 本冊驗收

- [ ] `npm install` 後 lockfile 只新增 §4 的三個套件
- [ ] `src/server/` 六個檔案存在且 `npm run typecheck` 通過
- [ ] `.env.example` 已含 §3 全部變數
- [ ] `NEXT_PUBLIC_USE_MOCK=true` 且其餘 env 全空時 `npm run build` 仍成功（鐵則 10）
- [ ] Vercel 專案 Settings → Environment Variables 已填 Phase 0 的變數
