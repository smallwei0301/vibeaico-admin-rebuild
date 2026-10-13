import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canSubmitBooking, effectiveMaxParty, partyExceedsSeats, isDepartureBookableOnPage } from '@/lib/public-booking-price';
import { candidateIsBookable } from '@/lib/public-departure-candidates';
import { publicTourBookingPage as t } from '@/i18n/zh-TW/pages/public-tour-booking';

const ok = {
  departureId: 'd1', contactName: '王小明', hasContact: true, partySize: 4, minParty: 2, maxParty: 8,
  submitting: false, bookingTotal: { total: 1 },
};

describe('#919 canSubmitBooking 與所選團次剩餘名額', () => {
  it('不提供 seatsLeft：行為不變', () => {
    expect(canSubmitBooking(ok)).toBe(true);
    expect(canSubmitBooking({ ...ok, partySize: 9 })).toBe(false);
  });
  it('提供 seatsLeft：人數 <= 剩餘名額才可送出', () => {
    expect(canSubmitBooking({ ...ok, seatsLeft: 4 })).toBe(true);
    expect(canSubmitBooking({ ...ok, seatsLeft: 3 })).toBe(false);
    expect(canSubmitBooking({ ...ok, partySize: 5, seatsLeft: 3 })).toBe(false);
    expect(canSubmitBooking({ ...ok, seatsLeft: 10 })).toBe(true);
  });
});

describe('#919 有效人數上限', () => {
  it('未選團次＝方案最大人數；選定後取較小者', () => {
    expect(effectiveMaxParty(8)).toBe(8);
    expect(effectiveMaxParty(8, 3)).toBe(3);
    expect(effectiveMaxParty(8, 20)).toBe(8);
  });
  it('partyExceedsSeats', () => {
    expect(partyExceedsSeats(5, undefined)).toBe(false);
    expect(partyExceedsSeats(5, 3)).toBe(true);
    expect(partyExceedsSeats(3, 3)).toBe(false);
    expect(partyExceedsSeats(Number.NaN, 3)).toBe(false);
  });
});

describe('#919 名額不足的團次判斷', () => {
  it('剩餘名額 < 最低人數不可訂', () => {
    expect(candidateIsBookable(1, 2)).toBe(false);
    expect(candidateIsBookable(2, 2)).toBe(true);
  });
  it('不足的團次不得被預選', () => {
    const plan = { minParty: 2, departures: [{ id: 'a', seatsLeft: 1 }, { id: 'b', seatsLeft: 5 }] };
    expect(isDepartureBookableOnPage(plan, 'a')).toBe(false);
    expect(isDepartureBookableOnPage(plan, 'b')).toBe(true);
  });
});

describe('#919 BookingForm 接線與文案', () => {
  const src = readFileSync('src/app/s/[shopCode]/plans/[planId]/book/BookingForm.tsx', 'utf8');
  it('option 依 candidateIsBookable 帶 disabled 並附名額不足標示', () => {
    expect(src).toContain('disabled={!candidateIsBookable(d.seatsLeft, plan.minParty)}');
    expect(src).toContain('t.form.departureInsufficientSuffix');
  });
  it('max 與 canSubmitBooking 使用所選團次名額', () => {
    expect(src).toContain('max={maxPartyAllowed}');
    expect(src).toContain('seatsLeft: selectedSeatsLeft');
  });
  it('提示文案在 i18n', () => {
    expect(t.errors.partySizeExceedsSeats(3)).toBe('此團次只剩 3 位，請減少人數或改選其他團次');
    expect(t.form.departureInsufficientSuffix).toContain('名額不足');
  });
});
