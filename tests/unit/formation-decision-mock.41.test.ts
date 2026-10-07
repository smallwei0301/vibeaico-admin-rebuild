import { describe, expect, it } from 'vitest';
import { decideDepartureFormation } from '@/services/tours';
import { MOCK_TRIP_DEPARTURES } from '@/mock/tours';

describe('decideDepartureFormation（mock）', () => {
  it('REVIEW_REQUIRED 的 dp_4：有效報名 3 人（to_41a＋to_41b）→ 仍然成團寫回 mock，之後再決策 → 409', async () => {
    const dep = MOCK_TRIP_DEPARTURES.find((d) => d.id === 'dp_4')!;
    expect(dep.formationStatus).toBe('REVIEW_REQUIRED');
    const r = await decideDepartureFormation('dp_4', { decision: 'FORM' });
    expect(r.formationStatus).toBe('FORMED');
    expect(r.formedBy).toBe('GUIDE_OVERRIDE');
    expect(r.formedParticipants).toBe(3);
    expect(dep.formationStatus).toBe('FORMED');
    await expect(decideDepartureFormation('dp_4', { decision: 'FORM' })).rejects.toMatchObject({ status: 409 });
  });

  it('不存在 → 404；非 REVIEW_REQUIRED（dp_1 已成團）→ 409；已取消團次 → 409', async () => {
    await expect(decideDepartureFormation('nope', { decision: 'FORM' })).rejects.toMatchObject({ status: 404 });
    await expect(decideDepartureFormation('dp_1', { decision: 'FORM' })).rejects.toMatchObject({ status: 409 });
    await expect(decideDepartureFormation('dp_6', { decision: 'FORM' })).rejects.toMatchObject({ status: 409 });
  });
});
