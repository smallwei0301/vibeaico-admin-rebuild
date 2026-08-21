# 05 — 寄信（Resend，Phase 4）

> 目標：驗證碼信、密碼重設信、預約/訂單通知信。全部經由一個寄信模組，
> 通知類信件必須尊重 `tenant_settings.notify` 的開關。

---

## 1. Resend 前置作業（人工）

1. 註冊 https://resend.com → API Keys → 建 key → 填 `RESEND_API_KEY`。
2. Domains → 加自己的網域 → 照指示加 DNS（SPF/DKIM）→ 驗證通過。
   `MAIL_FROM` 用該網域，例如 `VibeAI <noreply@yourdomain.com>`。
3. 還沒有網域時的過渡做法：`MAIL_FROM="onboarding@resend.dev"`
   （只能寄給自己帳號的信箱，夠開發用；**上線前必須換驗證網域**）。

---

## 2. 寄信模組

### `src/server/email/send.ts`

```ts
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

export async function sendBookingNotifyEmail(
  to: string, kind: 'NEW' | 'CANCELLED', p: {
    shopName: string; customerName: string; serviceName: string;
    startAt: string; staffName?: string | null },
) {
  const title = kind === 'NEW' ? '新預約通知' : '預約取消通知';
  await send(to, `【${p.shopName}】${title} — ${p.customerName} ${p.serviceName}`,
             bookingHtml(title, p));
}

export async function sendProductOrderNotifyEmail(
  to: string, p: { shopName: string; orderNo: string; customerName: string; totalAmount: number },
) {
  await send(to, `【${p.shopName}】新商品訂單 ${p.orderNo}`, orderHtml(p));
}
```

### `src/server/email/templates.ts`（同資料夾，被 send.ts import）

純函式回 HTML 字串；inline style、寬 480px、品牌色 `#C9A961`（tokens.css 的
`--color-primary`）。骨架：

```ts
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

export const verificationHtml = (title: string, code: string) => shell(title, `
  <p style="font-size:14px;color:#3A3A3C;">您的驗證碼為（10 分鐘內有效）：</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#1A1A2E;
            text-align:center;margin:16px 0;">${code}</p>
  <p style="font-size:12px;color:#8E8E93;">若非您本人操作，請忽略此信。</p>`);

export const bookingHtml = (title: string, p: any) => shell(title, `
  <table style="font-size:14px;color:#3A3A3C;line-height:2;">
    <tr><td style="color:#8E8E93;padding-right:16px;">顧客</td><td>${p.customerName}</td></tr>
    <tr><td style="color:#8E8E93;">服務</td><td>${p.serviceName}</td></tr>
    <tr><td style="color:#8E8E93;">時間</td><td>${p.startAt}</td></tr>
    ${p.staffName ? `<tr><td style="color:#8E8E93;">服務人員</td><td>${p.staffName}</td></tr>` : ''}
  </table>`);

export const orderHtml = (p: any) => shell('新商品訂單', `
  <p style="font-size:14px;">訂單 ${p.orderNo} — ${p.customerName}，
     金額 NT$ ${p.totalAmount.toLocaleString()}</p>`);
```

⚠️ 模板中所有插值（customerName 等使用者輸入）先過 HTML escape：

```ts
const esc = (s: string) => s.replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
```

---

## 3. 觸發點與開關對應（notify 群組，鍵名見 `src/config/tenant-settings.ts`）

| 事件（觸發位置） | 開關 | 收件人 |
|---|---|---|
| 註冊 / 忘記密碼（03 分冊） | 無條件寄 | 使用者 email |
| 新預約建立（POST `/api/bookings`、LINE/公開頁來源） | `notifyNewBooking` | 店家（basic.tenantEmail；空則跳過） |
| 預約取消（cancel 端點） | `notifyBookingCancel` | 店家 |
| 指定員工的新預約 | `notifyStaffBooking` | 該員工 email |
| 新商品訂單 | `notifyProductOrder` | 店家 |

實作規約：

- 在動作端點成功寫 DB 之後呼叫，**用 `void sendXxx(...)` 不 await**（寄信慢或失敗
  都不可拖垮 API 回應；函式內部已吞錯）。
- 讀開關：`tenant_settings.notify` jsonb → `notifySettingsSchema.parse()` 補預設。
- 「顧客端」通知（確認/提醒/取消推播）走 **LINE 推播**，不是 email —— 見 06 分冊；
  預約提醒與生日/喚回屬排程 —— 見 07 分冊。

---

## 本冊驗收

- [ ] 註冊流程真的收到驗證碼信（檢查 spam）
- [ ] Resend Dashboard → Logs 看得到寄送紀錄
- [ ] 關閉 `notifyNewBooking` 後建預約不寄信；打開會寄
- [ ] `RESEND_API_KEY` 留空時 API 全部正常運作（只少寄信、console 有 warn）
- [ ] 模板在 Gmail 手機版顯示正常（寬 480、無外部圖片依賴）
