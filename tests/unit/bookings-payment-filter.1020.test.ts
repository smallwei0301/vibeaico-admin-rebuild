import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePaymentStatusParam } from '@/lib/booking-payment-filter';

describe('#1020 預約列表付款篩選', () => {
  it('合法值帶入，非法值忽略', () => {
    for (const v of ['UNPAID', 'PAID_ONLINE', 'PAID_OFFLINE', 'REFUNDED'] as const) {
      expect(parsePaymentStatusParam(v)).toBe(v);
    }
    for (const v of ['', 'paid', 'unpaid', 'PARTIAL', null, undefined]) {
      expect(parsePaymentStatusParam(v)).toBe('');
    }
  });

  it('page.tsx 有綁定 paymentStatusFilter 的 select 並使用 i18n key', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/tenant/bookings/page.tsx'), 'utf8');
    expect(src).toContain('value={paymentStatusFilter}');
    expect(src).toContain('t.filters.paymentAll');
    expect(src).toContain('t.filters.paymentAriaLabel');
    expect(src).toContain('common.paymentStatus[k]');
    expect(src).toContain("parsePaymentStatusParam(params.get('paymentStatus'))");
  });
});
