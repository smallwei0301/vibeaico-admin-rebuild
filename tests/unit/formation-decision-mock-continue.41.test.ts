import { describe, expect, it } from 'vitest';
import { decideDepartureFormation } from '@/services/tours';
import { MOCK_TRIP_DEPARTURES, MOCK_TOUR_ORDERS } from '@/mock/tours';

describe('decideDepartureFormation（mock）繼續出團', () => {
  it('AT_RISK 的 dp_8 → FORMED；原成團證據不變、訂單金額不動；再決策 → 409；REVIEW_REQUIRED 的 dp_4 不能 CONTINUE', async () => {
    const dep = MOCK_TRIP_DEPARTURES.find((d) => d.id === 'dp_8')!;
    expect(dep.formationStatus).toBe('AT_RISK');
    const before = { formedAt: dep.formedAt, formedBy: dep.formedBy, formedParticipants: dep.formedParticipants };
    const amounts = JSON.stringify(MOCK_TOUR_ORDERS.map((o) => [o.id, o.totalAmount, o.depositAmount, o.paymentStatus]));
    const r = await decideDepartureFormation('dp_8', { decision: 'CONTINUE' });
    expect(r.formationStatus).toBe('FORMED');
    expect({ formedAt: r.formedAt, formedBy: r.formedBy, formedParticipants: r.formedParticipants }).toEqual(before);
    expect(JSON.stringify(MOCK_TOUR_ORDERS.map((o) => [o.id, o.totalAmount, o.depositAmount, o.paymentStatus]))).toBe(amounts);
    await expect(decideDepartureFormation('dp_8', { decision: 'CONTINUE' })).rejects.toMatchObject({ status: 409 });
    await expect(decideDepartureFormation('dp_4', { decision: 'CONTINUE' })).rejects.toMatchObject({ status: 409 });
    await expect(decideDepartureFormation('dp_8', { decision: 'FORM' })).rejects.toMatchObject({ status: 409 });
  });
});
