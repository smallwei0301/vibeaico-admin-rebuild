import { describe, expect, it } from 'vitest';
import { departureFormationSnapshot } from '@/server/departure-formation-snapshot';

const now = Date.parse('2030-01-01T00:00:00Z');
const plan = { min_to_depart: 4, formation_deadline_days_before: 7 };
const departure = { departsOn: '2030-01-15', startTime: '09:00', capacity: 8 };

describe('#42 immutable new-departure formation rules, effective Asia/Taipei', () => {
  it('snapshots total formation threshold separately from single-order minimum', () => {
    expect(departureFormationSnapshot(plan, departure, now)).toEqual({
      formation_status: 'COLLECTING', min_to_depart_snapshot: 4,
      formation_deadline_at: '2030-01-08T01:00:00.000Z',
    });
  });
  it.each([0, 7, 90])('accepts plan deadline %s without local/UTC date drift', (days) => {
    const result = departureFormationSnapshot({ ...plan, formation_deadline_days_before: days },
      { ...departure, departsOn: '2030-06-01', startTime: '00:30' }, now);
    expect(result.formation_deadline_at).toBe(new Date(Date.parse('2030-05-31T16:30:00Z') - days * 86400000).toISOString());
  });
  it('uses start of the effective local day for a departure without a time', () => {
    expect(departureFormationSnapshot(plan, { ...departure, startTime: null }, now).formation_deadline_at)
      .toBe('2030-01-07T16:00:00.000Z');
  });
  it.each([undefined, null, NaN, Infinity, 0, -1, 1.5, '4'])('fails closed for corrupted/missing plan threshold %s', (min_to_depart) => {
    expect(() => departureFormationSnapshot({ ...plan, min_to_depart }, departure, now)).toThrow();
  });
  it.each([undefined, null, NaN, Infinity, -1, 91, 7.5, '7'])('fails closed for corrupted/missing plan days %s', (formation_deadline_days_before) => {
    expect(() => departureFormationSnapshot({ ...plan, formation_deadline_days_before }, departure, now)).toThrow();
  });
  it('rejects insufficient capacity without clamping threshold', () => {
    expect(() => departureFormationSnapshot(plan, { ...departure, capacity: 3 }, now)).toThrow(/名額/);
  });
  it('rejects past defaults with an actionable confirmation prompt', () => {
    expect(() => departureFormationSnapshot(plan, { ...departure, departsOn: '2030-01-03' }, now))
      .toThrow(/請選擇新的成團截止時間/);
  });
  it('uses an explicit future override, bounded by departure start', () => {
    expect(departureFormationSnapshot(plan, { ...departure, departsOn: '2030-01-03',
      formationDeadlineAt: '2030-01-02T10:00:00+08:00' }, now).formation_deadline_at)
      .toBe('2030-01-02T02:00:00.000Z');
    for (const formationDeadlineAt of ['2029-12-31T10:00:00Z', '2030-01-03T10:00:00+08:00', 'bad']) {
      expect(() => departureFormationSnapshot(plan, { ...departure, departsOn: '2030-01-03', formationDeadlineAt }, now)).toThrow();
    }
  });
  it('does not reinterpret default threshold1 as already formed or mutate earlier snapshots', () => {
    const first = departureFormationSnapshot(plan, departure, now);
    plan.min_to_depart = 6;
    const second = departureFormationSnapshot(plan, { ...departure, departsOn: '2030-01-16' }, now);
    expect(first.min_to_depart_snapshot).toBe(4);
    expect(second.min_to_depart_snapshot).toBe(6);
    expect(departureFormationSnapshot({ min_to_depart: 1, formation_deadline_days_before: 7 }, departure, now).formation_status)
      .toBe('COLLECTING');
    plan.min_to_depart = 4;
  });
});
