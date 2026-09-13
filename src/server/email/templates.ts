/**
 * src/server/email/templates.ts — Resend 信件 HTML 模板（純函式，無 I/O）
 * 規格：docs/integration/05-EMAIL-RESEND.md §2。
 *
 * ⚠️ 05 分冊 §2 的 `bookingHtml`/`orderHtml` 範例程式碼本身沒有套用 `esc()`
 * （規格書自己的示意簡化），但同段落末尾明文要求「模板中所有插值（customerName
 * 等使用者輸入）先過 HTML escape」。本檔對所有使用者可控的字串插值
 * （customerName、serviceName、staffName、orderNo）一律套用 `esc()`。
 * `startAt`（系統產生的時間字串）與 `totalAmount`（數字）非使用者可控輸入，
 * 不需要 escape。`shopName` 目前未出現在任何模板 body 中（見 05 §2 範例：
 * 只用在 send.ts 組信件主旨，主旨是純文字非 HTML，不適用 HTML escape）——
 * 若之後模板 body 需要顯示店名，記得同樣套 esc()。
 */

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

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

/**
 * @param resetLink 僅 `purpose === 'RESET_PASSWORD'` 時提供（見 send.ts）；
 *   提供時在驗證碼下方多渲染一段「或點此連結重設密碼」的按鈕。
 *   連結字串本身先過 `esc()` 才插入 `href` 屬性（03 分冊已記錄的 Phase 2
 *   handoff：reset-password 頁讀 `?token=`（=驗證碼）與 `?email=` 兩個查詢參數）。
 */
export const verificationHtml = (title: string, code: string, resetLink?: string): string => shell(title, `
  <p style="font-size:14px;color:#3A3A3C;">您的驗證碼為（10 分鐘內有效）：</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#1A1A2E;
            text-align:center;margin:16px 0;">${code}</p>
  ${resetLink ? `
  <p style="text-align:center;margin:20px 0;">
    <a href="${esc(resetLink)}"
       style="display:inline-block;background:#C9A961;color:#1A1A2E;font-weight:700;
              font-size:14px;padding:10px 24px;border-radius:8px;text-decoration:none;">
      或點此連結重設密碼
    </a>
  </p>` : ''}
  <p style="font-size:12px;color:#8E8E93;">若非您本人操作，請忽略此信。</p>`);

/** 預約通知信（新預約 / 取消）所需欄位，對應 send.ts `sendBookingNotifyEmail` 的 `p` 參數。 */
export interface BookingNotifyDetails {
  shopName: string;
  customerName: string;
  serviceName: string;
  /** 已格式化的時間字串（系統產生，非使用者輸入） */
  startAt: string;
  /** 未指定服務人員時為 null / undefined，模板不渲染「服務人員」列 */
  staffName?: string | null;
}

export const bookingHtml = (title: string, p: BookingNotifyDetails): string => shell(title, `
  <table style="font-size:14px;color:#3A3A3C;line-height:2;">
    <tr><td style="color:#8E8E93;padding-right:16px;">顧客</td><td>${esc(p.customerName)}</td></tr>
    <tr><td style="color:#8E8E93;">服務</td><td>${esc(p.serviceName)}</td></tr>
    <tr><td style="color:#8E8E93;">時間</td><td>${p.startAt}</td></tr>
    ${p.staffName ? `<tr><td style="color:#8E8E93;">服務人員</td><td>${esc(p.staffName)}</td></tr>` : ''}
  </table>`);

/** 新商品訂單通知信所需欄位，對應 send.ts `sendProductOrderNotifyEmail` 的 `p` 參數。 */
export interface ProductOrderNotifyDetails {
  shopName: string;
  orderNo: string;
  customerName: string;
  totalAmount: number;
}

export const orderHtml = (p: ProductOrderNotifyDetails): string => shell('新商品訂單', `
  <p style="font-size:14px;">訂單 ${esc(p.orderNo)} — ${esc(p.customerName)}，
     金額 NT$ ${p.totalAmount.toLocaleString()}</p>`);

/* ------------------------------------------------------------------ 消費明細
 * 顧客端「消費明細」信 —— issue #27 ③。
 *
 * 與上面的 `orderHtml`（新商品訂單通知，收件人是**店家**、只有一行摘要）是兩件
 * 不同的信，刻意不共用：這封寄給**顧客**，是手動建單時勾選「LINE 通知顧客消費
 * 明細（未綁 LINE 自動改寄 Email）」的 Email 備援，內容必須逐項列出品項/數量/
 * 金額與訂單編號。把它塞進 orderHtml 會讓店家通知信也長出明細表，是另一種錯。 */

/** 消費明細信的單一品項（名稱/數量/單價快照，取自 product_order_items） */
export interface ProductOrderReceiptItem {
  name: string;
  quantity: number;
  /** 單價（小計由模板算 quantity × price） */
  price: number;
}

export interface ProductOrderReceiptDetails {
  shopName: string;
  orderNo: string;
  customerName: string;
  items: ProductOrderReceiptItem[];
  totalAmount: number;
}

export const productOrderReceiptHtml = (p: ProductOrderReceiptDetails): string =>
  shell(`${esc(p.shopName)} 消費明細`, `
  <p style="font-size:14px;color:#3A3A3C;">${esc(p.customerName)} 您好，感謝您的購買！以下是本次消費明細：</p>
  <p style="font-size:13px;color:#8E8E93;margin:4px 0 12px;">訂單編號：${esc(p.orderNo)}</p>
  <table style="font-size:14px;color:#3A3A3C;line-height:1.9;width:100%;border-collapse:collapse;">
    <tr style="color:#8E8E93;">
      <th align="left" style="border-bottom:1px solid #E5E5EA;font-weight:400;">品項</th>
      <th align="right" style="border-bottom:1px solid #E5E5EA;font-weight:400;">數量</th>
      <th align="right" style="border-bottom:1px solid #E5E5EA;font-weight:400;">小計</th>
    </tr>
    ${p.items.map((i) => `
    <tr>
      <td>${esc(i.name)}</td>
      <td align="right">${i.quantity}</td>
      <td align="right">NT$ ${(i.price * i.quantity).toLocaleString()}</td>
    </tr>`).join('')}
    <tr>
      <td style="border-top:1px solid #E5E5EA;font-weight:700;">合計</td>
      <td style="border-top:1px solid #E5E5EA;"></td>
      <td align="right" style="border-top:1px solid #E5E5EA;font-weight:700;">
        NT$ ${p.totalAmount.toLocaleString()}</td>
    </tr>
  </table>`);
