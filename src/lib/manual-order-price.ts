import { resolveSeasonUnitPrice, type PublicSeasonRow } from '@/lib/public-season-price';
import type { TripPlanSeason } from '@/lib/types';

/**
 * 店家端 TripPlanSeason → PublicSeasonRow。
 * TripPlanSeason 沒有 sortOrder；後端 mapper 已依 sort_order 排序 seasons，
 * 所以用陣列索引當 sortOrder（同跨度時維持原順序，與 create_tour_order 的 sort_order 次序一致）。
 * 後端只看 active = true 的季節，這裡同樣過濾。
 */
export function toSeasonRows(seasons: readonly TripPlanSeason[]): PublicSeasonRow[] {
  return seasons
    .filter((s) => s.active)
    .map((s, index) => ({
      id: s.id,
      startMonth: s.startMonth,
      startDay: s.startDay,
      endMonth: s.endMonth,
      endDay: s.endDay,
      priceOverride: s.priceOverride,
      sortOrder: index,
    }));
}

export type ManualOrderPricePreview = {
  unitPrice: number;
  total: number;
  /** DEPARTURE = 已依團次出發日解析；BASE = 尚未選團次，僅為基本價；BASE_SEASONAL = 有季節定價但尚未選團次 */
  basis: 'DEPARTURE' | 'BASE';
  /** 方案有啟用的季節定價，且尚未選團次，金額可能與建立後不同 */
  seasonalPending: boolean;
};

export function previewManualOrderPrice(input: {
  priceType: 'PER_PERSON' | 'PER_GROUP' | string;
  basePrice: number;
  seasons: readonly TripPlanSeason[];
  departsOn: string | null | undefined;
  partySize: number;
}): ManualOrderPricePreview {
  const rows = toSeasonRows(input.seasons);
  const hasDeparture = Boolean(input.departsOn);
  const unitPrice = hasDeparture
    ? resolveSeasonUnitPrice(input.departsOn as string, rows, input.basePrice)
    : input.basePrice;
  const total = input.priceType === 'PER_PERSON' ? unitPrice * input.partySize : unitPrice;
  return {
    unitPrice,
    total,
    basis: hasDeparture ? 'DEPARTURE' : 'BASE',
    seasonalPending: !hasDeparture && rows.length > 0,
  };
}
