import { candidateIsBookable } from '@/lib/public-departure-candidates';

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

/**
 * 預約頁「可預選且可送出」某個團次的單一判斷來源（#46）：團次在 plan.departures 內、剩餘名額 >= 方案最低人數，
 * 且價格可確定（有季節定價時該團次必須解析出 unitPrice，否則 canSubmitBooking 會擋下送出）。
 * 預約頁的 ?departure= 預選與 BookingForm 初始團次直接呼叫它；LINE「近期團次」用預約頁載入器的結果呼叫它；
 * 店家首頁（public-shop.ts 的 linkable）在團次列只有單一團次，改用 seasonUnitPriceFor 解析同一個 unitPrice 後呼叫它。不得各自重寫。
 */
export function isDepartureBookableOnPage(
  plan: { minParty: number; seasonalPricing?: boolean; departures: Array<{ id: string; seatsLeft: number; unitPrice?: number }> },
  departureId: string | null | undefined,
): boolean {
  if (!departureId) return false;
  const departure = plan.departures.find((d) => d.id === departureId);
  if (!departure) return false;
  if (!candidateIsBookable(departure.seatsLeft, plan.minParty)) return false;
  if (plan.seasonalPricing && departure.unitPrice === undefined) return false;
  return true;
}

/**
 * #919：人數的有效上限＝min(方案最大人數, 所選團次剩餘名額)。尚未選團次（seatsLeft 未提供）時就是方案最大人數。
 */
export function effectiveMaxParty(maxParty: number, seatsLeft?: number): number {
  return seatsLeft === undefined ? maxParty : Math.min(maxParty, seatsLeft);
}

/** #919：人數是否超過所選團次的剩餘名額（只在人數本身是合法整數時判斷；未選團次不算超過）。 */
export function partyExceedsSeats(partySize: number, seatsLeft?: number): boolean {
  return seatsLeft !== undefined && Number.isInteger(partySize) && partySize > seatsLeft;
}

/**
 * 預約／申請表單能否送出。原本的必填條件不變；方案有季節定價（seasonalPricing）時，另外要求目前選的團次算得出
 * 實際金額（bookingTotal 不為 null，例如季節資料不完整或查詢失敗就算不出）——避免旅客在看不到正確金額時送出。
 * 沒有季節定價時，基本價一定算得出來，維持原條件。
 */
export function canSubmitBooking(input: {
  departureId: string;
  contactName: string;
  hasContact: boolean;
  partySize: number;
  minParty: number;
  maxParty: number;
  submitting: boolean;
  seasonalPricing?: boolean;
  bookingTotal: unknown | null;
  /** #919：所選團次的剩餘名額。有提供時人數不得超過它；不提供則行為與先前完全相同。 */
  seatsLeft?: number;
}): boolean {
  const withinSeats = input.seatsLeft === undefined || input.partySize <= input.seatsLeft;
  const base = !!input.departureId && !!input.contactName.trim() && input.hasContact
    && input.partySize >= input.minParty && input.partySize <= input.maxParty && withinSeats && !input.submitting;
  if (input.seasonalPricing) return base && input.bookingTotal !== null;
  return base;
}
