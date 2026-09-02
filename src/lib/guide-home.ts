import type { DashboardAlerts, TripDeparture } from '@/lib/types';

/**
 * Home-page actions are selected from backend-derived alert fields only.
 * The GUIDE surface may choose how to present an item, but it must not invent
 * a count or an action that the alert payload cannot justify.
 */
export type GuideFocusItemKey =
  | 'unprocessedBookings'
  | 'bookingCutoff'
  | 'pushQuota'
  | 'atRiskCustomers';

export type GuideFocusItem = {
  key: GuideFocusItemKey;
  count?: number;
  href: string;
};

const FOCUS_PRIORITY: readonly GuideFocusItemKey[] = [
  'unprocessedBookings',
  'bookingCutoff',
  'pushQuota',
  'atRiskCustomers',
];

/** Return at most the requested number of actionable, non-empty alert types. */
export function selectGuideFocusItems(
  alerts: DashboardAlerts | null,
  limit = 3,
): GuideFocusItem[] {
  if (!alerts || limit <= 0) return [];

  const candidates: Partial<Record<GuideFocusItemKey, GuideFocusItem>> = {
    unprocessedBookings: alerts.unprocessedBookings > 0
      ? { key: 'unprocessedBookings', count: alerts.unprocessedBookings, href: '/tenant/bookings?status=PENDING' }
      : undefined,
    bookingCutoff: alerts.bookingCutoffPassed
      ? { key: 'bookingCutoff', href: '/tenant/tour-orders' }
      : undefined,
    pushQuota: alerts.pushQuotaExhausted
      ? { key: 'pushQuota', href: '/tenant/line-settings' }
      : undefined,
    atRiskCustomers: alerts.atRiskCustomers > 0
      ? { key: 'atRiskCustomers', count: alerts.atRiskCustomers, href: '/tenant/customers?atRisk=true' }
      : undefined,
  };

  return FOCUS_PRIORITY
    .map((key) => candidates[key])
    .filter((item): item is GuideFocusItem => item !== undefined)
    .slice(0, limit);
}

export type GuideDepartureSummary = TripDeparture & {
  tripTitle: string;
};

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function compareDeparture(a: GuideDepartureSummary, b: GuideDepartureSummary): number {
  return a.departsOn.localeCompare(b.departsOn)
    || a.startTime.localeCompare(b.startTime)
    || a.tripTitle.localeCompare(b.tripTitle)
    || a.id.localeCompare(b.id);
}

/** Select upcoming, non-cancelled departures in deterministic display order. */
export function selectUpcomingGuideDepartures(
  departures: readonly GuideDepartureSummary[],
  todayIso: string,
  limit = 3,
): GuideDepartureSummary[] {
  if (!isDateKey(todayIso) || limit <= 0) return [];
  return [...departures]
    .filter((departure) => departure.status !== 'CANCELLED' && departure.departsOn >= todayIso)
    .sort(compareDeparture)
    .slice(0, limit);
}

export type GuideWeekSummary = {
  key: string;
  dateLabel: string;
  weekdayIndex: number;
  departureCount: number;
  selected: boolean;
};

function parseDateKey(value: string): Date | null {
  if (!isDateKey(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Build a seven-day count strip from departure dates, excluding cancellations. */
export function buildGuideWeekSummary(
  departures: readonly GuideDepartureSummary[],
  startIso: string,
  selectedIso = startIso,
): GuideWeekSummary[] {
  const start = parseDateKey(startIso);
  if (!start) return [];

  const activeDates = new Map<string, number>();
  for (const departure of departures) {
    if (departure.status === 'CANCELLED') continue;
    activeDates.set(departure.departsOn, (activeDates.get(departure.departsOn) ?? 0) + 1);
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = toDateKey(date);
    return {
      key,
      dateLabel: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      weekdayIndex: date.getUTCDay(),
      departureCount: activeDates.get(key) ?? 0,
      selected: key === selectedIso,
    };
  });
}

/** Format a local calendar date once, outside render-time business selectors. */
export function dateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
