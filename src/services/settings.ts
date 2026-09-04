import { ApiError, adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import type { BusinessType } from '@/config/modes';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl, maskSecret,
  type LineSettings, type TenantSettings,
} from '@/config/tenant-settings';

type BasicSettings = TenantSettings['basic'];
import type { FeatureSubscription } from '@/config/features';
import type { SetupStatus } from '@/lib/types';
import { MOCK_FEATURES, MOCK_MODE, MOCK_SETUP_STATUS, MOCK_TENANTS } from '@/mock';

const current = MOCK_TENANTS[0];

/**
 * mock 模式下的 line 設定覆寫（目前只有 richMenuBgImageUrl 需要真的「記住」）。
 * `getTenantSettings()` 的 mock 分支每次呼叫都用 DEFAULT_TENANT_SETTINGS() 重新算，
 * 本身沒有持久化，所以上傳背景圖後若不補一個 mock store，「重整後仍看得到」就無從驗證。
 * 依 CLAUDE.md 的規則延遲初始化：只在呼叫當下讀 MOCK_MODE，不在 module scope 求值。
 */
const mockLineSettingsStore = new Map<BusinessType, Partial<LineSettings>>();
const getMockLineSettingsOverrides = () => {
  if (!mockLineSettingsStore.has(MOCK_MODE)) mockLineSettingsStore.set(MOCK_MODE, {});
  return mockLineSettingsStore.get(MOCK_MODE)!;
};

/**
 * mock 模式下的 basic 設定覆寫（目前只有 staffTerm 需要真的「記住」）。
 * 與 getMockLineSettingsOverrides 同一套模式：延遲初始化，只在呼叫當下讀 MOCK_MODE。
 */
const mockBasicSettingsStore = new Map<BusinessType, Partial<BasicSettings>>();
const getMockBasicSettingsOverrides = () => {
  if (!mockBasicSettingsStore.has(MOCK_MODE)) mockBasicSettingsStore.set(MOCK_MODE, {});
  return mockBasicSettingsStore.get(MOCK_MODE)!;
};

export interface TenantSettingsSaveResult {
  welcomeCardImageCleanupPending?: boolean;
}

export interface UploadRichMenuBgImageResult {
  url: string;
}

/**
 * Rich Menu 背景圖上傳 —— 走**專用**端點 `/api/settings/line/rich-menu/upload-bg-image`，
 * 不能借用通用的 `uploadImage()`（`/api/upload`）：通用端點放行到 5MB，
 * 但 create 端點會把這張圖原樣上傳給 LINE，`/v2/bot/richmenu/{id}/content` 的平台上限是
 * 1MB —— 用通用端點上傳會讓超過 1MB 的圖片「上傳成功」，直到之後發布才失敗。
 * 這裡在上傳當下就用與後端相同的規則擋下，並把後端的真實錯誤訊息原樣往上拋。
 */
const RICH_MENU_BG_MAX_BYTES = 1024 * 1024; // 1MB，對齊 upload-bg-image route 的 LINE 平台限制
const RICH_MENU_BG_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png']);

export const uploadRichMenuBgImage = (file: File) =>
  adapt<UploadRichMenuBgImageResult>(
    () => {
      if (!RICH_MENU_BG_ALLOWED_TYPES.has(file.type)) {
        throw new ApiError('僅支援 JPEG / PNG 圖片', 'VALIDATION');
      }
      if (file.size > RICH_MENU_BG_MAX_BYTES) {
        throw new ApiError('圖片超過 1MB 上限（LINE Rich Menu 限制），請壓縮後再上傳', 'VALIDATION');
      }
      return { url: file.name };
    },
    () => {
      const form = new FormData();
      form.append('file', file);
      return request<UploadRichMenuBgImageResult>('/api/settings/line/rich-menu/upload-bg-image', {
        method: 'POST',
        body: form,
      });
    },
  );

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
      Object.assign(s.line, getMockLineSettingsOverrides());
      Object.assign(s.basic, getMockBasicSettingsOverrides());
      return s;
    },
    () => request<TenantSettings>('/api/settings'),
  );

export const saveTenantSettings = (patch: Partial<TenantSettings>) =>
  adapt<TenantSettingsSaveResult | undefined>(
    () => {
      if (patch.basic) Object.assign(getMockBasicSettingsOverrides(), patch.basic);
      return undefined;
    },
    () => request<TenantSettingsSaveResult>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  );

export const saveLineSettings = (patch: Partial<LineSettings>) =>
  adapt(
    () => { Object.assign(getMockLineSettingsOverrides(), patch); return undefined; },
    () => request<void>('/api/settings/line', { method: 'PUT', body: JSON.stringify(patch) }),
  );

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
