import { ApiError, adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl, aiSettingsSchema, brandingSettingsSchema,
  type AiSettings, type BrandingSettings, type LineSettings, type TenantSettings,
} from '@/config/tenant-settings';
import type { FeatureSubscription } from '@/config/features';
import type { BusinessType } from '@/config/modes';
import type {
  BindableLineUser, OwnerNotifyRecipient, OwnerNotifyState, SetupStatus,
} from '@/lib/types';
import type { RichMenuCustomPublishedConfig } from '@/lib/rich-menu-published-config';
import { MOCK_FEATURES, MOCK_SETUP_STATUS, MOCK_MODE, MOCK_TENANTS, byMode } from '@/mock';

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


/* --------------------------------------------------- 公開頁外觀（branding）
 * `tenant_settings.branding`（migration 0021）——/tenant/shop-design 頁讀寫。
 *
 * ⚠️ 示範內容為什麼放在這裡而不是頁面裡：接線後頁面的初始值一律來自
 * `getTenantSettings().branding`，沒有第二條路徑。示範店家的三份公開頁內容
 * 因此得由 mock 分支供應（同 chat 服務的 byMode 對話資料）；留在頁面裡的話，
 * 真實模式下新開的店會看到「示範美髮沙龍」的文案被當成自己的設定。
 */

const DEMO_BRANDING_BY_MODE: Record<BusinessType, Partial<BrandingSettings>> = {
  LOCAL_SHOP: {
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
  },
  GUIDE: {
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
  },
  CLINIC: {
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
  },
};

/** ⚠️ 必須在 callback 內求值：模組層取 byMode() 會凍在 applyMockMode() 之前的模式 */
const demoBranding = (fallbackName: string): BrandingSettings => {
  const preset = byMode(DEMO_BRANDING_BY_MODE);
  return brandingSettingsSchema.parse({ shopName: fallbackName, ...preset });
};

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
      s.branding = demoBranding(current.name);
      return s;
    },
    () => request<TenantSettings>('/api/settings'),
  );

/**
 * 存營業／逐日營業時間之後，端點回報的實際影響（issue #33 ②）。
 * `null` = 這次的 patch 沒有 business 群組，或是示範模式——**沒有數字可報**，
 * 頁面就不顯示那幾句「已建立 N 筆／偵測到 N 筆」。
 */
export type BusinessHoursImpact = {
  perDayMode: boolean;
  /** 這次實際建立的自動封鎖筆數（全刪重建後的總數） */
  autoBlockCreated: number;
  /** 落在新的非營業時段的既有預約筆數 */
  conflictBookingCount: number;
  /** 店家手動建立的每週封鎖筆數（一律保留） */
  manualWeeklyBlockCount: number;
};

export const saveTenantSettings = (patch: Partial<TenantSettings>) =>
  adapt<BusinessHoursImpact | null>(
    () => null,
    () => request<BusinessHoursImpact | null>(
      '/api/settings', { method: 'PUT', body: JSON.stringify(patch) },
    ),
  );

/**
 * POST /api/settings/weekly-business-hours/draft — **乾跑**：把還沒存的營業
 * 設定送過去，回報「照這份存下去會發生什麼」，一列都不寫（issue #33 ②）。
 *
 * ⚠️ 「乾跑」這個語意是**我方選定**的，不是原站考據結果——原站只有路徑與
 * 四句文案，沒有 request/response 形狀。依據與反面證據見
 * `src/server/business-hours-blocks.ts` 檔頭與 04 分冊 §A-1.2。
 */
export const previewBusinessHours = (business: TenantSettings['business']) =>
  adapt<{
    perDayMode: boolean;
    autoBlockCount: number;
    conflictBookingCount: number;
    manualWeeklyBlockCount: number;
  } | null>(
    () => null,
    () => request('/api/settings/weekly-business-hours/draft', {
      method: 'POST', body: JSON.stringify(business),
    }),
  );

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

/* ------------------------------------------------ 老闆通知（owner-notify）
 * 四支端點（規格逐字路徑見 docs/specs/dashboard.json 的 jsApiCalls），
 * 契約見 06 分冊 §5.5。儀表板是唯一呼叫端。
 *
 * ⚠️ 示範分支：示範店家沒有任何 LINE 官方帳號，也就沒有好友、沒有名單。
 * 據實回「未設定 LINE ＋ 空名單」，不得編一組看起來像已綁定的接收者——
 * 那正是 CLAUDE.md 點名的假的已知（同一檔 getTenantSettings 的先例）。
 */

export const getOwnerNotify = () =>
  adapt<OwnerNotifyState>(
    () => ({ status: 'NOT_CONFIGURED', recipients: [], maxRecipients: 3 }),
    () => request<OwnerNotifyState>('/api/settings/line/owner-notify'),
  );

export const listOwnerNotifyLineUsers = () =>
  adapt<{ lineUsers: BindableLineUser[] }>(
    () => ({ lineUsers: [] }),
    () => request<{ lineUsers: BindableLineUser[] }>('/api/settings/line/owner-notify/line-users'),
  );

/** 本人自我認領（「是我，綁定通知」）。示範店家沒有 LINE 可綁 → 丟真正的錯誤。 */
export const bindOwnerNotify = (lineUserId: string) =>
  adapt<{ recipient: OwnerNotifyRecipient; maxRecipients: number }>(
    () => { throw demoLineUnavailable(); },
    () => request('/api/settings/line/owner-notify/bind', {
      method: 'POST',
      body: JSON.stringify({ lineUserId }),
    }),
  );

/** 加入通知名單（「新增接收者」）。:id ＝ lineUserId（見該 route 檔頭）。 */
export const addOwnerNotifyRecipient = (lineUserId: string) =>
  adapt<{ recipient: OwnerNotifyRecipient; maxRecipients: number }>(
    () => { throw demoLineUnavailable(); },
    () => request(
      `/api/settings/line/owner-notify/recipients/${encodeURIComponent(lineUserId)}`,
      { method: 'POST' },
    ),
  );

/** 移出通知名單。回傳 promoted ＝ 遞補為主要的那一位（沒有遞補時 null）。 */
export const removeOwnerNotifyRecipient = (lineUserId: string) =>
  adapt<{ promoted: OwnerNotifyRecipient | null }>(
    () => { throw demoLineUnavailable(); },
    () => request(
      `/api/settings/line/owner-notify/recipients/${encodeURIComponent(lineUserId)}`,
      { method: 'DELETE' },
    ),
  );

/** 解除全部接收者的綁定。回傳實際移除幾位。 */
export const clearOwnerNotify = () =>
  adapt<{ removed: number }>(
    () => { throw demoLineUnavailable(); },
    () => request('/api/settings/line/owner-notify', { method: 'DELETE' }),
  );

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

export const createTelegramBindLink = () =>
  adapt<{ deepLink: string; expiresInMinutes: number }>(
    () => ({ deepLink: 'https://t.me/vibeai_demo_bot?start=demo-telegram-link', expiresInMinutes: 15 }),
    () => request('/api/telegram/bind', { method: 'POST' }),
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

/* ═══════════════════════════════════════ 進階選單設計器（issue #19）
 * 端點契約：docs/integration/06-LINE-INTEGRATION.md §6.2
 *
 * ⚠️ 這一整組在 issue #19 之前**全部不存在**，所以 rich-menu-design 頁的
 * 「情境範本預覽／發布」「快速套用範本」「儲存草稿」「還原前次發布」「單格圖示上傳」
 * 「預約步驟引導」六處都是本地假成功或死按鈕（14 分冊 §1、issue #3／#6 已改成
 * 誠實提示）。現在它們有真的端點可以打了。
 *
 * mock 分支一律 `throw demoLineUnavailable()`：骨架模式沒有 LINE 頻道，
 * 假裝成功正是這一輪在清的東西。
 */

/** 一格的設定（與 src/server/rich-menu.ts 的 richMenuCellSchema 同形） */
export type RichMenuCellPayload = {
  label: string;
  action: 'SEND_TEXT' | 'OPEN_URL' | 'OPEN_URL_AD' | 'FLEX_POPUP';
  value: string;
  icon: string;
};

/** 一份進階設計（advanced-config 的草稿、create-advanced 的 body 都是這個形狀） */
export type RichMenuDesignPayload = {
  theme: string;
  layout: string;
  cells: RichMenuCellPayload[];
  bgImageUrl?: string;
  chatBarText?: string;
  name?: string;
};

/** create-custom 的請求本體；後端發布後才加上 `kind: 'CUSTOM'` 存為 PUBLISHED config。 */
export type RichMenuCustomPayload = Omit<RichMenuCustomPublishedConfig, 'kind'>;

/** GET advanced-config 的 published.config 可能是固定版型或任意座標 custom。 */
export type RichMenuPublishedConfig = RichMenuDesignPayload | RichMenuCustomPublishedConfig;

/** 建立並發布自訂版型／每格設定的選單（會維護還原點，§6.2.2 三代輪替）。 */
export const createAdvancedRichMenu = (design: RichMenuDesignPayload) =>
  adapt<{ richMenuId: string }>(
    () => { throw demoLineUnavailable(); },
    () => request<{ richMenuId: string }>('/api/settings/line/rich-menu/create-advanced', {
      method: 'POST',
      body: JSON.stringify(design),
    }),
  );

/**
 * 完全自訂座標區塊的發布（§6.2.4）。
 *
 * 選單設計頁的「自訂格數」已接上本函式：原站 DOM 只留行／列與逐格設定，沒有
 * 座標 payload。頁面採等分格線後交給本端點；該幾何規則是實作選擇，不宣稱還原。
 *
 * 這仍不是任意拖拉矩形編輯器：端點可收任意 bounds，但頁面目前只產生等分格線。
 */
export const createCustomRichMenu = (body: RichMenuCustomPayload) =>
  adapt<{ richMenuId: string }>(
    () => { throw demoLineUnavailable(); },
    () => request<{ richMenuId: string }>('/api/settings/line/rich-menu/create-custom', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

/**
 * 依情境範本一鍵建立（§6.2.4）。
 *
 * ⚠️ 範本**只決定主題配色**：原站「哪一句文案屬於哪一個範本」的對應已遺失
 * （REBUILD-SPEC §9.3 第 1 點），六格文案一律用業態預設值。頁面必須照實說。
 */
export const createSceneRichMenu = (sceneId: string) =>
  adapt<{ richMenuId: string; sceneId: string }>(
    () => { throw demoLineUnavailable(); },
    () => request<{ richMenuId: string; sceneId: string }>(
      '/api/settings/line/rich-menu/create-scene',
      { method: 'POST', body: JSON.stringify({ sceneId }) },
    ),
  );

export type RichMenuPreview = {
  size: { width: number; height: number };
  chatBarText: string;
  areas: { bounds: { x: number; y: number; width: number; height: number }; action: any }[];
  theme: string;
  imageDataUrl: string;
  /** 預覽圖是純色底圖：沒有店名、沒有格子文字、沒有格線（§6.2.5） */
  imageIsFlatColor: boolean;
  sceneId?: string;
  sceneName?: string;
  /** 範本只決定配色，六格文案是業態預設值 */
  cellsAreModeDefaults?: boolean;
};

/**
 * 產生預覽（§6.2.5）。
 *
 * ⚠️ **這三支絕對不會發布任何東西**——不呼叫 LINE 的建立／設預設／上傳。
 * 端點那一側有整合測試斷言「mock LINE 的 richmenu 建立次數為 0」。
 */
export const previewAdvancedRichMenu = (design: RichMenuDesignPayload) =>
  adapt<RichMenuPreview>(
    () => { throw demoLineUnavailable(); },
    () => request<RichMenuPreview>('/api/settings/line/rich-menu/preview-advanced', {
      method: 'POST',
      body: JSON.stringify(design),
    }),
  );

export const previewSceneRichMenu = (sceneId: string) =>
  adapt<RichMenuPreview>(
    () => { throw demoLineUnavailable(); },
    () => request<RichMenuPreview>('/api/settings/line/rich-menu/preview-scene', {
      method: 'POST',
      body: JSON.stringify({ sceneId }),
    }),
  );

/** 聊天室 Flex 主選單的預覽 payload（顧客真的會收到的那一包，含 flexShowTip 的第二則）。 */
export const previewSceneFlex = () =>
  adapt<{ kind: string; messages: unknown[]; messageCount: number; bubbleCount: number }>(
    () => { throw demoLineUnavailable(); },
    () => request('/api/settings/line/rich-menu/preview-scene-flex', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );

/**
 * 還原上一次發布的選單（§6.2.2 / §6.2.7）。
 *
 * 還原點只保留最近 1 份（擁有者裁決）。沒有還原點時端點回 **404**，
 * ApiError 的 message 會說明「為什麼沒有」——呼叫端照原文顯示，不要吞掉改寫成
 * 「還原成功」或含糊的「操作失敗」。
 */
export const restorePreviousRichMenu = () =>
  adapt<{ richMenuId: string; source: 'LINE_MENU_REUSED' | 'RECREATED' }>(
    () => { throw demoLineUnavailable(); },
    () => request('/api/settings/line/rich-menu/restore-previous', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );

export type AdvancedConfig = {
  draft: (RichMenuDesignPayload & { updatedAt: string }) | null;
  published: { config: RichMenuPublishedConfig; richMenuId: string; updatedAt: string } | null;
  /** 只回時間，不回整份設計（畫面只需要知道有沒有、是什麼時候的） */
  restorePoint: { updatedAt: string } | null;
};

/** 讀草稿／已發布／有無還原點（§6.2.6）。 */
export const getAdvancedConfig = () =>
  adapt<AdvancedConfig>(
    () => { throw demoLineUnavailable(); },
    () => request<AdvancedConfig>('/api/settings/line/rich-menu/advanced-config'),
  );

/**
 * 儲存草稿（§6.2.6）。
 *
 * ⚠️ **草稿不是發布。** 存成功只代表「下次打開這一頁看得到同樣的設定」，
 * 不代表顧客的選單有任何改變。頁面的成功訊息必須這樣寫（鐵則 12）。
 */
export const saveAdvancedConfig = (design: RichMenuDesignPayload) =>
  adapt<{ updatedAt: string }>(
    () => { throw demoLineUnavailable(); },
    () => request<{ updatedAt: string }>('/api/settings/line/rich-menu/advanced-config', {
      method: 'PUT',
      body: JSON.stringify(design),
    }),
  );

export type BookingStepGuidePayload = {
  enabled: boolean;
  steps: { key: string; title: string; color: string }[];
};

/**
 * 預約步驟引導（§6.2.9）。路徑**不在 rich-menu/ 底下**（規格逐字）。
 *
 * ⚠️ 存得到、讀得回、payload 也過 LINE 驗證，**但目前顧客收不到**：原站的引導卡
 * 插在「預約 carousel」最前面，而本專案的「預約」回的是純文字服務清單，沒有那個
 * carousel。回應的 `deliveredToCustomers` 就是這件事的旗標，頁面必須照它說實話。
 */
export const getBookingStepGuide = () =>
  adapt<BookingStepGuidePayload & { card: unknown; deliveredToCustomers: boolean }>(
    () => { throw demoLineUnavailable(); },
    () => request('/api/settings/line/booking-step-guide'),
  );

export const saveBookingStepGuide = (body: BookingStepGuidePayload) =>
  adapt<BookingStepGuidePayload & { card: unknown; deliveredToCustomers: boolean }>(
    () => { throw demoLineUnavailable(); },
    () => request('/api/settings/line/booking-step-guide', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
