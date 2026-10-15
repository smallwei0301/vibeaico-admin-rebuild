import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { travelerDepositDue } from '@/lib/tour-order-payment-display';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';

const o = (status: string, paymentStatus: string, depositAmount: number | null, totalAmount = 1000, salesMode?: string) =>
  ({ status, paymentStatus, depositAmount, totalAmount, salesMode });

describe('travelerDepositDue（#1017）', () => {
  it('CONFIRMED + UNPAID + 0<定金<總額 回定金', () => {
    expect(travelerDepositDue(o('CONFIRMED', 'UNPAID', 300))).toBe(300);
    expect(travelerDepositDue(o('CONFIRMED', 'UNPAID', 300, 1000, 'REQUEST'))).toBe(300);
  });
  it.each([
    ['定金 0', o('CONFIRMED', 'UNPAID', 0)],
    ['定金等於總額', o('CONFIRMED', 'UNPAID', 1000)],
    ['PARTIAL', o('CONFIRMED', 'PARTIAL', 300)],
    ['PAID', o('CONFIRMED', 'PAID', 300)],
    ['CANCELLED', o('CANCELLED', 'UNPAID', 300)],
    ['PENDING REQUEST', o('PENDING', 'UNPAID', 300, 1000, 'REQUEST')],
    ['PENDING FIXED_DEPARTURE', o('PENDING', 'UNPAID', 300, 1000, 'FIXED_DEPARTURE')],
  ])('%s 回 null', (_n, order) => {
    expect(travelerDepositDue(order)).toBeNull();
  });

  it('狀態頁使用 travelerDepositDue 與新文案', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/s/[shopCode]/requests/[orderId]/page.tsx'), 'utf8');
    expect(src).toContain('travelerDepositDue');
    expect(src).toContain('t.status.fields.depositDue');
    expect(src).toContain('t.status.paymentDepositDueDescription');
    expect(src).toContain('t.status.confirmedDepositDescription');
    expect(src).toContain('t.status.confirmedDepositNoDeadlineDescription');
  });

  it('i18n 新文案含金額', () => {
    expect(t.status.paymentDepositDueDescription('NT$300')).toContain('NT$300');
    expect(t.status.confirmedDepositDescription('明天', 'NT$300')).toContain('NT$300');
    expect(t.status.confirmedDepositDescription('明天', 'NT$300')).toContain('明天');
    expect(t.status.confirmedDepositNoDeadlineDescription('NT$300')).toContain('NT$300');
    expect(t.status.fields.depositDue).toBeTruthy();
  });
});
