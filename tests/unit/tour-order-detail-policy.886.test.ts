import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { refundPolicyText } from '@/lib/tour-order-detail-labels';
import { publicTourRequestPage } from '@/i18n/zh-TW/pages/public-tour-request';

const page = readFileSync('src/app/tenant/tour-orders/page.tsx', 'utf8');
const map = publicTourRequestPage.form.cancellationPolicy;

describe('#886 訂單詳情政策／付款方式', () => {
  it('refundPolicyText 對應旅客端同一份條文', () => {
    expect(refundPolicyText('STANDARD', map)).toBe(map.STANDARD);
    expect(refundPolicyText('STRICT', map)).toBe(map.STRICT);
  });
  it('null／未知快照回傳 null', () => {
    expect(refundPolicyText(null, map)).toBeNull();
    expect(refundPolicyText(undefined, map)).toBeNull();
    expect(refundPolicyText('WEIRD', map)).toBeNull();
    expect(refundPolicyText('toString', map)).toBeNull();
  });
  it('詳情頁透過政策 map 顯示 refundPolicySnapshot 與無紀錄佔位', () => {
    expect(page).toContain('refundPolicyText(detail.refundPolicySnapshot, publicTourRequestPage.form.cancellationPolicy)');
    expect(page).toContain('t.detail.noPolicy');
  });
  it('已退款金額大於 0 才顯示並用 formatCurrency', () => {
    expect(page).toMatch(/detail\.refundedAmount != null && detail\.refundedAmount > 0/);
    expect(page).toContain('formatCurrency(detail.refundedAmount)');
  });
  it('付款方式空白時顯示未指定（詳情與列表）', () => {
    expect(page).toContain('detail.paymentMethodLabel || <span');
    expect(page).toContain('o.paymentMethodLabel || t.detail.noMethod');
  });
});
