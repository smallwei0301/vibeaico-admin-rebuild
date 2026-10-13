import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localDayRange, unprocessedUpperBound } from '../../src/lib/bookings-query-range';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('#908 首頁待辦連結與查詢範圍', () => {
  it('流失預警連結參數與顧客頁讀取的參數一致', () => {
    const dash = read('src/app/tenant/dashboard/page.tsx');
    const cust = read('src/app/tenant/customers/page.tsx');
    expect(dash).toContain('/tenant/customers?atRisk=true');
    expect(dash).not.toContain('filter=atRisk');
    expect(cust).toContain("params.get('atRisk') === 'true'");
  });

  it('localDayRange 涵蓋本地整天', () => {
    const now = new Date(2026, 9, 13, 15, 30, 12);
    const { from, to } = localDayRange(now);
    const f = new Date(from), t = new Date(to);
    expect([f.getFullYear(), f.getMonth(), f.getDate(), f.getHours(), f.getMinutes(), f.getSeconds(), f.getMilliseconds()])
      .toEqual([2026, 9, 13, 0, 0, 0, 0]);
    expect([t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()])
      .toEqual([13, 23, 59, 59, 999]);
    expect(f.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(t.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it('首頁今日預約帶 from/to 且 size 100', () => {
    const dash = read('src/app/tenant/dashboard/page.tsx');
    expect(dash).toContain('size: 100, ...localDayRange()');
  });

  it('UNPROCESSED 且未設 endDate 時帶 to；其餘維持原行為', () => {
    const now = new Date('2026-10-13T08:00:00.000Z');
    expect(unprocessedUpperBound('UNPROCESSED', '', now)).toBe(now.toISOString());
    expect(unprocessedUpperBound('UNPROCESSED', undefined, now)).toBe(now.toISOString());
    expect(unprocessedUpperBound('UNPROCESSED', '2026-10-20', now)).toBeUndefined();
    expect(unprocessedUpperBound('PENDING', '', now)).toBeUndefined();
    expect(read('src/app/tenant/bookings/page.tsx')).toContain('unprocessedUpperBound(status, endDate)');
  });
});
