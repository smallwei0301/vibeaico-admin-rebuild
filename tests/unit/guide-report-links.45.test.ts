import { describe, expect, it } from 'vitest';
import {
  rangeLink, rankingLink, refundPendingLink, repeatCustomersLink, sourceLink,
} from '@/lib/guide-report-links';
import { parseTourOrdersDeepLink } from '@/services/tours';

const R = { from: '2026-10-01', to: '2026-10-10' };
const TRIP = '33333333-3333-4333-8333-333333333333';
const PLAN = '44444444-4444-4444-8444-444444444444';
const params = (href: string) => new URLSearchParams(href.split('?')[1]);

describe('報表下鑽連結參數（純函式）', () => {
  it('來源連結：source＋activeOnly＋本期日期', () => {
    expect(sourceLink(R, 'LINE')).toBe('/tenant/tour-orders?createdFrom=2026-10-01&createdTo=2026-10-10&source=LINE&activeOnly=1');
  });

  it('行程／方案排行：訂單數、人數排序帶 activeOnly；實收營收排序不帶', () => {
    for (const m of ['orders', 'people'] as const) {
      expect(params(rankingLink(R, 'trip', TRIP, m)).get('activeOnly')).toBe('1');
      expect(params(rankingLink(R, 'plan', PLAN, m)).get('activeOnly')).toBe('1');
    }
    expect(params(rankingLink(R, 'trip', TRIP, 'revenue')).has('activeOnly')).toBe(false);
    expect(params(rankingLink(R, 'plan', PLAN, 'revenue')).has('activeOnly')).toBe(false);
    expect(params(rankingLink(R, 'trip', TRIP, 'orders')).get('tripId')).toBe(TRIP);
    expect(params(rankingLink(R, 'plan', PLAN, 'orders')).get('planId')).toBe(PLAN);
    expect(params(rankingLink(R, 'plan', PLAN, 'orders')).has('tripId')).toBe(false);
  });

  it('退款處理中帶 paymentStatus；取消率帶 status=CANCELLED；總數連結不帶任何排除', () => {
    expect(params(refundPendingLink(R)).get('paymentStatus')).toBe('REFUND_PENDING');
    expect(params(rangeLink(R, 'CANCELLED')).get('status')).toBe('CANCELLED');
    expect(params(rangeLink(R)).has('activeOnly')).toBe(false);
    expect(params(rangeLink(R)).has('status')).toBe(false);
  });

  it('重複旅客連結：repeatCustomers＋兩個日期，且能被訂單頁 parse 還原', () => {
    const href = repeatCustomersLink(R);
    expect(href).toBe('/tenant/tour-orders?createdFrom=2026-10-01&createdTo=2026-10-10&repeatCustomers=1');
    expect(parseTourOrdersDeepLink(href.split('?')[1])).toMatchObject({ repeatCustomers: true, createdFrom: R.from, createdTo: R.to });
  });

  it('有 asOf 時所有連結帶 createdBefore；沒有則不帶；parse 還原且非法值忽略', () => {
    const asOf = '2026-10-07T03:40:00.000Z';
    const R2 = { ...R, asOf, timeZone: 'America/New_York' };
    const links = [
      rangeLink(R2), rangeLink(R2, 'CANCELLED'), sourceLink(R2, 'LINE'), rankingLink(R2, 'plan', PLAN, 'orders'),
      refundPendingLink(R2), repeatCustomersLink(R2),
    ];
    for (const l of links) {
      expect(params(l).get('createdBefore')).toBe(asOf);
      expect(params(l).get('tz')).toBe('America/New_York');
    }
    // 沒有 asOf 就不帶 tz（tz 只用來顯示資料截至）
    expect(params(rangeLink({ ...R, timeZone: 'America/New_York' })).has('tz')).toBe(false);
    expect(params(rangeLink(R)).has('createdBefore')).toBe(false);
    expect(params(rangeLink({ ...R, asOf: null })).has('createdBefore')).toBe(false);
    expect(parseTourOrdersDeepLink(repeatCustomersLink(R2).split('?')[1]).createdBefore).toBe(asOf);
    expect(parseTourOrdersDeepLink('?createdBefore=nope').createdBefore).toBe('');
    expect(parseTourOrdersDeepLink(repeatCustomersLink(R2).split('?')[1]).tz).toBe('America/New_York');
    expect(parseTourOrdersDeepLink('?tz=Mars/Base').tz).toBe('Asia/Taipei'); // 不合法 → 預設時區
    expect(parseTourOrdersDeepLink('').tz).toBe('');
  });
});
