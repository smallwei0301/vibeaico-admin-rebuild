import { describe, expect, it } from 'vitest';

import { mapTripPlan } from '@/server/mappers';

const row = (sales_mode?: unknown) => ({
  id: 'plan-1',
  trip_id: 'trip-1',
  name: '標準方案',
  description: '',
  price_per_person: 3000,
  child_price: null,
  min_party: 1,
  max_party: 10,
  deposit_mode: 'FULL',
  deposit_value: 0,
  sort_order: 1,
  active: true,
  ...(sales_mode === undefined ? {} : { sales_mode }),
});

/*
 * #42 驗收：legacy `bookingType` 過去在 mapTripPlan() 裡永遠寫死 SCHEDULED，
 * 導致 GUIDE 後台「預約型態」欄位對 INSTANT／REQUEST 方案顯示錯誤徽章。
 * 鎖住由 canonical `sales_mode` 推導的三種映射，避免回歸。
 */
describe('#42 bookingType 由 sales_mode 推導', () => {
  it('FIXED_DEPARTURE 對應 SCHEDULED', () => {
    expect(mapTripPlan(row('FIXED_DEPARTURE')).bookingType).toBe('SCHEDULED');
  });

  it('INSTANT 對應 INSTANT', () => {
    expect(mapTripPlan(row('INSTANT')).bookingType).toBe('INSTANT');
  });

  it('REQUEST 對應 REQUEST', () => {
    expect(mapTripPlan(row('REQUEST')).bookingType).toBe('REQUEST');
  });

  /* 未知值與 salesMode 本身的 fail-closed 收斂一致，倒回 SCHEDULED（FIXED_DEPARTURE）。 */
  it.each([
    ['未帶欄位', undefined],
    ['空字串', ''],
    ['null', null],
    ['未知值', 'SOMETHING_ELSE'],
  ])('把 %s 收斂成 SCHEDULED', (_label, value) => {
    expect(mapTripPlan(row(value)).bookingType).toBe('SCHEDULED');
  });
});
