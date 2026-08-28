import { describe, expect, it } from 'vitest';
import {
  departureInterval, evaluateStaffAvailability, evaluateStaffAvailabilityWithFacts, type AvailabilityInput,
} from '@/server/staff-availability';
import { aggregatePerformance } from '@/server/addon-performance';

const DAY = '2030-06-05';
const interval = departureInterval(DAY, '09:00', 120);

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    staff: { id: 'guide-a', name: '王導遊', availabilityPolicy: 'DEFAULT_AVAILABLE' },
    interval,
    shifts: [],
    bookings: [],
    blocks: [],
    departures: [],
    ...overrides,
  };
}

describe('staff availability engine (#37)', () => {
  it('DEFAULT_AVAILABLE 不需要 shift；EXPLICIT_ONLY 必須完整涵蓋', () => {
    expect(evaluateStaffAvailability(input()).available).toBe(true);
    expect(evaluateStaffAvailability(input({
      staff: { id: 'guide-a', name: '王導遊', availabilityPolicy: 'EXPLICIT_ONLY' },
    })).conflicts).toEqual([{ reason: 'SHIFT' }]);
    expect(evaluateStaffAvailability(input({
      staff: { id: 'guide-a', name: '王導遊', availabilityPolicy: 'EXPLICIT_ONLY' },
      shifts: [{ staffId: 'guide-a', start: interval.start, end: interval.end }],
    })).available).toBe(true);
  });

  it('booking、個人或全店 block 都會阻擋，並回傳時間', () => {
    const booking = evaluateStaffAvailability(input({
      bookings: [{ staffId: 'guide-a', start: interval.start, end: interval.end }],
    }));
    expect(booking.conflicts).toEqual([{ reason: 'BOOKING', conflictStart: interval.start, conflictEnd: interval.end }]);

    const block = evaluateStaffAvailability(input({
      blocks: [{ staffId: null, start: interval.start, end: interval.end }],
    }));
    expect(block.conflicts).toEqual([{ reason: 'BLOCK', conflictStart: interval.start, conflictEnd: interval.end }]);
  });

  it('PRIMARY 與 ASSISTANT 都佔用；CANCELLED 不佔用', () => {
    const baseDeparture = {
      id: 'departure-1', start: interval.start, end: interval.end, staffIds: ['guide-a'],
    };
    expect(evaluateStaffAvailability(input({
      departures: [{ ...baseDeparture, status: 'OPEN' }],
    })).conflicts[0]?.reason).toBe('DEPARTURE');
    expect(evaluateStaffAvailability(input({
      departures: [{ ...baseDeparture, status: 'CANCELLED' }],
    })).available).toBe(true);
  });

  it('無時間團次是整日占用', () => {
    const allDay = departureInterval(DAY, '', 120);
    expect(allDay.end).toBe('2030-06-05T16:00:00.000Z');
    expect(evaluateStaffAvailability(input({
      departures: [{ id: 'departure-1', start: allDay.start, end: allDay.end, staffIds: ['guide-a'], status: 'OPEN' }],
    })).conflicts[0]?.reason).toBe('DEPARTURE');
  });

  it('同一份 facts 可供整個 slot grid 重用，仍保留每個候選的衝突結果', () => {
    const next = departureInterval(DAY, '11:00', 60);
    const facts = {
      shifts: [], bookings: [{ staffId: 'guide-a', start: interval.start, end: interval.end }],
      blocks: [], departures: [],
    };
    expect(evaluateStaffAvailabilityWithFacts([input().staff], interval, facts)[0].available).toBe(false);
    expect(evaluateStaffAvailabilityWithFacts([input().staff], next, facts)[0].available).toBe(true);
  });
});

describe('C+ addon performance (#37)', () => {
  it('separates PRIMARY, SPECIFIC_STAFF and NONE without using null ambiguously', () => {
    const result = aggregatePerformance(['primary', 'specific'], [{
      id: 'booking-1', staffId: 'primary', status: 'COMPLETED', finalPrice: 180,
    }], [
      { bookingId: 'booking-1', appliedAmount: 30, performanceMode: 'PRIMARY', performanceStaffId: null },
      { bookingId: 'booking-1', appliedAmount: 40, performanceMode: 'SPECIFIC_STAFF', performanceStaffId: 'specific' },
      { bookingId: 'booking-1', appliedAmount: 10, performanceMode: 'NONE', performanceStaffId: null },
    ], [{ performanceStaffId: 'specific', performanceAmount: 50 }]);
    expect(result.get('primary')?.revenue).toBe(130);
    expect(result.get('specific')?.revenue).toBe(90);
  });
});
