import { describe, expect, it } from 'vitest';
import { leapYearDoy, resolveSeasonUnitPrice, type PublicSeasonRow } from '@/lib/public-season-price';

const s = (over: Partial<PublicSeasonRow> & { id: string }): PublicSeasonRow => ({
  startMonth: 7, startDay: 1, endMonth: 8, endDay: 31, priceOverride: 2000, sortOrder: 0, ...over,
});
const BASE = 1000;

describe('#11 季節單價解析（與 0132 create_tour_order 同規則）', () => {
  it('doy 以 2000 年（閏年）計：2/29＝60、12/31＝366', () => {
    expect(leapYearDoy(2, 29)).toBe(60);
    expect(leapYearDoy(3, 1)).toBe(61);
    expect(leapYearDoy(12, 31)).toBe(366);
  });

  it.each([
    ['未命中 → 基本價', '2098-05-01', [s({ id: 'a' })], 1000],
    ['單一命中（含邊界 7/1）', '2098-07-01', [s({ id: 'a' })], 2000],
    ['單一命中（含邊界 8/31）', '2098-08-31', [s({ id: 'a' })], 2000],
    ['跨年命中（12/1–2/28，1/15）', '2098-01-15', [s({ id: 'a', startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 })], 2000],
    ['跨年命中（12/20）', '2098-12-20', [s({ id: 'a', startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 })], 2000],
    ['跨年未命中（6/1）', '2098-06-01', [s({ id: 'a', startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 })], 1000],
    ['重疊取跨度最小者', '2098-07-15', [
      s({ id: 'wide', startMonth: 6, startDay: 1, endMonth: 9, endDay: 30, priceOverride: 1500 }),
      s({ id: 'narrow', startMonth: 7, startDay: 10, endMonth: 7, endDay: 20, priceOverride: 2500 }),
    ], 2500],
    ['跨度相同比 sort_order（小者優先）', '2098-07-15', [
      s({ id: 'a', priceOverride: 1111, sortOrder: 5 }),
      s({ id: 'b', priceOverride: 2222, sortOrder: 1 }),
    ], 2222],
    ['跨度與 sort_order 相同比 id（小者優先）', '2098-07-15', [
      s({ id: 'bbbbbbbb-0000-0000-0000-000000000000', priceOverride: 1111 }),
      s({ id: 'aaaaaaaa-0000-0000-0000-000000000000', priceOverride: 2222 }),
    ], 2222],
    ['命中第一筆但 override 為 null → 用基本價，不看下一筆', '2098-07-15', [
      s({ id: 'a', priceOverride: null, startMonth: 7, startDay: 10, endMonth: 7, endDay: 20 }),
      s({ id: 'b', priceOverride: 9999 }),
    ], 1000],
    ['2/29（閏年日期）命中 2/1–2/29 的季節', '2096-02-29', [s({ id: 'a', startMonth: 2, startDay: 1, endMonth: 2, endDay: 29 })], 2000],
    ['2/29 季節：非閏年的 2/28 命中、3/1 不命中', '2098-03-01', [s({ id: 'a', startMonth: 2, startDay: 1, endMonth: 2, endDay: 29 })], 1000],
    ['override 為 0（合法的免費價）→ 用 0', '2098-07-15', [s({ id: 'a', priceOverride: 0 })], 0],
  ])('%s', (_label, departsOn, seasons, expected) => {
    expect(resolveSeasonUnitPrice(departsOn, seasons, BASE)).toBe(expected);
  });

  it('跨年跨度邊界（366）：跨年季節 12/31–1/2 跨度 2 小於非跨年 1/1–1/4 跨度 3，即使 sort_order 較大仍勝出', () => {
    const wrap = s({ id: 'w', startMonth: 12, startDay: 31, endMonth: 1, endDay: 2, priceOverride: 111, sortOrder: 1 });
    const plain = s({ id: 'p', startMonth: 1, startDay: 1, endMonth: 1, endDay: 4, priceOverride: 222, sortOrder: 0 });
    expect(resolveSeasonUnitPrice('2098-01-01', [plain, wrap], BASE)).toBe(111);
    expect(resolveSeasonUnitPrice('2098-01-01', [wrap, plain], BASE)).toBe(111);
  });

  it('日期格式無法解析 → 基本價', () => {
    expect(resolveSeasonUnitPrice('bad', [s({ id: 'a' })], BASE)).toBe(BASE);
  });
});
