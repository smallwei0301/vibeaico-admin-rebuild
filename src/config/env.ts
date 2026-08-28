import { z } from 'zod';

/**
 * 平台層環境變數（Platform-level env）
 * -----------------------------------------------------------------------------
 * 這裡只放「整個平台共用、且不該讓店家看到」的設定。
 * ⚠️ 任何「每家店不一樣」的東西（LINE Channel Token、營業時間、金流帳號…）
 *    都不在這裡 —— 它們屬於租戶設定，見 src/config/tenant-settings.ts，
 *    由店家自己在後台前台輸入、存進資料庫。
 *
 * 為什麼要分兩層：這是多租戶系統。env 是部署一次的，租戶設定是每家店一份的。
 * 把 LINE Token 放 env 等於整個平台只能服務一家店。
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** 資料庫連線字串（骨架階段可留空，走 mock） */
  DATABASE_URL: z.string().optional(),

  /* ---- Supabase（Phase 0，見 docs/integration/01-ARCHITECTURE.md §3）----
   * 維持 optional：mock 模式下必須能在全空 env 起動（鐵則 10）。
   * 取用時才在 src/server/supabase.ts 做非空斷言。
   * 註：NEXT_PUBLIC_* 兩把放這裡是照 01 分冊 §3 的程式碼片段；本專案頁面不 fetch
   *     （鐵則 1），Supabase client 只在 src/server/* 建立，故不需要進 clientSchema。 */
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  /** ⚠️ 最高權限：僅 LINE webhook / Vercel Cron / 註冊流程可用（鐵則 7） */
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  /** Resend 寄信（Phase 4，見 05 分冊） */
  RESEND_API_KEY: z.string().optional(),
  /** Resend delivery webhook signing secret (whsec_...), server-only. */
  RESEND_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

  /** #40 平台單一 Telegram Bot 與每日健康報告收件端；全為 server-only。 */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_ID: z.string().optional(),
  /** Bot username only; this is used to create a public t.me deep link. */
  TELEGRAM_BOT_USERNAME: z.string().regex(/^@?[A-Za-z0-9_]{5,}$/).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  PLATFORM_OWNER_EMAIL: z.string().email().optional(),
  PLATFORM_TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/).optional(),

  /** Vercel Cron 呼叫 /api/cron/* 的 Bearer token（Phase 7，見 07 分冊） */
  CRON_SECRET: z.string().optional(),

  /** AI 客服（AI_ASSISTANT，09 分冊 §7）：平台一把 key，所有店共用；未設定時 AI 客服靜默停用 */
  ANTHROPIC_API_KEY: z.string().optional(),

  /** 簽發租戶 session / JWT 用的密鑰 */
  AUTH_SECRET: z.string().min(16).optional(),

  /** 租戶設定中的密文欄位（LINE Secret / Token）落地前的加密金鑰，32 bytes hex */
  SETTINGS_ENCRYPTION_KEY: z.string().length(64).optional(),

  /** 平台級 OAuth：讓店家用「LINE 登入 / Google 登入」註冊後台帳號。
   *  這與「店家自己的 LINE 官方帳號」無關，是兩套不同的 channel。 */
  LINE_LOGIN_CHANNEL_ID: z.string().optional(),
  LINE_LOGIN_CHANNEL_SECRET: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  /** 平台寄信（驗證碼、密碼重設） */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  /** 檔案儲存（QR Code、Rich Menu 底圖、作品集圖片） */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  /** Web Push（後台「開啟新預約推播」） */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

const clientSchema = z.object({
  /** 對外站台網址，用來組公開預約頁連結與 LINE Webhook URL */
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  /** GA4 評估 ID（原站為 G-YP724H56BX） */
  NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
  /** 骨架模式：true 時所有 API 走 src/mock 假資料，不需要任何後端 */
  NEXT_PUBLIC_USE_MOCK: z.enum(['true', 'false']).default('true'),
});

export const serverEnv = serverSchema.parse(process.env);

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  NEXT_PUBLIC_USE_MOCK: process.env.NEXT_PUBLIC_USE_MOCK,
});

export const USE_MOCK = clientEnv.NEXT_PUBLIC_USE_MOCK === 'true';
export const APP_URL = clientEnv.NEXT_PUBLIC_APP_URL;
