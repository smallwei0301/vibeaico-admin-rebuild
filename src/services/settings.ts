import { ApiError, adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import type { BusinessType } from '@/config/modes';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl, maskSecret,
  brandingSettingsSchema,
  type BrandingSettings, type LineSettings, type TenantSettings,
} from '@/config/tenant-settings';
import type { BusinessType } from '@/config/modes';
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
 * mock 分支「假倉庫」：/tenant/shop-design（Issue #7）三種業態各自的示範品牌內容
 * + 之後透過 saveTenantSettings({ branding }) 的異動，讓 mock 模式下的儲存也像
 * 真實後端一樣可讀回、可持久（比照 src/services/marketing.ts 的 getMockPushStore）。
 *
 * 延遲初始化：只在第一次被呼叫時建立（三套都建好），不在 module 頂層讀
 * MOCK_MODE，避免凍結到錯誤業態（CLAUDE.md 明列的陷阱）。
 */
let mockBrandingStore: Record<BusinessType, BrandingSettings> | null = null;

function getMockBrandingStore(): Record<BusinessType, BrandingSettings> {
  if (!mockBrandingStore) {
    mockBrandingStore = {
      LOCAL_SHOP: brandingSettingsSchema.parse({
        shopName: '示範美髮沙龍',
        announcement: '8/25–8/28 公休，造型預約請提前於 LINE 預訂，感謝支持！',
        aboutTitle: '關於我們',
        aboutContent:
          '成立於 2018 年的小型沙龍，每位設計師一次只服務一位客人，'
          + '從頭皮檢測到造型建議都慢慢聊。使用低敏染劑與植萃護理，敏感頭皮也能安心。',
        gallery: [
          { id: 'g_1', url: '', caption: '一樓洗髮區' },
          { id: 'g_2', url: '', caption: '設計師工作台' },
          { id: 'g_3', url: '', caption: '護理專區' },
        ],
        instagram: 'https://instagram.com/demo_salon',
        line: 'https://line.me/R/ti/p/@demo1234',
        googleMaps: 'https://maps.example.com/demo-salon',
        contactEmail: 'hello@demo-salon.example.com',
      }),
      GUIDE: brandingSettingsSchema.parse({
        shopName: '祕島嚮導工作室',
        announcement: '9 月賞鯨團次已開放報名，颱風季請留意出團前一日的最終確認通知。',
        aboutTitle: '關於祕島',
        aboutContent:
          '我們是一群在宜蘭、花蓮長大的在地嚮導，帶你走進觀光路線之外的祕境。'
          + '所有海域行程由持證船長領航，山域行程每 6 人配置 1 名教練，'
          + '全程投保高山嚮導責任險。人數不多，走得慢一點，看得多一點。',
        gallery: [
          { id: 'g_1', url: '', caption: '龜山島牛奶海' },
          { id: 'g_2', url: '', caption: '飛旋海豚出沒' },
          { id: 'g_3', url: '', caption: '砂婆礑溪谷' },
          { id: 'g_4', url: '', caption: '九份夜色' },
        ],
        themeColor: '#4361ee',
        instagram: 'https://instagram.com/midao_guide',
        line: 'https://line.me/R/ti/p/@midao888',
        googleMaps: 'https://maps.example.com/wushi-harbor',
        contactEmail: 'hi@midao.example.com',
      }),
      CLINIC: brandingSettingsSchema.parse({
        shopName: '示範診所',
        announcement:
          '流感疫苗開打中，公費對象請攜帶健保卡。中秋連假 9/25–9/27 休診，急診請至鄰近醫院。',
        aboutTitle: '門診資訊',
        aboutContent:
          '家庭醫學科、內科一般門診，附設健檢中心。'
          + '看診時間：週一至週五 09:00–12:00、14:00–17:30、18:30–21:00；週六上午診。'
          + '線上預約可查看即時看診號碼，減少現場等候。',
        gallery: [
          { id: 'g_1', url: '', caption: '候診區' },
          { id: 'g_2', url: '', caption: '健檢中心' },
        ],
        line: 'https://line.me/R/ti/p/@democlinic',
        googleMaps: 'https://maps.example.com/demo-clinic',
        contactEmail: 'service@demo-clinic.example.com',
      }),
    };
  }
  return mockBrandingStore;
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
      // #181 的 line 覆寫（richMenuBgImageUrl 等）與本 slice 的 branding
      // 是兩個互不相干的群組，兩邊都要保留。
      Object.assign(s.line, getMockLineSettingsOverrides());
      s.branding = getMockBrandingStore()[MOCK_MODE];
      return s;
    },
    () => request<TenantSettings>('/api/settings'),
  );

export const saveTenantSettings = (patch: Partial<TenantSettings>) =>
  adapt<TenantSettingsSaveResult | undefined>(
    () => {
      if (patch.branding) {
        getMockBrandingStore()[MOCK_MODE] = brandingSettingsSchema.parse(patch.branding);
      }
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
