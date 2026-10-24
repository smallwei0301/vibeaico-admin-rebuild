import { describe, expect, it } from 'vitest';
import { departureInterval, loadStaffLoad } from '@/server/staff-availability';

describe('#46 staff-availability：duration snapshot 優先', () => {
  const base = { departsOn: '2026-10-27', startTime: '10:00' };
  const startMs = Date.UTC(2026, 9, 27, 2, 0); // 台北 10:00

  it('有 snapshot 時以 snapshot 為準，忽略行程 duration_hours', () => {
    const i = departureInterval({ ...base, durationHours: 5, durationMinutes: 90 });
    expect(i).toEqual({ start: startMs, end: startMs + 90 * 60_000, wholeDay: false });
  });

  it('snapshot 明確為 null＝時長未知，整日占用（不回頭讀 duration_hours）', () => {
    const i = departureInterval({ ...base, durationHours: 2, durationMinutes: null });
    expect(i.wholeDay).toBe(true);
    expect(i.end - i.start).toBe(24 * 60 * 60_000);
  });

  it('未帶 durationMinutes（尚未建立的候選時段）維持舊行為：用 duration_hours', () => {
    const i = departureInterval({ ...base, durationHours: 2 });
    expect(i).toEqual({ start: startMs, end: startMs + 120 * 60_000, wholeDay: false });
  });

  it('snapshot <= 0 視為未知，整日占用', () => {
    expect(departureInterval({ ...base, durationHours: 2, durationMinutes: 0 }).wholeDay).toBe(true);
  });

  it('loadStaffLoad 查詢團次佔用時一併選出 duration_minutes_snapshot 並套用', async () => {
    let selected = '';
    const chain = (rows: unknown[], capture?: (cols: string) => void) => {
      const q: Record<string, unknown> = {};
      const self = () => q;
      for (const m of ['eq', 'in', 'lt', 'gt', 'gte', 'lte', 'neq', 'order', 'is', 'or']) q[m] = self;
      q.select = (cols: string) => { capture?.(cols); return q; };
      q.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
      return q;
    };
    const supabase = {
      from: (table: string) => {
        if (table === 'trip_departure_staff') {
          return chain([{
            departure_id: 'd1', staff_id: 's1',
            trip_departures: { id: 'd1', departs_on: '2026-10-27', start_time: '10:00:00', status: 'CLOSED', duration_minutes_snapshot: 90, trips: { duration_hours: 8 } },
          }], (c) => { selected = c; });
        }
        return chain([]);
      },
    };
    const load = await loadStaffLoad(supabase as never, 't', startMs - 3_600_000, startMs + 86_400_000);
    expect(selected).toContain('duration_minutes_snapshot');
    expect(load.departures).toEqual([{ departureId: 'd1', staffId: 's1', start: startMs, end: startMs + 90 * 60_000 }]);
  });
});
