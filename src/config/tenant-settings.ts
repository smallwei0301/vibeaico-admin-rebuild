import { z } from 'zod';
import { RICH_MENU_THEME_KEYS } from './rich-menu-themes';

/**
 * 租戶設定（Tenant Settings）— 多店家客製化的核心
 * -----------------------------------------------------------------------------
 * 每一家店一份，存在資料庫，由店家自己在後台輸入。這裡定義 schema 與預設值。
 *
 * 分組對應後台頁面：
 *   line      → /tenant/line-settings
 *   basic     → /tenant/settings#basic
 *   business  → /tenant/settings#business
 *   notify    → /tenant/settings#notification
 *   points    → /tenant/settings#points
 *   privacy   → /tenant/settings#notification（隱私防護區塊）
 *   branding  → /tenant/shop-design
 *
 * 🔐 標記為 secret 的欄位入庫前必須用 SETTINGS_ENCRYPTION_KEY 加密，
 *    回傳到前端時一律遮罩（見 maskSecret / SECRET_FIELDS）。
 */

/* ------------------------------------------------------- Flex 主選單卡片 */
/**
 * LINE Flex carousel 一次最多能放幾個 bubble。
 *
 * ⚠️ **這是外部規格（LINE Messaging API），不是我們可以自己決定的數字**，
 * 所以它必須只有一個出處。理由與 `src/server/paging.ts` 的 `MAX_PAGE_SIZE`
 * 完全同型：那次是頁面送 `size: 200`、端點各自寫死 `.max(100)`，兩個數字分別
 * 寫在兩個檔案、沒有人保證一致，於是清單頁在部署環境整頁載不出來。
 *
 * 這裡若把 12 抄成兩份（zod 一份、頁面一份），失敗模式是店家在頁面上編到第 13 張
 * 才被伺服器擋掉、前面的工白做；抄成三份（再加一句「最多 12 張卡片」的文案）
 * 就會出現文案說 10、程式擋 12 的情況——本檔改動前 `rich-menu-design.ts` 裡
 * 同時存在 `maxCards12` 與 `maxCards10` 兩句，正是這個下場。
 *
 * 出處：LINE Messaging API reference — Flex Message「carousel」
 * 的 `contents`：Max: 12 bubbles。
 */
export const MAX_FLEX_CARDS = 12;

/**
 * 一張輪播卡片。欄位是 06 分冊 §6 的契約
 * `{title, subtitle, imageUrl, ad, linkUrl?}`（04 分冊的契約以此為準，不得自行擴充）。
 *
 * ⚠️ `linkUrl` 是 14 分冊 §8.20 的**擁有者裁決**加上去的第五個欄位：原本的四欄
 * 沒有地方放網址，但這一頁的文案從一開始就寫著「插入廣告卡片（打開網址）」——
 * 廣告卡不能點本身沒有意義，補齊比改掉文案更符合擁有者方針。
 *
 * 各上限的來源都是 LINE 端的硬限制，不是憑感覺訂的：
 * - `title` 20 字：卡片底部按鈕的 action，LINE 規定 `label` 最多 20 字
 *   （message 與 uri 兩種 action 同一個上限）。沒有 `linkUrl` 時刻意讓 `label`
 *   與送出的 `text` 都等於 title——按鈕上寫什麼、按下去就送出什麼，中間不做截斷
 *   （截斷會讓兩者不一致，顧客按到的關鍵字與看到的字不同）。
 * - `imageUrl` 必須是 https：LINE 的 image 元件只收 HTTPS 網址，http 會被拒。
 *   空字串＝這張卡沒有主圖（合法，組裝時整個 hero 區塊省略）。
 * - `linkUrl` 的可用 scheme：見下方 `FLEX_LINK_URL_SCHEMES` / `isAllowedFlexLinkUrl()`。
 *   空字串＝這張卡不開網址（合法，組裝時按鈕退回 message action）。
 */

/**
 * 卡片 `linkUrl` 的**白名單** scheme（14 分冊 §8.20-b，擁有者裁決「廣告卡全開」）。
 *
 * 「全開」的工程定義：**LINE 的 `uri` action 實測收什麼，我們就收什麼**，一個都沒再扣。
 * 這份清單的每一項都有 `scripts/verify/flex-menu-validate.cjs` 對 LINE 官方
 * `POST /v2/bot/message/validate/reply` 的實測回應碼撐著（2026-08-25 實跑）：
 *
 *   收下（HTTP 200）→ 進白名單：
 *     https://a.example/          200
 *     http://a.example/           200
 *     line://ti/p/@abc            200
 *     tel:0212345678              200
 *     mailto:shop@example.com     200
 *   退回（HTTP 400 `invalid uri scheme`）→ 不進白名單：
 *     sms:0212345678 / javascript:alert(1) / data:text/html,x /
 *     ftp://a.example/ / file:///etc/passwd / `/foo`（相對路徑）/ `a.example/foo`
 *
 * ⚠️ **沒有被那支腳本量到的 scheme 不准加進這個陣列**，也不准在註解裡寫
 * 「LINE 應該也收 X」。這一節的每一個數字都是量出來的，不是推出來的
 * （§8.20 就是「把 hero 圖的限制推想成 uri action 的限制、還附了引用」而錯的）。
 *
 * ⚠️ 為什麼是**白名單**而不是黑名單：黑名單只擋得住今天想得到的字串，
 * 明天多一個沒人想過的 scheme 就會直接送到顧客手上，而**沒有任何測試會紅**。
 * 白名單漏掉一個合法 scheme 只是少一個功能、店家會反映；黑名單漏掉一個危險
 * scheme 是顧客被導去 `javascript:`。兩種錯的代價不對等。
 */
export const FLEX_LINK_URL_SCHEMES = [
  'https://',
  'http://',
  'line://',
  'tel:',
  'mailto:',
] as const;

/**
 * `linkUrl` 是否可用（**寫入驗證、讀取搶救、頁面即時提示三處共用這一支**）。
 *
 * 三處共用是刻意的：本專案已經反覆抓到「同一件事寫兩份，短期一樣、長期一定分岔，
 * 而分岔的那一天沒有任何測試會紅」。這裡若各寫一份 `startsWith()`，
 * 失敗模式是頁面說可以、端點回 400，或更糟：端點收下了、顧客那一包被 LINE 整份退回。
 *
 * 判斷規則（三條缺一不可）：
 * 1. **先 `trim()`**——前後空白／換行／Tab 由 zod 一併去掉，存進 DB 的也是去空白後的值。
 *    LINE 對前置空白的 `" https://a.example/"` 回 400，所以「去掉再比對、也去掉再存」
 *    才是一致的：畫面說可以，送出去的那一份 LINE 就真的收。
 * 2. **case-insensitive**——LINE 對 `HTTPS://A.EXAMPLE/` 回 200，我們沒有理由更嚴。
 * 3. **必須以白名單的某個 scheme 開頭**——所以「藏在 scheme 前後或中間」的變形
 *    （`\tjavascript:`、`" javascript:"`、`java\tscript:`、`JavaScript:`）
 *    全部落在白名單外，不需要另外列黑名單去追。相對路徑（沒有 scheme）也不在內。
 *
 * ⚠️ 判斷**不看 LINE 對某個變形回什麼**。就算 LINE 對某個變形回 200，這裡照樣擋——
 * 白名單是「正規化後必須以已實測 scheme 開頭」，不是「LINE 沒退就放行」。
 *
 * 空字串回 `false`：呼叫端各自決定空字串代表什麼
 * （schema：合法的「不開網址」；`cardAction()`：退回 message action）。
 */
export function isAllowedFlexLinkUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return FLEX_LINK_URL_SCHEMES.some((scheme) => normalized.startsWith(scheme));
}

/** 一張輪播卡片（欄位契約與各上限的來源見本檔上方那段說明）。 */
export const flexCardSchema = z.object({
  title: z.string().trim().min(1, '卡片標題不可空白').max(20, '卡片標題最多 20 字'),
  subtitle: z.string().trim().max(60, '卡片說明最多 60 字').default(''),
  imageUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || v.startsWith('https://'), '圖片網址必須是 https://')
    .default(''),
  ad: z.boolean().default(false),
  linkUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (v) => v === '' || isAllowedFlexLinkUrl(v),
      '連結網址只接受 https://、http://、line://、tel:、mailto: 開頭',
    )
    .default(''),
});

export type FlexCard = z.infer<typeof flexCardSchema>;

/* ---------------------------------------------------------------- LINE 設定 */
export const lineSettingsSchema = z.object({
  /** 純數字，例如：2005459361 */
  channelId: z.string().regex(/^\d*$/, '請輸入純數字的 Channel ID').default(''),
  /** 32 字元英數字 🔐 */
  channelSecret: z.string().default(''),
  /** 約 170 字元 🔐 */
  channelAccessToken: z.string().default(''),
  /** 由系統依 shopCode 自動組出，唯讀顯示：{APP_URL}/api/line/webhook/{shopCode} */
  webhookUrl: z.string().default(''),
  /** LINE 官方帳號基本 ID，例如 @abc1234x（選填） */
  lineBasicId: z.string().default(''),
  /** 自動回覆 */
  autoReplyEnabled: z.boolean().default(true),
  defaultReply: z.string().max(500).default(''),
  /** Flex 主選單 */
  flexMenuEnabled: z.boolean().default(true),
  flexMenuFallback: z.enum(['HINT', 'SILENT']).default('HINT'),
  flexHeaderColor: z.string().default('#06C755'),
  flexHeaderTitle: z.string().default('✨ {shopName}'),
  flexHeaderSubtitle: z.string().default(''),
  flexShowTip: z.boolean().default(true),
  /**
   * Flex 主選單的輪播卡片（06 分冊 §6「2026-08-24 補規格」：卡片陣列一併存進
   * line jsonb 的 `flexCards` 鍵，上限 12 張）。
   *
   * 為什麼放在 line jsonb 而不是新開一張表：與 `systemKeywordGroupsDisabled`／
   * `ai.strictMode` 同一手法——這是租戶設定，`tenant_settings.line` 是既有的
   * jsonb 欄位，新增鍵只是 zod 多一個 default，老資料由 `.parse(row.line ?? {})`
   * 自動補 `[]`，**不需要 migration**。
   *
   * 生效點只有一個：`src/server/flex-menu.ts` 的 `buildFlexMenuOutcome()`，
   * 由 webhook 的「選單」內建指令（`src/server/line-events.ts` 分支 ④ → MENU）
   * 呼叫。存得進來但沒有人讀，就是一顆假的開關。
   */
  flexCards: z.array(flexCardSchema).max(MAX_FLEX_CARDS).default([]),
  campaignKeywordEnabled: z.boolean().default(true),
  /**
   * 停用的「系統內建關鍵字」組（keyword-replies 頁 15 組的 key，如 COUPON/MENU）。
   * webhook（src/server/line-events.ts 分支 ④）讀這份清單：命中的組直接不回應。
   *
   * 為什麼放在 line jsonb 而不是新開一張表：這是**租戶設定**（CLAUDE.md「多租戶
   * 設定的兩層」表的下半層），與 autoReplyEnabled/defaultReply 同一類、同一個
   * 儲存位置、同一支 PUT /api/settings/line 端點，不需要 migration。
   *
   * 生效條件：**無條件生效，不看 KEYWORD_REPLY 訂閱狀態**（14 分冊 §8.16 擁有者
   * 裁決）。「關掉內建回覆」是少做一件事，不該需要付費；付費閘門只擋「覆蓋」
   * ——也就是店家自己編一組新的關鍵字回覆（`keyword_replies` 表的寫入端點
   * requireFeature('KEYWORD_REPLY')，09 分冊 §5）。
   */
  systemKeywordGroupsDisabled: z.array(z.string()).default([]),
  /** Rich Menu */
  richMenuTheme: z.enum(RICH_MENU_THEME_KEYS).default('LINE_GREEN'),
  richMenuBgImageUrl: z.string().default(''),
  richMenuNoOverlay: z.boolean().default(false),
  richMenuTextColor: z.string().default('#FFFFFF'),
  /** 目前已發布到 LINE 的 Rich Menu ID；發布成功後由 rich-menu/create 端點寫入。 */
  richMenuId: z.string().default(''),
});

/* ------------------------------------------------------------- 基本 / 營業 */
export const basicSettingsSchema = z.object({
  tenantName: z.string().min(1, '請輸入店家名稱'),
  /** 僅限小寫英文、數字、連字號；用於登入與 LINE Webhook URL */
  shopCode: z.string().regex(/^[a-z0-9-]+$/, '僅限小寫英文、數字、連字號（-）'),
  tenantPhone: z.string().default(''),
  tenantEmail: z.string().email().or(z.literal('')).default(''),
  tenantAddress: z.string().default(''),
  tenantDescription: z.string().default(''),
  /** 服務人員的稱呼（原站可自訂：員工 / 設計師 / 醫師 / 老師…） */
  staffTerm: z.string().default('服務人員'),
});

const timeString = z.string().regex(/^\d{2}:\d{2}$/);

export const businessSettingsSchema = z.object({
  /** 開啟後可逐日設定不同營業時段 */
  perDayMode: z.boolean().default(false),
  businessStart: timeString.default('09:00'),
  businessEnd: timeString.default('18:00'),
  breakStart: timeString.or(z.literal('')).default(''),
  breakEnd: timeString.or(z.literal('')).default(''),
  /** 每日時段（perDayMode = true 時使用），index 0 = 週日 */
  perDayHours: z.array(z.array(z.object({ start: timeString, end: timeString }))).length(7)
    .default([[], [], [], [], [], [], []]),
  /** 預約時段間隔（分鐘） */
  slotInterval: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]).default(30),
  /** 可提前預約時間 */
  advanceBookingValue: z.number().int().min(1).default(30),
  advanceBookingUnit: z.enum(['DAY', 'MONTH']).default('DAY'),
  /** 最快可預約（前置時間，天） */
  minAdvanceBookingDays: z.number().int().min(0).default(0),
  /** 預約截止日期（選填）；已過期時儀表板會跳紅色警示 */
  bookingCutoffDate: z.string().default(''),
  /** 公休日，0 = 週日 */
  closedDays: z.array(z.number().int().min(0).max(6)).default([0]),
  /** 顧客預約自動確認 */
  autoConfirmEnabled: z.boolean().default(false),
  /** 預約時強制指定服務人員 */
  staffSelectionMandatory: z.boolean().default(false),
  /** 商品訂單線上收款 */
  productOnlinePaymentEnabled: z.boolean().default(false),
  /** 預約自訂欄位，一行一個，行尾 * 表必填 */
  bookingCustomFields: z.string().default(''),
  /**
   * 每位員工的排班模式（/tenant/shifts 頁的「固定休息 / 輪休」按鈕）：
   * key = staff.id，值二選一。缺 key = 尚未設定，頁面視為 ROTATING。
   *
   * ⚠️ 為什麼落在 `business` 而不是新開一個群組或新欄位：這是店家的營運設定，
   * `business` jsonb 已經存在，新增一個 zod 鍵不需要 migration；/tenant/settings
   * 頁儲存 business 群組時是把 GET 回來的整包再送回去（見該頁 patchBusiness），
   * 所以這個鍵會原樣往返，不會被洗掉。
   */
  staffScheduleModes: z.record(z.string(), z.enum(['FIXED_REST', 'ROTATING'])).default({}),
});

/* --------------------------------------------------------------- 通知設定 */
export const notifySettingsSchema = z.object({
  /** 顧客：預約提醒 */
  notifyBookingReminder: z.boolean().default(true),
  reminderHoursBefore: z.number().int().default(24),
  /** 顧客：LINE 預約狀態推播 */
  notifyBookingConfirmed: z.boolean().default(true),
  notifyBookingCompleted: z.boolean().default(false),
  notifyBookingCancelled: z.boolean().default(true),
  notifyBookingModified: z.boolean().default(true),
  notifyBookingNoShow: z.boolean().default(false),
  /** 店家 / 員工：Email 通知 */
  notifyNewBooking: z.boolean().default(true),
  notifyBookingCancel: z.boolean().default(true),
  notifyStaffBooking: z.boolean().default(false),
  notifyProductOrder: z.boolean().default(true),
  /** 生日祝福（每天 09:00） */
  enableBirthdayGreeting: z.boolean().default(false),
  birthdayGreetingMessage: z.string().default(''),
  /** 顧客喚回（每天 14:00，每店每天最多 50 位） */
  enableCustomerRecall: z.boolean().default(false),
  customerRecallDays: z.number().int().min(1).default(60),
  customerRecallMessage: z.string().default(''),
  /** 加好友歡迎訊息 */
  welcomeMessageText: z.string().default(''),
  welcomeCardTitle: z.string().default(''),
  welcomeCardImageUrl: z.string().default(''),
  welcomeFeatureListText: z.string().default(''),
  profileCollectIntroText: z.string().default(''),
  profileCollectDoneText: z.string().default(''),
});

/* --------------------------------------------------------------- 隱私防護 */
export const privacySettingsSchema = z.object({
  /** 開啟後 LINE 個資收集改用網頁表單 */
  privacyProtectionEnabled: z.boolean().default(false),
  collectCustomerEmailEnabled: z.boolean().default(true),
  collectCustomerBirthdayEnabled: z.boolean().default(true),
  collectCustomerGenderEnabled: z.boolean().default(true),
  /** 加好友時先不收集資料，延後到預約時 */
  deferProfileCollectionEnabled: z.boolean().default(false),
});

/* --------------------------------------------------------------- 點數設定 */
export const pointsSettingsSchema = z.object({
  pointEarnEnabled: z.boolean().default(false),
  /** 消費多少元累積 1 點 */
  pointEarnRate: z.number().int().min(1).default(100),
  rounding: z.enum(['FLOOR', 'ROUND', 'CEIL']).default('FLOOR'),
});

/* ------------------------------------------------------ 公開頁外觀（品牌） */
/**
 * 公開預約頁的外觀設定 — 存 `tenant_settings.branding` jsonb（migration 0021），
 * 由 /tenant/shop-design 頁讀寫（本檔開頭的分組對照表從一開始就寫著
 * `branding → /tenant/shop-design`，但這個群組實際上一直不存在）。
 *
 * ⚠️ 為什麼需要新的群組而不是塞進 `basic`：`PUT /api/settings` 是**群組整包覆蓋**，
 * `basic` 是 /tenant/settings 頁的，兩頁各存各的欄位卻共用一包，先儲存的那一邊
 * 會被後儲存的那一邊洗掉。分組是這個端點的隔離單位。
 */
export const brandingSettingsSchema = z.object({
  /** 公開頁標題；空字串 = 沿用店家名稱 */
  shopName: z.string().default(''),
  logoUrl: z.string().default(''),
  logoHidden: z.boolean().default(false),
  bannerUrl: z.string().default(''),
  bannerVideoUrl: z.string().default(''),
  bannerVideoSound: z.boolean().default(true),
  announcement: z.string().default(''),
  aboutTitle: z.string().default(''),
  aboutContent: z.string().default(''),
  aboutImageUrl: z.string().default(''),
  gallery: z.array(z.object({
    id: z.string(),
    url: z.string().default(''),
    caption: z.string().default(''),
  })).default([]),
  /** 品牌主色（公開頁用的資料值，不是後台的設計 token） */
  themeColor: z.string().default('#6366f1'),
  facebook: z.string().default(''),
  instagram: z.string().default(''),
  line: z.string().default(''),
  threads: z.string().default(''),
  googleMaps: z.string().default(''),
  contactEmail: z.string().default(''),
});

export type BrandingSettings = z.infer<typeof brandingSettingsSchema>;

/* -------------------------------------------------------------- AI 客服 */
/**
 * AI 客服（AI_ASSISTANT）設定 — 存 tenant_settings.ai jsonb（migration 0011）。
 * 09 分冊 §7.1。獨立端點 /api/ai-settings 讀寫；不併入 tenantSettingsSchema
 * （既有 /api/settings 的群組與回傳形狀不動）。
 */
export const aiSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** 店家自訂的 AI 口吻／補充說明，會拼進 system prompt */
  personaNotes: z.string().default(''),
  /** 常見問答 */
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  /** AI 判定無法回答（UNSURE）時引導真人接手的訊息 */
  handoffMessage: z.string().default(''),
  /**
   * 嚴格模式（issue #27 ①）——ai-settings 頁「嚴格模式：閒聊 / 亂碼 由專人處理」。
   *
   * 這個開關原本是頁面裡的純本地 state：可以撥、撥完顯示「AI 客服設定已儲存」，
   * 但沒有任何端點收得到它，重新整理就回到 false。開關的說明文字寫著
   * 「開啟後…AI 完全不回覆，讓店家專人親自接」，那是一個**行為承諾**，
   * 存不進來就等於畫面在宣稱一件沒發生的事（00 鐵則 12）。
   *
   * 落在 `ai` jsonb 裡不需要 migration —— `tenant_settings.ai` 是 migration 0011
   * 就建好的 jsonb 欄位，新增鍵只是 zod schema 多一個 default，老資料由
   * `aiSettingsSchema.parse(row?.ai ?? {})` 自動補 false。
   *
   * 生效點：webhook 分支 ⑤（src/server/line-events.ts）—— 開啟時「明顯非詢問」
   * 的訊息（純數字／純符號／單一字元…）直接不進 AI，見該處的 isLikelyChitchat。
   */
  strictMode: z.boolean().default(false),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

/* ------------------------------------------------------------------- 全部 */
export const tenantSettingsSchema = z.object({
  basic: basicSettingsSchema,
  business: businessSettingsSchema,
  notify: notifySettingsSchema,
  privacy: privacySettingsSchema,
  points: pointsSettingsSchema,
  line: lineSettingsSchema,
  branding: brandingSettingsSchema,
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
export type LineSettings = z.infer<typeof lineSettingsSchema>;

/** 🔐 這些欄位入庫加密、出庫遮罩，永遠不以明文回傳前端 */
export const SECRET_FIELDS = ['line.channelSecret', 'line.channelAccessToken'] as const;

/** 遮罩：保留頭 4 尾 4，中間以 • 取代 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 12) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(12)}${value.slice(-4)}`;
}

/** 依 shopCode 組出該店家的 LINE Webhook URL（原站規則） */
export function buildWebhookUrl(appUrl: string, shopCode: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/line/webhook/${shopCode}`;
}

/** 依 shopCode 組出公開預約頁網址 */
export function buildPublicBookingUrl(appUrl: string, shopCode: string): string {
  return `${appUrl.replace(/\/$/, '')}/s/${shopCode}`;
}

export const DEFAULT_TENANT_SETTINGS = (shopCode: string, tenantName: string): TenantSettings =>
  tenantSettingsSchema.parse({
    basic: { tenantName, shopCode },
    business: {},
    notify: {},
    privacy: {},
    points: {},
    line: {},
    branding: {},
  });
