import type { Trip, TripStatus } from '@/lib/types';

export type GuideTripFilter = 'ALL' | TripStatus;

export type GuideTripSummary = {
  total: number;
  published: number;
  draft: number;
  archived: number;
  upcomingDepartures: number;
};

function updatedAtValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Selectors for the GUIDE trip surface. They only search/filter facts returned by
 * listTrips; the GUIDE page does not invent a second plan or publishing state.
 */
export function filterGuideTrips(
  trips: readonly Trip[],
  filter: GuideTripFilter = 'ALL',
  query = '',
): Trip[] {
  const needle = query.trim().toLowerCase();

  return trips
    .filter((trip) => filter === 'ALL' || trip.status === filter)
    .filter((trip) => !needle || [
      trip.title,
      trip.tagline,
      trip.summary,
      trip.region,
      trip.category,
    ].some((value) => value.toLowerCase().includes(needle)))
    .slice()
    .sort((a, b) => (
      updatedAtValue(b.updatedAt) - updatedAtValue(a.updatedAt)
      || a.title.localeCompare(b.title, 'zh-Hant')
      || a.id.localeCompare(b.id)
    ));
}

export function summarizeGuideTrips(trips: readonly Trip[]): GuideTripSummary {
  return trips.reduce<GuideTripSummary>((summary, trip) => {
    summary.total += 1;
    summary.upcomingDepartures += trip.upcomingDepartureCount;
    if (trip.status === 'PUBLISHED') summary.published += 1;
    if (trip.status === 'DRAFT') summary.draft += 1;
    if (trip.status === 'ARCHIVED') summary.archived += 1;
    return summary;
  }, {
    total: 0,
    published: 0,
    draft: 0,
    archived: 0,
    upcomingDepartures: 0,
  });
}
