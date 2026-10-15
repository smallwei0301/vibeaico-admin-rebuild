import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partialPaymentBreakdown } from '@/lib/public-partial-payment';
import { mapTourOrder } from '@/server/mappers';
import { publicTourRequestPage as i18n } from '@/i18n/zh-TW/pages/public-tour-request';

const base = { totalAmount: 10000 } as const;
const src = (p: string) => readFileSync(p, 'utf8');

describe('#988 partialPaymentBreakdown', () => {
  it('PARTIAL 有已收：回傳已付與尾款', () => {
    expect(partialPaymentBreakdown({ ...base, paymentStatus: 'PARTIAL', paidAmount: 3000 }))
      .toEqual({ paidAmount: 3000, balanceDue: 7000 });
  });
  it('PARTIAL 無已收或不可靠：null', () => {
    for (const paidAmount of [undefined, 0, -1, Number.NaN, 10000, 12000]) {
      expect(partialPaymentBreakdown({ ...base, paymentStatus: 'PARTIAL', paidAmount })).toBeNull();
    }
  });
  it('PAID／UNPAID：null', () => {
    expect(partialPaymentBreakdown({ ...base, paymentStatus: 'PAID', paidAmount: 10000 })).toBeNull();
    expect(partialPaymentBreakdown({ ...base, paymentStatus: 'UNPAID', paidAmount: 0 })).toBeNull();
  });
  it('含退款：尾款不扣 refundedAmount（沿用 guide-action-inbox 的 total − paid）', () => {
    const o = { ...base, paymentStatus: 'PARTIAL' as const, paidAmount: 3000, refundedAmount: 1000 };
    expect(partialPaymentBreakdown(o)).toEqual({ paidAmount: 3000, balanceDue: 7000 });
  });
});

describe('#988 mapper 與頁面', () => {
  const derived = { tripTitle: '', planName: '', departsOn: '', startTime: '', paymentMethodLabel: '' };
  it('mapTourOrder 讀 paid_amount；null／缺失為 undefined', () => {
    const row = { id: 'o', order_no: 'N', trip_id: 't', total_amount: 100, payment_status: 'PARTIAL', created_at: 'x' };
    expect(mapTourOrder({ ...row, paid_amount: '30' }, derived).paidAmount).toBe(30);
    expect(mapTourOrder({ ...row, paid_amount: null }, derived).paidAmount).toBeUndefined();
    expect(mapTourOrder(row, derived).paidAmount).toBeUndefined();
  });
  it('頁面：總額有標籤、PARTIAL 分支、無中文字面量', () => {
    const page = src('src/app/s/[shopCode]/requests/[orderId]/page.tsx');
    expect(page).toContain('t.status.fields.totalAmount');
    expect(page).toContain('partialPaymentBreakdown(order)');
    expect(page).toContain('t.status.fields.paidAmount');
    expect(page).toContain('t.status.fields.balanceDue');
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/[一-鿿]/);
  });
  it('PARTIAL 有明細：改用只確認尾款期限的文案，不再請旅客確認金額', () => {
    const page = src('src/app/s/[shopCode]/requests/[orderId]/page.tsx');
    expect(page).toContain('t.status.paymentPartialWithBreakdownDescription');
    const withBreakdown = i18n.status.paymentPartialWithBreakdownDescription;
    expect(withBreakdown).not.toBe(i18n.status.paymentDescription.PARTIAL);
    expect(withBreakdown).not.toContain('金額');
    expect(withBreakdown).toContain('尾款');
  });
  it('PARTIAL 無明細（partialPaymentBreakdown 為 null）仍保留原通用文案', () => {
    expect(partialPaymentBreakdown({ ...base, paymentStatus: 'PARTIAL', paidAmount: undefined })).toBeNull();
    expect(i18n.status.paymentDescription.PARTIAL).toContain('實際已付金額、待付金額與期限請向店家確認');
  });
  it('公開查詢 select * 帶出 paid_amount', () => {
    expect(src('src/server/public-tour-request.ts')).toMatch(/from\('tour_orders'\)\.select\('\*'\)/);
  });
});
