import { adaptAuth, request } from '@/lib/api';
import type { OAuthStatus, TenantSummary } from '@/lib/types';
import type { BusinessType } from '@/config/modes';
import { MOCK_TENANTS } from '@/mock';

/**
 * 認證 service —— 頁面（login/register/forgot-password/reset-password）與
 * Topbar 店家切換的唯一資料入口。mock 認證模式（AUTH_REAL=false）全部回 undefined／假資料，
 * 端點與 payload 形狀對照 03 分冊 §6.2 與 04 分冊 §A-0。
 */

/**
 * 平台 OAuth（LINE／Google）是否已設定憑證（#26）。骨架階段一律回 false——
 * mock 模式不該假裝平台已經設定了真的第三方登入。
 */
export const getOAuthStatus = () =>
  adaptAuth<OAuthStatus>(
    () => ({ google: { configured: false }, line: { configured: false } }),
    () => request<OAuthStatus>('/api/auth/oauth/status'),
  );

export const login = (email: string, password: string) =>
  adaptAuth(
    () => undefined,
    () => request<void>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  );

export const logout = () =>
  adaptAuth(
    () => undefined,
    () => request<void>('/api/auth/logout', { method: 'POST' }),
  );

export const sendVerificationCode = (email: string, purpose: 'REGISTER' | 'RESET_PASSWORD') =>
  adaptAuth(
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
  businessType?: BusinessType;
}) =>
  adaptAuth(
    () => undefined,
    () => request<void>('/api/auth/tenant/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );

export const forgotPassword = (email: string) =>
  adaptAuth(
    () => undefined,
    () => request<void>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  );

export const resetPassword = (payload: { email: string; code: string; newPassword: string }) =>
  adaptAuth(
    () => undefined,
    () => request<void>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );

export const changePassword = (payload: { currentPassword: string; newPassword: string }) =>
  adaptAuth(
    () => undefined,
    () => request<void>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );

export const myTenants = () =>
  adaptAuth<TenantSummary[]>(
    () => MOCK_TENANTS,
    () => request<TenantSummary[]>('/api/auth/my-tenants'),
  );

export const switchTenant = (tenantId: string) =>
  adaptAuth(
    () => undefined,
    () => request<void>('/api/auth/switch-tenant', {
      method: 'POST',
      body: JSON.stringify({ tenantId }),
    }),
  );
