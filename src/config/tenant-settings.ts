import { z } from 'zod';

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
  campaignKeywordEnabled: z.boolean().default(true),
  /** Rich Menu */
  richMenuTheme: z.enum(['LINE_GREEN', 'OCEAN_BLUE', 'ROYAL_PURPLE', 'SUNSET_ORANGE', 'DARK'])
    .default('LINE_GREEN'),
  richMenuBgImageUrl: z.string().default(''),
  richMenuNoOverlay: z.boolean().default(false),
  richMenuTextColor: z.string().default('#FFFFFF'),
});

/* ------------------------------------------------------------- 基本 / 營業 */
export const DEFAULT_TENANT_TIME_ZONE = 'Asia/Taipei';

export function isValidTenantTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

const tenantTimeZoneSchema = z.string()
  .trim()
  .min(1, '請輸入有效的 IANA 時區')
  .refine(isValidTenantTimeZone, '請輸入有效的 IANA 時區')
  .default(DEFAULT_TENANT_TIME_ZONE);

export const basicSettingsSchema = z.object({
  tenantName: z.string().min(1, '請輸入店家名稱'),
  /** 僅限小寫英文、數字、連字號；用於登入與 LINE Webhook URL */
  shopCode: z.string().regex(/^[a-z0-9-]+$/, '僅限小寫英文、數字、連字號（-）'),
  tenantPhone: z.string().default(''),
  tenantEmail: z.string().email().or(z.literal('')).default(''),
  tenantAddress: z.string().default(''),
  tenantDescription: z.string().default(''),
  /** 日期邊界、行程與提醒的租戶時區；舊資料預設台北。 */
  timezone: tenantTimeZoneSchema,
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
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

/* -------------------------------------------------------------- 商店設計頁 */
/**
 * 公開頁品牌設定（Issue #7）— 存 tenant_settings.branding jsonb（migration 0077）。
 * `/tenant/shop-design` 頁面讀寫，欄位逐字對照該頁的 ShopPageConfig 型別。
 *
 * Owner 裁示（2026-09-04）：獨立開一組 `branding`，不併入既有的 `business`
 * （`business` 是營業時段／預約規則，`branding` 是公開頁的視覺與品牌內容，
 * 語意不同）。
 *
 * ⚠️ 下面的 `line` 欄位是「社群連結」（公開頁要顯示的 LINE 加好友網址），
 *    與本檔案上方的 `lineSettingsSchema`（LINE Bot Channel 設定群組，存在
 *    tenant_settings.line、對應 /tenant/line-settings）**同名但完全不同語意**，
 *    不要混用；這裡的 line 只是 branding 物件裡的一個字串欄位。
 *
 * logoUrl / bannerUrl / aboutImageUrl / gallery[].url 目前只儲存/回填 URL
 * 字串本身 —— 圖片上傳流程（含 storage bucket）是獨立 slice，尚未接線。
 */
export const galleryImageSchema = z.object({
  id: z.string(),
  url: z.string().default(''),
  caption: z.string().default(''),
});

export const brandingSettingsSchema = z.object({
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
  gallery: z.array(galleryImageSchema).default([]),
  themeColor: z.string().default('#6366f1'),
  facebook: z.string().default(''),
  instagram: z.string().default(''),
  /** ⚠️ 社群連結用的 LINE 網址，非 LINE Bot 設定，見上方檔頭註解 */
  line: z.string().default(''),
  threads: z.string().default(''),
  googleMaps: z.string().default(''),
  contactEmail: z.string().default(''),
});

export type GalleryImage = z.infer<typeof galleryImageSchema>;
export type BrandingSettings = z.infer<typeof brandingSettingsSchema>;

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