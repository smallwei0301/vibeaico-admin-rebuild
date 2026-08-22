/**
 * src/server/email/send.ts — 寄信模組（Phase 2 子集）
 * 規格：docs/integration/05-EMAIL-RESEND.md §2。
 *
 * 本檔僅轉錄 05 分冊 §2 的 `send()` 與 `sendVerificationCodeEmail()`（含其 HTML
 * 模板），因為 send-verification-code route（Phase 2）依賴它。05 分冊其餘的
 * 通知信模板與寄送函式——`sendBookingNotifyEmail()`（新預約/取消通知）、
 * `sendProductOrderNotifyEmail()`（新商品訂單通知）、以及獨立的
 * `src/server/email/templates.ts`（`bookingHtml`/`orderHtml`）——屬於 Phase 4
 * （預約/訂單通知，見 05 分冊 §3 觸發點表格），本階段不建立；屆時比照下方
 * `verificationHtml` 的寫法，在 templates.ts 補上 `shell()`/`bookingHtml()`/
 * `orderHtml()` 並在此檔新增對應的 send 函式即可。
 */

import { Resend } from 'resend';

const resend = () => new Resend(process.env.RESEND_API_KEY!);
const FROM = () => process.env.MAIL_FROM ?? 'onboarding@resend.dev';

async function send(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {           // 未設定時不擋主流程，只留 log
    console.warn('[email] RESEND_API_KEY 未設定，略過寄信：', subject, '→', to);
    return;
  }
  const { error } = await resend().emails.send({ from: FROM(), to, subject, html });
  if (error) console.error('[email] 寄送失敗', subject, to, error);  // 寄信失敗不讓 API 失敗
}

export async function sendVerificationCodeEmail(
  to: string, code: string, purpose: 'REGISTER' | 'RESET_PASSWORD',
) {
  const title = purpose === 'REGISTER' ? '註冊驗證碼' : '密碼重設驗證碼';
  await send(to, `【VibeAI】${title}`, verificationHtml(title, code));
}

/* ---------------------------------------------------------------------- *
 * 以下為 05 分冊 §2 `src/server/email/templates.ts` 中，本階段用得到的部分
 * （`shell` 骨架 + `verificationHtml`）。之後補齊 Phase 4 模板時，建議把
 * 這些搬去獨立的 `templates.ts` 檔並從這裡 import，行為不變。
 * ---------------------------------------------------------------------- */

const shell = (title: string, inner: string) => `
<div style="font-family:'Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <div style="background:#1A1A2E;border-radius:12px 12px 0 0;padding:20px 24px;">
    <span style="color:#C9A961;font-size:18px;font-weight:700;">VibeAI</span>
  </div>
  <div style="border:1px solid #E5E5EA;border-top:0;border-radius:0 0 12px 12px;padding:24px;">
    <h2 style="font-size:16px;color:#1A1A2E;margin:0 0 16px;">${title}</h2>
    ${inner}
    <p style="color:#8E8E93;font-size:12px;margin-top:24px;">此信件由系統自動發送，請勿直接回覆。</p>
  </div>
</div>`;

const verificationHtml = (title: string, code: string) => shell(title, `
  <p style="font-size:14px;color:#3A3A3C;">您的驗證碼為（10 分鐘內有效）：</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#1A1A2E;
            text-align:center;margin:16px 0;">${code}</p>
  <p style="font-size:12px;color:#8E8E93;">若非您本人操作，請忽略此信。</p>`);
