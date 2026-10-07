import { describe, expect, it } from 'vitest';
import { decideDepartureFormation } from '@/services/tours';
import { MOCK_TRIP_DEPARTURES } from '@/mock/tours';

describe('decideDepartureFormation（mock）延長募集', () => {
  it('沒時區、過去、晚於（示範）出發的新截止 → 400 且不改狀態；合法 → 回 COLLECTING 並寫回新截止時間，之後再決策 → 409', async () => {
    const dep = MOCK_TRIP_DEPARTURES.find((d) => d.id === 'dp_4')!;
    const d = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
    for (const bad of ['2020-01-01T00:00:00+08:00', '2099-01-01T00:00:00+08:00', '2030-01-01T00:00:00']) {
      await expect(decideDepartureFormation('dp_4', { decision: 'EXTEND', newDeadline: bad })).rejects.toMatchObject({ status: 400 });
    }
    expect(dep.formationStatus).toBe('REVIEW_REQUIRED');
    const newDeadline = d(3);
    const r = await decideDepartureFormation('dp_4', { decision: 'EXTEND', newDeadline });
    expect(r.formationStatus).toBe('COLLECTING');
    expect(Date.parse(r.formationDeadlineAt!)).toBe(Date.parse(newDeadline));
    expect(dep.formationStatus).toBe('COLLECTING');
    await expect(decideDepartureFormation('dp_4', { decision: 'FORM' })).rejects.toMatchObject({ status: 409 });
  });
});
