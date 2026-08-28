import { describe, expect, it } from 'vitest';
import type { DepartureStaffAvailability, TripDeparture } from '@/lib/types';
import {
  departureGuidePresentation,
  guideAssignmentPresentation,
  batchDeparturePresentation,
} from '@/lib/tour-guide-ui';

const available: DepartureStaffAvailability = {
  staffId: 'guide-1', staffName: '王導遊', available: true, conflicts: [],
};
const busy: DepartureStaffAvailability = {
  staffId: 'guide-2', staffName: '陳導遊', available: false,
  conflicts: [{ reason: 'BOOKING' }],
};

describe('issue #37 tour guide UI presentation', () => {
  it('adapts the assignment UI from the active+bookable candidates: 0 onboarding, 1 solo, 2+ team', () => {
    expect(guideAssignmentPresentation([])).toMatchObject({ mode: 'ONBOARDING' });
    expect(guideAssignmentPresentation([available])).toMatchObject({
      mode: 'SOLO', soleGuide: available,
    });
    expect(guideAssignmentPresentation([available, busy])).toMatchObject({
      mode: 'TEAM', guides: [available, busy],
    });
  });

  it('keeps a busy candidate and its exact conflict reason visible instead of dropping it', () => {
    expect(guideAssignmentPresentation([available, busy])).toMatchObject({
      mode: 'TEAM',
      unavailable: [{ staffId: 'guide-2', staffName: '陳導遊', reason: 'BOOKING' }],
    });
  });

  it('preserves actual batch created/skipped/conflicts counts for the UI', () => {
    expect(batchDeparturePresentation({
      created: 2,
      skipped: 1,
      conflicts: [{ date: '2099-12-31', staffId: 'guide-2', staffName: '陳導遊', reason: 'BOOKING' }],
    })).toEqual({
      created: 2,
      skipped: 1,
      conflicts: [{ date: '2099-12-31', staffId: 'guide-2', staffName: '陳導遊', reason: 'BOOKING' }],
      keepDialogOpen: true,
    });
  });

  it('keeps legacy departures honest when no primary guide was assigned', () => {
    const legacy = {
      id: 'departure-legacy', tripId: 'trip-1', planId: 'plan-1', planName: '方案',
      departsOn: '2020-01-01', startTime: '09:00', capacity: 10, seatsBooked: 0,
      status: 'CANCELLED', note: '', primaryStaffId: null, primaryStaffName: null,
      assistantStaffIds: [], assistantStaffNames: [],
    } satisfies TripDeparture;

    expect(departureGuidePresentation(legacy)).toEqual({ primary: null, assistants: [] });
  });
});
