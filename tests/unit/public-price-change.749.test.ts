import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { isPriceChangedError, priceChangedQuoteFromError } from '@/lib/public-price-change';

describe('#749 priceChangedQuoteFromError', () => {
  it('TOUR_003 + data.quote → 現價', () => {
    const e = new ApiError('x', 'TOUR_003', 409, { quote: { unitPrice: 1200, total: 2400 } });
    expect(isPriceChangedError(e)).toBe(true);
    expect(priceChangedQuoteFromError(e)).toEqual({ unitPrice: 1200, total: 2400 });
  });
  it('沒有 quote、格式不符、或其他錯誤碼 → null', () => {
    expect(priceChangedQuoteFromError(new ApiError('x', 'TOUR_003', 409))).toBeNull();
    expect(priceChangedQuoteFromError(new ApiError('x', 'TOUR_003', 409, { quote: { unitPrice: 'a', total: 1 } }))).toBeNull();
    expect(priceChangedQuoteFromError(new ApiError('x', 'REQ_003', 409, { quote: { unitPrice: 1, total: 1 } }))).toBeNull();
    expect(priceChangedQuoteFromError(new Error('x'))).toBeNull();
  });
});
