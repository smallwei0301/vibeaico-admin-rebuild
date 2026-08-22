import { describe, it, expect } from 'vitest';
import { esc, verificationHtml, bookingHtml, orderHtml } from '@/server/email/templates';

/* ------------------------------------------------------------------- esc */
// 05-EMAIL-RESEND.md §2 末段：模板中所有使用者輸入插值先過 HTML escape。
describe('esc (05 §2)', () => {
  it('轉義 & < > " \' 五個字元', () => {
    expect(esc('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('一般文字不受影響', () => {
    expect(esc('王小明 / 臉部保養')).toBe('王小明 / 臉部保養');
  });

  it('<script> 標籤逐字轉義，不留任何未轉義的角括號', () => {
    const out = esc('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

/* ------------------------------------------------------------- bookingHtml */
describe('bookingHtml (05 §2)', () => {
  const base = {
    shopName: '示範美學工作室',
    customerName: '王小明',
    serviceName: '臉部保養',
    startAt: '2026-08-22 10:00',
  };

  it('customerName 含 <script> → 輸出不含未轉義的 <script>（XSS 防護）', () => {
    const html = bookingHtml('新預約通知', { ...base, customerName: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('serviceName 含特殊字元 → 一併轉義', () => {
    const html = bookingHtml('新預約通知', { ...base, serviceName: 'A&B<課程>' });
    expect(html).toContain('A&amp;B&lt;課程&gt;');
  });

  it('staffName 為 null → 不出現「服務人員」列', () => {
    const html = bookingHtml('新預約通知', { ...base, staffName: null });
    expect(html).not.toContain('服務人員');
  });

  it('staffName 未帶（undefined）→ 不出現「服務人員」列', () => {
    const html = bookingHtml('新預約通知', { ...base });
    expect(html).not.toContain('服務人員');
  });

  it('staffName 非 null → 出現「服務人員」列，且值已轉義', () => {
    const html = bookingHtml('新預約通知', { ...base, staffName: '陳<師傅>' });
    expect(html).toContain('服務人員');
    expect(html).toContain('陳&lt;師傅&gt;');
  });

  it('title 帶入 <h2> 標題', () => {
    const html = bookingHtml('預約取消通知', base);
    expect(html).toContain('預約取消通知');
  });
});

/* ---------------------------------------------------------- verificationHtml */
describe('verificationHtml — RESET_PASSWORD 重設連結（03 分冊 Phase 2 handoff）', () => {
  it('未帶 resetLink（REGISTER 情境）→ 不含重設密碼連結', () => {
    const html = verificationHtml('註冊驗證碼', '123456');
    expect(html).not.toContain('重設密碼');
    expect(html).not.toContain('href=');
  });

  it('帶 resetLink（RESET_PASSWORD 情境）→ 含 ?token= 與 encodeURIComponent 後的 email', () => {
    const link = 'http://localhost:3000/tenant/reset-password?token=123456&email=' +
      encodeURIComponent('a+b@example.com');
    const html = verificationHtml('密碼重設驗證碼', '123456', link);
    expect(html).toContain('?token=123456');
    expect(html).toContain(encodeURIComponent('a+b@example.com'));
    expect(html).toContain('重設密碼');
  });

  it('resetLink 中的 & 於 href 屬性內被 esc() 轉成 &amp;', () => {
    const link = 'http://localhost:3000/tenant/reset-password?token=123456&email=a%40b.com';
    const html = verificationHtml('密碼重設驗證碼', '123456', link);
    expect(html).toContain('href="http://localhost:3000/tenant/reset-password?token=123456&amp;email=a%40b.com"');
  });

  it('驗證碼本身依然顯示在信件中', () => {
    const html = verificationHtml('註冊驗證碼', '654321');
    expect(html).toContain('654321');
  });
});

/* ------------------------------------------------------------------ orderHtml */
describe('orderHtml (05 §2)', () => {
  it('金額以 toLocaleString 千分位格式輸出', () => {
    const html = orderHtml({
      shopName: '示範美學工作室', orderNo: 'PO2608220001', customerName: '林美麗', totalAmount: 12345,
    });
    expect(html).toContain((12345).toLocaleString());
    expect(html).toContain('12,345');
  });

  it('customerName / orderNo 含特殊字元 → 轉義', () => {
    const html = orderHtml({
      shopName: '示範', orderNo: 'PO<1>', customerName: 'A&B', totalAmount: 100,
    });
    expect(html).toContain('PO&lt;1&gt;');
    expect(html).toContain('A&amp;B');
  });
});
