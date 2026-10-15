import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { listPaymentLine, detailPaymentRows } from '@/lib/tour-order-payment-display';
import { MOCK_TOUR_ORDERS } from '@/mock/tours';
import { tourOrdersPage as t } from '@/i18n/zh-TW/pages/tour-orders';

const base = { status: 'CONFIRMED', paymentStatus: 'UNPAID', totalAmount: 10000, depositAmount: 3000 } as const;

describe('#1000 店家團體訂單：依實收金額顯示', () => {
  it('UNPAID 有定金：列表只顯示應收定金，不顯示已收', () => {
    expect(listPaymentLine({ ...base })).toEqual({ kind: 'depositDue', amount: 3000 });
    expect(detailPaymentRows({ ...base })).toEqual({ depositDue: 3000, paid: null, balanceDue: null });
  });
  it('PARTIAL：顯示實收與待收尾款（total − paid）', () => {
    const o = { ...base, paymentStatus: 'PARTIAL', paidAmount: 4000 } as const;
    expect(listPaymentLine(o)).toEqual({ kind: 'paid', amount: 4000 });
    expect(detailPaymentRows(o)).toEqual({ depositDue: null, paid: 4000, balanceDue: 6000 });
  });
  it('PAID：不顯示待收尾款，顯示已收金額', () => {
    const o = { ...base, paymentStatus: 'PAID', paidAmount: 10000 } as const;
    expect(listPaymentLine(o)).toBeNull();
    expect(detailPaymentRows(o)).toEqual({ depositDue: null, paid: 10000, balanceDue: null });
  });
  it('PARTIAL 但 paidAmount 缺失（mock）：視為未知，不顯示已收與尾款', () => {
    const o = { ...base, paymentStatus: 'PARTIAL' } as const;
    expect(listPaymentLine(o)).toBeNull();
    expect(detailPaymentRows(o)).toEqual({ depositDue: null, paid: null, balanceDue: null });
  });
  it('CANCELLED + PARTIAL：保留已收金額、不顯示待收尾款', () => {
    const o = { ...base, status: 'CANCELLED', paymentStatus: 'PARTIAL', paidAmount: 4000 } as const;
    expect(detailPaymentRows(o)).toEqual({ depositDue: null, paid: 4000, balanceDue: null });
  });
  it('CANCELLED + UNPAID 有定金：列表不顯示應收定金', () => {
    const o = { ...base, status: 'CANCELLED' } as const;
    expect(listPaymentLine(o)).toBeNull();
  });
  it('CANCELLED + PARTIAL：列表仍顯示已收', () => {
    const o = { ...base, status: 'CANCELLED', paymentStatus: 'PARTIAL', paidAmount: 4000 } as const;
    expect(listPaymentLine(o)).toEqual({ kind: 'paid', amount: 4000 });
  });
  it('paidAmount 非有限／<=0 視為未知', () => {
    for (const paidAmount of [0, -1, NaN, Infinity]) {
      expect(detailPaymentRows({ ...base, paymentStatus: 'PARTIAL', paidAmount }).paid).toBeNull();
    }
  });
  it('CANCELLED + UNPAID 有定金：詳情不顯示應收定金', () => {
    expect(detailPaymentRows({ ...base, status: 'CANCELLED' })).toEqual({ depositDue: null, paid: null, balanceDue: null });
  });
  it('應收定金：UNPAID 未取消才有；PARTIAL／PAID 沒有', () => {
    expect(detailPaymentRows({ ...base }).depositDue).toBe(3000);
    expect(detailPaymentRows({ ...base, paymentStatus: 'PARTIAL', paidAmount: 4000 }).depositDue).toBeNull();
    expect(detailPaymentRows({ ...base, paymentStatus: 'PAID', paidAmount: 10000 }).depositDue).toBeNull();
    expect(detailPaymentRows({ ...base, depositAmount: 0 }).depositDue).toBeNull();
  });
  it('列表與詳情的應收定金在所有 status／paymentStatus 組合一致', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const) {
      for (const paymentStatus of ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED'] as const) {
        for (const paidAmount of [undefined, 4000]) {
          const o = { ...base, status, paymentStatus, paidAmount } as never;
          const list = listPaymentLine(o);
          const listDue = list?.kind === 'depositDue' ? list.amount : null;
          expect(detailPaymentRows(o).depositDue, `${status}/${paymentStatus}/${paidAmount}`).toBe(listDue);
        }
      }
    }
  });
  it('mock 種子：PARTIAL／PAID 訂單皆有合法 paidAmount', () => {
    for (const o of MOCK_TOUR_ORDERS) {
      if (o.paymentStatus === 'PAID') expect(o.paidAmount, o.id).toBe(o.totalAmount);
      if (o.paymentStatus === 'PARTIAL') {
        expect(o.paidAmount, o.id).toBeGreaterThan(0);
        expect(o.paidAmount, o.id).toBeLessThan(o.totalAmount);
      }
      // DB 約束 tour_orders_refunded_paid_amount_ck
      if (o.paymentStatus === 'REFUND_PENDING') expect(o.paidAmount, o.id).toBeGreaterThan(0);
      if (o.paymentStatus === 'REFUNDED') {
        expect(o.paidAmount, o.id).toBeGreaterThan(0);
        expect(o.refundedAmount, o.id).toBeGreaterThan(0);
      }
    }
  });
  it('mock 種子 to_8（退款中）：詳情顯示實收 2670，無應收定金', () => {
    const o = MOCK_TOUR_ORDERS.find((x) => x.id === 'to_8')!;
    const r = detailPaymentRows(o);
    expect(r.paid).toBe(2670);
    expect(r.depositDue).toBeNull();
  });
  it('文案與頁面接線', () => {
    expect(t.depositBadge).toBe('應收定金');
    expect(t.paidBadge).toBe('已收');
    expect(t.detail.fields.deposit).toBe('應收定金');
    expect(t.detail.fields.paid).toBe('已收金額');
    const page = readFileSync('src/app/tenant/tour-orders/page.tsx', 'utf8');
    expect(page).toContain('listPaymentLine(o)');
    expect(page).toContain('detailPaymentRows(detail)');
    expect(page).not.toContain('detail.totalAmount - detail.depositAmount');
  });
});
