import { describe, expect, it } from 'vitest';

import {
  addGuideDays,
  addGuideMonths,
  buildGuideMonthDays,
  filterGuideDepartures,
  getGuideDeparturePhase,
  startOfGuideWeek,
} from '@/lib/guide-departures';
import type { GuideDepartureSummary } from '@/lib/guide-home';

const departure = (overrides: Partial<GuideDepartureSummary> = {}): GuideDepartureSummary => ({
  id: 'dp-1',
  tripId: 'trip-1',
  planId: 'plan-1',
  planName: '標準方案',
  tripTitle: '海岸線半日遊',
  departsOn: '2026-09-02',
  startTime: '09:00',
  capacity: 8,
  seatsBooked: 3,
  status: 'OPEN',
  note: '',
  ...overrides,
});

describe('GUIDE departures calendar selectors (#66 Phase D)', () => {
  it('uses date-only arithmetic without timezone drift', () => {
    expect(addGuideDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addGuideMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(startOfGuideWeek('2026-09-02')).toBe('2026-08-30');
  });

  it('derives truthful departure phases from date and backend status', () => {
    expect(getGuideDeparturePhase(departure({ departsOn: '2026-08-31' }), '2026-09-01')).toBe('COMPLETED');
    expect(getGuideDeparturePhase(departure({ status: 'CLOSED' }), '2026-09-01')).toBe('UPCOMING');
    expect(getGuideDeparturePhase(departure({ status: 'CANCELLED' }), '2026-09-01')).toBe('CANCELLED');
  });

  it('filters and sorts all, upcoming, open and completed views', () => {
    const rows = [
      departure({ id: 'late', departsOn: '2026-09-04' }),
      departure({ id: 'done', departsOn: '2026-08-31' }),
      departure({ id: 'closed', departsOn: '2026-09-03', status: 'CLOSED' }),
      departure({ id: 'cancelled', departsOn: '2026-09-01', status: 'CANCELLED' }),
    ];
    expect(filterGuideDepartures(rows, '2026-09-01', 'ALL').map((row) => row.id)).toEqual([
      'done', 'cancelled', 'closed', 'late',
    ]);
    expect(filterGuideDepartures(rows, '2026-09-01', 'UPCOMING').map((row) => row.id)).toEqual(['closed', 'late']);
    expect(filterGuideDepartures(rows, '2026-09-01', 'OPEN').map((row) => row.id)).toEqual(['late']);
    expect(filterGuideDepartures(rows, '2026-09-01', 'COMPLETED').map((row) => row.id)).toEqual(['done']);
  });

  it('builds a seven-row month grid with counts and excludes cancelled departures', () => {
    const grid = buildGuideMonthDays('2026-09-10', [
      departure({ id: 'one', departsOn: '2026-09-01' }),
      departure({ id: 'two', departsOn: '2026-09-01' }),
      departure({ id: 'cancelled', departsOn: '2026-09-01', status: 'CANCELLED' }),
    ]);
    expect(grid).toHaveLength(42);
    expect(grid.find((day) => day.key === '2026-09-01')).toMatchObject({ departureCount: 2, inMonth: true });
    expect(grid.filter((day) => day.inMonth)).toHaveLength(30);
  });
});
