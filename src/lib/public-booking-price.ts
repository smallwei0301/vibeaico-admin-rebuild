/**
 * 預約／申請表單的「實際金額」摘要。順序與 canonical 0132 create_tour_order（第 118–140 行）一致：
 * v_base＝依出發日解析的季節 override（沒有則方案基本價）；PER_GROUP 的總額為 v_base（整團一口價，與人數無關），
 * 其餘（PER_PERSON）為 v_base × 人數。child_price 與訂金不參與 v_total（0132 檔頭說明 child_price 無季節 override，
 * create_tour_order 也沒有使用它），所以不適用於此摘要。
 */
export type BookingPriceDeparture = { unitPrice?: number };
export type BookingPricePlan = {
  pricePerPerson: number;
  priceType: 'PER_PERSON' | 'PER_GROUP';
  seasonalPricing?: boolean;
};

export function resolveBookingTotal(
  departure: BookingPriceDeparture | null | undefined,
  plan: BookingPricePlan,
  partySize: number,
): { unitPrice: number; total: number } | null {
  if (!departure) return null;
  if (!Number.isInteger(partySize) || partySize < 1) return null;
  // 方案有季節定價但這個團次沒有解析出單價（例如季節資料不完整）：無法誠實計算，不顯示金額。
  if (plan.seasonalPricing && departure.unitPrice === undefined) return null;
  const unitPrice = departure.unitPrice ?? plan.pricePerPerson;
  const total = plan.priceType === 'PER_GROUP' ? unitPrice : unitPrice * partySize;
  return { unitPrice, total };
}

/**
 * 「依出發日期而定，見各團次」只能在方案至少有一個團次帶 unitPrice 時顯示（畫面上真的看得到各團次價格）。
 * 方案有季節定價但沒有任何團次帶 unitPrice（INSTANT、未載入團次、季節查詢達上限、沒有可列團次）→ 'contact'，
 * 改顯示「價格依出發日期而定，請洽店家」。沒有季節定價 → null（顯示基本價）。
 */
export function seasonalHeadlineKind(plan: {
  seasonalPricing?: boolean;
  departures: Array<{ unitPrice?: number }>;
}): 'by-departure' | 'contact' | null {
  if (!plan.seasonalPricing) return null;
  return plan.departures.some((departure) => departure.unitPrice !== undefined) ? 'by-departure' : 'contact';
}
