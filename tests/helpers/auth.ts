// tests/helpers/auth.ts
//
// 登入輔助 —— 見 docs/integration/12-TESTING-TDD.md §1.4：
//   「登入輔助 tests/helpers/auth.ts：loginAs(email, password) 回傳帶 cookie 的
//    fetch wrapper；travelerJwt(email) 回 Bearer token。」
//
// ⚠️ 現況（2026-08 撰寫時）：`/api/auth/login`、`/api/public/auth/login` 都還
// 不存在（03/11 分冊描述的端點，Phase 2 / Phase 9 才會建立）。這裡先把介面、
// 型別、實作邏輯寫好 —— 一旦端點存在，這兩支函式應該不需要再改，整合測試就
// 能直接 import 使用。呼叫這兩支函式在 Phase 2/9 之前必然會丟出「端點不存在」
// 的錯誤（fetch 到 404 或連線被拒），這是預期中的事，不是這份檔案的 bug。
//
// 判斷／待確認事項（12 分冊沒交代清楚，見本次任務回報）：
//   - 04/03 分冊的信封格式是 `{ success, data?, message?, code? }`
//     （見 src/lib/api.ts、CLAUDE.md「Pages never fetch」一節），這裡假設
//     `/api/auth/login` 成功時把 session cookie 用 Set-Cookie 帶回、body 走
//     同一個信封；旅客 JWT（11 分冊 §2：「Supabase JWT 放 Authorization: Bearer，
//     不依賴跨網域 cookie」）假設走 `/api/public/auth/login`，token 放在
//     `data.accessToken`。兩個假設都待 Phase 2/9 的實作與此對齊時再校正。

import { TRAVELER_1 } from '../fixtures';

/** 整合測試伺服器位址 —— 與 tests/integration/global-setup.ts 起的 next dev 一致。 */
const INTEGRATION_BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const AUTH_STEP_TIMEOUT_MS = 20_000;

/** `src/lib/api.ts` 假設的固定回應信封（見 CLAUDE.md「Pages never fetch」一節）。 */
interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
}

/** `loginAs()` 回傳的、帶登入 cookie 的 fetch wrapper。 */
export interface AuthedApi {
  /** 原始 fetch，路徑可傳相對路徑（如 `/api/bookings`）或絕對 URL。 */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  get(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
  patch(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
  put(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
  delete(path: string, init?: RequestInit): Promise<Response>;
}

function resolveUrl(path: string): string {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${INTEGRATION_BASE_URL}${path}`;
}

/** Bound each helper request so a stalled auth endpoint names the exact step. */
async function fetchAuthStep(label: string, url: string, init: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(AUTH_STEP_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...init, signal });
  } catch (cause) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    throw new Error(`[auth helper] '${label}' timed out or failed: ${detail}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

function withJsonBody(init: RequestInit | undefined, body: unknown): RequestInit {
  if (body === undefined) return init ?? {};
  return {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  };
}

/**
 * 以 email/password 登入店家後台帳號（`POST /api/auth/login`），回傳帶
 * session cookie 的 fetch wrapper，供整合測試打其他 `/api/**` 端點。
 *
 * 對應 12 分冊 §3 骨架裡的 `loginAs(SHOP_A.owner)` 呼叫方式：那裡的
 * `SHOP_A.owner` 是 `{ email, password }`（見 tests/fixtures.ts），實際呼叫
 * 時請展開為 `loginAs(SHOP_A.owner.email, SHOP_A.owner.password)`。
 */
export async function loginAs(email: string, password: string): Promise<AuthedApi> {
  // ⚠️ 真正的 cookie jar（實跑抓到的坑，勿簡化回「登入當下快照」）：
  //   1. `headers.get('set-cookie')` 會把多個 Set-Cookie 併成一條逗號字串，
  //      舊寫法 `.split(';')[0]` 只留下第一個 cookie —— @supabase/ssr 的
  //      session 可能分塊（sb-…-auth-token.0/.1），會被砍掉一半。
  //      正規做法是 `headers.getSetCookie()`（Node >=19.7 的標準 API，回陣列）。
  //   2. 登入之後的回應也會 Set-Cookie —— 例如 switch-tenant 設
  //      vibeai_active_tenant、Supabase 續期 token。不持續吃進 jar，
  //      «switch 後 me 變更» 這類測試必然假紅（cookie 沒帶到下一個請求）。
  const jar = new Map<string, string>();

  const ingest = (response: Response): void => {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired =
        attrs.some((a) => a.trim().toLowerCase() === 'max-age=0') || value === '';
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
  };

  const cookieHeader = (): string =>
    [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');

  const signIn = async (): Promise<void> => {
    const res = await fetchAuthStep('POST /api/auth/login', resolveUrl('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify(await res.json()); } catch { /* non-JSON */ }
      throw new Error(`loginAs(${email}) 失敗：POST /api/auth/login 回 ${res.status} ${detail}`);
    }
    ingest(res);
    if (jar.size === 0) {
      throw new Error(`loginAs(${email}) 失敗：回應是 2xx 但沒有 Set-Cookie header，無法建立已登入的 session。`);
    }
  };

  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const response = await fetchAuthStep(`${method} ${path}`, resolveUrl(path), {
      ...init, headers: { ...(init?.headers ?? {}), Cookie: cookieHeader() },
    });
    ingest(response);
    return response;
  };

  await signIn();
  // A successful login must immediately establish a tenant session.  This
  // preflight catches a bad jar before a long integration suite turns it into
  // unrelated 401/404 cascades.
  const me = await request('/api/auth/me');
  if (!me.ok) throw new Error(`loginAs(${email}) preflight：GET /api/auth/me 回 ${me.status}`);

  const authedFetch = async (path: string, init?: RequestInit): Promise<Response> => {
    let response = await request(path, init);
    // Long serialized integration runs can encounter a renewed or invalidated
    // test cookie. Renew once so later assertions exercise their route rather
    // than cascading from the same stale session.
    if (response.status === 401 && path !== '/api/auth/me') {
      await signIn();
      const renewed = await request('/api/auth/me');
      if (!renewed.ok) throw new Error(`loginAs(${email}) renewal preflight：GET /api/auth/me 回 ${renewed.status}`);
      response = await request(path, init);
    }
    return response;
  };

  return {
    fetch: authedFetch,
    get: (path, init) => authedFetch(path, { ...init, method: 'GET' }),
    post: (path, body, init) => authedFetch(path, { ...withJsonBody(init, body), method: 'POST' }),
    patch: (path, body, init) => authedFetch(path, { ...withJsonBody(init, body), method: 'PATCH' }),
    put: (path, body, init) => authedFetch(path, { ...withJsonBody(init, body), method: 'PUT' }),
    delete: (path, init) => authedFetch(path, { ...init, method: 'DELETE' }),
  };
}

/** email → 密碼 的已知測試帳號對照（目前只有 tests/fixtures.ts 的 TRAVELER_1）。 */
const KNOWN_TRAVELER_PASSWORDS: Record<string, string> = {
  [TRAVELER_1.email]: TRAVELER_1.password,
};

/**
 * 取得旅客帳號的 Supabase JWT（供 `Authorization: Bearer` 使用），對應
 * 11 分冊 §2「Supabase JWT 放 Authorization: Bearer，不依賴跨網域 cookie」。
 *
 * 12 分冊給的簽章是 `travelerJwt(email)`（單一參數）。這裡保留這個呼叫方式
 * ——密碼透過 tests/fixtures.ts 的已知種子帳號（目前只有 TRAVELER_1）反查；
 * 若呼叫的 email 不在種子清單裡，就必須自己傳 password（第二參數），否則丟出
 * 清楚的錯誤而不是靜默失敗。
 */
export async function travelerJwt(email: string, password?: string): Promise<string> {
  const resolvedPassword = password ?? KNOWN_TRAVELER_PASSWORDS[email];
  if (!resolvedPassword) {
    throw new Error(
      `travelerJwt(${email})：這個 email 不在 tests/fixtures.ts 的已知種子帳號裡，` +
        ' 請呼叫 travelerJwt(email, password) 明確帶入密碼。',
    );
  }

  const res = await fetchAuthStep('POST /api/public/auth/login', resolveUrl('/api/public/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: resolvedPassword }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      // ignore
    }
    throw new Error(`travelerJwt(${email}) 失敗：POST /api/public/auth/login 回 ${res.status} ${detail}`);
  }

  const envelope = (await res.json()) as ApiEnvelope<{ accessToken?: string; token?: string }>;
  const token = envelope.data?.accessToken ?? envelope.data?.token;
  if (!envelope.success || !token) {
    throw new Error(`travelerJwt(${email}) 失敗：回應沒有帶 accessToken/token（${JSON.stringify(envelope)}）。`);
  }
  return token;
}
