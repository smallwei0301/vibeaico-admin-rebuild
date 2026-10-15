/**
 * #1022：LINE「團次」清單排除已停用／查無方案的團次，日期窗以店家時區計算。
 */
import { describe, expect, it } from 'vitest';
import { addCalendarDays, departureWindow, filterListableDepartures } from '@/server/line-departures';

const deps = [
  { id: 'd1', plan_id: 'p-active' },
  { id: 'd2', plan_id: 'p-inactive' },
  { id: 'd3', plan_id: 'p-missing' },
  { id: 'd4', plan_id: null },
];
const plans = [
  { id: 'p-active', active: true },
  { id: 'p-inactive', active: false },
];

describe('filterListableDepartures', () => {
  it('排除 inactive 與查無方案的團次，保留 active', () => {
    const ids = filterListableDepartures(deps, plans).map((d) => d.id);
    expect(ids).toEqual(['d1', 'd4']);
  });

  it('plan_id 為 null 的團次維持列出', () => {
    expect(filterListableDepartures([{ plan_id: null }], [])).toHaveLength(1);
  });

  it('全部被排除時回空陣列', () => {
    expect(filterListableDepartures(deps.slice(1, 3), plans)).toEqual([]);
  });
});

describe('departureWindow', () => {
  it('UTC 17:30 在台北已是隔天：from 用台北日期，to = from + 14 天', () => {
    expect(departureWindow(Date.parse('2026-10-15T17:30:00Z'), 'Asia/Taipei')).toEqual({ from: '2026-10-16', to: '2026-10-30' });
  });

  it('UTC 10:00 在台北仍是同一天', () => {
    expect(departureWindow(Date.parse('2026-10-15T10:00:00Z'), 'Asia/Taipei')).toEqual({ from: '2026-10-15', to: '2026-10-29' });
  });

  it('時區缺值或無效回退 Asia/Taipei', () => {
    const now = Date.parse('2026-10-15T17:30:00Z');
    expect(departureWindow(now, undefined).from).toBe('2026-10-16');
    expect(departureWindow(now, 'Not/AZone').from).toBe('2026-10-16');
  });

  it('其他店家時區生效', () => {
    expect(departureWindow(Date.parse('2026-10-15T17:30:00Z'), 'America/Los_Angeles').from).toBe('2026-10-15');
  });

  it('跨月跨年以日期字串運算', () => {
    expect(addCalendarDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(addCalendarDays('2026-02-20', 14)).toBe('2026-03-06');
  });
});
