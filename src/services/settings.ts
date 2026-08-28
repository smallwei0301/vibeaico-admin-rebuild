import { adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl, maskSecret, aiSettingsSchema,
  type AiSettings, type LineSettings, type TenantSettings,
} from '@/config/tenant-settings';
import type { FeatureSubscription } from '@/config/features';
import type { SetupStatus } from '@/lib/types';
import { MOCK_FEATURES, MOCK_SETUP_STATUS, MOCK_TENANTS } from '@/mock';

const current = MOCK_TENANTS[0];

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
  adapt(() => undefined, () => request<void>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }));

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

/* ------------------------------------------------------------- AI 客服設定
 * `GET/PUT /api/ai-settings`（09 分冊 §7.1）—— /tenant/ai-settings 頁專用。
 *
 * ⚠️ 為什麼這裡非有不可（issue #27 ①）：ai-settings 頁原本呼叫的是
 * `saveLineSettings({ autoReplyEnabled, defaultReply: prompt })`，也就是把
 * **AI 提示詞**寫進 `tenant_settings.line.defaultReply`。那個欄位是 webhook
 * 分支 ⑥ 的「沒有 AI 時的靜態罐頭回覆」，於是店家寫給 AI 的指令
 * （「你是一間美髮沙龍的客服…」）被逐字推播給每一位傳訊息來的顧客，
 * 畫面卻顯示「AI 客服設定已儲存（已啟用）」。同時 webhook 分支 ⑤ 讀的
 * `tenant_settings.ai.enabled` 永遠停在 zod 預設的 false ——「已啟用」是假的。
 *
 * 14 分冊 §8.1 的裁決是**分家**：
 *   - `line.autoReplyEnabled` / `line.defaultReply` 只由 line-settings 頁寫
 *   - `ai.*` 只由 ai-settings 頁寫（就是這兩支函式）
 * 兩頁從此不再搶同一組欄位。
 */

export const getAiSettings = () =>
  adapt<AiSettings>(
    // 示範分支：沒有任何 AI 訂閱、沒有 ANTHROPIC_API_KEY，據實回 schema 預設值
    // （enabled=false）。不可為了畫面好看回 true —— 那又是一個捏造的已知。
    () => aiSettingsSchema.parse({}),
    () => request<AiSettings>('/api/ai-settings'),
  );

/**
 * 寫回整包 AI 設定。
 *
 * 端點契約是**整包覆蓋**（09 §7.1：`body = AiSettings`，`aiSettingsSchema.parse`
 * 之後直接 upsert 進 `ai` jsonb），所以呼叫端必須送**完整**物件。頁面的作法是
 * 載入時把 GET 回來的整包留著，儲存時只覆寫自己編輯的欄位再送回去 —— 否則
 * `faq` / `handoffMessage` 會被 zod 的 default 洗成空值（頁面上沒有那兩個欄位，
 * 使用者不會知道自己弄丟了什麼）。
 */
export const saveAiSettings = (value: AiSettings) =>
  adapt<void>(
    () => undefined,
    () => request<void>('/api/ai-settings', { method: 'PUT', body: JSON.stringify(value) }),
  );

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
