import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime, weekdayZh, zonedYmd } from '@/lib/utils';

/** #936：純日期 YYYY-MM-DD 沒有時點，任何瀏覽器時區都不得少（或多）一天。 */
const ZONES = ['America/Los_Angeles', 'Asia/Taipei'];

describe.each(ZONES)('純日期格式化 @ 瀏覽器時區 %s', (zone) => {
  const prevTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = zone; });
  afterAll(() => { if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz; });

  it('formatDate 顯示 14 日', () => {
    expect(formatDate('2026-10-14')).toBe('2026/10/14');
  });
  it('帶店家時區時純日期同樣不換算', () => {
    expect(formatDate('2026-10-14', 'America/Los_Angeles')).toBe('2026/10/14');
    expect(formatDate('2026-10-14', 'Asia/Taipei')).toBe('2026/10/14');
    expect(zonedYmd('2026-10-14', 'Pacific/Auckland')).toBe('2026-10-14');
  });
  it('formatDateTime／formatTime／weekdayZh 一致', () => {
    expect(formatDateTime('2026-10-14')).toBe('2026/10/14 00:00');
    expect(formatTime('2026-10-14')).toBe('00:00');
    expect(weekdayZh('2026-10-14')).toBe(weekdayZh('2026-10-14', 'Asia/Taipei'));
    expect(weekdayZh('2026-10-14')).toBe('週三');
  });
  it('時點 ISO 字串行為不變', () => {
    const iso = '2026-10-14T20:30:00Z';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(formatDate(iso)).toBe(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`);
    expect(formatDateTime(iso)).toBe(`${formatDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    expect(formatDate(iso, 'Asia/Taipei')).toBe('2026/10/15');
    expect(formatDateTime(iso, 'America/Los_Angeles')).toBe('2026/10/14 13:30');
  });
});
