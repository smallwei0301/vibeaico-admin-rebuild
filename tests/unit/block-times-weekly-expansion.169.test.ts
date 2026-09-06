import { describe, expect, it } from 'vitest';
import { expandBlockTimeOccurrences, type BlockTimeRow } from '@/server/block-times';

/**
 * #169：block_times 的 WEEKLY 列採「存規則、查詢時展開」，不實體化未來每一週
 * 的具體列。這支測試直接驗證展開的純函式，不碰資料庫——
 * queryEffectiveBlockTimes 只是「撈 SINGLE + 撈全部 WEEKLY + 逐列展開」的
 * 薄封裝，正確性全部壓在 expandBlockTimeOccurrences 上。
 */

const baseRow: BlockTimeRow = {
  id: 'row-1',
  staff_id: null,
  reason: '每週例會',
  title: '團隊會議',
  recurrence: 'WEEKLY',
  day_of_week: 2, // 週二（0=週日）
  full_day: false,
  auto: false,
  // 首次發生：2026-09-08（週二）09:00–10:30（台北時間 = +08:00）
  start_at: '2026-09-08T01:00:00.000Z', // 台北 09:00
  end_at: '2026-09-08T02:30:00.000Z', // 台北 10:30
};

describe('#169 expandBlockTimeOccurrences: WEEKLY 展開', () => {
  it('在單一週的查詢區間內展開出恰好一次發生，時分與時長不變', () => {
    // 查 2026-09-14 (一) 00:00 ~ 2026-09-21 (一) 00:00（台北），涵蓋 09-15（二）
    const from = '2026-09-13T16:00:00.000Z'; // 台北 09-14 00:00
    const to = '2026-09-20T16:00:00.000Z'; // 台北 09-21 00:00
    const out = expandBlockTimeOccurrences(baseRow, from, to);
    expect(out).toHaveLength(1);
    expect(out[0].start_at).toBe('2026-09-15T01:00:00.000Z'); // 台北 09-15 09:00
    expect(out[0].end_at).toBe('2026-09-15T02:30:00.000Z'); // 台北 09-15 10:30
    // 規則本身的欄位（reason/title/id/day_of_week…）原樣帶著走
    expect(out[0].id).toBe('row-1');
    expect(out[0].reason).toBe('每週例會');
    expect(out[0].day_of_week).toBe(2);
  });

  it('查詢區間橫跨多週時，每一週各展開一次，且都落在區間內', () => {
    // 查首次發生當週起，橫跨 4 週
    const from = baseRow.start_at;
    const to = '2026-10-06T00:00:00.000Z'; // 涵蓋 09-08、09-15、09-22、09-29
    const out = expandBlockTimeOccurrences(baseRow, from, to);
    expect(out.map((o) => o.start_at)).toEqual([
      '2026-09-08T01:00:00.000Z',
      '2026-09-15T01:00:00.000Z',
      '2026-09-22T01:00:00.000Z',
      '2026-09-29T01:00:00.000Z',
    ]);
  });

  it('不會展開早於「首次發生」日期的那幾週，即使查詢區間往前涵蓋', () => {
    // 查詢區間從首次發生的三週前開始
    const from = '2026-08-16T00:00:00.000Z';
    const to = '2026-09-10T00:00:00.000Z';
    const out = expandBlockTimeOccurrences(baseRow, from, to);
    expect(out).toHaveLength(1);
    expect(out[0].start_at).toBe(baseRow.start_at);
  });

  it('full_day 的每週規則，每次發生都是完整 24 小時，時長不因跨週而跑掉', () => {
    const fullDayWeekly: BlockTimeRow = {
      ...baseRow,
      full_day: true,
      start_at: '2026-09-07T16:00:00.000Z', // 台北 09-08 00:00
      end_at: '2026-09-08T16:00:00.000Z', // 台北 09-09 00:00（24 小時）
      day_of_week: 2,
    };
    const out = expandBlockTimeOccurrences(fullDayWeekly, '2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
    expect(out).toHaveLength(1);
    const durationMs = Date.parse(out[0].end_at) - Date.parse(out[0].start_at);
    expect(durationMs).toBe(24 * 60 * 60 * 1000);
  });

  it('SINGLE 列原樣傳回單一列，不展開', () => {
    const single: BlockTimeRow = { ...baseRow, recurrence: 'SINGLE', day_of_week: null };
    const out = expandBlockTimeOccurrences(single, '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    expect(out).toEqual([single]);
  });

  it('查詢區間完全不含任何一次發生時回空陣列', () => {
    const out = expandBlockTimeOccurrences(baseRow, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    expect(out).toEqual([]);
  });
});
