import { isDepartureBookableOnPage } from '@/lib/public-booking-price';

/**
 * #1011：方案詳情頁的團次直達預約連結。
 * 只有固定團次方案（FIXED_DEPARTURE）且該團次通過預約頁同一套 `isDepartureBookableOnPage`
 * （名額 >= 最低人數、季節定價方案須解析得出 unitPrice）才回連結；其餘回 null（維持純文字）。
 */
export function departureBookHref(
  shopCode: string,
  plan: {
    id: string;
    salesMode: string;
    minParty: number;
    seasonalPricing?: boolean;
    departures: Array<{ id: string; seatsLeft: number; unitPrice?: number; soldOut?: true }>;
  },
  departure: { id: string; soldOut?: true },
): string | null {
  if (plan.salesMode !== 'FIXED_DEPARTURE') return null;
  if (departure.soldOut) return null;
  if (!isDepartureBookableOnPage(plan, departure.id)) return null;
  return `/s/${shopCode}/plans/${encodeURIComponent(plan.id)}/book?departure=${encodeURIComponent(departure.id)}`;
}
