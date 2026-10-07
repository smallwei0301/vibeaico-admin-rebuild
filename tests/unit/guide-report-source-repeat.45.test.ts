import { describe, expect, it } from 'vitest';
import { computeGuideReport, repeatCustomers, currentCustomerIds, type GuideReportOrderRow } from '@/server/guide-report';

// 期望值全部手算寫死。本期 2026-10-01～10-10（Asia/Taipei），上一期 09-21～09-30。
const Z = 'Asia/Taipei';
const names = { tripNames: new Map<string, string>(), planNames: new Map<string, string>() };
let seq = 0;
const row = (o: Partial<GuideReportOrderRow> & { created_at: string }): GuideReportOrderRow => ({
  id: `o${++seq}`, trip_id: 'tA', plan_id: 'pA', party_size: 1,
  status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 0, refunded_amount: 0, ...o,
});
const CUR = '2026-10-02T02:00:00Z';
const PREV = '2026-09-25T02:00:00Z';
const run = (rows: GuideReportOrderRow[], prior: string[] = []) =>
  computeGuideReport({ rows, from: '2026-10-01', to: '2026-10-10', timeZone: Z, ...names, priorCustomerIds: new Set(prior) });

describe('來源分布', () => {
  it('四個來源恆列（0 也列）、未知與空值歸 OTHER、取消排除、實收扣退款', () => {
    const r = run([
      row({ created_at: CUR, source: 'MIDAO', paid_amount: 1000 }),
      row({ created_at: CUR, source: 'MIDAO', paid_amount: 500, refunded_amount: 200 }), // 實收 300
      row({ created_at: CUR, source: 'LINE', paid_amount: 0, status: 'PENDING' }),
      row({ created_at: CUR, source: 'LINE', paid_amount: 900, status: 'CANCELLED' }), // 排除
      row({ created_at: CUR, source: 'WEIRD', paid_amount: 100 }),
      row({ created_at: CUR, source: null, paid_amount: 50 }),
      row({ created_at: PREV, source: 'MANUAL', paid_amount: 700 }), // 上一期
    ]);
    expect(r.summary.bySource).toEqual({
      MIDAO: { orders: 2, revenue: 1300 },
      VIBEAI_SHOP: { orders: 0, revenue: 0 },
      LINE: { orders: 1, revenue: 0 },
      MANUAL: { orders: 0, revenue: 0 },
      OTHER: { orders: 2, revenue: 150 },
    });
    expect(r.previous.bySource.MANUAL).toEqual({ orders: 1, revenue: 700 });
    expect(r.previous.bySource.MIDAO).toEqual({ orders: 0, revenue: 0 });
  });
});

describe('重複旅客', () => {
  it('本期 2 筆 → 重複；本期 1 筆但先前有 → 重複；本期 1 筆且先前無 → 不重複', () => {
    const r = run([
      row({ created_at: CUR, customer_id: 'A' }),
      row({ created_at: '2026-10-05T02:00:00Z', customer_id: 'A' }),
      row({ created_at: CUR, customer_id: 'B' }),
      row({ created_at: CUR, customer_id: 'C' }),
    ], ['B']);
    expect(r.repeat).toEqual({ customers: 3, repeatCustomers: 2, ratePercent: 66.7, unlinkedOrders: 0 });
  });

  it('customer_id 為空不計分母、另列筆數；只有取消的旅客不計入；取消單不湊成 2 筆', () => {
    const r = run([
      row({ created_at: CUR, customer_id: null }),
      row({ created_at: CUR, customer_id: null }),
      row({ created_at: CUR, customer_id: 'D', status: 'CANCELLED' }),
      row({ created_at: CUR, customer_id: 'E' }),
      row({ created_at: CUR, customer_id: 'E', status: 'CANCELLED' }),
    ]);
    expect(r.repeat).toEqual({ customers: 1, repeatCustomers: 0, ratePercent: 0, unlinkedOrders: 2 });
  });

  it('分母 0（只有取消／沒有訂單）→ 重複率 null，不是 0', () => {
    expect(run([row({ created_at: CUR, customer_id: 'F', status: 'CANCELLED' })]).repeat)
      .toEqual({ customers: 0, repeatCustomers: 0, ratePercent: null, unlinkedOrders: 0 });
    expect(run([]).repeat.ratePercent).toBeNull();
  });

  it('上一期訂單不算本期旅客，且本期單筆旅客不因上一期訂單被自動算重複（先前須由 priorCustomerIds 提供）', () => {
    const r = run([row({ created_at: PREV, customer_id: 'G' }), row({ created_at: CUR, customer_id: 'G' })]);
    expect(r.repeat).toEqual({ customers: 1, repeatCustomers: 0, ratePercent: 0, unlinkedOrders: 0 });
  });

  it('repeatCustomers 直接呼叫：4 位旅客 1 位重複 → 25', () => {
    const rows = ['H', 'H', 'I', 'J', 'K'].map((c) => row({ created_at: CUR, customer_id: c }));
    expect(repeatCustomers(rows, new Set()).ratePercent).toBe(25);
  });

  it('currentCustomerIds：只回本期非取消且有 customer_id 者（去重）', () => {
    const ids = currentCustomerIds([
      row({ created_at: CUR, customer_id: 'A' }), row({ created_at: CUR, customer_id: 'A' }),
      row({ created_at: CUR, customer_id: 'B', status: 'CANCELLED' }),
      row({ created_at: PREV, customer_id: 'C' }), row({ created_at: CUR, customer_id: null }),
    ], '2026-10-01', '2026-10-10', Z);
    expect(ids).toEqual(['A']);
  });
});
