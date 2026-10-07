import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPendingTourRequest, tourPaymentActions } from '@/lib/tour-order-payment-actions';

const o = (status: string, paymentStatus: string, depositAmount: number | null = 0, totalAmount = 1000) =>
  ({ status, paymentStatus, depositAmount, totalAmount });

describe('tourPaymentActions（列表列與詳情 Modal 共用）', () => {
  it.each([
    ['PENDING/UNPAID 只有確認收款', o('PENDING', 'UNPAID'), ['confirmPayment']],
    ['PENDING/UNPAID 有訂金仍只有確認收款', o('PENDING', 'UNPAID', 300), ['confirmPayment']],
    ['CONFIRMED/UNPAID 有訂金', o('CONFIRMED', 'UNPAID', 300), ['confirmDeposit', 'confirmFull']],
    ['CONFIRMED/UNPAID 無訂金', o('CONFIRMED', 'UNPAID', 0), ['confirmPayment']],
    ['CONFIRMED/UNPAID 訂金等於總額', o('CONFIRMED', 'UNPAID', 1000), ['confirmPayment']],
    ['CONFIRMED/PARTIAL', o('CONFIRMED', 'PARTIAL', 300), ['confirmBalance']],
    ['CONFIRMED/PAID', o('CONFIRMED', 'PAID', 300), []],
    ['CANCELLED/UNPAID', o('CANCELLED', 'UNPAID', 300), []],
    ['CANCELLED/PARTIAL', o('CANCELLED', 'PARTIAL', 300), []],
    ['COMPLETED/PAID', o('COMPLETED', 'PAID'), []],
    ['CONFIRMED/REFUNDED', o('CONFIRMED', 'REFUNDED'), []],
  ])('%s', (_n, order, expected) => {
    expect(tourPaymentActions(order)).toEqual(expected);
  });

  it('未接受的 REQUEST（PENDING）沒有收款動作；接受後（CONFIRMED/UNPAID）才有', () => {
    const req = { ...o('PENDING', 'UNPAID', 300), salesMode: 'REQUEST' };
    expect(isPendingTourRequest(req)).toBe(true);
    expect(tourPaymentActions(req)).toEqual([]);
    const accepted = { ...o('CONFIRMED', 'UNPAID', 300), salesMode: 'REQUEST' };
    expect(isPendingTourRequest(accepted)).toBe(false);
    expect(tourPaymentActions(accepted)).toEqual(['confirmDeposit', 'confirmFull']);
    expect(tourPaymentActions({ ...o('CONFIRMED', 'UNPAID', 0), salesMode: 'REQUEST' })).toEqual(['confirmPayment']);
    // 非 REQUEST 的 PENDING（固定團／即時預約）建單即鎖名額，仍可確認收款
    expect(tourPaymentActions({ ...o('PENDING', 'UNPAID'), salesMode: 'INSTANT' })).toEqual(['confirmPayment']);
  });

  it('詳情頁接受／拒絕區塊與收款動作共用 isPendingTourRequest（互斥、同一來源）', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/tenant/tour-orders/page.tsx'), 'utf8');
    expect(src).toContain('isPendingTourRequest(detail) ?');
    expect(src).not.toContain("detail.salesMode === 'REQUEST' && detail.status === 'PENDING'");
  });

  it('頁面的列表列與詳情 Modal 都呼叫同一函式，且不再內嵌 hasPartialDeposit 條件', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/tenant/tour-orders/page.tsx'), 'utf8');
    expect(src.match(/tourPaymentActions\(/g)?.length).toBe(2);
    expect(src).not.toContain('hasPartialDeposit');
  });
});
