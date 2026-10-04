/**
 * #754 — 認證邊界獨立於業務 mock。
 * 行為測試：resolveAuthMode、adaptAuth、middleware、performLogout、safeNextPath、shellDataSources。
 * 接線測試（讀原始碼，本專案無 DOM 測試環境）：Topbar 登出為 button、AppShell 不在 AUTH_REAL 讀 MOCK_*。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { resolveAuthMode } from '@/config/env';
import {
  initialShellIdentity, mockUserNameForMode, performLogout, performSwitchTenant, tenantContextNotice, shellContentReady, safeNextPath, shellDataSources,
} from '@/lib/auth-boundary';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const code = (relative: string) =>
  read(relative).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 以指定 env 重新載入模組（env.ts 在 import 當下求值）。undefined = 完全不設定。 */
async function withEnv<T>(
  env: { useMock?: string; authMode?: string },
  load: () => Promise<T>,
): Promise<T> {
  vi.resetModules();
  vi.unstubAllEnvs();
  delete process.env.NEXT_PUBLIC_USE_MOCK;
  delete process.env.NEXT_PUBLIC_AUTH_MODE;
  if (env.useMock !== undefined) vi.stubEnv('NEXT_PUBLIC_USE_MOCK', env.useMock);
  if (env.authMode !== undefined) vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', env.authMode);
  return load();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock('@supabase/ssr');
  vi.resetModules();
});

describe('resolveAuthMode 3×3 全組合', () => {
  const useMocks = [undefined, 'true', 'false'] as const;
  const authModes = [undefined, 'real', 'mock'] as const;
  const expected = (u: string | undefined, a: string | undefined) =>
    a === 'real' || a === 'mock' ? a : u === 'true' ? 'mock' : 'real';

  for (const u of useMocks) {
    for (const a of authModes) {
      it(`USE_MOCK=${String(u)} AUTH_MODE=${String(a)} → ${expected(u, a)}`, () => {
        expect(resolveAuthMode(u, a)).toBe(expected(u, a));
      });
    }
  }

  it('未設定（Production 現況）→ real（fail-closed）', () => {
    expect(resolveAuthMode(undefined, undefined)).toBe('real');
  });
  it('AUTH_MODE 非法值被忽略，改看 USE_MOCK', () => {
    expect(resolveAuthMode('true', 'bogus')).toBe('mock');
    expect(resolveAuthMode(undefined, 'bogus')).toBe('real');
  });
});

describe('AUTH_REAL（模組層級，依實際 process.env）', () => {
  it('不設定 NEXT_PUBLIC_USE_MOCK → AUTH_REAL=true，但業務 USE_MOCK 仍為 true', async () => {
    const env = await withEnv({}, () => import('@/config/env'));
    expect(env.AUTH_REAL).toBe(true);
    expect(env.USE_MOCK).toBe(true);
  });
  it('USE_MOCK=true → AUTH_REAL=false；USE_MOCK=false → AUTH_REAL=true', async () => {
    expect((await withEnv({ useMock: 'true' }, () => import('@/config/env'))).AUTH_REAL).toBe(false);
    expect((await withEnv({ useMock: 'false' }, () => import('@/config/env'))).AUTH_REAL).toBe(true);
  });
  it('USE_MOCK=true + AUTH_MODE=real → AUTH_REAL=true 且 USE_MOCK 不變', async () => {
    const env = await withEnv({ useMock: 'true', authMode: 'real' }, () => import('@/config/env'));
    expect(env.AUTH_REAL).toBe(true);
    expect(env.USE_MOCK).toBe(true);
  });
});

describe('adaptAuth', () => {
  it('AUTH_REAL 時只呼叫 real，不呼叫 mock、不 delay', async () => {
    vi.useFakeTimers();
    try {
      const { adaptAuth } = await withEnv({}, () => import('@/lib/api'));
      const mock = vi.fn(() => 'mock');
      const real = vi.fn(async () => 'real');
      // 不推進 fake timer：若有 delay 這個 await 永遠不會完成
      await expect(adaptAuth(mock, real)).resolves.toBe('real');
      expect(real).toHaveBeenCalledTimes(1);
      expect(mock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AUTH_REAL=false（USE_MOCK=true）時走 mock，不呼叫 real', async () => {
    const { adaptAuth } = await withEnv({ useMock: 'true' }, () => import('@/lib/api'));
    const mock = vi.fn(() => 'mock');
    const real = vi.fn(async () => 'real');
    await expect(adaptAuth(mock, real)).resolves.toBe('mock');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(real).not.toHaveBeenCalled();
  });

  it('services/auth login 在 AUTH_REAL 時真的 POST /api/auth/login（USE_MOCK 缺值亦然）', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { loggedIn: true } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { login } = await withEnv({}, () => import('@/services/auth'));
    await login('a@b.c', 'pw');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/api/auth/login');
  });

  it('services/auth.ts 不再使用業務 adapt()', () => {
    const src = code('src/services/auth.ts');
    expect(src).not.toMatch(/\badapt\(/);
    expect(src).not.toMatch(/\badapt</);
  });
});

describe('middleware', () => {
  const getUser = vi.fn();
  async function load(env: { useMock?: string; authMode?: string }) {
    getUser.mockReset();
    vi.resetModules();
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: () => ({ auth: { getUser } }),
    }));
    return withEnvKeepMocks(env, () => import('@/middleware'));
  }
  // withEnv 會 resetModules 而清掉 doMock 註冊；這裡只換 env，不 reset。
  async function withEnvKeepMocks<T>(env: { useMock?: string; authMode?: string }, loadFn: () => Promise<T>) {
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_USE_MOCK;
    delete process.env.NEXT_PUBLIC_AUTH_MODE;
    if (env.useMock !== undefined) vi.stubEnv('NEXT_PUBLIC_USE_MOCK', env.useMock);
    if (env.authMode !== undefined) vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', env.authMode);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    return loadFn();
  }
  const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

  it('real（USE_MOCK 未設定）：無 session → 導向 login 並保留 next', async () => {
    const { middleware } = await load({});
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(req('/tenant/dashboard'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/tenant/login');
    expect(loc.searchParams.get('next')).toBe('/tenant/dashboard');
  });

  it('real：有 session → 放行', async () => {
    const { middleware } = await load({});
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await middleware(req('/tenant/dashboard'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('real：四個公開 auth 路徑無 session 也放行，且不查 session', async () => {
    const { middleware } = await load({});
    for (const p of ['login', 'register', 'forgot-password', 'reset-password']) {
      const res = await middleware(req(`/tenant/${p}`));
      expect(res.headers.get('location')).toBeNull();
    }
    expect(getUser).not.toHaveBeenCalled();
  });

  it('mock（USE_MOCK=true）：無 session 也放行', async () => {
    const { middleware } = await load({ useMock: 'true' });
    const res = await middleware(req('/tenant/dashboard'));
    expect(res.headers.get('location')).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('real：next 保留 query string（/tenant/impersonate?guide=x）', async () => {
    const { middleware } = await load({});
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(req('/tenant/impersonate?guide=x'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/tenant/login');
    expect(loc.search).toBe('?next=%2Ftenant%2Fimpersonate%3Fguide%3Dx');
    expect(loc.searchParams.get('next')).toBe('/tenant/impersonate?guide=x');
    // login 頁導回時 safeNextPath 保留 query
    expect(safeNextPath(loc.searchParams.get('next'))).toBe('/tenant/impersonate?guide=x');
  });

  it('原始碼只用 AUTH_REAL，不再以 USE_MOCK 判斷', () => {
    const src = code('src/middleware.ts');
    expect(src).toMatch(/AUTH_REAL/);
    expect(src).not.toMatch(/\bUSE_MOCK\b/);
  });
});

describe('Topbar 登出', () => {
  const mk = (logout: () => Promise<unknown>) => {
    const calls = { replace: [] as string[], refresh: 0, errors: [] as string[] };
    return {
      calls,
      deps: {
        logout,
        replace: (h: string) => calls.replace.push(h),
        refresh: () => { calls.refresh += 1; },
        showError: (m: string) => calls.errors.push(m),
        fallbackMessage: '登出失敗',
      },
    };
  };

  it('成功：呼叫 logout、replace 到 login、refresh', async () => {
    const logout = vi.fn(async () => undefined);
    const { calls, deps } = mk(logout);
    await expect(performLogout(deps)).resolves.toBe(true);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(calls.replace).toEqual(['/tenant/login']);
    expect(calls.refresh).toBe(1);
    expect(calls.errors).toEqual([]);
  });

  it('失敗：不導向、不 refresh、toast 顯示 server message', async () => {
    const { calls, deps } = mk(async () => { throw new Error('伺服器忙碌'); });
    await expect(performLogout(deps)).resolves.toBe(false);
    expect(calls.replace).toEqual([]);
    expect(calls.refresh).toBe(0);
    expect(calls.errors).toEqual(['伺服器忙碌']);
  });

  it('失敗且無 message：用 fallback', async () => {
    const { calls, deps } = mk(async () => { throw 'x'; });
    await performLogout(deps);
    expect(calls.errors).toEqual(['登出失敗']);
  });

  it('接線：Topbar 登出是 <button> 呼叫 logout，不再是指向 login 的 Link', () => {
    const src = read('src/components/layout/Topbar.tsx');
    expect(src).not.toMatch(/<Link\s+href="\/tenant\/login"/);
    expect(src).toMatch(/performLogout\(/);
    expect(src).toMatch(/import \{ logout \} from '@\/services\/auth'/);
    expect(src).toMatch(/onClick=\{\(\) => \{ void handleLogout\(\); \}\}/);
    expect(src).toMatch(/common\.topbar\.logoutFailed/);
  });
});

describe('AppShell 資料來源', () => {
  it('shellDataSources：認證軸與業務軸互相獨立', () => {
    expect(shellDataSources(true, true)).toEqual({
      tenantContextFromApi: true, businessDataFromMock: true, showDemoDataNotice: true,
    });
    expect(shellDataSources(true, false)).toEqual({
      tenantContextFromApi: true, businessDataFromMock: false, showDemoDataNotice: false,
    });
    expect(shellDataSources(false, true)).toEqual({
      tenantContextFromApi: false, businessDataFromMock: true, showDemoDataNotice: false,
    });
    expect(shellDataSources(false, false).showDemoDataNotice).toBe(false);
  });

  it('接線：AppShell 以 AUTH_REAL 決定 tenant／user 來源，且示範提示用 i18n', () => {
    const src = code('src/components/layout/AppShell.tsx');
    expect(src).toMatch(/shellDataSources\(AUTH_REAL, USE_MOCK\)/);
    expect(src).toMatch(/SRC\.tenantContextFromApi \? remoteTenants : MOCK_TENANTS/);
    expect(src).toMatch(/SRC\.showDemoDataNotice/);
    expect(src).toMatch(/common\.topbar\.demoDataNotice/);
    // 不再直接以 USE_MOCK 判斷 tenant／user（USE_MOCK 只能出現在 shellDataSources 呼叫與 import）
    const uses = src.split('\n').filter((l) => /\bUSE_MOCK\b/.test(l) && !/AUTH_REAL, USE_MOCK/.test(l));
    expect(uses).toEqual([]);
  });

  const MOCK_T = [{ id: 'a' }, { id: 'b', current: true }];
  const MOCK_U = { name: '假使用者' };

  it('initialShellIdentity：real 不論 useMock 都不取 MOCK_*', () => {
    for (const useMock of [true, false]) {
      expect(initialShellIdentity(true, useMock, MOCK_T, MOCK_U)).toEqual({ tenantId: '', userName: null });
    }
  });

  it('initialShellIdentity：mock 認證取 current 店家與 MOCK_USER', () => {
    for (const useMock of [true, false]) {
      expect(initialShellIdentity(false, useMock, MOCK_T, MOCK_U)).toEqual({ tenantId: 'b', userName: '假使用者' });
    }
    expect(initialShellIdentity(false, true, [{ id: 'z' }], MOCK_U).tenantId).toBe('z');
  });

  it('mockUserNameForMode：real 回 null（不覆蓋），mock 回 MOCK_USER 名稱', () => {
    expect(mockUserNameForMode(true, MOCK_U)).toBeNull();
    expect(mockUserNameForMode(false, MOCK_U)).toBe('假使用者');
  });

  it('接線：AppShell 身分初值與業態切換覆蓋都經過純函式，不直接用 MOCK_USER／MOCK_TENANTS 初值', () => {
    const src = code('src/components/layout/AppShell.tsx');
    expect(src).toMatch(/initialShellIdentity\(AUTH_REAL, USE_MOCK, MOCK_TENANTS, MOCK_USER\)\.tenantId/);
    expect(src).toMatch(/initialShellIdentity\(AUTH_REAL, USE_MOCK, MOCK_TENANTS, MOCK_USER\)\.userName/);
    expect(src).toMatch(/mockUserNameForMode\(AUTH_REAL, MOCK_USER\)/);
    expect(src).not.toMatch(/setUserName\(MOCK_USER/);
    expect(src).not.toMatch(/useState\([^)]*MOCK_TENANTS/);
  });

  it('接線：my-tenants 載入失敗不吞錯，AUTH_REAL 時顯示 danger Alert（文案在 i18n）', () => {
    const src = code('src/components/layout/AppShell.tsx');
    expect(src).not.toMatch(/myTenants\(\)[\s\S]*?\.catch\(\(\) => \{\}\)/);
    expect(src).toMatch(/\.catch\(\(\) => setTenantsLoadFailed\(true\)\)/);
    expect(src).toMatch(/tenantContextNotice\(\{[\s\S]*?authReal: SRC\.tenantContextFromApi[\s\S]*?loadFailed: tenantsLoadFailed/);
    expect(src).toMatch(/tenantNotice === .empty.[\s\S]*?common\.topbar\.noTenants/);
    expect(src).toMatch(/performSwitchTenant\(/);
    expect(src).toMatch(/tone="danger"[\s\S]*?common\.topbar\.tenantsLoadFailed/);
    expect(read('src/i18n/zh-TW/common.ts')).toContain('tenantsLoadFailed:');
  });

  it('i18n：示範資料提示文案固定', () => {
    expect(read('src/i18n/zh-TW/common.ts')).toContain('目前頁面為示範資料，尚未連接正式資料');
  });
});

describe('safeNextPath（防 open redirect）', () => {
  it('站內相對路徑原樣通過（含 query）', () => {
    expect(safeNextPath('/tenant/orders?x=1')).toBe('/tenant/orders?x=1');
  });
  it.each([null, undefined, '', 'https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', 'tenant/x', '/a\nb'])(
    '拒絕 %s → dashboard',
    (v) => {
      expect(safeNextPath(v as string | null | undefined)).toBe('/tenant/dashboard');
    },
  );
  it('登入頁使用 safeNextPath', () => {
    expect(read('src/app/tenant/login/page.tsx')).toMatch(/router\.push\(safeNextPath\(next\)\)/);
  });
});

describe('POST /api/auth/logout（signOut 錯誤不得被吞）', () => {
  afterEach(() => { vi.doUnmock('@/server/supabase'); vi.doUnmock('next/headers'); vi.resetModules(); });
  const loadRoute = async (signOut: (opts?: unknown) => Promise<{ error: unknown }>) => {
    vi.resetModules();
    // handle() 對寫入請求會讀 cookie（代登入稽核）；單元環境無 request scope，給空 cookie
    vi.doMock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
    vi.doMock('@/server/supabase', () => ({ createServerSupabase: async () => ({ auth: { signOut } }) }));
    return (await import('@/app/api/auth/logout/route')).POST;
  };
  const call = (POST: (req: Request, ctx: any) => Promise<Response>) =>
    POST(new Request('http://localhost:3000/api/auth/logout', { method: 'POST' }), {});

  it('signOut 成功 → 200 loggedOut', async () => {
    const POST = await loadRoute(async () => ({ error: null }));
    const res = await call(POST);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { loggedOut: true } });
  });

  it("signOut 以 scope 'local' 呼叫（不得撤銷其他裝置 session）", async () => {
    const signOut = vi.fn(async (_opts?: unknown) => ({ error: null }));
    const POST = await loadRoute(signOut);
    await call(POST);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('signOut 回 error → 500 SYS_001，不回 loggedOut', async () => {
    const POST = await loadRoute(async () => ({ error: new Error('boom') }));
    const res = await call(POST);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('SYS_001');
    expect(body.data).toBeUndefined();
  });
});

describe('GET /api/auth/my-tenants（business_type 必須回傳，Codex P1）', () => {
  afterEach(() => { vi.doUnmock('@/server/tenant'); vi.doUnmock('next/headers'); vi.resetModules(); });
  const load = async (rows: unknown[]) => {
    vi.resetModules();
    vi.doMock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
    const select = vi.fn((_cols: string) => ({ eq: async () => ({ data: rows, error: null }) }));
    vi.doMock('@/server/tenant', () => ({
      requireTenant: async () => ({ tenantId: 't1', user: { id: 'u1' }, supabase: { from: () => ({ select }) } }),
    }));
    const { GET } = await import('@/app/api/auth/my-tenants/route');
    return { GET, select };
  };

  it('select 含 tenants.business_type，且回應帶 businessType（GUIDE 不被吞成預設）', async () => {
    const { GET, select } = await load([
      { tenant_id: 't1', role: 'OWNER', tenants: { shop_code: 'g', name: 'G', business_type: 'GUIDE' } },
    ]);
    const res = await (GET as any)(new Request('http://localhost:3000/api/auth/my-tenants'), {});
    const body = await res.json();
    expect(select.mock.calls[0][0]).toMatch(/tenants\([^)]*business_type[^)]*\)/);
    expect(body.data[0].businessType).toBe('GUIDE');
    expect(body.data[0].current).toBe(true);
  });

  it('接線：AppShell 的 businessType 來自 current 店家（remoteTenants）', () => {
    const src = code('src/components/layout/AppShell.tsx');
    expect(src).toMatch(/SRC\.tenantContextFromApi \? remoteTenants : MOCK_TENANTS/);
    expect(src).toMatch(/const businessType = current\.businessType \?\? 'LOCAL_SHOP'/);
  });
});

describe('#754 review N9：performSwitchTenant', () => {
  it('成功：reload，不顯示錯誤', async () => {
    const reload = vi.fn(); const showError = vi.fn();
    expect(await performSwitchTenant({ switchTenant: async () => ({}), reload, showError, fallbackMessage: 'fb' })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(showError).not.toHaveBeenCalled();
  });
  it('失敗：不 reload，優先顯示 server message', async () => {
    const reload = vi.fn(); const showError = vi.fn();
    const ok = await performSwitchTenant({ switchTenant: async () => { throw new Error('無權限'); }, reload, showError, fallbackMessage: 'fb' });
    expect(ok).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('無權限');
  });
  it('失敗且無 message：用 fallback', async () => {
    const showError = vi.fn();
    await performSwitchTenant({ switchTenant: async () => { throw new Error(''); }, reload: vi.fn(), showError, fallbackMessage: 'fb' });
    expect(showError).toHaveBeenCalledWith('fb');
  });
});

describe('#754 review N10：tenantContextNotice', () => {
  const base = { authReal: true, loadFailed: false, loaded: true, count: 0 };
  it('成功但空陣列 -> empty', () => expect(tenantContextNotice(base)).toBe('empty'));
  it('載入失敗 -> failed（與 empty 互斥）', () =>
    expect(tenantContextNotice({ ...base, loadFailed: true, loaded: false })).toBe('failed'));
  it('failed 優先於 empty', () => expect(tenantContextNotice({ ...base, loadFailed: true })).toBe('failed'));
  it('有店家 / 尚未載入 / mock 認證 -> null', () => {
    expect(tenantContextNotice({ ...base, count: 2 })).toBeNull();
    expect(tenantContextNotice({ ...base, loaded: false })).toBeNull();
    expect(tenantContextNotice({ ...base, authReal: false })).toBeNull();
  });
});

describe('shellContentReady — real 模式等店家清單 settled 才掛載頁面（避免 key={businessType} 整頁重掛）', () => {
  it('real：清單未載入完成前不可掛載 children', () => {
    expect(shellContentReady({ tenantContextFromApi: true, loaded: false, loadFailed: false })).toBe(false);
  });
  it('real：載入成功或失敗後即可掛載（失敗維持既有誠實提示與 LOCAL_SHOP fallback）', () => {
    expect(shellContentReady({ tenantContextFromApi: true, loaded: true, loadFailed: false })).toBe(true);
    expect(shellContentReady({ tenantContextFromApi: true, loaded: false, loadFailed: true })).toBe(true);
  });
  it('mock 認證：同步，立即掛載、不設 loading gate', () => {
    expect(shellContentReady({ tenantContextFromApi: false, loaded: false, loadFailed: false })).toBe(true);
  });
  it('接線（本專案無 DOM 測試環境，沿用原始碼斷言）：AppShell 以 contentReady 決定是否渲染 children，且 mock 路徑以 SRC.tenantContextFromApi 判斷', () => {
    const src = read('src/components/layout/AppShell.tsx');
    expect(src).toMatch(/shellContentReady\(\{\s*tenantContextFromApi: SRC\.tenantContextFromApi,\s*loaded: tenantsLoaded,\s*loadFailed: tenantsLoadFailed,/);
    expect(src).toMatch(/\{contentReady \? children : \(/);
    expect(src).toContain('data-testid="shell-tenants-loading"');
  });
});

describe('POST /api/auth/logout（代入期間登出一併結束代入）', () => {
  afterEach(() => {
    vi.doUnmock('@/server/supabase'); vi.doUnmock('next/headers');
    vi.doUnmock('@/server/platform-admin'); vi.doUnmock('@/server/tenant');
    vi.resetModules();
  });

  type Opts = {
    cookie?: string;
    user?: { id: string } | null;
    endImpersonation?: (sid: string, uid: string) => Promise<void>;
    signOut?: (opts?: unknown) => Promise<{ error: unknown }>;
  };
  const load = async (o: Opts = {}) => {
    vi.resetModules();
    const order: string[] = [];
    const set = vi.fn();
    const getUser = vi.fn(async () => ({ data: { user: o.user === undefined ? { id: 'admin-1' } : o.user } }));
    const signOut = vi.fn(async (opts?: unknown) => { order.push('signOut'); return (o.signOut ?? (async () => ({ error: null })))(opts); });
    const end = vi.fn(async (sid: string, uid: string) => { order.push('end'); return (o.endImpersonation ?? (async () => undefined))(sid, uid); });
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ get: (n: string) => (n === 'vibeai_impersonation' && o.cookie ? { value: o.cookie } : undefined), getAll: () => [], set }),
    }));
    vi.doMock('@/server/supabase', () => ({ createServerSupabase: async () => ({ auth: { signOut, getUser } }) }));
    // handle() 在 cookie 存在時會做代入稽核：讓它解析不到有效代入，直接放行 handler
    vi.doMock('@/server/tenant', () => ({ requireUser: async () => ({ user: { id: 'admin-1' } }) }));
    vi.doMock('@/server/platform-admin', () => ({
      IMPERSONATION_COOKIE: 'vibeai_impersonation',
      endImpersonation: end,
      loadActiveImpersonation: async () => null,
      recordImpersonatedAction: async () => 'a1',
      finishImpersonatedAction: async () => undefined,
    }));
    const POST = (await import('@/app/api/auth/logout/route')).POST;
    const res = await POST(new Request('http://localhost:3000/api/auth/logout', { method: 'POST' }), {});
    return { res, set, getUser, signOut, end, order };
  };

  it('有 cookie＋有 user → endImpersonation(sessionId, user.id)、cookie 清除、signOut local、200', async () => {
    const r = await load({ cookie: 'sess-1' });
    expect(r.res.status).toBe(200);
    expect(r.end).toHaveBeenCalledTimes(1);
    expect(r.end).toHaveBeenCalledWith('sess-1', 'admin-1');
    expect(r.set).toHaveBeenCalledWith('vibeai_impersonation', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    expect(r.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(r.order).toEqual(['end', 'signOut']);
  });

  it('沒有 cookie → 不呼叫 getUser／endImpersonation，行為同舊版，200', async () => {
    const r = await load({});
    expect(r.res.status).toBe(200);
    expect(r.getUser).not.toHaveBeenCalled();
    expect(r.end).not.toHaveBeenCalled();
    expect(r.set).not.toHaveBeenCalled();
    expect(r.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('endImpersonation 丟錯 → 500，signOut 不得被呼叫（可重試，不謊報已登出）', async () => {
    const r = await load({ cookie: 'sess-1', endImpersonation: async () => { throw new Error('db down'); } });
    expect(r.res.status).toBe(500);
    expect(r.signOut).not.toHaveBeenCalled();
    expect((await r.res.json()).data).toBeUndefined();
  });

  it('signOut 回 error → 500，但代入已結束、cookie 已清', async () => {
    const r = await load({ cookie: 'sess-1', signOut: async () => ({ error: new Error('boom') }) });
    expect(r.res.status).toBe(500);
    expect(r.end).toHaveBeenCalledWith('sess-1', 'admin-1');
    expect(r.set).toHaveBeenCalledWith('vibeai_impersonation', '', expect.objectContaining({ maxAge: 0 }));
  });

  it('有 cookie 但已無 user → 不呼叫 endImpersonation，仍清 cookie 並 signOut', async () => {
    const r = await load({ cookie: 'sess-1', user: null });
    expect(r.res.status).toBe(200);
    expect(r.end).not.toHaveBeenCalled();
    expect(r.set).toHaveBeenCalledWith('vibeai_impersonation', '', expect.objectContaining({ maxAge: 0 }));
  });
});
