/**
 * src/server/email/send.ts — 寄信模組（Phase 4，見 docs/integration/05-EMAIL-RESEND.md §2）
 *
 * `verificationHtml`/`bookingHtml`/`orderHtml`（純函式 HTML 模板）搬到同資料夾的
 * `templates.ts`，本檔只保留寄送邏輯（`send()` + 三個 `sendXxx()` 匯出函式）。
 *
 * `sendVerificationCodeEmail` 與 Phase 2 版本行為相同，唯一差異：
 * `purpose === 'RESET_PASSWORD'` 時，信件在驗證碼下方多帶一段「或點此連結
 * 重設密碼」按鈕，連到 `${APP_URL}/tenant/reset-password?token=<code>&email=<email>`
 * ——對應 `src/app/tenant/reset-password/page.tsx` 讀 `?token=`/`?email=` 兩個
 * 查詢參數的既有行為（03 分冊留下、已記錄的 Phase 2 handoff）。
 */

import { Resend } from 'resend';
import { APP_URL } from '@/config/env';
import {
  verificationHtml, bookingHtml, orderHtml, productOrderReceiptHtml, supportChatNotifyHtml,
  type BookingNotifyDetails, type ProductOrderNotifyDetails,
  type ProductOrderReceiptDetails, type SupportChatNotifyDetails,
} from './templates';

const resend = () => new Resend(process.env.RESEND_API_KEY!);
const FROM = () => process.env.MAIL_FROM ?? 'onboarding@resend.dev';

/**
 * 寄送結果 —— issue #27 ③ 新增。
 *
 * 原本 `send()` 回 void：沒設 key 就略過、Resend 回錯就 console.error，對呼叫端
 * 一律「看起來成功」。這對背景寄信（notifyBookingEvent）無所謂，但手動建單的
 * 「未綁 LINE 自動改寄 Email」要把結果**顯示給店家看**，分不出「寄出了」與
 * 「根本沒寄」就會變成假的已知（00 鐵則 12）。故改回傳狀態；既有呼叫端忽略
 * 回傳值，行為完全不變。
 */
export type EmailSendResult =
  | 'SENT'           // Resend 已受理
  | 'SKIPPED_NO_KEY' // RESEND_API_KEY 未設定 → 完全沒送出
  | 'FAILED';        // Resend 回錯（網路/憑證/收件人格式…）

/**
 * 詳細寄送結果 —— issue #754。`configFailure` 區分「provider 設定類失敗」
 * （無 key、401/403、金鑰受限、寄件網域未驗證）與暫時性失敗（網路、5xx、429…）：
 * 前者重試也不會好，需要 Owner 介入，呼叫端據此決定是否進入「服務異常」狀態。
 */
export interface EmailSendDetail {
  result: EmailSendResult;
  configFailure: boolean;
  /**
   * 失敗種類（#763）。`config`：設定類（需 Owner 介入），含 401／403、`from` 欄位錯誤，
   * 以及所有「無法證明是收件人造成」的 4xx（fail-closed：請求層級問題重試不會好）；
   * `service`：可證明為服務層級（429、5xx、網路／逾時、SDK 無 statusCode）；
   * `recipient`：僅限可明確證明是 `to` 收件人被拒的 4xx（statusCode 4xx 且 message 指涉 `to` 欄位），
   * 只與該收件人有關，不得被當成全站狀態（否則可被攻擊者用來開啟 parity 視窗做枚舉）。
   * 殘餘（#764）：`service` 視窗只有 60 秒、`config` 10 分鐘，且僅存於各 instance 記憶體（best-effort）；
   * Resend 429 以 API key 為單位，burst 即可觸發 `service` 視窗；除每個 (email, purpose) 60 秒冷卻外，
   * 沒有跨位址、IP 或 API key 層級的 app 層節流，輪換 email／purpose 的 burst 仍可觸發 Resend 429。
   * SENT 時為 null。
   */
  failureKind: EmailFailureKind | null;
}
export type EmailFailureKind = 'config' | 'service' | 'recipient';

const CONFIG_ERROR_NAMES = new Set([
  'missing_api_key', 'invalid_api_key', 'restricted_api_key', 'invalid_from_address',
]);

/** message 明確指涉 `to` 欄位（如 "Invalid `to` field."）；不得命中 "Invalid `from` field"。 */
const RECIPIENT_FIELD_PATTERN = /`to`|\binvalid\s+to\s+(?:field|address)\b/i;
/** message 指涉 `from` 欄位（MAIL_FROM 格式錯誤，Resend 回 422 validation_error）。 */
const FROM_FIELD_PATTERN = /`from`|\binvalid\s+from\b/i;

function isConfigFailure(error: { name?: string; statusCode?: number | null; message?: string }): boolean {
  if (error.statusCode === 401 || error.statusCode === 403) return true;
  if (error.name && CONFIG_ERROR_NAMES.has(error.name)) return true;
  const message = error.message ?? '';
  if (FROM_FIELD_PATTERN.test(message)) return true;
  return /domain is not verified|api key is invalid/i.test(message);
}

function classifyFailure(error: { name?: string; statusCode?: number | null; message?: string }): EmailFailureKind {
  if (isConfigFailure(error)) return 'config';
  const status = error.statusCode;
  // 無 statusCode：SDK 網路／連線／逾時錯誤；429 與 5xx：服務層級。
  if (typeof status !== 'number' || status === 429 || status >= 500) return 'service';
  // 4xx：只有「可證明是 to 收件人被拒」才算 recipient；其餘（MAIL_FROM 的 422、400、404、409…）
  // 都是請求層級問題，重試不會好 → fail-closed 歸 config（503 MAIL_001 並開視窗），不可把全站停擺藏成 200。
  if (RECIPIENT_FIELD_PATTERN.test(error.message ?? '')) return 'recipient';
  return 'config';
}

async function sendDetailed(to: string, subject: string, html: string): Promise<EmailSendDetail> {
  if (!process.env.RESEND_API_KEY) {           // 未設定時不擋主流程，只留 log
    console.warn('[email] RESEND_API_KEY 未設定，略過寄信：', subject, '→', to);
    return { result: 'SKIPPED_NO_KEY', configFailure: true, failureKind: 'config' };
  }
  try {
    const { error } = await resend().emails.send({ from: FROM(), to, subject, html });
    if (error) {
      console.error('[email] 寄送失敗', subject, to, error);  // 細節只進 server log
      const failureKind = classifyFailure(error);
      return { result: 'FAILED', configFailure: failureKind === 'config', failureKind };
    }
    return { result: 'SENT', configFailure: false, failureKind: null };
  } catch (e) {
    console.error('[email] 寄送丟出例外', subject, to, e);
    return { result: 'FAILED', configFailure: false, failureKind: 'service' };
  }
}

async function send(to: string, subject: string, html: string): Promise<EmailSendResult> {
  return (await sendDetailed(to, subject, html)).result;
}

/** 回傳詳細結果；呼叫端（dispatchVerificationCode）據此決定是否回 503。 */
export async function sendVerificationCodeEmail(
  to: string, code: string, purpose: 'REGISTER' | 'RESET_PASSWORD',
): Promise<EmailSendDetail> {
  const title = purpose === 'REGISTER' ? '註冊驗證碼' : '密碼重設驗證碼';
  const resetLink = purpose === 'RESET_PASSWORD'
    ? `${APP_URL}/tenant/reset-password?token=${code}&email=${encodeURIComponent(to)}`
    : undefined;
  return sendDetailed(to, `【VibeAI】${title}`, verificationHtml(title, code, resetLink));
}

/** 新預約 / 取消通知信（05 §3：`notifyNewBooking`/`notifyStaffBooking`/`notifyBookingCancel` 開關）。 */
export async function sendBookingNotifyEmail(
  to: string, kind: 'NEW' | 'CANCELLED', p: BookingNotifyDetails,
) {
  const title = kind === 'NEW' ? '新預約通知' : '預約取消通知';
  await send(to, `【${p.shopName}】${title} — ${p.customerName} ${p.serviceName}`,
             bookingHtml(title, p));
}

/**
 * 新商品訂單通知信（05 §3：`notifyProductOrder` 開關）。
 * ⚠️ 觸發點尚未接線：`POST /api/product-orders` 端點屬 Phase 5 B-3
 * （04-API-CONTRACTS.md §B-3），本階段（Phase 4）尚未建立該端點，先在此
 * export 備用；等該端點建立時，於其成功寫入 DB 後 `void sendProductOrderNotifyEmail(...)`。
 */
export async function sendProductOrderNotifyEmail(
  to: string, p: ProductOrderNotifyDetails,
) {
  await send(to, `【${p.shopName}】新商品訂單 ${p.orderNo}`, orderHtml(p));
}

/**
 * 顧客端「消費明細」信（issue #27 ③）——手動建單勾選「LINE 通知顧客消費明細」
 * 但該顧客沒綁 LINE 時的 Email 備援。收件人是**顧客**，與寄給店家的
 * `sendProductOrderNotifyEmail` 是兩封不同的信（見 templates.ts 同段說明）。
 * 回傳寄送結果，呼叫端據以顯示「已改寄 Email」或「未送出」，不得一律報成功。
 */
export async function sendProductOrderReceiptEmail(
  to: string, p: ProductOrderReceiptDetails,
): Promise<EmailSendResult> {
  return send(to, `【${p.shopName}】消費明細 ${p.orderNo}`, productOrderReceiptHtml(p));
}

/**
 * Support chat 客服對話串通知信（issue #25 B 段）。
 *
 * ⚠️ 與其他 `sendXxx()` 不同：收件人不是店家或顧客，是平台客服信箱
 * （`PLATFORM_SUPPORT_NOTIFY_EMAIL`）。呼叫端（`src/server/support-chat-threads.ts`）
 * 必須在信箱未設定時**自己**判定為 `SKIPPED_NO_RECIPIENT`、完全不呼叫這個函式——
 * 這裡不 fallback 到任何硬編碼信箱，那正是決策文件明文禁止的事。
 */
export async function sendSupportChatNotifyEmail(
  to: string, p: SupportChatNotifyDetails,
): Promise<EmailSendResult> {
  return send(to, `【VibeAI 客服】${p.shopName} — ${p.subject}`, supportChatNotifyHtml(p));
}
