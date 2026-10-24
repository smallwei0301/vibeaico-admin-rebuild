import { describe, expect, it } from 'vitest';
import {
  generateInstantCandidates, instantsForWallClock, localDateOf,
  INSTANT_DEFAULT_MAX_ADVANCE_DAYS, INSTANT_DEFAULT_MIN_LEAD_MINUTES,
} from '@/lib/instant-start-candidates';

// 2026-10-24T00:00:00Z = 台北 2026-10-24 08:00
const NOW = Date.UTC(2026, 9, 24, 0, 0, 0);

describe('#46 INSTANT 候選起始時刻（純函式）', () => {
  it('預設提前 24 小時、可售 60 天', () => {
    expect(INSTANT_DEFAULT_MIN_LEAD_MINUTES).toBe(1440);
    expect(INSTANT_DEFAULT_MAX_ADVANCE_DAYS).toBe(60);
  });

  it('台北：依清單 × 日期產生，升冪，輸出 UTC instant 與本地日期／時間', () => {
    const out = generateInstantCandidates({ startTimes: ['13:30', '09:00'], timeZone: 'Asia/Taipei' }, NOW, { from: '2026-10-25', to: '2026-10-26' });
    expect(out.map((c) => `${c.localDate} ${c.localTime}`)).toEqual([
      '2026-10-25 09:00', '2026-10-25 13:30', '2026-10-26 09:00', '2026-10-26 13:30',
    ]);
    expect(out[0].startsAt).toBe('2026-10-25T01:00:00.000Z');
    expect(out[1].startsAt).toBe('2026-10-25T05:30:00.000Z');
  });

  it('提前量邊界：恰等於 now+lead 保留，早 1 分鐘剔除', () => {
    // 台北 now=08:00；lead 24h → earliest = 隔天 08:00
    const keep = generateInstantCandidates({ startTimes: ['08:00'], timeZone: 'Asia/Taipei' }, NOW, { from: '2026-10-24', to: '2026-10-25' });
    expect(keep.map((c) => c.localDate)).toEqual(['2026-10-25']);
    const drop = generateInstantCandidates({ startTimes: ['07:59'], timeZone: 'Asia/Taipei' }, NOW, { from: '2026-10-24', to: '2026-10-25' });
    expect(drop.map((c) => c.localDate)).toEqual([]);
    // lead 0 時今天尚未到的時刻可售，已過的不可
    const same = generateInstantCandidates({ startTimes: ['07:00', '09:00'], minLeadMinutes: 0, timeZone: 'Asia/Taipei' }, NOW, { from: '2026-10-24', to: '2026-10-24' });
    expect(same.map((c) => c.localTime)).toEqual(['09:00']);
  });

  it('可售天數邊界：含今天起第 N 天，第 N+1 天不可', () => {
    const out = generateInstantCandidates({ startTimes: ['12:00'], maxAdvanceDays: 3, minLeadMinutes: 0, timeZone: 'Asia/Taipei' }, NOW);
    expect(out.map((c) => c.localDate)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    const dflt = generateInstantCandidates({ startTimes: ['12:00'], timeZone: 'Asia/Taipei' }, NOW);
    expect(dflt[dflt.length - 1].localDate).toBe('2026-12-23'); // 10/24 + 60 天
    expect(dflt[0].localDate).toBe('2026-10-25');
  });

  it('本地日期依店家時區：UTC 的昨天可能是店家的今天', () => {
    // 2026-10-24T20:00Z = 台北 10/25 04:00；洛杉磯(PDT) 10/24 13:00
    const now = Date.UTC(2026, 9, 24, 20, 0, 0);
    expect(localDateOf('Asia/Taipei', now)).toBe('2026-10-25');
    expect(localDateOf('America/Los_Angeles', now)).toBe('2026-10-24');
  });

  it('DST fold（秋季重複一小時）：該牆上時間不產生候選', () => {
    // America/New_York 2026-11-01 01:30 出現兩次（EDT 與 EST）
    expect(instantsForWallClock('America/New_York', Date.UTC(2026, 10, 1, 1, 30))).toHaveLength(2);
    const now = Date.UTC(2026, 9, 30, 12, 0);
    const out = generateInstantCandidates({ startTimes: ['01:30', '10:00'], minLeadMinutes: 0, maxAdvanceDays: 5, timeZone: 'America/New_York' }, now, { from: '2026-10-31', to: '2026-11-02' });
    const day = (d: string) => out.filter((c) => c.localDate === d).map((c) => c.localTime);
    expect(day('2026-10-31')).toEqual(['01:30', '10:00']);
    expect(day('2026-11-01')).toEqual(['10:00']);
    expect(day('2026-11-02')).toEqual(['01:30', '10:00']);
  });

  it('DST gap（春季跳過一小時）：不存在的牆上時間不產生候選', () => {
    // America/New_York 2027-03-14 02:30 不存在
    expect(instantsForWallClock('America/New_York', Date.UTC(2027, 2, 14, 2, 30))).toHaveLength(0);
    const now = Date.UTC(2027, 2, 12, 12, 0);
    const out = generateInstantCandidates({ startTimes: ['02:30'], minLeadMinutes: 0, maxAdvanceDays: 5, timeZone: 'America/New_York' }, now, { from: '2027-03-13', to: '2027-03-15' });
    expect(out.map((c) => c.localDate)).toEqual(['2027-03-13', '2027-03-15']);
    expect(out[0].startsAt).toBe('2027-03-13T07:30:00.000Z'); // EST -05:00
    expect(out[1].startsAt).toBe('2027-03-15T06:30:00.000Z'); // EDT -04:00
  });

  it('無效或重複的時刻字串被忽略；空清單回空陣列', () => {
    const out = generateInstantCandidates({ startTimes: ['09:00', '09:00:00', '9:00', '25:00', '10:15:30', 'abc', ''], minLeadMinutes: 0, timeZone: 'Asia/Taipei' }, NOW, { from: '2026-10-25', to: '2026-10-25' });
    expect(out.map((c) => c.localTime)).toEqual(['09:00']);
    expect(generateInstantCandidates({ startTimes: [] }, NOW)).toEqual([]);
  });

  it('不認得的時區回退台北（與 resolvePublicTimeZone 一致）', () => {
    const out = generateInstantCandidates({ startTimes: ['09:00'], timeZone: 'Not/AZone' }, NOW, { from: '2026-10-25', to: '2026-10-25' });
    expect(out[0].startsAt).toBe('2026-10-25T01:00:00.000Z');
  });

  it('range 格式錯誤（含不存在的日期）回空陣列', () => {
    expect(generateInstantCandidates({ startTimes: ['09:00'] }, NOW, { from: '2026-02-30' })).toEqual([]);
    expect(generateInstantCandidates({ startTimes: ['09:00'] }, NOW, { to: 'x' })).toEqual([]);
  });
});
