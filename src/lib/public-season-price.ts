/**
 * 依出發日解析季節單價。規則與 canonical
 * supabase/migrations/0132_issue_42_seasonal_price_resolution.sql（第 85–118 行 create_tour_order）完全一致：
 * 1. 把月/日放到 2000 年（閏年）換算成「一年中的第幾天」（doy）。
 * 2. 命中：start<=end 時 cur 在 [start,end]；否則為跨年，cur>=start 或 cur<=end。
 * 3. 排序：天數跨度小者優先（start<=end → end-start；否則 (366-start)+end），再比 sort_order，再比 id
 *    （小者優先；id 為小寫 uuid 文字，字串比較與 PostgreSQL uuid 的位元組排序一致）。
 * 4. 取排序後第一筆（SQL 是 limit 1）的 price_override；若為 null 或沒有命中，用 basePrice。
 *    命中第一筆但 override 為 null 時用 base，不會改看下一筆（coalesce 發生在 limit 1 之後）。
 */
export type PublicSeasonRow = {
  id: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  priceOverride: number | null;
  sortOrder: number;
};

/** 2000 年（閏年）中 month/day 的 doy（1–366）。 */
export function leapYearDoy(month: number, day: number): number {
  return Math.round((Date.UTC(2000, month - 1, day) - Date.UTC(2000, 0, 1)) / 86_400_000) + 1;
}

export function resolveSeasonUnitPrice(
  departsOn: string,
  seasons: readonly PublicSeasonRow[],
  basePrice: number,
): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(departsOn);
  if (!match) return basePrice;
  const cur = leapYearDoy(Number(match[2]), Number(match[3]));
  const hits = seasons
    .map((season) => {
      const start = leapYearDoy(season.startMonth, season.startDay);
      const end = leapYearDoy(season.endMonth, season.endDay);
      const crossesYear = start > end;
      const hit = crossesYear ? cur >= start || cur <= end : cur >= start && cur <= end;
      const span = crossesYear ? (366 - start) + end : end - start;
      return { season, hit, span };
    })
    .filter((entry) => entry.hit)
    .sort((a, b) => {
      if (a.span !== b.span) return a.span - b.span;
      if (a.season.sortOrder !== b.season.sortOrder) return a.season.sortOrder - b.season.sortOrder;
      const ida = a.season.id.toLowerCase();
      const idb = b.season.id.toLowerCase();
      return ida < idb ? -1 : ida > idb ? 1 : 0;
    });
  const first = hits[0]?.season;
  return first && first.priceOverride !== null ? first.priceOverride : basePrice;
}
