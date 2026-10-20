import { describe, expect, it } from 'vitest';
import {
  formatDate, formatDateTime, formatTime, weekdayZh, zonedLocalToIso, zonedYmd,
} from '@/lib/utils';

// 2026-10-13T17:30:00Z：台北 10/14 01:30、洛杉磯 10/13 10:30（PDT, UTC-7）
const CROSS_MIDNIGHT = '2026-10-13T17:30:00Z';

describe('#936 後台日期時間以店家時區顯示', () => {
  it('跨午夜：台北顯示 10/14，洛杉磯顯示 10/13', () => {
    expect(formatDate(CROSS_MIDNIGHT, 'Asia/Taipei')).toBe('2026/10/14');
    expect(formatTime(CROSS_MIDNIGHT, 'Asia/Taipei')).toBe('01:30');
    expect(formatDateTime(CROSS_MIDNIGHT, 'Asia/Taipei')).toBe('2026/10/14 01:30');
    expect(formatDate(CROSS_MIDNIGHT, 'America/Los_Angeles')).toBe('2026/10/13');
    expect(formatTime(CROSS_MIDNIGHT, 'America/Los_Angeles')).toBe('10:30');
    expect(formatDateTime(CROSS_MIDNIGHT, 'America/Los_Angeles')).toBe('2026/10/13 10:30');
  });

  it('午夜顯示 00:xx 而非 24:xx', () => {
    expect(formatTime('2026-10-13T16:05:00Z', 'Asia/Taipei')).toBe('00:05');
  });

  it('weekdayZh 依店家時區換算星期', () => {
    expect(weekdayZh(CROSS_MIDNIGHT, 'Asia/Taipei')).toBe('週三'); // 2026-10-14
    expect(weekdayZh(CROSS_MIDNIGHT, 'America/Los_Angeles')).toBe('週二'); // 2026-10-13
  });

  it('無法辨識的時區回退 Asia/Taipei', () => {
    expect(formatDate(CROSS_MIDNIGHT, 'Not/AZone')).toBe('2026/10/14');
  });

  it('不傳 timeZone 時維持瀏覽器本地時區的既有行為', () => {
    const d = new Date(CROSS_MIDNIGHT);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(formatDate(CROSS_MIDNIGHT)).toBe(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`);
    expect(formatTime(CROSS_MIDNIGHT)).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  });

  it('zonedYmd 給 date input 預填用的店家當地日期', () => {
    expect(zonedYmd(CROSS_MIDNIGHT, 'Asia/Taipei')).toBe('2026-10-14');
    expect(zonedYmd(CROSS_MIDNIGHT, 'America/Los_Angeles')).toBe('2026-10-13');
  });

  it('zonedLocalToIso 把店家當地日期時間轉回 UTC，且與 formatDateTime 互逆', () => {
    expect(zonedLocalToIso('2026-10-14', '01:30', 'Asia/Taipei')).toBe('2026-10-13T17:30:00.000Z');
    expect(zonedLocalToIso('2026-10-13', '10:30', 'America/Los_Angeles')).toBe('2026-10-13T17:30:00.000Z');
    // 冬令（PST, UTC-8）
    expect(zonedLocalToIso('2026-12-01', '09:00', 'America/Los_Angeles')).toBe('2026-12-01T17:00:00.000Z');
    const iso = zonedLocalToIso('2026-03-08', '12:00', 'America/Los_Angeles'); // DST 切換當日午後 = PDT
    expect(iso).toBe('2026-03-08T19:00:00.000Z');
    expect(formatDateTime(iso, 'America/Los_Angeles')).toBe('2026/03/08 12:00');
  });
});
