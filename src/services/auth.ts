import { adapt, request } from '@/lib/api';
import type { TenantSummary } from '@/lib/types';
import type { BusinessType } from '@/config/modes';
import { MOCK_TENANTS, MOCK_USER } from '@/mock';

/**
 * 認證 service —— 頁面（login/register/forgot-password/reset-password）與
 * Topbar 店家切換的唯一資料入口。骨架階段（mock）全部回 undefined／假資料，
 * 端點與 payload 形狀對照 03 分冊 §6.2 與 04 分冊 §A-0。
 */

export const login = (email: string, password: string) =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  );

export const logout = () =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/logout', { method: 'POST' }),
  );

export const sendVerificationCode = (email: string, purpose: 'REGISTER' | 'RESET_PASSWORD') =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/send-verification-code', {
      method: 'POST',
      body: JSON.stringify({ email, purpose }),
    }),
  );

export const registerTenant = (payload: {
  email: string;
  code: string;
  password: string;
  tenantName: string;
  shopCode: string;
  /** 業態模式（13 分冊）；後端寫進 tenants.business_type，決定後台選單與名詞 */
  businessType?: BusinessType;
}) =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/tenant/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );

export const forgotPassword = (email: string) =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  );

export const resetPassword = (payload: { email: string; code: string; newPassword: string }) =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );

export const changePassword = (payload: { currentPassword: string; newPassword: string }) =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );

/**
 * 目前登入者（GET /api/auth/me，04 分冊 §A-0）— issue #34。
 *
 * ⚠️ **後端沒有「姓名」這個欄位。** `/api/auth/me` 回的是
 * `{email, tenantId, tenantName, shopCode, role}`，`auth.users` 也沒有存
 * display name（註冊只收 email／驗證碼／密碼／店名／店代碼／業態，
 * `admin.auth.admin.createUser()` 也沒帶 user_metadata，見
 * `src/app/api/auth/tenant/register/route.ts:13-34`）。所以 real 模式的顯示名稱
 * **就是帳號 email**，不是從 email 猜一個像人名的字串出來——那會是
 * 「貌似合理的佔位值」，正是 issue #34 在清的東西。
 * 骨架模式仍用 MOCK_USER.name（demo 要有個像樣的名字）。
 */
export type CurrentUser = {
  /** Topbar 顯示用；real＝email，mock＝MOCK_USER.name */
  displayName: string;
  email: string;
};

export const currentUser = () =>
  adapt<CurrentUser>(
    () => ({ displayName: MOCK_USER.name, email: MOCK_USER.email }),
    async () => {
      const me = await request<{ email: string }>('/api/auth/me');
      return { displayName: me.email, email: me.email };
    },
  );

export const myTenants = () =>
  adapt<TenantSummary[]>(
    () => MOCK_TENANTS,
    () => request<TenantSummary[]>('/api/auth/my-tenants'),
  );

export const switchTenant = (tenantId: string) =>
  adapt(
    () => undefined,
    () => request<void>('/api/auth/switch-tenant', {
      method: 'POST',
      body: JSON.stringify({ tenantId }),
    }),
  );
