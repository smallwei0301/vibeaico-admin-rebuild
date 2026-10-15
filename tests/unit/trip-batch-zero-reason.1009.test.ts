import { describe, expect, it } from 'vitest';
import { batchZeroReason } from '@/lib/trip-batch-zero-reason';
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
