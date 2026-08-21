# 03 — 登入系統（Phase 2）

> 目標：Email + 密碼註冊/登入（含 Email 驗證碼）、忘記/重設密碼、
> session 保護所有後台頁、多店帳號切換。OAuth（Google / LINE Login）為後期選配（§7）。

技術基底：**Supabase Auth**。session 由 `@supabase/ssr` 存在 httpOnly cookie，
前端 `request()` 已設 `credentials: 'include'`，同源自動帶上，前端零改動。

---

## 1. 端點總表

| Method | Path | 用途 | 權限 |
|---|---|---|---|
| POST | `/api/auth/send-verification-code` | 寄 6 位數驗證碼（註冊/重設共用） | 公開 |
| POST | `/api/auth/tenant/register` | 開店註冊（驗證碼＋開帳號＋建店） | 公開 |
| POST | `/api/auth/login` | Email＋密碼登入 | 公開 |
| POST | `/api/auth/logout` | 登出 | 登入 |
| POST | `/api/auth/forgot-password` | 寄重設驗證碼（內部轉呼叫 send-verification-code 邏輯） | 公開 |
| POST | `/api/auth/reset-password` | 驗證碼＋新密碼重設 | 公開 |
| POST | `/api/auth/change-password` | 登入中改密碼 | 登入 |
| GET | `/api/auth/me` | 目前使用者＋目前店家 | 登入 |
| GET | `/api/auth/my-tenants` | 我的店家清單（`TenantSummary[]`） | 登入 |
| POST | `/api/auth/switch-tenant` | 切換目前操作的店家（設 cookie） | 登入 |

請求/回應詳細欄位見 04 分冊 §A-0；本冊給實作。

---

## 2. 驗證碼流程

```
註冊：輸入 email → send-verification-code(purpose=REGISTER)
     → Resend 寄 6 位數（10 分鐘有效）→ 使用者填碼 + 密碼 + 店名 + shopCode
     → POST /api/auth/tenant/register
重設：forgot-password → 同上 purpose=RESET_PASSWORD → reset-password
```

規則（照做，不要放寬）：

- 碼為 6 位數字，`crypto.randomInt(100000, 999999)`。
- 有效 10 分鐘；同一 email + purpose 60 秒內不可重寄（查最近一筆 `created_at`）。
- 驗證成功即寫 `consumed_at`，一碼一次。
- 為防 email 枚舉：email 已存在時 `send-verification-code(REGISTER)` 與
  不存在時 `forgot-password` **都回成功**，只是不寄信（或寄「此信箱已註冊」提醒信）。

### `/api/auth/send-verification-code/route.ts`

```ts
import { z } from 'zod';
import { randomInt } from 'crypto';
import { handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { sendVerificationCodeEmail } from '@/server/email/send'; // 05 分冊

const bodySchema = z.object({
  email: z.string().email('請輸入有效的 Email'),
  purpose: z.enum(['REGISTER', 'RESET_PASSWORD']),
});

export const POST = handle(async (req) => {
  const { email, purpose } = bodySchema.parse(await req.json());
  const admin = createAdminSupabase();

  const { data: recent } = await admin.from('auth_verification_codes')
    .select('created_at').eq('email', email).eq('purpose', purpose)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000)
    return fail(429, '請稍候再重新發送驗證碼', ERR.CONFLICT);

  // email 是否已註冊（枚舉防護：不論結果都回 success）
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 } as any);
  const exists = !!(await admin.rpc('email_exists', { p_email: email })).data; // 見下方 SQL
  if ((purpose === 'REGISTER') === exists) return ok({ sent: true });

  const code = String(randomInt(100000, 999999));
  await admin.from('auth_verification_codes').insert({
    email, code, purpose, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  await sendVerificationCodeEmail(email, code, purpose);
  return ok({ sent: true });
});
```

輔助 SQL（併入 migration `0003`，或新開 `0010`）：

```sql
create or replace function email_exists(p_email text) returns boolean as $$
  select exists (select 1 from auth.users where lower(email) = lower(p_email));
$$ language sql stable security definer set search_path = public, auth;
revoke execute on function email_exists(text) from anon, authenticated; -- 僅 service role
```

### 共用驗碼函式 `src/server/verify-code.ts`

```ts
import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';

export async function consumeCode(email: string, code: string, purpose: 'REGISTER'|'RESET_PASSWORD') {
  const admin = createAdminSupabase();
  const { data } = await admin.from('auth_verification_codes').select('*')
    .eq('email', email).eq('purpose', purpose).eq('code', code)
    .is('consumed_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new ApiHttpError(400, '驗證碼錯誤或已過期', ERR.CODE_INVALID);
  await admin.from('auth_verification_codes')
    .update({ consumed_at: new Date().toISOString() }).eq('id', data.id);
}
```

---

## 3. 註冊（開店）— `/api/auth/tenant/register/route.ts`

一個交易做四件事：驗碼 → 建 auth user → 建 tenants + tenant_users(OWNER) →
建 tenant_settings 預設值。auth user 無法包進 SQL 交易，因此**順序與補償**如下：

```ts
import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { consumeCode } from '@/server/verify-code';
import { DEFAULT_TENANT_SETTINGS } from '@/config/tenant-settings';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8, '密碼至少 8 碼'),
  tenantName: z.string().min(1, '請輸入店家名稱'),
  shopCode: z.string().regex(/^[a-z0-9-]+$/, '僅限小寫英文、數字、連字號'),
});

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await req.json());
  const admin = createAdminSupabase();

  const { data: dup } = await admin.from('tenants').select('id').eq('shop_code', b.shopCode).maybeSingle();
  if (dup) return fail(409, '此店家代碼已被使用', ERR.SHOPCODE_TAKEN);

  await consumeCode(b.email, b.code, 'REGISTER');

  const { data: created, error: uerr } = await admin.auth.admin.createUser({
    email: b.email, password: b.password, email_confirm: true,   // 驗證碼已確認過信箱
  });
  if (uerr) return fail(409, 'Email 已註冊', ERR.EMAIL_TAKEN);
  const userId = created.user.id;

  try {
    const { data: t, error } = await admin.from('tenants')
      .insert({ shop_code: b.shopCode, name: b.tenantName }).select('id').single();
    if (error) throw error;
    await admin.from('tenant_users').insert({ tenant_id: t.id, user_id: userId, role: 'OWNER' });
    const s = DEFAULT_TENANT_SETTINGS(b.shopCode, b.tenantName);
    await admin.from('tenant_settings').insert({
      tenant_id: t.id, basic: s.basic, business: s.business, notify: s.notify,
      privacy: s.privacy, points: s.points, line: { ...s.line, channelSecret: undefined, channelAccessToken: undefined },
    });
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);       // 補償：建店失敗就回滾帳號
    throw e;
  }
  return ok({ registered: true });
});
```

---

## 4. 登入 / 登出 / 改密 / 重設

```ts
// /api/auth/login/route.ts
import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { createServerSupabase } from '@/server/supabase';

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = handle(async (req) => {
  const { email, password } = bodySchema.parse(await req.json());
  const supabase = await createServerSupabase();          // signIn 會把 session 寫進 cookie
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(401, '帳號或密碼錯誤', ERR.BAD_CREDENTIALS);
  return ok({ loggedIn: true });
});
```

```ts
// /api/auth/logout/route.ts
export const POST = handle(async () => {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return ok({ loggedOut: true });
});
```

```ts
// /api/auth/reset-password/route.ts —— 驗證碼 + 新密碼
const bodySchema = z.object({ email: z.string().email(), code: z.string().length(6),
                              newPassword: z.string().min(8) });
export const POST = handle(async (req) => {
  const b = bodySchema.parse(await req.json());
  await consumeCode(b.email, b.code, 'RESET_PASSWORD');
  const admin = createAdminSupabase();
  const { data: uid } = await admin.rpc('user_id_by_email', { p_email: b.email }); // 同 email_exists 模式
  if (!uid) return fail(400, '驗證碼錯誤或已過期', ERR.CODE_INVALID);
  await admin.auth.admin.updateUserById(uid, { password: b.newPassword });
  return ok({ reset: true });
});
```

```ts
// /api/auth/change-password/route.ts —— 登入中：驗舊密碼再改
const bodySchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
export const POST = handle(async (req) => {
  const b = bodySchema.parse(await req.json());
  const { supabase, user } = await requireUser();
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email!, password: b.currentPassword });
  if (error) return fail(400, '目前密碼不正確', ERR.BAD_CREDENTIALS);
  await supabase.auth.updateUser({ password: b.newPassword });
  return ok({ changed: true });
});
```

`user_id_by_email` SQL（與 `email_exists` 同 migration）：

```sql
create or replace function user_id_by_email(p_email text) returns uuid as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$ language sql stable security definer set search_path = public, auth;
revoke execute on function user_id_by_email(text) from anon, authenticated;
```

`forgot-password` route 只是 `send-verification-code` 的殼：固定
`purpose = 'RESET_PASSWORD'`，一律回 `ok({ sent: true })`。

---

## 5. me / my-tenants / switch-tenant

```ts
// GET /api/auth/me  →  { email, tenantId, tenantName, shopCode, role }
export const GET = handle(async () => {
  const t = await requireTenant();
  return ok({ email: t.user.email, tenantId: t.tenantId,
              tenantName: t.tenantName, shopCode: t.shopCode, role: t.role });
});

// GET /api/auth/my-tenants  →  TenantSummary[]（見 src/lib/types.ts）
// current = 與 requireTenant() 解析結果相同者為 true

// POST /api/auth/switch-tenant  body: { tenantId }
// 驗證是成員 → cookies().set(ACTIVE_TENANT_COOKIE, tenantId, { httpOnly:true, path:'/', sameSite:'lax' })
```

---

## 6. 頁面保護與接線

### 6.1 `src/middleware.ts`（新檔，repo 根層 src/）

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = ['/tenant/login', '/tenant/register',
                      '/tenant/forgot-password', '/tenant/reset-password'];

export async function middleware(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') return NextResponse.next(); // 鐵則 10
  if (PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (all) => all.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    } },
  );
  const { data: { user } } = await supabase.auth.getUser();  // 同時完成 token 續期
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/tenant/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ['/tenant/:path*'] };
```

### 6.2 `src/services/auth.ts`（新檔）

比照既有 service 寫法，全部走 `adapt(mock, real)`：

```ts
export const login = (email: string, password: string) =>
  adapt(() => undefined,
        () => request<void>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
export const logout = () => …            // POST /api/auth/logout
export const sendVerificationCode = (email: string, purpose: 'REGISTER'|'RESET_PASSWORD') => …
export const registerTenant = (payload: {…}) => …
export const forgotPassword = (email: string) => …
export const resetPassword = (payload: {…}) => …
export const changePassword = (payload: {…}) => …
export const myTenants = () => adapt<TenantSummary[]>(() => MOCK_TENANTS, () => request('/api/auth/my-tenants'));
export const switchTenant = (tenantId: string) => …
```

並在 `src/services/index.ts` 加 `export * from './auth';`。

### 6.3 頁面接線（鐵則 1 的核准例外，僅此四頁）

| 頁 | 改法 |
|---|---|
| `/tenant/login/page.tsx` | submit handler 改呼叫 `login()`，成功後 `router.push(searchParams.next ?? '/tenant/dashboard')`；`ApiError` 時顯示 `err.message` |
| `/tenant/register/page.tsx` | 「發送驗證碼」→ `sendVerificationCode(email,'REGISTER')`；送出 → `registerTenant()`，成功導 login |
| `/tenant/forgot-password/page.tsx` | 送出 → `forgotPassword(email)`，成功顯示既有成功提示 |
| `/tenant/reset-password/page.tsx` | 送出 → `resetPassword()`，成功導 login |

只改事件處理與 loading/error state，不動版面與文案（文案在 `src/i18n/zh-TW/pages/*`）。
Topbar 的店家切換選單已存在，資料源改 `myTenants()`＋`switchTenant()`（該元件屬
layout，若需接線視為本節例外之延伸，僅改資料呼叫）。

---

## 7. 後期選配：Google / LINE Login OAuth

原站端點 `/api/auth/oauth/google/authorize`、`/api/auth/oauth/line/authorize`。
用 Supabase Auth Providers 實作：

1. Supabase Dashboard 開啟 Google provider（填 `GOOGLE_OAUTH_CLIENT_ID/SECRET`）。
   LINE 不是內建 provider → 用 **OIDC custom provider**（issuer `https://access.line.me`），
   填 LINE Login channel 的 ID/Secret（注意：這是「平台的 LINE Login channel」，
   與各店家的 Messaging API channel 完全是兩回事 —— 見 `src/config/env.ts` 註解）。
2. 兩個 route 都只做 `supabase.auth.signInWithOAuth({ provider, options: { redirectTo:
   `${APP_URL}/api/auth/oauth/callback` } })` 並 302 到回傳的 url。
3. `/api/auth/oauth/callback`：`exchangeCodeForSession(code)` → 若該 user 無任何
   `tenant_users` 紀錄 → 導 `/tenant/register?oauth=1`（補開店資料）；否則導 dashboard。

未設定 provider 前，登入頁的第三方按鈕維持現狀（disabled / 隱藏），不算未完成。

---

## 本冊驗收

- [ ] 未登入開 `/tenant/dashboard`（USE_MOCK=false）→ 302 到 `/tenant/login`
- [ ] 註冊全流程可走通：寄碼 → 收信 → 註冊 → 登入 → dashboard
- [ ] 錯誤密碼登入回 `{success:false, code:'AUTH_002'}`，頁面顯示錯誤訊息
- [ ] 忘記密碼 → 重設 → 用新密碼登入成功
- [ ] `GET /api/auth/my-tenants` 回自己那間店且 `current: true`
- [ ] 第二個帳號看不到第一家店的任何資料（開兩店互測 RLS）
- [ ] `NEXT_PUBLIC_USE_MOCK=true` 時登入頁行為與串接前完全相同
