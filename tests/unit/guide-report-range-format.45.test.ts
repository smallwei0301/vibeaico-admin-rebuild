import { describe, expect, it } from 'vitest';
import { formatAsOf } from '@/lib/guide-report-range';

describe('formatAsOf（資料截至，依店家時區並附時區名稱）', () => {
  it('同一時間點在不同時區顯示不同時刻，且附時區名稱；不合法時區回退台北', () => {
    const iso = '2026-10-07T04:30:00.000Z';
    const tpe = formatAsOf(iso, 'Asia/Taipei');
    const ny = formatAsOf(iso, 'America/New_York');
    expect(tpe).toContain('12:30');
    expect(ny).toContain('00:30');
    expect(tpe).not.toBe(ny);
    expect(tpe).toMatch(/GMT\+8|UTC\+8/);
    expect(formatAsOf(iso, 'Mars/Base')).toBe(tpe);
  });
});
