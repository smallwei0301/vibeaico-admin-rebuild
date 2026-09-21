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

  /**
   * 平台客服信箱（issue #25 B 段／`docs/decisions/2026-09-11-support-chat-human-escalation.md`）。
   * 店家在 support-chat widget「轉人工」時，通知信寄去這個信箱。
   *
   * ⚠️ 未設定時**不擋** thread／訊息寫入——店家的留言仍會成功保存，只是
   * `src/server/email/send.ts` 的 `sendSupportChatNotifyEmail()` 會回
   * `SKIPPED_NO_RECIPIENT`，UI 依此誠實顯示「已保存，通知尚未送出」。
   * 絕不可 fallback 成任何個人信箱或 repo owner 帳號——那會讓一個沒設定的平台
   * 悄悄把客服信寄去某個人的私人信箱而不留痕跡。
   */
  PLATFORM_SUPPORT_NOTIFY_EMAIL: z.string().email().optional(),

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

  /**
   * 推廣成效匿名 visitor_hash 的每日輪替 salt 密鑰（issue #23，
   * 見 `src/server/promotion-visitor-hash.ts`）。未設定時退回
   * `SETTINGS_ENCRYPTION_KEY`、再退回一個固定字串（不影響公開頁可用性，
   * 只影響 salt 隨機性），所以這裡維持 optional，不擋骨架模式全空 env 起動。
   */
  PROMOTION_VISITOR_SALT_SECRET: z.string().optional(),

  /**
   * 平台贊助金流（issue #25 C 段，`docs` 見 PR 說明）：綠界（ECPay）AIO 商店憑證。
   *
   * ⚠️ 這是**平台自己**收贊助用的商店，跟任何一家租戶的收款方式（#9
   * `tenant_payment_methods`）完全無關，不可混用、不可從那邊借憑證。
   *
   * 2026-09-15 盤點 `midao.env`：三者皆未設定（EXTERNAL_CONFIG_BLOCKED）。未設定
   * 時 `/api/donations` 的建單（純寫我方 DB）仍正常運作，只有「取得付款頁表單」
   * 那一步會回 503 + `EXT_001`，不會用假憑證簽出一組必然被 ECPay 拒絕的表單。
   */
  ECPAY_MERCHANT_ID: z.string().optional(),
  ECPAY_HASH_KEY: z.string().optional(),
  ECPAY_HASH_IV: z.string().optional(),
  /** 'production' 打正式 ECPay；其餘（含未設定）一律視為測試站，指向 payment-stage */
  ECPAY_ENV: z.enum(['production', 'stage']).default('stage'),

  /**
   * issue #11／`docs/integration/11-PARTNER-API.md` §4.1：允許跨網域呼叫
   * `/api/public/**` 的來源網域，逗號分隔（例如 Midao 正式／預覽網域）。
   * 未設定時 fail closed——`src/server/public-cors.ts` 不會放行任何跨網域
   * Origin，只有同源請求（沒有 `Origin` header，或瀏覽器同源請求）不受影響。
   * 不支援萬用字元；一律逐一列出允許的網域。
   */
  PUBLIC_CORS_ORIGINS: z.string().optional(),
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
