import { ApiError, adapt, request } from '@/lib/api';
import { APP_URL } from '@/config/env';
import type { BusinessType } from '@/config/modes';
import {
  DEFAULT_TENANT_SETTINGS, buildWebhookUrl, maskSecret,
  aiSettingsSchema, brandingSettingsSchema,
  type AiSettings, type BrandingSettings, type GalleryImage, type LineSettings, type TenantSettings,
} from '@/config/tenant-settings';

type BasicSettings = TenantSettings['basic'];
type BusinessSettings = TenantSettings['business'];
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

/**
 * #33②：帶 business 群組存檔後，後端回報這次「自動封鎖時段」重建的影響。
 * 乾跑端點（previewBusinessHours）回同一個形狀，差別只在有沒有真的寫入。
 */
export interface BusinessHoursImpact {
  perDayMode: boolean;
  autoBlockCount: number;
  conflictBookingCount: number;
  manualWeeklyBlockCount: number;
}

export interface TenantSettingsSaveResult {
  welcomeCardImageCleanupPending?: boolean;
  /** 只有 patch 帶 business 群組時才會出現（#33②） */
  businessHours?: BusinessHoursImpact;
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
 * 真正建立並發布 Rich Menu —— 走 `/api/settings/line/rich-menu/create`
 * （`src/app/api/settings/line/rich-menu/create/route.ts` 早已實作：建立→傳圖→
 * 設為預設，三步驟原子完成，失敗會清掉半成品）。
 *
 * 在此之前，`/tenant/line-settings` 的「建立 Rich Menu」按鈕只呼叫
 * `saveLineSettings()` 把主題／底圖等欄位寫進 `tenant_settings`，從未真的打過
 * LINE 的 API——畫面上顯示「已建立並發布」，LINE 那邊其實什麼都沒發生。這支
 * 函式接掉那顆按鈕，讓「建立」對應到真的會呼叫 LINE 官方 API 的端點，回傳真實
 * `richMenuId`；呼叫失敗時把後端的真實錯誤（例如底圖讀不到、主題圖尚未上架）
 * 原樣往上拋，不得顯示成功。
 */
export const publishRichMenu = () =>
  adapt<{ richMenuId: string }>(
    () => ({ richMenuId: 'mock-rich-menu-id' }),
    () => request<{ richMenuId: string }>('/api/settings/line/rich-menu/create', { method: 'POST' }),
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
      // basic（staffTerm 等）與 branding 是互不相干的設定群組，兩邊都要保留。
      Object.assign(s.basic, getMockBasicSettingsOverrides());
      s.branding = getMockBrandingStore()[MOCK_MODE];
      return s;
    },
    () => request<TenantSettings>('/api/settings'),
  );

export const saveTenantSettings = (patch: Partial<TenantSettings>) =>
  adapt<TenantSettingsSaveResult | undefined>(
    () => {
      if (patch.basic) Object.assign(getMockBasicSettingsOverrides(), patch.basic);
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

/**
 * shop-page 端點群（issue #22；04 分冊 §A-1.1）—— `/tenant/shop-design` 頁
 * 讀寫 `branding` 群組的**唯一入口**，取代原本借用 `saveTenantSettings({ branding })`
 * 整包覆蓋、也修掉 14 分冊記錄的「儲存送空 patch」根因：`saveShopPageSettings()`
 * 只送真的異動的欄位，並把伺服器回傳的合併結果交回呼叫端重繪（不是信任本地 state）。
 *
 * `saveTenantSettings({ branding })` 的整包覆蓋語意**仍然保留**（見該函式與
 * `src/app/api/settings/route.ts` 的檔頭註解）——那是 issue #7 既有回歸測試與
 * mock 分支共用倉庫鎖定的既有行為，但自本 issue 起沒有任何頁面會再呼叫它送
 * branding，一律改用這裡的兩支函式。
 */
export const getShopPageSettings = () =>
  adapt<BrandingSettings>(
    () => getMockBrandingStore()[MOCK_MODE],
    () => request<BrandingSettings>('/api/settings/shop-page'),
  );

export const saveShopPageSettings = (patch: Partial<BrandingSettings>) =>
  adapt<BrandingSettings>(
    () => {
      const store = getMockBrandingStore();
      const merged = brandingSettingsSchema.parse({ ...store[MOCK_MODE], ...patch });
      store[MOCK_MODE] = merged;
      return merged;
    },
    () => request<BrandingSettings>('/api/settings/shop-page', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  );

/**
 * POST /api/settings/shop-page/gallery/reorder —— 圖片展示排序持久化。
 * `gallery` 是 `branding` jsonb 裡的一個陣列，沒有獨立的 sort_order 欄位，
 * 順序就是陣列索引；`ids` 必須是目前 gallery 的完整排列。
 */
export const reorderShopPageGallery = (ids: string[]) =>
  adapt<GalleryImage[]>(
    () => {
      const store = getMockBrandingStore();
      const current = store[MOCK_MODE];
      const byId = new Map(current.gallery.map((g) => [g.id, g]));
      const reordered = ids.map((id) => byId.get(id)).filter((g): g is GalleryImage => !!g);
      store[MOCK_MODE] = { ...current, gallery: reordered };
      return reordered;
    },
    () => request<GalleryImage[]>('/api/settings/shop-page/gallery/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  );

/**
 * banner video 兩階段上傳（issue #22 Part A；04 分冊 §A-1.1）——
 * `presignBannerVideo()` → 用戶端直接 PUT 到回傳的 `signedUrl` → 上傳成功後
 * 呼叫 `confirmBannerVideo()`。大檔案（最大 50MB）直傳 Storage，完全不經過
 * 這個 Next.js server 的 JSON body。
 *
 * mock 分支：沒有真的 Storage 好直傳，直接把 `file.name` 當成「上傳完成的
 * 網址」寫回 mock branding store，行為與其他 mock 上傳分支（見上方
 * `uploadRichMenuBgImage`）一致：只驗證 UI 流程，不驗證真實網路互動。
 */
export interface PresignBannerVideoResult {
  bucket: string;
  path: string;
  signedUrl: string;
  token: string;
}

export const BANNER_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const BANNER_VIDEO_ALLOWED_TYPES = new Set(['video/mp4', 'video/webm']);

export const presignBannerVideo = (contentType: string, sizeBytes: number) =>
  adapt<PresignBannerVideoResult>(
    () => {
      if (!BANNER_VIDEO_ALLOWED_TYPES.has(contentType)) {
        throw new ApiError('影片只支援 MP4 / WebM 格式', 'VALIDATION');
      }
      if (sizeBytes > BANNER_VIDEO_MAX_BYTES) {
        throw new ApiError('影片大小不可超過 50MB', 'VALIDATION');
      }
      return { bucket: 'banner-videos', path: 'mock/banner-video/mock.mp4', signedUrl: '', token: '' };
    },
    () => request<PresignBannerVideoResult>('/api/settings/shop-page/banner-video/presign', {
      method: 'POST',
      body: JSON.stringify({ contentType, sizeBytes }),
    }),
  );

/**
 * 直傳到 Storage 簽名網址。**不走 `request()`**——那支輔助函式假設回應信封是
 * `{success,data}`，但 Storage 的 PUT 端點回的是它自己的格式；這裡直接用
 * `fetch`，非 2xx 一律視為失敗並丟出錯誤訊息帶 HTTP 狀態碼方便除錯。
 */
export const uploadBannerVideoToSignedUrl = async (signedUrl: string, file: File) => {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!res.ok) {
    throw new ApiError(`上傳到儲存空間失敗（HTTP ${res.status}）`, 'INTERNAL');
  }
};

export const confirmBannerVideo = (path: string) =>
  adapt<BrandingSettings>(
    () => {
      const store = getMockBrandingStore();
      const merged = brandingSettingsSchema.parse({
        ...store[MOCK_MODE],
        bannerVideoUrl: `mock://banner-video/${path}`,
      });
      store[MOCK_MODE] = merged;
      return merged;
    },
    () => request<BrandingSettings>('/api/settings/shop-page/banner-video/confirm', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  );

export interface DeleteBannerVideoResult {
  removed: boolean;
}

export const deleteBannerVideo = () =>
  adapt<DeleteBannerVideoResult>(
    () => {
      const store = getMockBrandingStore();
      const current = store[MOCK_MODE];
      const removed = !!current.bannerVideoUrl;
      store[MOCK_MODE] = brandingSettingsSchema.parse({ ...current, bannerVideoUrl: '' });
      return { removed };
    },
    () => request<DeleteBannerVideoResult>('/api/settings/shop-page/banner-video', {
      method: 'DELETE',
    }),
  );

/**
 * POST /api/settings/weekly-business-hours/draft —— **乾跑**，一列都不寫。
 *
 * ⚠️ 「乾跑」是我方選定的語意，不是原站考據結果；依據與反面證據見
 * src/server/business-hours-blocks.ts 檔頭。真正的寫入走 saveTenantSettings。
 *
 * 骨架模式沒有這條鏈路（沒有 block_times 假資料可算），回 null 代表「算不出來」，
 * 呼叫端據此**不顯示**那幾句文案——而不是顯示一個編造的數字。
 */
export const previewBusinessHours = (business: BusinessSettings) =>
  adapt<BusinessHoursImpact | null>(
    () => null,
    () => request<BusinessHoursImpact>('/api/settings/weekly-business-hours/draft', {
      method: 'POST',
      body: JSON.stringify(business),
    }),
  );

export const saveLineSettings = (patch: Partial<LineSettings>) =>
  adapt(
    () => { Object.assign(getMockLineSettingsOverrides(), patch); return undefined; },
    () => request<void>('/api/settings/line', { method: 'PUT', body: JSON.stringify(patch) }),
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
 *
 * mock 分支把 patch 併進 `getMockLineSettingsOverrides()`——與 richMenuBgImageUrl
 * 同一個假倉庫，於是骨架模式下「發布後重整卡片還在」也是真的，不是假成功。
 */
export const saveFlexMenu = (
  patch: Partial<Pick<LineSettings,
    'flexMenuEnabled' | 'flexMenuFallback' | 'flexCards' |
    'flexHeaderColor' | 'flexHeaderTitle' | 'flexHeaderSubtitle' | 'flexShowTip'>>,
) =>
  adapt<void>(
    () => { Object.assign(getMockLineSettingsOverrides(), patch); return undefined; },
    () => request<void>('/api/settings/line/flex-menu', {
      method: 'POST',
      body: JSON.stringify(patch),
    }),
  );

export const testLineConnection = () =>
  adapt<{ ok: boolean; message: string }>(
    () => ({ ok: true, message: '連線正常' }),
    () => request<{ ok: boolean; message: string }>('/api/settings/line/test', { method: 'POST' }),
  );

/**
 * Issue #477 P1a：把 verify 報告裡「Webhook 沒開啟」的提示文案，換成一顆真的能
 * 呼叫 LINE 官方 API 修好的按鈕（PUT endpoint + PUT setActive，皆用該租戶自己的
 * Channel Token）。`synced:false` 時保留誠實的失敗訊息，前端不得顯示成功、也
 * 不清除既有設定。mock 模式一律回同步成功，讓 demo 流程可走完全程。
 */
export const syncLineWebhook = () =>
  adapt<{ synced: boolean; message: string; endpoint?: string }>(
    () => ({ synced: true, message: 'Webhook 網址已更新並開啟（demo 模式）' }),
    () =>
      request<{ synced: boolean; message: string; endpoint?: string }>(
        '/api/settings/line/webhook-sync',
        { method: 'POST' },
      ),
  );

/**
 * Issue #47 驗收「關閉／解除連線後，秘密欄位清除且狀態誠實回到未設定」——
 * `saveLineSettings({ channelSecret: '', channelAccessToken: '' })` 做不到這件事：
 * `PUT /api/settings/line`（06 分冊鐵則 6）把空字串明確定義成「不動舊值」，是為了
 * 一般編輯表單不要求每次都重貼 Token；但那個語意套在「解除連線」上正好相反——
 * 呼叫端以為秘密被清空了，資料庫裡其實原封不動。真正會清空
 * `line_channel_secret_enc`／`line_channel_access_token_enc` 的是既有的
 * `POST /api/settings/line/disconnect`，必須改呼叫這支而不是 `saveLineSettings()`。
 */
export const disconnectLine = () =>
  adapt<void>(
    () => undefined,
    () => request<void>('/api/settings/line/disconnect', { method: 'POST' }),
  );

/**
 * 六項可查證檢查（status 只會是 PASS/FAIL）+ 一項人工確認提示（AUTO_REPLY，
 * status 恆為 INFO）—— 見 src/app/api/settings/line/verify/route.ts 檔頭說明。
 * `pass` 欄位保留相容（`pass === (status === 'PASS')`），呼叫端計算失敗數須用
 * status==='FAIL'，AUTO_REPLY 的 INFO 不計入通過／失敗任一邊。
 */
export const verifyLineSetup = () =>
  adapt<{ checks: { key: string; status: 'PASS' | 'FAIL' | 'INFO'; pass: boolean; message: string }[] }>(
    () => ({
      checks: [
        { key: 'CREDENTIALS', status: 'PASS', pass: true, message: 'Channel ID / Secret / Access Token 都已填寫' },
        { key: 'TOKEN', status: 'PASS', pass: true, message: 'Access Token 有效（LINE 認證通過）' },
        {
          key: 'ID_SECRET_PAIR', status: 'PASS', pass: true,
          message: 'Channel ID 與 Secret 配對正確（webhook 簽章可通過）',
        },
        {
          key: 'BOT_MODE', status: 'PASS', pass: true,
          message: 'LINE 官方帳號後台「回應方式」為 Bot 模式（推薦）',
        },
        {
          key: 'WEBHOOK', status: 'PASS', pass: true,
          message: 'Use webhook 已開啟（LINE 會把使用者點選／訊息事件送到本系統）',
        },
        {
          key: 'WEBHOOK_TEST', status: 'PASS', pass: true,
          message: 'Webhook 實際測試通過（LINE → 本系統 200 OK）',
        },
        {
          key: 'AUTO_REPLY',
          status: 'INFO',
          pass: false,
          message:
            '「自動回應訊息」開關無公開 API 可直接查詢，請自行至 LINE Official Account Manager 確認並關閉，避免 LINE 內建自動回應攔截 Bot 訊息',
        },
      ],
    }),
    () => request('/api/settings/line/verify', { method: 'POST' }),
  );

export const getSetupStatus = () =>
  adapt<SetupStatus>(() => MOCK_SETUP_STATUS, () => request<SetupStatus>('/api/settings/setup-status'));

/* ------------------------------------------------------------- AI 客服設定
 * `GET/PUT /api/ai-settings`（09 分冊 §7.1）—— /tenant/ai-settings 頁專用。
 *
 * ⚠️ 為什麼這兩支非有不可（issue #27 ①）：ai-settings 頁原本呼叫的是
 * `saveLineSettings({ autoReplyEnabled, defaultReply: prompt })`，也就是把
 * **AI 提示詞**寫進 `tenant_settings.line.defaultReply`。那個欄位是 webhook
 * 分支 ⑥ 的「沒有 AI 時的靜態罐頭回覆」，於是店家寫給 AI 的指令
 * （「你是一間美髮沙龍的客服，語氣親切，優先引導顧客預約」）被**逐字推播給
 * 每一位傳訊息來的顧客**，畫面卻顯示「AI 客服設定已儲存（已啟用）」。
 * 同時 webhook 分支 ⑤ 讀的 `tenant_settings.ai.enabled` 永遠停在 zod 預設的
 * false ——「已啟用」從來就是假的。
 *
 * 14 分冊 §8.1 的擁有者裁決是**分家**：
 *   - `line.autoReplyEnabled` / `line.defaultReply` 只由 line-settings 頁寫
 *   - `ai.*` 只由 ai-settings 頁寫（就是這兩支函式）
 * 兩頁從此不再搶同一組欄位。
 */

export const getAiSettings = () =>
  adapt<AiSettings>(
    // 示範分支：沒有任何 AI 訂閱、沒有金鑰，據實回 schema 預設值（enabled=false）。
    // 不可為了畫面好看回 true —— 那又是一個捏造的已知。
    () => aiSettingsSchema.parse({}),
    () => request<AiSettings>('/api/ai-settings'),
  );

/**
 * 寫回整包 AI 設定。
 *
 * 端點契約是**整包覆蓋**（09 §7.1：`body = AiSettings`，`aiSettingsSchema.parse`
 * 之後直接 upsert 進 `ai` jsonb），所以呼叫端必須送**完整**物件。頁面的作法是
 * 載入時把 GET 回來的整包留著，儲存時只覆寫自己編輯的欄位再送回去——否則
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
