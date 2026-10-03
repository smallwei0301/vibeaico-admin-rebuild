import { describe, expect, it } from 'vitest';
import { formationDefaultDeadline, formationLocalDateTime, formationTimeZone, formationWallTimeToIso } from '@/lib/departure-formation-time';

describe('#42 tenant wall time and calendar deadline', () => {
  it('uses the canonical default only for missing legacy settings', () => {
    expect(formationTimeZone(undefined)).toBe('Asia/Taipei');
    for (const value of [null, '', 'bad/zone', 8]) expect(() => formationTimeZone(value)).toThrow();
  });
  it.each([['Asia/Tokyo', '2030-01-14T15:30:00.000Z'], ['America/Los_Angeles', '2030-01-15T08:30:00.000Z']])('round trips local input in %s without UTC date drift', (zone, utc) => {
    expect(formationWallTimeToIso('2030-01-15', '00:30', zone)).toBe(utc);
    expect(formationLocalDateTime(utc, zone)).toBe('2030-01-15T00:30:00');
  });
  it('subtracts calendar days across DST rather than 24-hour durations', () => {
    expect(formationDefaultDeadline('2030-03-12', '10:00', 7, 'America/New_York')).toBe('2030-03-05T15:00:00.000Z');
    expect(formationWallTimeToIso('2030-03-12', '10:00', 'America/New_York')).toBe('2030-03-12T14:00:00.000Z');
  });
  it('rejects nonexistent and ambiguous DST wall clocks instead of choosing an offset', () => {
    expect(() => formationWallTimeToIso('2030-03-10', '02:30', 'America/New_York')).toThrow();
    expect(() => formationWallTimeToIso('2030-11-03', '01:30', 'America/New_York')).toThrow();
  });
});
