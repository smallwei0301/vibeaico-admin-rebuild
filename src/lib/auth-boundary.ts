/**
 * 認證邊界的純函式（#754）— 不碰 env、網路與 DOM，方便單元測試。
 * 元件把 AUTH_REAL／USE_MOCK 傳進來，這裡只負責「哪些資料該來自哪裡」的判斷。
 */

export const LOGIN_PATH = '/tenant/login';
export const DASHBOARD_PATH = '/tenant/dashboard';

/**
 * AppShell 的資料來源判斷。認證／租戶 context（使用者、店家清單、目前店家、切換店家）
 * 只看 authReal；業務資料（側欄徽章、開店進度）只看 useMock。兩者互不影響。
 */
export function shellDataSources(authReal: boolean, useMock: boolean) {
  return {
    /** 使用者、店家清單、目前店家、切換店家：true = 走 /api/auth/*，絕不讀 MOCK_TENANTS／MOCK_USER */
    tenantContextFromApi: authReal,
    /** 側欄徽章、開店進度：true = 走 MOCK_*；false = 走真端點 */
    businessDataFromMock: useMock,
    /** 真登入 + 假業務資料：必須誠實提示「目前頁面為示範資料」 */
    showDemoDataNotice: authReal && useMock,
  };
}

/**
 * AppShell 身分欄位（目前店家 id、使用者名稱）的初值。
 * authReal 時一律為「尚未知道」（空字串／null），絕不取 mock 資料；只有 mock 認證才用 MOCK_*。
 * useMock 參數保留給呼叫端對齊簽名，身分初值只看 authReal（認證軸與業務軸互相獨立）。
 */
export function initialShellIdentity(
  authReal: boolean,
  _useMock: boolean,
  mockTenants: ReadonlyArray<{ id: string; current?: boolean }>,
  mockUser: { name: string },
): { tenantId: string; userName: string | null } {
  if (authReal) return { tenantId: '', userName: null };
  return {
    tenantId: (mockTenants.find((t) => t.current) ?? mockTenants[0])?.id ?? '',
    userName: mockUser.name,
  };
}

/** 業務資料切換 mock 業態時，使用者名稱是否可被 MOCK_USER 覆蓋：只有 mock 認證才可，real 時回 null＝不覆蓋。 */
export function mockUserNameForMode(authReal: boolean, mockUser: { name: string }): string | null {
  return authReal ? null : mockUser.name;
}

/**
 * `?next=` 只允許站內相對路徑（防 open redirect）。
 * 必須以單一「/」開頭；拒絕 `//host`、`/\host`、含 scheme、含控制字元的值。
 * 不合法一律回 fallback。
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = DASHBOARD_PATH): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  return raw;
}

/**
 * Topbar 登出流程：真的呼叫 logout()，成功才導向登入頁並 refresh；
 * 失敗只顯示錯誤，不導向（不假裝已登出）。
 */
export async function performLogout(deps: {
  logout: () => Promise<unknown>;
  replace: (href: string) => void;
  refresh: () => void;
  showError: (message: string) => void;
  fallbackMessage: string;
}): Promise<boolean> {
  try {
    await deps.logout();
  } catch (err) {
    deps.showError(err instanceof Error && err.message ? err.message : deps.fallbackMessage);
    return false;
  }
  deps.replace(LOGIN_PATH);
  deps.refresh();
  return true;
}

/**
 * AUTH_REAL 切換店家：真的呼叫 switchTenant()，成功才 reload；
 * 失敗只顯示錯誤（優先 server message，否則 fallback），不 reload、維持目前店家。
 */
export async function performSwitchTenant(deps: {
  switchTenant: () => Promise<unknown>;
  reload: () => void;
  showError: (message: string) => void;
  fallbackMessage: string;
}): Promise<boolean> {
  try {
    await deps.switchTenant();
  } catch (err) {
    deps.showError(err instanceof Error && err.message ? err.message : deps.fallbackMessage);
    return false;
  }
  deps.reload();
  return true;
}

/**
 * AUTH_REAL 店家清單狀態提示：載入失敗 -> 'failed'；載入成功但 0 間 -> 'empty'；其餘 null。
 * 兩者互斥（failed 優先）；mock 認證永不提示。
 */
export function tenantContextNotice(state: {
  authReal: boolean;
  loadFailed: boolean;
  loaded: boolean;
  count: number;
}): 'failed' | 'empty' | null {
  if (!state.authReal) return null;
  if (state.loadFailed) return 'failed';
  if (state.loaded && state.count === 0) return 'empty';
  return null;
}
