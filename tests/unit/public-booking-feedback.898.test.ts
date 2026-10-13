/** #898：旅客預約流程的死連結、人數回饋、無團次文案（原始碼斷言）。 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicTourBookingPage as bookingT } from '@/i18n/zh-TW/pages/public-tour-booking';
import { publicTourRequestPage as requestT } from '@/i18n/zh-TW/pages/public-tour-request';

const read = (p: string) => readFileSync(p, 'utf8');
const base = 'src/app/s/[shopCode]/';
const forms = [
  `${base}plans/[planId]/book/BookingForm.tsx`,
  `${base}plans/[planId]/request/RequestForm.tsx`,
];

describe('#898 旅客預約流程', () => {
  it('狀態頁與店家首頁沒有通往 my-orders 的連結', () => {
    for (const f of [`${base}requests/[orderId]/page.tsx`, `${base}page.tsx`]) {
      expect(read(f), f).not.toMatch(/my-orders|myOrdersLink/);
    }
    // 路由本身保留（可能被加入書籤）
    expect(read(`${base}my-orders/page.tsx`)).toContain('MyOrdersSearch');
    expect(read(`${base}my-orders/page.tsx`)).not.toContain('/api/public/tour-requests/mine');
  });

  it('兩個表單都在人數不合時顯示 partySizeOutOfRange 並以 aria-describedby 關聯', () => {
    for (const f of forms) {
      const src = read(f);
      expect(src, f).toContain('t.errors.partySizeOutOfRange(plan.minParty, plan.maxParty)');
      expect(src, f).toContain('aria-describedby={partySizeInvalid');
      expect(src, f).toContain('id="partySize-error"');
      expect(src, f).toMatch(/partySize-error" className="text-sm text-danger"/);
      expect(src, f).toContain("e.target.value === '' ? NaN");
    }
  });

  it('partySizeOutOfRange 帶出最少／最多人數', () => {
    expect(bookingT.errors.partySizeOutOfRange(2, 8)).toContain('2');
    expect(bookingT.errors.partySizeOutOfRange(2, 8)).toContain('8');
    expect(requestT.errors.partySizeOutOfRange(3, 5)).toMatch(/3.*5/);
  });

  it('無團次文案不再指向不存在的「下方聯絡方式」，改指向已存在的返回店家頁連結', () => {
    expect(bookingT.form.departuresEmpty).not.toContain('下方聯絡方式');
    expect(requestT.form.departuresEmpty).not.toContain('下方聯絡方式');
    expect(bookingT.form.departuresEmpty).toContain(bookingT.form.backToShop);
    expect(requestT.form.departuresEmpty).toContain(requestT.form.backToShop);
    for (const f of forms) expect(read(f), f).toContain('t.form.backToShop');
  });
});
