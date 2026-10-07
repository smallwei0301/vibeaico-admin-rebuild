/**
 * 公開下單金額鎖定（#749）：後端回 409 + code TOUR_003（ERR.PRICE_CHANGED）時，data.quote 為「現在的實際金額」。
 * 表單據此請旅客重新確認，不清空已填內容。
 */
import { ApiError } from '@/lib/api';

export const PRICE_CHANGED_CODE = 'TOUR_003';

export type PriceChangedQuote = { unitPrice: number; total: number; priceType: 'PER_PERSON' | 'PER_GROUP' };

export function isPriceChangedError(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === PRICE_CHANGED_CODE;
}

/** 取出 PRICE_CHANGED 回應帶的現價；不是此錯誤或沒帶／格式不符回 null。 */
export function priceChangedQuoteFromError(e: unknown): PriceChangedQuote | null {
  if (!isPriceChangedError(e)) return null;
  const quote = (e.data as { quote?: { unitPrice?: unknown; total?: unknown; priceType?: unknown } } | undefined)?.quote;
  const unitPrice = Number(quote?.unitPrice);
  const total = Number(quote?.total);
  if (!quote || quote.unitPrice == null || quote.total == null || !Number.isFinite(unitPrice) || !Number.isFinite(total)) return null;
  const priceType = quote.priceType;
  if (priceType !== 'PER_PERSON' && priceType !== 'PER_GROUP') return null;
  return { unitPrice, total, priceType };
}
