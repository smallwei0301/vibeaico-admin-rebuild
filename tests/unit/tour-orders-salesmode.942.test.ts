// Issue #942 — mock 模式下 listTourOrders 的 salesMode 篩選與真實 API 同語意（方案 sales_mode）。
import { describe, expect, it } from 'vitest';
import { listTourOrders } from '@/services/tours';
import { MOCK_TRIP_PLANS } from '@/mock/tours';

describe('mock listTourOrders salesMode', () => {
  it('只回方案為該販售方式的訂單，且是全部的真子集', async () => {
    const all = await listTourOrders({ size: 100 });
    const req = await listTourOrders({ size: 100, salesMode: 'REQUEST' });
    expect(req.totalElements).toBeGreaterThan(0);
    expect(req.totalElements).toBeLessThan(all.totalElements);
    for (const o of req.content) {
      expect(MOCK_TRIP_PLANS.some((p) => p.tripId === o.tripId && p.name === o.planName && p.salesMode === 'REQUEST')).toBe(true);
    }
  });
});
