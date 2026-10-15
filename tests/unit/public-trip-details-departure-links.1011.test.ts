import { describe, expect, it } from 'vitest';
import { departureBookHref } from '@/lib/public-departure-link';
import { isDepartureBookableOnPage } from '@/lib/public-booking-price';

const base = { id: 'p/1', salesMode: 'FIXED_DEPARTURE', minParty: 2 };

describe('#1011 departureBookHref', () => {
  it('fixed + bookable 回編碼後的預約連結', () => {
    const plan = { ...base, departures: [{ id: 'd 1', seatsLeft: 5 }] };
    expect(departureBookHref('shop', plan, plan.departures[0])).toBe('/s/shop/plans/p%2F1/book?departure=d%201');
  });
  it('客滿回 null', () => {
    const plan = { ...base, departures: [{ id: 'd1', seatsLeft: 0, soldOut: true as const }] };
    expect(departureBookHref('shop', plan, plan.departures[0])).toBeNull();
  });
  it('名額低於最低人數回 null', () => {
    const plan = { ...base, departures: [{ id: 'd1', seatsLeft: 1 }] };
    expect(departureBookHref('shop', plan, plan.departures[0])).toBeNull();
  });
  it('季節定價但無 unitPrice 回 null', () => {
    const plan = { ...base, seasonalPricing: true, departures: [{ id: 'd1', seatsLeft: 5 }] };
    expect(departureBookHref('shop', plan, plan.departures[0])).toBeNull();
  });
  it('REQUEST 方案回 null', () => {
    const plan = { ...base, salesMode: 'REQUEST', departures: [{ id: 'd1', seatsLeft: 5 }] };
    expect(departureBookHref('shop', plan, plan.departures[0])).toBeNull();
  });
  it('與 isDepartureBookableOnPage 一致', () => {
    for (const seatsLeft of [0, 1, 2, 9]) for (const unitPrice of [undefined, 100]) for (const seasonalPricing of [false, true]) {
      const plan = { ...base, seasonalPricing, departures: [{ id: 'd1', seatsLeft, ...(unitPrice !== undefined ? { unitPrice } : {}) }] };
      expect(departureBookHref('s', plan, plan.departures[0]) !== null).toBe(isDepartureBookableOnPage(plan, 'd1'));
    }
  });
});
