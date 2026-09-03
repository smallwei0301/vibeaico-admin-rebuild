import { adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl, maskSecret,
  type LineSettings, type TenantSettings,
} from '@/config/tenant-settings';
import type { FeatureSubscription } from '@/config/features';
import type { SetupStatus } from '@/lib/types';
import { MOCK_FEATURES, MOCK_SETUP_STATUS, MOCK_TENANTS } from '@/mock';

const current = MOCK_TENANTS[0];

export interface TenantSettingsSaveResult {
  welcomeCardImageCleanupPending?: boolean;
}

/**
 * 讀租戶設定。
 * 🔐 line.channelSecret / line.channelAccessToken 一律以遮罩形式回傳，
 *    前端只在使用者「重新輸入」時才送出新值；沒動過就送空字串代表不變更。
 */
export const getTenantSettings = () =>
  adapt<TenantSettings>(
    () => {
      const s = DEFAULT_TENANT_SETTINGS(current.shopCode, current.name);
      s.line.channelId = '2005459361';
      s.line.channelSecret = maskSecret('ab2d0a47249da385b1dfda6d5adcb865');
      s.line.channelAccessToken = maskSecret('G6e//SU+Bv9k00q2cidcTOKENSAMPLEabcdef1234567890');
      s.line.webhookUrl = buildWebhookUrl(APP_URL, current.shopCode);
      s.line.lineBasicId = '@demo1234';
      return s;
    },
    () => request<TenantSettings>('/api/settings'),
  );

export const saveTenantSettings = (patch: Partial<TenantSettings>) =>
  adapt<TenantSettingsSaveResult | undefined>(
    () => undefined,
    () => request<TenantSettingsSaveResult>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  );

export const saveLineSettings = (patch: Partial<LineSettings>) =>
  adapt(() => undefined, () => request<void>('/api/settings/line', { method: 'PUT', body: JSON.stringify(patch) }));

export const testLineConnection = () =>
  adapt<{ ok: boolean; message: string }>(
    () => ({ ok: true, message: '連線正常' }),
    () => request<{ ok: boolean; message: string }>('/api/settings/line/test', { method: 'POST' }),
  );

export const verifyLineSetup = () =>
  adapt<{ checks: { key: string; pass: boolean; message: string }[] }>(
    () => ({
      checks: [
        { key: 'TOKEN', pass: true, message: 'Channel Access Token 有效' },
        { key: 'WEBHOOK', pass: true, message: 'Webhook URL 已設定且可連線' },
        { key: 'AUTO_REPLY', pass: false, message: 'LINE 官方帳號的「自動回應訊息」仍為開啟，會攔截 Bot 訊息' },
        { key: 'RICH_MENU', pass: true, message: 'Rich Menu 已發布' },
        { key: 'QUOTA', pass: true, message: '本月推播額度尚有 68 則' },
      ],
    }),
    () => request('/api/settings/line/verify', { method: 'POST' }),
  );

export const getSetupStatus = () =>
  adapt<SetupStatus>(() => MOCK_SETUP_STATUS, () => request<SetupStatus>('/api/settings/setup-status'));

export const listFeatures = () =>
  adapt<FeatureSubscription[]>(() => MOCK_FEATURES, () => request<FeatureSubscription[]>('/api/feature-store'));

/* ---- 功能商店訂閱動作（09 分冊 §3；全部 ⚙OWNER）----
 * mock 分支一律模擬成功（回 undefined/空物件），頁面照舊只動本地 state；
 * real 分支的 409 POINTS_001（點數不足）由頁面 catch 後開既有的儲值 modal。 */

export interface FeatureRestoreResult {
  restoredCoupons?: number;
  restoredProducts?: number;
  restoreSideEffectFailed?: boolean;
}

export const applyFeature = (code: string, months: number) =>
  adapt<FeatureRestoreResult | undefined>(
    () => undefined,
    () => request<FeatureRestoreResult>(`/api/feature-store/${code}/apply`, {
      method: 'POST',
      body: JSON.stringify({ months }),
    }),
  );

export const cancelFeature = (code: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/feature-store/${code}/cancel`, { method: 'POST' }),
  );

export const restoreFeature = (code: string) =>
  adapt<FeatureRestoreResult | undefined>(
    () => undefined,
    () => request<FeatureRestoreResult>(`/api/feature-store/${code}/restore`, { method: 'POST' }),
  );

export const applyFeatureBundle = (key: 'LITE' | 'PRO', months: number) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/feature-store/bundle/${key}/apply`, {
      method: 'POST',
      body: JSON.stringify({ months }),
    }),
  );

export const cancelFeatureBundle = (key: 'LITE' | 'PRO') =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/feature-store/bundle/${key}/cancel`, { method: 'POST' }),
  );
