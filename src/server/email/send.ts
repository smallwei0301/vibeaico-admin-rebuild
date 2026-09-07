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
  verificationHtml, bookingHtml, orderHtml, productOrderReceiptHtml,
  type BookingNotifyDetails, type ProductOrderNotifyDetails,
  type ProductOrderReceiptDetails,
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

async function send(to: string, subject: string, html: string): Promise<EmailSendResult> {
  if (!process.env.RESEND_API_KEY) {           // 未設定時不擋主流程，只留 log
    console.warn('[email] RESEND_API_KEY 未設定，略過寄信：', subject, '→', to);
    return 'SKIPPED_NO_KEY';
  }
  const { error } = await resend().emails.send({ from: FROM(), to, subject, html });
  if (error) {
    console.error('[email] 寄送失敗', subject, to, error);  // 寄信失敗不讓 API 失敗
    return 'FAILED';
  }
  return 'SENT';
}

export async function sendVerificationCodeEmail(
  to: string, code: string, purpose: 'REGISTER' | 'RESET_PASSWORD',
) {
  const title = purpose === 'REGISTER' ? '註冊驗證碼' : '密碼重設驗證碼';
  const resetLink = purpose === 'RESET_PASSWORD'
    ? `${APP_URL}/tenant/reset-password?token=${code}&email=${encodeURIComponent(to)}`
    : undefined;
  await send(to, `【VibeAI】${title}`, verificationHtml(title, code, resetLink));
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
