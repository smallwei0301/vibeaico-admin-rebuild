import { resolveSeasonUnitPrice, type PublicSeasonRow } from '@/lib/public-season-price';
import type { TripPlanSeason } from '@/lib/types';

/**
 * 店家端 TripPlanSeason → PublicSeasonRow。
 * 優先使用 mapper 帶出的真實 sortOrder（與 create_tour_order 的 sort_order 次序一致）；
 * 沒有時才退回陣列索引（mapper 已依 sort_order、id 排序）。
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
      sortOrder: s.sortOrder ?? index,
    }));
}

export type ManualOrderPricePreview = {
  unitPrice: number;
  total: number;
  /** 應收訂金，與 create_tour_order（0132）的 v_deposit 一致 */
  deposit: number;
  /** DEPARTURE = 已依團次出發日解析；BASE = 尚未選團次，僅為基本價 */
  basis: 'DEPARTURE' | 'BASE';
  /** 方案有啟用的季節定價，且尚未選團次，金額與訂金皆為估算，可能與建立後不同 */
  seasonalPending: boolean;
};

/**
 * 應收訂金，逐行對應 create_tour_order（0132）：
 * DEPOSIT_FIXED = least(deposit_value, total)，不乘人數；
 * DEPOSIT_PERCENT = round(total × deposit_value / 100)；NONE／FULL／其他 = 0。
 */
export function previewManualOrderDeposit(
  depositMode: string | null | undefined,
  depositValue: number,
  total: number,
): number {
  if (depositMode === 'DEPOSIT_FIXED') return Math.min(depositValue, total);
  if (depositMode === 'DEPOSIT_PERCENT') return Math.round((total * depositValue) / 100);
  return 0;
}

export function previewManualOrderPrice(input: {
  priceType: 'PER_PERSON' | 'PER_GROUP' | string;
  basePrice: number;
  seasons: readonly TripPlanSeason[];
  departsOn: string | null | undefined;
  partySize: number;
  depositMode?: string | null;
  depositValue?: number;
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
    deposit: previewManualOrderDeposit(input.depositMode, input.depositValue ?? 0, total),
    basis: hasDeparture ? 'DEPARTURE' : 'BASE',
    seasonalPending: !hasDeparture && rows.length > 0,
  };
}
