import { describe, expect, it } from 'vitest';
import { batchDatePlan, batchZeroReason } from '@/lib/trip-batch-zero-reason';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';
import { publicTourRequestPage } from '@/i18n/zh-TW/pages/public-tour-request';

describe('batchZeroReason (#1009)', () => {
  it('missingDates', () => {
    expect(batchZeroReason({ from: '', to: '2026-11-10', weekdays: [6] })).toBe('missingDates');
    expect(batchZeroReason({ from: '2026-11-01', to: '', weekdays: [6] })).toBe('missingDates');
  });
  it('endBeforeStart', () => {
    expect(batchZeroReason({ from: '2026-11-10', to: '2026-11-01', weekdays: [6] })).toBe('endBeforeStart');
  });
  it('noWeekdays', () => {
    expect(batchZeroReason({ from: '2026-11-01', to: '2026-11-30', weekdays: [] })).toBe('noWeekdays');
  });
  it('noMatchingDays', () => {
    // 2026-11-02 (Mon) ~ 2026-11-04 (Wed)，只勾週六
    expect(batchZeroReason({ from: '2026-11-02', to: '2026-11-04', weekdays: [6] })).toBe('noMatchingDays');
  });
  it('non-zero returns null', () => {
    expect(batchZeroReason({ from: '2026-11-01', to: '2026-11-30', weekdays: [6, 0] })).toBeNull();
  });
  it('i18n keys exist', () => {
    const hint = tripsPage.departures.batch.noDatesHint;
    for (const k of ['missingDates', 'endBeforeStart', 'noWeekdays', 'noMatchingDays'] as const) {
      expect(hint[k]).toBeTruthy();
    }
    expect(tripsPage.plans.durationMinutes('90')).toBe('90 分鐘');
    expect(publicTourRequestPage.status.detailsTitle).toBe('訂單明細');
  });
});

describe('batchDatePlan (#1009)', () => {
  it('counts known range', () => {
    // 2026-10-01 (Thu) ~ 10-14：週一 5,12；週三 7,14 => 4
    expect(batchDatePlan({ from: '2026-10-01', to: '2026-10-14', weekdays: [1, 3] })).toEqual({ count: 4, reason: null });
  });
  it('reason is null iff count > 0', () => {
    const froms = ['', '2026-10-01', '2026-10-10'];
    const tos = ['', '2026-10-14', '2026-10-02'];
    const wds = [[], [1, 3], [5]];
    for (const from of froms) for (const to of tos) for (const weekdays of wds) {
      const { count, reason } = batchDatePlan({ from, to, weekdays });
      expect(reason === null).toBe(count > 0);
      expect(batchZeroReason({ from, to, weekdays })).toBe(reason);
    }
  });
  it('invalid date -> missingDates', () => {
    expect(batchDatePlan({ from: 'nope', to: '2026-10-14', weekdays: [1] })).toEqual({ count: 0, reason: 'missingDates' });
  });
});
