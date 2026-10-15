import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { listPaymentLine, detailPaymentRows } from '@/lib/tour-order-payment-display';
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
    expect(detailPaymentRows(o)).toEqual({ depositDue: 3000, paid: 4000, balanceDue: 6000 });
  });
  it('PAID：不顯示待收尾款，顯示已收金額', () => {
    const o = { ...base, paymentStatus: 'PAID', paidAmount: 10000 } as const;
    expect(listPaymentLine(o)).toBeNull();
    expect(detailPaymentRows(o)).toEqual({ depositDue: 3000, paid: 10000, balanceDue: null });
  });
  it('PARTIAL 但 paidAmount 缺失（mock）：視為未知，不顯示已收與尾款', () => {
    const o = { ...base, paymentStatus: 'PARTIAL' } as const;
    expect(listPaymentLine(o)).toBeNull();
    expect(detailPaymentRows(o)).toEqual({ depositDue: 3000, paid: null, balanceDue: null });
  });
  it('CANCELLED + PARTIAL：保留已收金額、不顯示待收尾款', () => {
    const o = { ...base, status: 'CANCELLED', paymentStatus: 'PARTIAL', paidAmount: 4000 } as const;
    expect(detailPaymentRows(o)).toEqual({ depositDue: 3000, paid: 4000, balanceDue: null });
  });
  it('paidAmount 非有限／<=0 視為未知', () => {
    for (const paidAmount of [0, -1, NaN, Infinity]) {
      expect(detailPaymentRows({ ...base, paymentStatus: 'PARTIAL', paidAmount }).paid).toBeNull();
    }
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
