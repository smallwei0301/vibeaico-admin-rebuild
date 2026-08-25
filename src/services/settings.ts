import { ApiError, adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl,
  type LineSettings, type TenantSettings,
} from '@/config/tenant-settings';
import type { FeatureSubscription } from '@/config/features';
import type { SetupStatus } from '@/lib/types';
import { MOCK_FEATURES, MOCK_SETUP_STATUS, MOCK_MODE, MOCK_TENANTS } from '@/mock';

/**
 * 目前這一間示範店家。
 *
 * ⚠️ 不可以寫成模組層的 `const current = MOCK_TENANTS[0]`（本檔案原本就是這樣寫的，
 * 是 CLAUDE.md「mode-aware mock data」明文警告過的陷阱）：模組求值發生在 AppShell
 * 呼叫 `applyMockMode()` 之前，`MOCK_TENANTS[0]` 又固定是 GUIDE 的祕島嚮導工作室，
 * 於是使用者切到示範美髮沙龍／示範診所時，設定頁仍然顯示嚮導工作室的店名與
 * shopCode，連 webhook URL 都是別家的。必須在 callback 內、依當下的 `MOCK_MODE`
 * 重新解析。
 */
const demoTenant = () => MOCK_TENANTS.find((t) => t.businessType === MOCK_MODE) ?? MOCK_TENANTS[0];

/**
 * 示範店家碰到「必須真的打 LINE API 才能完成」的動作時，一律丟這個錯。
 *
 * 界線在哪裡：示範分支回**示範資料**（預約、商品、客戶……）是合理的，那本來就是
 * 一組拿來看畫面長相的資料集；但只要是在**宣告第三方系統的狀態**——LINE 已連動、
 * 檢查通過、Rich Menu 已發布上去——就不能編，因為那間示範店家確確實實沒有任何
 * LINE 官方帳號，編出來的成功訊息會被使用者當成真的。
 */
const demoLineUnavailable = () =>
  new ApiError('示範店家沒有連動 LINE 官方帳號，這個動作不會真的送到 LINE', 'DEMO_NO_LINE', 400);

/**
 * 讀租戶設定。
 * 🔐 line.channelSecret / line.channelAccessToken 一律以遮罩形式回傳，
 *    前端只在使用者「重新輸入」時才送出新值；沒動過就送空字串代表不變更。
 *
 * ⚠️ 示範分支**不得**填入看起來像真的 Channel ID／Token。原本這裡硬塞
 * `channelId = '2005459361'` 與兩個 maskSecret(...)，畫面因此顯示「已連動」，
 * 但那間示範店家從來沒有任何 LINE 官方帳號——正是 00 分冊鐵則 12／CLAUDE.md
 * 「絕不捏造已知狀態」禁止的事。示範店家的 LINE 就是「尚未設定」，據實呈現即可。
 */
export const getTenantSettings = () =>
  adapt<TenantSettings>(
    () => {
      const current = demoTenant();
      const s = DEFAULT_TENANT_SETTINGS(current.shopCode, current.name);
      // webhook URL 由 shopCode 推出來，是真的可以算出來的值，保留。
      s.line.webhookUrl = buildWebhookUrl(APP_URL, current.shopCode);
      return s;
    },
    () => request<TenantSettings>('/api/settings'),
  );

export const saveTenantSettings = (patch: Partial<TenantSettings>) =>
  adapt(() => undefined, () => request<void>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }));

export const saveLineSettings = (patch: Partial<LineSettings>) =>
  adapt(() => undefined, () => request<void>('/api/settings/line', { method: 'PUT', body: JSON.stringify(patch) }));

/**
 * 解除 LINE 連動（POST /api/settings/line/disconnect，06 分冊 §6）。
 *
 * ⚠️ 不可以用 `saveLineSettings({ channelSecret: '', channelAccessToken: '' })` 代替：
 * 依 04 分冊 §A-1 / 鐵則 6，secret 欄位送空字串的語意是「維持原值」，那樣寫
 * token 根本不會被清掉，webhook 照常運作，畫面卻顯示「已解除綁定」——正是
 * 00 分冊鐵則 12 禁止的假成功。必須打專用端點，由後端清空兩個 `*_enc`
 * 與 line jsonb 的 channelId。
 */
export const disconnectLine = () =>
  adapt<void>(
    () => undefined,
    () => request<void>('/api/settings/line/disconnect', { method: 'POST' }),
  );

/**
 * 測試 LINE 連線。示範分支不能回「連線正常」——沒有 token 就沒有連線可測，
 * 回一個假的成功等於教使用者相信一個不存在的狀態。
 */
export const testLineConnection = () =>
  adapt<{ ok: boolean; message: string }>(
    () => ({ ok: false, message: '示範店家沒有真實的 LINE 官方帳號，無法測試連線' }),
    () => request<{ ok: boolean; message: string }>('/api/settings/line/test', { method: 'POST' }),
  );

/**
 * LINE 設定檢查報告。
 *
 * ⚠️ 示範分支原本回傳一組編造的檢查結果：四項綠燈、外加一項寫死的
 * 「自動回應訊息仍為開啟」紅字。那五列沒有任何一列真的檢查過東西，其中那一列
 * 紅字更是本專案「假錯誤」事件的源頭（見 CLAUDE.md）。示範店家根本沒有 LINE
 * 頻道可查，正確的呈現是五項全部 WARN／尚未設定，而不是編出綠燈與紅燈。
 * 真實分支才會實際打 LINE API（含 `GET /v2/bot/info` 的 chatMode 判讀）。
 */
export const verifyLineSetup = () =>
  adapt<{ checks: { key: string; pass: boolean; message: string; severity?: 'FAIL' | 'WARN' }[] }>(
    () => ({
      checks: (['TOKEN', 'WEBHOOK', 'AUTO_REPLY', 'RICH_MENU', 'QUOTA'] as const).map((key) => ({
        key,
        pass: false,
        severity: 'WARN' as const,
        message: '示範店家尚未設定 LINE 官方帳號，這一項沒有東西可以檢查',
      })),
    }),
    () => request('/api/settings/line/verify', { method: 'POST' }),
  );

export const getSetupStatus = () =>
  adapt<SetupStatus>(() => MOCK_SETUP_STATUS, () => request<SetupStatus>('/api/settings/setup-status'));

/**
 * 建立並發布 Rich Menu（POST /api/settings/line/rich-menu/create）。
 * 骨架模式下模擬成功；真實模式失敗時讓 ApiError 往上拋，呼叫端用真正的錯誤訊息
 * 顯示 toast——不可以像先前的頁面本地模擬那樣，不管成不成功都顯示「已發布」。
 */
export const createRichMenu = (theme: string) =>
  adapt<{ richMenuId: string }>(
    () => { throw demoLineUnavailable(); },
    () => request<{ richMenuId: string }>('/api/settings/line/rich-menu/create', {
      method: 'POST',
      body: JSON.stringify({ theme }),
    }),
  );

/** 刪除目前已發布的 Rich Menu（DELETE /api/settings/line/rich-menu）。 */
export const deleteRichMenu = () =>
  adapt<void>(
    () => { throw demoLineUnavailable(); },
    () => request<void>('/api/settings/line/rich-menu', { method: 'DELETE' }),
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
