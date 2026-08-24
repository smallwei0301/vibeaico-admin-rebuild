import { adapt, request } from '@/lib/api';
import type { TenantSummary } from '@/lib/types';
import type { BusinessType } from '@/config/modes';
import { MOCK_TENANTS } from '@/mock';

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
