import { afterEach, describe, expect, it } from 'vitest';
import { decideDepartureFormation } from '@/services/tours';
import { MOCK_TRIP_DEPARTURES } from '@/mock/tours';
import { mockDepartureRows } from '@/mock/guide-report';
import { computeFormation } from '@/server/guide-report-formation';

// mock 報表：導遊 EXTEND 後團次回到 COLLECTING，但 formation_decided_at 必須被保存並投影，成團 availability 才是 TRACKED。
describe('mock 延長募集後的成團報表 availability（#45）', () => {
  const dep = MOCK_TRIP_DEPARTURES.find((d) => d.id === 'dp_4')!;
  const original = { ...dep };
  afterEach(() => { Object.assign(dep, original); delete dep.formationDecidedAt; });

  it('dp_4 EXTEND 後：formationDecidedAt 寫回、報表 row 帶 formation_decided_at、只看 dp_4 時 availability 為 TRACKED', async () => {
    expect(dep.formationStatus).toBe('REVIEW_REQUIRED');
    const newDeadline = new Date(Date.now() + 3 * 86400000).toISOString();
    const r = await decideDepartureFormation('dp_4', { decision: 'EXTEND', newDeadline });
    expect(r.formationStatus).toBe('COLLECTING');
    expect(typeof dep.formationDecidedAt).toBe('string');

    const nowMs = Date.now();
    const rows = mockDepartureRows(nowMs).filter((x) => x.id === 'dp_4');
    expect(rows).toHaveLength(1);
    expect(rows[0].formation_status).toBe('COLLECTING');
    expect(rows[0].formation_decided_at).toBe(dep.formationDecidedAt);
    const day = rows[0].departs_on;
    const fm = computeFormation({ rows, from: day, to: day, prevFrom: day, prevTo: day, today: day });
    expect(fm.availability).toBe('TRACKED');
  });
});
