/**
 * tests/unit/ics-parser.21.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/server/ics-parser.ts`（Issue #21 驗收「Parsing」四條）：基本 VEVENT、
 * all-day 事件、具名時區、STATUS:CANCELLED 排除。
 */
import { describe, it, expect } from 'vitest';
import { parseIcs } from '@/server/ics-parser';

function ics(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
}

describe('parseIcs（issue #21）', () => {
  it('基本 VEVENT：UID/SUMMARY/DTSTART/DTEND（UTC）', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-1@example.com',
      'SUMMARY:團隊會議',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T100000Z',
      'END:VEVENT',
    ));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: 'evt-1@example.com',
      title: '團隊會議',
      startAt: '2026-09-01T09:00:00.000Z',
      endAt: '2026-09-01T10:00:00.000Z',
      allDay: false,
    });
  });

  it('all-day event（VALUE=DATE）：起訖以 UTC midnight 表示，all_day=true', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-allday@example.com',
      'SUMMARY:公司旅遊',
      'DTSTART;VALUE=DATE:20260910',
      'DTEND;VALUE=DATE:20260912',
      'END:VEVENT',
    ));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: '公司旅遊',
      startAt: '2026-09-10T00:00:00.000Z',
      endAt: '2026-09-12T00:00:00.000Z',
      allDay: true,
    });
  });

  it('all-day event 缺 DTEND：依規則預設 1 天長度', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-allday-2@example.com',
      'SUMMARY:國定假日',
      'DTSTART;VALUE=DATE:20260910',
      'END:VEVENT',
    ));
    expect(events[0]).toMatchObject({
      startAt: '2026-09-10T00:00:00.000Z',
      endAt: '2026-09-11T00:00:00.000Z',
      allDay: true,
    });
  });

  it('timezone（TZID）：Asia/Taipei（UTC+8）壁鐘時間正確換算成 UTC', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-tz@example.com',
      'SUMMARY:客戶拜訪',
      'DTSTART;TZID=Asia/Taipei:20260901T140000',
      'DTEND;TZID=Asia/Taipei:20260901T153000',
      'END:VEVENT',
    ));
    // 台北時間 14:00 = UTC 06:00（UTC+8，無 DST）
    expect(events[0].startAt).toBe('2026-09-01T06:00:00.000Z');
    expect(events[0].endAt).toBe('2026-09-01T07:30:00.000Z');
    expect(events[0].allDay).toBe(false);
  });

  it('timezone（TZID）：有夏令時間的時區（America/New_York）正確換算', () => {
    // 2026-07-01 是美東夏令時間（UTC-4）。
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-tz-dst@example.com',
      'SUMMARY:Remote sync',
      'DTSTART;TZID=America/New_York:20260701T090000',
      'DTEND;TZID=America/New_York:20260701T100000',
      'END:VEVENT',
    ));
    expect(events[0].startAt).toBe('2026-07-01T13:00:00.000Z');
    expect(events[0].endAt).toBe('2026-07-01T14:00:00.000Z');
  });

  it('STATUS:CANCELLED 的事件不得殘留成有效事件', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-cancelled@example.com',
      'SUMMARY:已取消的會議',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T100000Z',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:evt-still-valid@example.com',
      'SUMMARY:正常事件',
      'DTSTART:20260902T090000Z',
      'DTEND:20260902T100000Z',
      'END:VEVENT',
    ));
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('evt-still-valid@example.com');
  });

  it('多個 VEVENT：全部各自正確解析', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:e1@example.com',
      'SUMMARY:A',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T093000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:e2@example.com',
      'SUMMARY:B',
      'DTSTART:20260902T090000Z',
      'DTEND:20260902T093000Z',
      'END:VEVENT',
    ));
    expect(events.map((e) => e.uid)).toEqual(['e1@example.com', 'e2@example.com']);
  });

  it('line folding（延續行以空白開頭）能正確接回上一行', () => {
    const events = parseIcs([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:evt-fold@example.com',
      'SUMMARY:這是一個很長的標題需要\r\n 折行才能放進 75 字元限制',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));
    expect(events[0].title).toBe('這是一個很長的標題需要折行才能放進 75 字元限制');
  });

  it('escape 字元（\\, \\; \\n）正確還原', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-escape@example.com',
      'SUMMARY:標題含逗號\\, 分號\\; 換行\\n第二行',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T100000Z',
      'END:VEVENT',
    ));
    expect(events[0].title).toBe('標題含逗號, 分號; 換行\n第二行');
  });

  it('沒有 UID 時合成一個 fallback UID，不讓快取表拿到空字串', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'SUMMARY:沒有 UID 的事件',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T100000Z',
      'END:VEVENT',
    ));
    expect(events[0].uid).toBeTruthy();
    expect(events[0].uid.length).toBeGreaterThan(0);
  });

  it('沒有 DTSTART 的事件安全跳過，不丟例外', () => {
    const events = parseIcs(ics(
      'BEGIN:VEVENT',
      'UID:evt-no-start@example.com',
      'SUMMARY:缺起始時間',
      'END:VEVENT',
    ));
    expect(events).toHaveLength(0);
  });

  it('空字串輸入回傳空陣列', () => {
    expect(parseIcs('')).toEqual([]);
  });
});
