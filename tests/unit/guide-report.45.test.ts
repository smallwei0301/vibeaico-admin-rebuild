import { describe, expect, it } from 'vitest';
import {
  computeGuideReport, changePercent, resolveReportRange, zonedMidnightMs, GuideReportRangeError,
  type GuideReportOrderRow,
} from '@/server/guide-report';

// 期望值全部手算寫死，不呼叫正式函式產生。
const Z = 'Asia/Taipei';
const names = {
  tripNames: new Map([['tA', '甲行程'], ['tB', '乙行程']]),
  planNames: new Map([['pA', '甲方案'], ['pB', '乙方案'], ['pC', '丙方案']]),
};
let seq = 0;
const row = (o: Partial<GuideReportOrderRow> & { created_at: string }): GuideReportOrderRow => ({
  id: `o${String(++seq).padStart(2, '0')}`, trip_id: 'tA', plan_id: 'pA', party_size: 1,
  status: 'CONFIRMED', payment_status: 'UNPAID', paid_amount: 0, refunded_amount: 0, ...o,
});
const run = (rows: GuideReportOrderRow[], from = '2026-10-01', to = '2026-10-10') =>
  computeGuideReport({ rows, from, to, timeZone: Z, ...names });

describe('computeGuideReport — 空資料', () => {
  it('沒有任何訂單：計數為 0、平均客單 null、變化 null、排行空', () => {
    const r = run([]);
    expect(r.summary.totalOrders).toBe(0);
    expect(r.summary.revenue).toBe(0);
    expect(r.summary.avgOrderValue).toBeNull();
    expect(r.previous.avgOrderValue).toBeNull();
    expect(r.truncated).toBe(false);
    expect(r.changes).toEqual({ totalOrders: null, revenue: null, avgOrderValue: null, cancellationRatePoints: null });
    expect(r.summary.cancellationRate).toBeNull(); // 分母 0 → null，不是 0%
    expect(r.ranking.plan.orders).toEqual([]);
    expect(r.ranking.trip.revenue).toEqual([]);
  });

  it('只有未付款訂單：分母 0 → 平均客單 null（不是 0）', () => {
    const r = run([row({ created_at: '2026-10-02T02:00:00Z' })]);
    expect(r.summary.totalOrders).toBe(1);
    expect(r.summary.paidOrderCount).toBe(0);
    expect(r.summary.avgOrderValue).toBeNull();
  });
});

describe('實收營收與平均客單', () => {
  it('PARTIAL 只算已收；PAID 算全額；未付款不算', () => {
    const r = run([
      row({ created_at: '2026-10-02T02:00:00Z', payment_status: 'PARTIAL', paid_amount: 3000, status: 'CONFIRMED' }),
      row({ created_at: '2026-10-03T02:00:00Z', payment_status: 'PAID', paid_amount: 5000, status: 'COMPLETED' }),
      row({ created_at: '2026-10-04T02:00:00Z', payment_status: 'UNPAID', paid_amount: 0, status: 'PENDING' }),
    ]);
    expect(r.summary.revenue).toBe(8000);
    expect(r.summary.paidOrderCount).toBe(2);
    expect(r.summary.avgOrderValue).toBe(4000);
  });

  it('平均客單四捨五入到整數元（10001 / 2 = 5000.5 → 5001）', () => {
    const r = run([
      row({ created_at: '2026-10-02T02:00:00Z', payment_status: 'PAID', paid_amount: 5000 }),
      row({ created_at: '2026-10-03T02:00:00Z', payment_status: 'PAID', paid_amount: 5001 }),
    ]);
    expect(r.summary.avgOrderValue).toBe(5001);
  });

  it('已退款扣除；退款處理中仍算實收但另計；numeric 字串可解析', () => {
    const r = run([
      row({ created_at: '2026-10-02T02:00:00Z', status: 'CANCELLED', payment_status: 'REFUNDED', paid_amount: '2000', refunded_amount: '2000' }),
      row({ created_at: '2026-10-03T02:00:00Z', status: 'CANCELLED', payment_status: 'REFUND_PENDING', paid_amount: 4000, refunded_amount: 0 }),
      row({ created_at: '2026-10-04T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 1000 }),
    ]);
    expect(r.summary.revenue).toBe(5000); // 0 + 4000 + 1000
    expect(r.summary.refundedAmount).toBe(2000);
    expect(r.summary.refundPendingCount).toBe(1);
    expect(r.summary.paidOrderCount).toBe(1); // 取消單（含退款處理中）不進分母
    expect(r.summary.avgOrderValue).toBe(1000); // 分子也只含非取消單：1000 / 1
  });

  it('平均客單排除取消單：非取消實收 3000+5000、取消且退款處理中 9000 → 4000（不是 17000/3）', () => {
    const r = run([
      row({ created_at: '2026-10-02T02:00:00Z', status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 3000 }),
      row({ created_at: '2026-10-03T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 5000 }),
      row({ created_at: '2026-10-04T02:00:00Z', status: 'CANCELLED', payment_status: 'REFUND_PENDING', paid_amount: 9000 }),
    ]);
    expect(r.summary.revenue).toBe(17000);
    expect(r.summary.paidOrderCount).toBe(2);
    expect(r.summary.avgOrderValue).toBe(4000);
  });

  it('只有取消的已付款單：平均客單 null', () => {
    const r = run([row({ created_at: '2026-10-02T02:00:00Z', status: 'CANCELLED', payment_status: 'REFUND_PENDING', paid_amount: 9000 })]);
    expect(r.summary.avgOrderValue).toBeNull();
  });
});

describe('取消與退款不混算', () => {
  it('取消數只看 status；已退款的完成單不算取消', () => {
    const r = run([
      row({ created_at: '2026-10-02T02:00:00Z', status: 'CANCELLED', payment_status: 'UNPAID' }),
      row({ created_at: '2026-10-03T02:00:00Z', status: 'CANCELLED', payment_status: 'REFUND_PENDING', paid_amount: 100 }),
      row({ created_at: '2026-10-04T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 100, refunded_amount: 0 }),
      row({ created_at: '2026-10-05T02:00:00Z', status: 'PENDING' }),
    ]);
    expect(r.summary.cancelledCount).toBe(2);
    expect(r.summary.byStatus).toEqual({ PENDING: 1, CONFIRMED: 0, COMPLETED: 1, CANCELLED: 2 });
    expect(r.summary.refundPendingCount).toBe(1);
    expect(r.summary.refundedAmount).toBe(0);
  });
});

describe('取消率', () => {
  const mk = (n: number, cancelled: number, day: string) => Array.from({ length: n }, (_, i) =>
    row({ created_at: `${day}T02:00:00Z`, status: i < cancelled ? 'CANCELLED' : 'CONFIRMED' }));
  it('2/10 → 5/100：本期（10 筆）取消率 20%、上一期（100 筆）5%，增減為 +15.0 百分點（不是 +150%）', () => {
    // 本期 10/01–10/10；上一期 09/21–09/30
    const r = run([...mk(10, 2, '2026-10-05'), ...mk(100, 5, '2026-09-25')]);
    expect(r.summary.cancellationRate).toBe(20);
    expect(r.previous.cancellationRate).toBe(5);
    expect(r.changes.cancellationRatePoints).toBe(15);
  });
  it('取消率四捨五入到 1 位（1/3 → 33.3）；全取消 100；上一期無訂單 → 比較 null', () => {
    const r = run(mk(3, 1, '2026-10-05'));
    expect(r.summary.cancellationRate).toBe(33.3);
    expect(r.previous.cancellationRate).toBeNull();
    expect(r.changes.cancellationRatePoints).toBeNull();
    expect(run(mk(2, 2, '2026-10-05')).summary.cancellationRate).toBe(100);
  });
  it('取消率下降為負的百分點差', () => {
    const r = run([...mk(10, 1, '2026-10-05'), ...mk(10, 3, '2026-09-25')]);
    expect(r.changes.cancellationRatePoints).toBe(-20);
  });
});

describe('上一期比較', () => {
  it('上一期為緊鄰的等長期間；變化百分比四捨五入到 1 位；上一期 0 → null', () => {
    // 本期 10/01–10/10（10 天），上一期 09/21–09/30
    const r = run([
      row({ created_at: '2026-10-02T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 3000 }),
      row({ created_at: '2026-10-03T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 3000 }),
      row({ created_at: '2026-10-04T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 3000 }),
      row({ created_at: '2026-09-25T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 4000 }),
      row({ created_at: '2026-09-22T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 5000 }),
      row({ created_at: '2026-09-10T02:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 99999 }), // 更早，不算
    ]);
    expect(r.range).toMatchObject({ prevFrom: '2026-09-21', prevTo: '2026-09-30', days: 10 });
    expect(r.summary.totalOrders).toBe(3);
    expect(r.previous.totalOrders).toBe(2);
    expect(r.previous.revenue).toBe(9000);
    expect(r.changes.totalOrders).toBe(50); // (3-2)/2
    expect(r.changes.revenue).toBe(0); // 9000 vs 9000
    expect(r.changes.cancellationRatePoints).toBe(0); // 兩期取消率皆 0%
  });

  it('changePercent：33.333… → 33.3；上一期 0 或 null → null', () => {
    expect(changePercent(4, 3)).toBe(33.3);
    expect(changePercent(1, 3)).toBe(-66.7);
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(null, 3)).toBeNull();
    expect(changePercent(3, null)).toBeNull();
  });
});

describe('時區與月界線', () => {
  it('台北 10/01 00:00 = 前一日 16:00Z；邊界以租戶時區為準', () => {
    expect(new Date(zonedMidnightMs('2026-10-01', 'Asia/Taipei')).toISOString()).toBe('2026-09-30T16:00:00.000Z');
    // 美東（日光節約中）10/01 00:00 = 04:00Z
    expect(new Date(zonedMidnightMs('2026-10-01', 'America/New_York')).toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });

  it('午夜跳時：Santiago 2024-09-08 無 00:00，取該日第一個有效瞬間 04:00Z；前一日仍是 03:00Z 的 23:00', () => {
    expect(new Date(zonedMidnightMs('2024-09-08', 'America/Santiago')).toISOString()).toBe('2024-09-08T04:00:00.000Z');
    expect(new Date(zonedMidnightMs('2024-09-07', 'America/Santiago')).toISOString()).toBe('2024-09-07T04:00:00.000Z');
    expect(new Date(zonedMidnightMs('2024-09-09', 'America/Santiago')).toISOString()).toBe('2024-09-09T03:00:00.000Z');
  });

  it('一般日期與台北不變；秋季回撥日（Havana 2024-11-03 00:00 重複）取第一次出現', () => {
    expect(new Date(zonedMidnightMs('2026-03-15', 'Asia/Taipei')).toISOString()).toBe('2026-03-14T16:00:00.000Z');
    expect(new Date(zonedMidnightMs('2024-11-03', 'America/Havana')).toISOString()).toBe('2024-11-03T04:00:00.000Z');
    expect(new Date(zonedMidnightMs('2024-11-04', 'America/Havana')).toISOString()).toBe('2024-11-04T05:00:00.000Z');
  });

  it('09/30 15:59:59Z（台北 09/30 23:59:59）屬九月；16:00:00Z 屬十月', () => {
    const rows = [
      row({ created_at: '2026-09-30T15:59:59Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 100 }),
      row({ created_at: '2026-09-30T16:00:00Z', status: 'COMPLETED', payment_status: 'PAID', paid_amount: 200 }),
    ];
    const oct = run(rows, '2026-10-01', '2026-10-31');
    expect(oct.summary.totalOrders).toBe(1);
    expect(oct.summary.revenue).toBe(200);
    const sep = run(rows, '2026-09-01', '2026-09-30');
    expect(sep.summary.totalOrders).toBe(1);
    expect(sep.summary.revenue).toBe(100);
  });

  it('半開區間：結束日當天 23:59 含、隔天 00:00 不含', () => {
    const rows = [
      row({ created_at: '2026-10-10T15:59:59Z' }), // 台北 10/10 23:59:59
      row({ created_at: '2026-10-10T16:00:00Z' }), // 台北 10/11 00:00
    ];
    expect(run(rows, '2026-10-01', '2026-10-10').summary.totalOrders).toBe(1);
  });

  it('年界線：本期 2027-01-01 起，上一期落在 2026-12', () => {
    const rg = resolveReportRange('2027-01-01', '2027-01-31', Z);
    expect(rg.prevFrom).toBe('2026-12-01');
    expect(rg.prevTo).toBe('2026-12-31');
    expect(rg.days).toBe(31);
    const r = computeGuideReport({
      rows: [row({ created_at: '2026-12-31T15:59:59Z' }), row({ created_at: '2026-12-31T16:00:00Z' })],
      from: '2027-01-01', to: '2027-01-31', timeZone: Z, ...names,
    });
    expect(r.summary.totalOrders).toBe(1); // 台北 2027-01-01 00:00
    expect(r.previous.totalOrders).toBe(1); // 台北 2026-12-31 23:59:59
  });

  it('無效時區回退台北；日期錯誤與過長區間拋 GuideReportRangeError', () => {
    expect(resolveReportRange('2026-10-01', '2026-10-02', 'Not/AZone').timeZone).toBe('Asia/Taipei');
    expect(() => resolveReportRange('2026-10-05', '2026-10-01', Z)).toThrow(GuideReportRangeError);
    expect(() => resolveReportRange('2026-02-30', '2026-03-01', Z)).toThrow(GuideReportRangeError);
    expect(() => resolveReportRange('2024-01-01', '2026-01-01', Z)).toThrow(GuideReportRangeError);
  });
});

describe('熱門排行（行程／方案，三種排序）', () => {
  const rows = [
    // pA：2 單 / 5 人 / 收 3000
    row({ created_at: '2026-10-02T02:00:00Z', plan_id: 'pA', trip_id: 'tA', party_size: 2, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 1000 }),
    row({ created_at: '2026-10-03T02:00:00Z', plan_id: 'pA', trip_id: 'tA', party_size: 3, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 2000 }),
    // pB：1 單 / 9 人 / 收 9000
    row({ created_at: '2026-10-04T02:00:00Z', plan_id: 'pB', trip_id: 'tB', party_size: 9, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 9000 }),
    // pC：2 單 / 2 人 / 收 3000（與 pA 的訂單數、營收同分）
    row({ created_at: '2026-10-05T02:00:00Z', plan_id: 'pC', trip_id: 'tB', party_size: 1, status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 1500 }),
    row({ created_at: '2026-10-06T02:00:00Z', plan_id: 'pC', trip_id: 'tB', party_size: 1, status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 1500 }),
    // 取消單不計訂單／人數（pB 的 9 人取消單不增加人數）
    row({ created_at: '2026-10-07T02:00:00Z', plan_id: 'pB', trip_id: 'tB', party_size: 9, status: 'CANCELLED', payment_status: 'UNPAID', paid_amount: 0 }),
  ];
  const r = run(rows);
  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  it('依訂單數：pA、pC 同為 2，依名稱 code unit 升冪（丙 U+4E19 < 甲 U+7532）→ pC 先；pB 為 1', () => {
    expect(ids(r.ranking.plan.orders)).toEqual(['pC', 'pA', 'pB']);
  });
  it('依人數：pB 9、pA 5、pC 2（取消單人數不計）', () => {
    expect(ids(r.ranking.plan.people)).toEqual(['pB', 'pA', 'pC']);
    expect(r.ranking.plan.people[0]).toMatchObject({ name: '乙方案', orders: 1, people: 9, revenue: 9000 });
  });
  it('依實收營收：pB 9000；pA、pC 同為 3000 → 依名稱 code unit，pC（丙）先', () => {
    expect(ids(r.ranking.plan.revenue)).toEqual(['pB', 'pC', 'pA']);
  });
  it('行程維度：tB 3 單（pB 1 + pC 2，取消不計）、tA 2 單', () => {
    expect(ids(r.ranking.trip.orders)).toEqual(['tB', 'tA']);
    expect(r.ranking.trip.orders[0]).toMatchObject({ orders: 3, people: 11, revenue: 12000 });
    expect(ids(r.ranking.trip.revenue)).toEqual(['tB', 'tA']);
  });
  it('名稱也相同時依 id 穩定排序；指標為 0 的項目不進該排序', () => {
    const same = computeGuideReport({
      rows: [
        row({ id: 'z2', plan_id: 'pZ2', created_at: '2026-10-02T02:00:00Z', status: 'CONFIRMED' }),
        row({ id: 'z1', plan_id: 'pZ1', created_at: '2026-10-02T03:00:00Z', status: 'CONFIRMED' }),
      ],
      from: '2026-10-01', to: '2026-10-10', timeZone: Z,
      tripNames: new Map(), planNames: new Map([['pZ1', '同名'], ['pZ2', '同名']]),
    });
    expect(ids(same.ranking.plan.orders)).toEqual(['pZ1', 'pZ2']);
    expect(same.ranking.plan.revenue).toEqual([]); // 全未付款，營收排序無項目
  });
  it('最多列 10 名', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row({ plan_id: `p${i}`, created_at: '2026-10-02T02:00:00Z', status: 'CONFIRMED' }));
    expect(run(many).ranking.plan.orders).toHaveLength(10);
  });
});
