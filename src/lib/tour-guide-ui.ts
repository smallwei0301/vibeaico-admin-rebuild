import type { DepartureStaffAvailability, TripDeparture } from '@/lib/types';

type GuideConflict = DepartureStaffAvailability['conflicts'][number];

export type GuideAssignmentPresentation =
  | { mode: 'ONBOARDING'; unavailable: UnavailableGuide[] }
  | { mode: 'SOLO'; soleGuide: DepartureStaffAvailability; unavailable: UnavailableGuide[] }
  | { mode: 'TEAM'; guides: DepartureStaffAvailability[]; unavailable: UnavailableGuide[] };

export type UnavailableGuide = {
  staffId: string;
  staffName: string;
  reason: GuideConflict['reason'] | null;
};

/**
 * The availability endpoint is already the active+bookable candidate boundary.
 * This presenter deliberately adapts only to that returned list: zero requires
 * onboarding, one is auto-assigned by the server, and two or more need the
 * primary/assistant controls.
 */
export function guideAssignmentPresentation(
  guides: DepartureStaffAvailability[],
): GuideAssignmentPresentation {
  const unavailable = guides
    .filter((guide) => !guide.available)
    .map((guide) => ({
      staffId: guide.staffId,
      staffName: guide.staffName,
      reason: guide.conflicts[0]?.reason ?? null,
    }));

  if (guides.length === 0) return { mode: 'ONBOARDING', unavailable };
  if (guides.length === 1) return { mode: 'SOLO', soleGuide: guides[0], unavailable };
  return { mode: 'TEAM', guides, unavailable };
}

export type BatchConflict = {
  date: string;
  staffId: string;
  staffName: string;
  reason: string;
};

export function batchDeparturePresentation(result: {
  created: number;
  skipped: number;
  conflicts?: BatchConflict[];
}) {
  const conflicts = result.conflicts ?? [];
  return {
    created: result.created,
    skipped: result.skipped,
    conflicts,
    keepDialogOpen: conflicts.length > 0,
  };
}

/** Never invent a replacement for legacy departures that predate assignment. */
export function departureGuidePresentation(departure: TripDeparture) {
  return {
    primary: departure.primaryStaffName ?? null,
    assistants: departure.assistantStaffNames?.filter(Boolean) ?? [],
  };
}
