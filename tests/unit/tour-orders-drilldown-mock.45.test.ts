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
});
