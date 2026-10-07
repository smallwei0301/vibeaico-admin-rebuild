import { describe, expect, it } from 'vitest';
import { listTourOrders } from '@/services/tours';

describe('listTourOrders（mock）篩選', () => {
  it('createdFrom/createdTo 與 tripId 能篩，且半開區間不含 to+1 當天', async () => {
    const all = await listTourOrders({ size: 100 });
    const sample = all.content[0];
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(sample.createdAt));
    const same = await listTourOrders({ size: 100, createdFrom: day, createdTo: day });
    expect(same.content.map((o) => o.id)).toContain(sample.id);
    const before = await listTourOrders({ size: 100, createdTo: '2000-01-01' });
    expect(before.content).toHaveLength(0);
    const byTrip = await listTourOrders({ size: 100, tripId: sample.tripId });
    expect(byTrip.content.every((o) => o.tripId === sample.tripId)).toBe(true);
  });

  it('activeOnly 排除已取消；planId 依報表 mock 方案名稱比對（未知 id → 0 筆）', async () => {
    const all = await listTourOrders({ size: 100 });
    const active = await listTourOrders({ size: 100, activeOnly: '1' });
    expect(active.content.every((o) => o.status !== 'CANCELLED')).toBe(true);
    expect(active.totalElements).toBe(all.content.filter((o) => o.status !== 'CANCELLED').length);
    expect((await listTourOrders({ size: 100, planId: 'no-such-plan' })).totalElements).toBe(0);
  });

  it('repeatCustomers：mock 以電話識別旅客，只列非取消且（區間內 ≥2 筆或區間前已有）者', async () => {
    const wide = await listTourOrders({ size: 100, repeatCustomers: '1', createdFrom: '2000-01-01', createdTo: '2100-01-01' });
    const all = (await listTourOrders({ size: 100 })).content.filter((o) => o.status !== 'CANCELLED');
    const n = (phone: string) => all.filter((o) => o.customerPhone === phone).length;
    expect(wide.content.every((o) => o.status !== 'CANCELLED' && n(o.customerPhone) >= 2)).toBe(true);
    expect(wide.totalElements).toBe(all.filter((o) => n(o.customerPhone) >= 2).length);
  });
});
