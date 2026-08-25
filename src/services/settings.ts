import { ApiError, adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl, aiSettingsSchema,
  type AiSettings, type LineSettings, type TenantSettings,
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

/**
 * 儲存 Flex 主選單（POST /api/settings/line/flex-menu，06 分冊 §6 / issue #6）。
 *
 * ⚠️ 這支函式在此之前**不存在**——rich-menu-design 頁 Flex 分頁的「發布」只是
 * `toast.show(t.flex.saved)`，卡片、開關、fallback 全都只活在瀏覽器記憶體裡，
 * 而店家看到的是「主選單已儲存！顧客下次開啟聊天時會看到新樣式」（14 分冊
 * §1 根因 A 的典型：成功訊息宣稱了一件沒發生的事）。
 *
 * 端點的合併語意是 partial patch（只寫這次帶了的鍵），所以呼叫端可以只送
 * `{ flexCards: [] }`（清除已發布）或整包（發布）。`flexCards` 超過
 * `MAX_FLEX_CARDS` 會被端點的 zod 擋成 400，錯誤原文由 ApiError 帶回頁面。
 */
export const saveFlexMenu = (
  patch: Partial<Pick<LineSettings,
    'flexMenuEnabled' | 'flexMenuFallback' | 'flexCards' |
    'flexHeaderColor' | 'flexHeaderTitle' | 'flexHeaderSubtitle' | 'flexShowTip'>>,
) =>
  adapt<void>(
    () => undefined,
    () => request<void>('/api/settings/line/flex-menu', {
      method: 'POST',
      body: JSON.stringify(patch),
    }),
  );

/** 刪除目前已發布的 Rich Menu（DELETE /api/settings/line/rich-menu）。 */
export const deleteRichMenu = () =>
  adapt<void>(
    () => { throw demoLineUnavailable(); },
    () => request<void>('/api/settings/line/rich-menu', { method: 'DELETE' }),
  );

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
  /**
   * `restoreSideEffectFailed` 時，平台端待處理紀錄（`bug_reports`，reporter='system'）
   * **是否真的寫進去了**（issue #28 第 ⑭ 筆的後續；鐵則 3：只新增 optional 欄位）。
   *
   * 為什麼需要這個旗標：這句文案原本結尾寫「（已通知平台處理）」，而當時
   * `restore/route.ts` 的失敗分支只有一行 `console.error`——**零通知**。commit
   * `9829f12` 補上了真正的 `bug_reports` 寫入，但那個寫入自己也可能失敗（route
   * 內 try/catch 吞掉），所以在沒有旗標可據實分岔之前，畫面仍然不能宣稱「已通知
   * 平台」——那還是拿一個沒量到的狀態當已知，跟原本那句同一種錯。
   *
   * 語意刻意分成三態，**`undefined` 不等於 `false` 的相反面**：
   * - `true`：insert 真的成功（route 拿到 `error === null`）→ 畫面才可以說已自動記錄
   * - `false`：insert 失敗（拋錯或回 error）→ 畫面必須說請聯絡平台客服
   * - `undefined`：mock 分支、或舊版後端沒回這個欄位＝**我們不知道**
   *   → 頁面一律當作不能宣稱（`=== true` 才走「已記錄」那句）
   */
  platformNotified?: boolean;
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
