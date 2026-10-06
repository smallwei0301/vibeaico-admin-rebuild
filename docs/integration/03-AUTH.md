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
- **寄信失敗契約（#754／#758）**：該寄信卻發生 provider／設定層級失敗時（無 API key、provider 401／403、5xx、429、網路錯誤等），
  `send-verification-code` 與 `forgot-password` 回 **503 `MAIL_001`**，訊息固定為
  「驗證信暫時無法寄出，請稍後再試或聯絡我們」，剛插入的驗證碼即刪除（不留 60 秒冷卻），
  provider 細節只進 server log、不回給 client。**不得**在 provider／設定層級失敗而沒寄出時回 `{sent:true}`（收件人專屬拒絕例外，見下）。
- **枚舉防護的精確保證**（best-effort，非絕對；**不保證**已存在／不存在 email 的回應「完全相同」）：
  **正常運作時已知的既有差異（#764）**：`POST /api/auth/send-verification-code` 不論 purpose 是 `REGISTER` 或 `RESET_PASSWORD`，
  對「不存在（REGISTER）／已存在（RESET_PASSWORD）而真的寄出過信」的位址，60 秒內第二次請求回 **429**（不吞）；
  對「不寄信分支」的位址（REGISTER 已存在、RESET_PASSWORD 不存在）從無碼可查，永遠回 200 `{sent:true}`。
  只有 `forgot-password` 會吞掉 429，因此不受此差異影響。此差異未消除，需 Owner 決定冷卻是否改為對稱（#764 剩餘範圍）。
  **殘餘風險**：(a) 持續故障時，parity 視窗在「最後一次失敗寄送」之後才開始計時，`service` 60 秒、`config` 10 分鐘到期（無 grace period）；
  到期後到下一次失敗前，已存在 email 的探測回 200、而該次寄信分支才會失敗回 503，每次到期都會重新暴露，不是只暴露一次；
  (b) 視窗存於各 serverless instance 的記憶體，不跨 instance 共享，僅為 best-effort；
  (c) check-then-set 競態：視窗開啟當下已通過檢查的並行請求照常完成；
  (d) 失敗後刪除驗證碼若也失敗（只留 server log），會殘留一筆，60 秒內只有寄信分支的位址（REGISTER 未註冊／RESET_PASSWORD 已註冊）在 send-verification-code 會 429（forgot-password 吞 429）；
  (e) Resend 429 以 API key 為單位，請求 burst 可觸發 service 視窗（60 秒暫停寄信），且 auth email 端點目前無 app 層 rate limit。
  寄信失敗分三類（`src/server/email/send.ts` 的 `failureKind`）：
  `config`（無 key、401／403、金鑰／寄件者／網域設定錯誤）、`service`（429、5xx、網路／逾時、SDK 無 statusCode）、
  `recipient`（僅限可證明為 `to` 收件人被拒的 4xx：statusCode 4xx 且 message 指涉 `to` 欄位，如 422 "Invalid `to` field"）。
  `from` 欄位錯誤（MAIL_FROM 格式錯，422 "Invalid `from` field"）與其餘無法證明是收件人造成的 4xx（400、422 非 to、404、409…）一律 fail-closed 歸 `config`，不得歸 `recipient`（否則全站寄不出信卻回 200，#763 Codex P1 #4）。`config`／`service` 該次請求回 503 `MAIL_001`、刪除驗證碼，並開啟 parity 視窗
  （`config` 10 分鐘、`service` 60 秒；多次失敗取較長者，不縮短既有視窗）。
  **`recipient`（收件人專屬拒絕）回 200 `{sent:true}`，與「不寄信分支」對外無法區分**：驗證碼已刪除、不儲存，
  只寫 server log，不開啟／延伸／清除視窗（#763 P1 #3；若回 503，攻擊者可用 provider 會拒絕的位址反覆探測：
  已註冊 → 200、未註冊 → 503）。理由：被 provider 拒絕的位址等同「受理後退信」的不可投遞位址
  （使用者看到已寄出、信不會到）；#754 的誠實回報保留給真正影響使用者的 provider／設定層級故障。
  驗證碼已刪除，故重複請求不會產生只對未註冊位址成立的 429 冷卻。
  **視窗內，所有寄碼請求（已註冊／未註冊、REGISTER／RESET_PASSWORD 兩條分支）在最前面短路回同一個 503 `MAIL_001`**：
  不查 DB、不寫驗證碼、不呼叫 provider，也早於 60 秒重寄冷卻（429）與 email 存在判斷。視窗只由 TTL 結束，
  不會因 provider 恢復而提前清除（否則未註冊 email 寄成功回 200、已註冊 email 仍 503，形成枚舉 oracle，#763）。
  **可用性代價**：服務層級失敗後，該 instance 暫停寄信至多 60 秒（Resend 429 突發同樣造成 60 秒暫停，#764）；
  設定類失敗暫停到 TTL（10 分鐘）結束或重新部署。
  視窗存於 instance 記憶體：跨 serverless instance 不共享；每個 instance 第一個失敗請求之前仍可能出現差異；
  持續故障時，視窗每次過期後會重新暴露，直到下一次失敗再開（追蹤於 #764）。實作見 `src/server/send-code.ts`。

### `/api/auth/send-verification-code/route.ts`

```ts
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { dispatchVerificationCode } from '@/server/send-code';

const bodySchema = z.object({
  email: z.string().email('請輸入有效的 Email'),
  purpose: z.enum(['REGISTER', 'RESET_PASSWORD']),
});

// route 只做：zod 解析 → dispatchVerificationCode → ok({ sent: true })。
// 視窗檢查、冷卻、email_exists、產碼寫入、寄信與失敗分類全在 @/server/send-code。
export const POST = handle(async (req) => {
  const { email, purpose } = bodySchema.parse(await req.json());
  await dispatchVerificationCode(email, purpose);
  return ok({ sent: true });
});
```

> **不得**在 route 內直接呼叫 `sendVerificationCodeEmail` 後無條件回 `{ sent: true }`：
> 那會把寄信失敗變成假成功，且讓「已註冊／未註冊」兩條分支的回應可區分（枚舉 oracle）。

#### `src/server/send-code.ts` `dispatchVerificationCode(email, purpose)` 流程（順序不可調換）

1. **parity 視窗檢查最先**：`Date.now() < configFailureUntil` → 直接丟 503 `MAIL_001`。
   早於 DB 查詢、60 秒冷卻與 `email_exists`，兩條分支回應一致，且不呼叫 provider。
2. **60 秒重寄冷卻**：該 email＋purpose 最近一筆碼不到 60 秒 → 丟 429（`ERR.CONFLICT`）。
3. **`email_exists` 判斷**：`(purpose === 'REGISTER') === exists`（不需寄信的分支）→ 直接返回，route 回 200 `{ sent: true }`。
4. **產碼寫入** `auth_verification_codes`，再 `await sendVerificationCodeEmail(...)`；`result === 'SENT'` → 返回（SENT 不清除視窗）。
5. **寄信失敗**：先刪除剛寫入的碼（刪除失敗只寫 log），再依 `failureKind` 分流：
   - `recipient`（僅可證明為 `to` 欄位的 4xx）：只寫 server log，**正常返回**（route 回 200），不開視窗、不丟 503，避免與不寄信分支可區分。
   - `config`（含 MAIL_FROM 錯誤與其餘無法證明的 4xx，fail-closed）：視窗 10 分鐘。
   - `service`（5xx／429／網路）：視窗 60 秒。
   - 視窗以 `configFailureUntil = Math.max(configFailureUntil, Date.now() + ttl)` 延伸，不縮短既有較長視窗，之後丟 503 `MAIL_001`。

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
import { MODE_PRESETS } from '@/config/modes';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8, '密碼至少 8 碼'),
  tenantName: z.string().min(1, '請輸入店家名稱'),
  shopCode: z.string().regex(/^[a-z0-9-]+$/, '僅限小寫英文、數字、連字號'),
  businessType: z.enum(['LOCAL_SHOP', 'GUIDE', 'CLINIC']).optional(),   // 預設 LOCAL_SHOP，寫入 tenants.business_type
});

function isDuplicateEmailError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === 'email_exists';
}

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await req.json());
  const admin = createAdminSupabase();

  const { data: dup } = await admin.from('tenants').select('id').eq('shop_code', b.shopCode).maybeSingle();
  if (dup) return fail(409, '此店家代碼已被使用', ERR.SHOPCODE_TAKEN);

  await consumeCode(b.email, b.code, 'REGISTER');

  const { data: created, error: uerr } = await admin.auth.admin.createUser({
    email: b.email, password: b.password, email_confirm: true,   // 驗證碼已確認過信箱
  });
  if (uerr) {
    if (isDuplicateEmailError(uerr)) return fail(409, 'Email 已註冊', ERR.EMAIL_TAKEN);
    throw uerr;   // 其他錯誤由 handle() 轉成 500 SYS_001，不洩漏 provider 訊息
  }
  const userId = created.user.id;

  let tenantId: string | undefined;
  let ownerLinked = false;   // 僅 tenant_users(OWNER) 寫入成功後為 true
  try {
    const { data: t, error } = await admin.from('tenants')
      .insert({ shop_code: b.shopCode, name: b.tenantName, business_type: b.businessType ?? 'LOCAL_SHOP' }).select('id').single();
    if (error) throw error;
    tenantId = t.id;
    const { error: merr } = await admin.from('tenant_users').insert({ tenant_id: t.id, user_id: userId, role: 'OWNER' });
    if (merr) throw merr;   // 每一步都要檢查錯誤，否則會帶著半成品店家回 200
    ownerLinked = true;
    const s = DEFAULT_TENANT_SETTINGS(b.shopCode, b.tenantName);
    const { error: serr } = await admin.from('tenant_settings').insert({
      tenant_id: t.id, basic: s.basic, business: s.business, notify: s.notify,
      privacy: s.privacy, points: s.points, line: { ...s.line, channelSecret: undefined, channelAccessToken: undefined },
    });
    if (serr) throw serr;
    // 依模式贈與功能（GUIDE → TOUR_MODULE；source='GRANTED'、永久）
    const granted = MODE_PRESETS[b.businessType ?? 'LOCAL_SHOP'].grantedFeatures;
    if (granted.length > 0) {
      const { error: ferr } = await admin.from('feature_subscriptions').insert(
        granted.map((code) => ({ tenant_id: t.id, code, active: true, expires_at: null, source: 'GRANTED' })),
      );
      if (ferr) throw ferr;
    }
  } catch (e) {
    if (tenantId) {
      const { error: derr } = await admin.from('tenants').delete().eq('id', tenantId);   // 補償：刪店（cascade 清子表）
      if (derr) {
        if (ownerLinked) {
          // 刪店失敗但 owner membership 已建立：保留 auth 帳號，店家仍有可登入的 owner，可人工／重試復原；刪帳號會留下無主店家並佔住 shop_code
          console.error('[register] 補償刪店失敗，保留 auth 帳號', { tenantId, shopCode: b.shopCode, error: derr });
          throw e;
        }
        // 刪店失敗且尚無 owner membership（失敗點在 tenant_users insert）：租戶守門會回 403，保留帳號只會讓使用者
        // 同時被 email 與 shop_code 鎖死；記錄孤兒店家供人工清理，仍刪 auth 帳號釋放 email
        console.error('[register] 補償刪店失敗，孤兒店家（尚無 owner membership），仍刪除 auth 帳號', { tenantId, shopCode: b.shopCode, error: derr });
      }
    }
    await admin.auth.admin.deleteUser(userId);       // 補償：建店失敗就回滾帳號
    throw e;
  }
  return ok({ registered: true });
});
```

錯誤分類規則（Issue #710）：`createUser` 失敗時，只有 `code === 'email_exists'` 才回 409 `AUTH_003`；其他錯誤（provider 5xx、網路故障等）一律 `throw`，由 `handle()` 轉成 500 `SYS_001`，且不建立 tenant、不洩漏 provider 訊息。理由：provider 暫時故障若被誤報成「Email 已註冊」，使用者會被導去登入或重設密碼，卻不知道其實是註冊沒成功。

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
// （import：cookies from 'next/headers'；ApiHttpError, ERR, handle, ok from '@/server/http'；
//   IMPERSONATION_COOKIE, endImpersonation from '@/server/platform-admin'；isMissingSessionError from '@/server/tenant'）
export const POST = handle(async () => {
  const supabase = await createServerSupabase();
  // 代入中登出：先結束代入 session（admin_user_id 收窄、冪等）並清 cookie；結束失敗直接 500，不謊報已登出
  const jar = await cookies();
  const sessionId = jar.get(IMPERSONATION_COOKIE)?.value;
  if (sessionId) {
    const { data, error: uerr } = await supabase.auth.getUser();
    // Auth 服務故障 ≠ 沒登入：fail closed（503），保留 cookie 以便重試，不 signOut（同 requireUser）
    if (uerr && !isMissingSessionError(uerr)) {
      console.error('[auth] logout getUser failed; keeping impersonation cookie for retry', uerr);
      throw new ApiHttpError(503, '暫時無法確認登入狀態，請稍後再試', ERR.INTERNAL);
    }
    if (data?.user) await endImpersonation(sessionId, data.user.id);
    jar.set(IMPERSONATION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  }
  // 只結束目前裝置的 session；錯誤不得吞掉，否則 session 沒撤銷卻回 200
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new ApiHttpError(500, '登出失敗，請稍後再試', ERR.INTERNAL);
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
`purpose = 'RESET_PASSWORD'`；正常時一律回 `ok({ sent: true })`，寄信失敗（或處於 parity 視窗內）回 503 `MAIL_001`（見 §2 寄信失敗契約）。

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
// select 含 tenants.business_type（AppShell 在 AUTH_REAL 下以此決定業態外框）。
// ⚠️ 平台管理者代登入期間（t.impersonation 有值）：只回代入目標一筆
//    { id: t.tenantId, shopCode, name, role: t.role, current: true, businessType }，
//    資料取自 requireTenant() 已載入的 tenants 列、不查 tenant_users，
//    目標只能來自 session row，絕不由 request 輸入推導；殼層因此只有一個選項，無從切走。

// POST /api/auth/switch-tenant  body: { tenantId }
// 驗證是成員 → cookies().set(ACTIVE_TENANT_COOKIE, tenantId, { httpOnly:true, path:'/', sameSite:'lax' })
```

---

## 6. 頁面保護與接線

### 6.0 認證模式 `resolveAuthMode()`（#754）

認證邊界（登入、session 保護、店家脈絡）獨立於業務資料開關 `NEXT_PUBLIC_USE_MOCK`，
由 `src/config/env.ts` 的 `resolveAuthMode(rawUseMock, rawAuthMode)` 吃**原始 env 字串**決定
（不可餵經 zod `.default('true')` 的值，缺值會被誤當 `'true'`）：

1. `NEXT_PUBLIC_AUTH_MODE` 明確為 `real`／`mock` → 以它為準（其他值載入時直接拋錯）；
2. 否則 `NEXT_PUBLIC_USE_MOCK === 'true'` → `mock`（本機示範、CI build）；
3. `'false'` 或未設定 → `real`（fail-closed：Production 缺值也要求真 session）。

匯出常數 `AUTH_REAL`；以下 middleware、service、頁面接線全部只看 `AUTH_REAL`。
**混合模式**（`AUTH_REAL` + 業務 `USE_MOCK=true`）：認證與店家清單走真 API，其餘業務資料仍是 mock，
AppShell 須顯示 `common.topbar.demoDataNotice` 提示，且 AUTH_REAL 分支絕不讀 `MOCK_TENANTS`／`MOCK_USER`。

### 6.1 `src/middleware.ts`（新檔，repo 根層 src/）

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { AUTH_REAL } from '@/config/env';

const PUBLIC_PATHS = ['/tenant/login', '/tenant/register',
                      '/tenant/forgot-password', '/tenant/reset-password'];

export async function middleware(req: NextRequest) {
  if (!AUTH_REAL) return NextResponse.next(); // 只有「明確 mock 認證」才放行；缺值／false 一律往下驗 session
  if (PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (all: { name: string; value: string; options: CookieOptions }[]) =>
          all.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    } },
  );
  const { data: { user } } = await supabase.auth.getUser();  // 同時完成 token 續期
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/tenant/login';
    url.search = '';   // 清掉原請求的 query，避免與登入頁參數混用
    url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);   // 保留完整 next；登入頁以 safeNextPath() 驗證後才導回
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ['/tenant/:path*'] };
```

### 6.2 `src/services/auth.ts`（新檔）

認證專用 service 一律走 `adaptAuth(mock, real)`（`src/lib/api.ts`）：只看 `AUTH_REAL`，
與業務 `USE_MOCK` 無關；`AUTH_REAL` 時直接打真 API（不 delay），否則才走 mock。
**不得**用 `adapt()`——它綁業務 `USE_MOCK`，會讓「業務 mock＋真登入」的混合模式誤走假登入。

```ts
export const login = (email: string, password: string) =>
  adaptAuth(() => undefined,
        () => request<void>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
export const logout = () => …            // POST /api/auth/logout；route 以 signOut({ scope: 'local' })，
                                         // 只結束目前裝置（預設 global 會踢掉所有裝置）；signOut 失敗要回錯，
                                         // Topbar 失敗時顯示錯誤、不導向（不假裝已登出）
                                         // 代入期間登出會一併結束代入 session（ended_at）並清除 vibeai_impersonation cookie
export const sendVerificationCode = (email: string, purpose: 'REGISTER'|'RESET_PASSWORD') => …
export const registerTenant = (payload: {…}) => …
export const forgotPassword = (email: string) => …
export const resetPassword = (payload: {…}) => …
export const changePassword = (payload: {…}) => …
export const myTenants = () => adaptAuth<TenantSummary[]>(() => MOCK_TENANTS, () => request('/api/auth/my-tenants'));
export const switchTenant = (tenantId: string) => …
```

並在 `src/services/index.ts` 加 `export * from './auth';`。

### 6.3 頁面接線（鐵則 1 的核准例外，僅此四頁）

| 頁 | 改法 |
|---|---|
| `/tenant/login/page.tsx` | submit handler 改呼叫 `login()`，成功後 `router.push(safeNextPath(next))`（`src/lib/auth-boundary.ts`：只接受單一 `/` 開頭的站內路徑，拒絕 `//host`、`/\host`、含 scheme／控制字元者，不合法回 `/tenant/dashboard`；防 open redirect。**不得**直接使用未驗證的 `next`）；`ApiError` 時顯示 `err.message` |
| `/tenant/register/page.tsx` | 「發送驗證碼」→ `sendVerificationCode(email,'REGISTER')`；送出 → `registerTenant()`，成功導 login |
| `/tenant/forgot-password/page.tsx` | 送出 → `forgotPassword(email)`，成功顯示既有成功提示 |
| `/tenant/reset-password/page.tsx` | 送出 → `resetPassword()`，成功導 login |

只改事件處理與 loading/error state，不動版面與文案（文案在 `src/i18n/zh-TW/pages/*`）。
Topbar 的店家切換選單已存在，資料源改 `myTenants()`＋`switchTenant()`（該元件屬
layout，若需接線視為本節例外之延伸，僅改資料呼叫）。

AppShell 在 `AUTH_REAL` 的殼層規則：

- 店家清單與業態來自 `myTenants()`；清單 **settled（成功或失敗）前不掛載內容區**
  （`shellContentReady`），避免業態變動使 `key={businessType}` 整頁重掛、丟失狀態。
- 載入失敗顯示錯誤提示、清單為空顯示「無店家」提示（`tenantContextNotice`），不得退回 `MOCK_TENANTS`。
- 使用者名稱走真端點（未知時為 `null`，不顯示假名字）。
- 代登入期間清單只有代入目標一筆（見 §5）。

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

- [ ] 未登入開 `/tenant/dashboard`（`AUTH_REAL`：`USE_MOCK=false`、未設定，或 `AUTH_MODE=real`）→ 302 到 `/tenant/login`
- [ ] 同上但 `NEXT_PUBLIC_USE_MOCK` **未設定** → 仍 302（fail-closed，不得放行）
- [ ] `NEXT_PUBLIC_AUTH_MODE` 填 `real`／`mock` 以外的值 → 載入時直接拋錯
- [ ] 註冊全流程可走通：寄碼 → 收信 → 註冊 → 登入 → dashboard
- [ ] 錯誤密碼登入回 `{success:false, code:'AUTH_002'}`，頁面顯示錯誤訊息
- [ ] 忘記密碼 → 重設 → 用新密碼登入成功
- [ ] `GET /api/auth/my-tenants` 回自己那間店且 `current: true`，並含 `businessType`
- [ ] 平台管理者代登入期間，`GET /api/auth/my-tenants` 只回代入目標一筆（不回管理者自己的店）
- [ ] 登入 `?next=//evil.com`、`/\evil.com`、`https://evil.com` → 一律導 `/tenant/dashboard`；`?next=/tenant/orders` → 導回該頁
- [ ] 登出呼叫 `signOut({ scope: 'local' })`；signOut 失敗時顯示錯誤、不導向登入頁；其他裝置 session 不受影響
- [ ] 平台管理者代入期間登出 → 一併結束代入 session（`impersonation_sessions.ended_at` 不為 null）並清除 `vibeai_impersonation` cookie；結束代入失敗回 500 且不 signOut
- [ ] `AUTH_REAL` 下 my-tenants 未回前不掛載內容區；失敗／空清單各有提示；不讀 `MOCK_TENANTS`／`MOCK_USER`
- [ ] 混合模式（`AUTH_REAL` + 業務 `USE_MOCK=true`）：真登入可用，AppShell 顯示示範資料提示
- [ ] 第二個帳號看不到第一家店的任何資料（開兩店互測 RLS）
- [ ] 認證模式為 `mock`（`NEXT_PUBLIC_USE_MOCK=true` 且未設 `AUTH_MODE`，或 `AUTH_MODE=mock`）時，登入頁與 middleware 行為與串接前完全相同（假登入、不擋頁）
