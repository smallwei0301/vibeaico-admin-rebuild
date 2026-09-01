import type { GuideDepartureSummary } from '@/lib/guide-home';

export type GuideDepartureFilter = 'ALL' | 'UPCOMING' | 'OPEN' | 'COMPLETED';
export type GuideDeparturePhase = 'UPCOMING' | 'OPEN' | 'COMPLETED' | 'CANCELLED';

export type GuideMonthDay = {
  key: string;
  dateLabel: string;
  weekdayIndex: number;
  departureCount: number;
  inMonth: boolean;
};

function parseDateKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function compareDepartures(a: GuideDepartureSummary, b: GuideDepartureSummary): number {
  return a.departsOn.localeCompare(b.departsOn)
    || a.startTime.localeCompare(b.startTime)
    || a.tripTitle.localeCompare(b.tripTitle)
    || a.id.localeCompare(b.id);
}

export function addGuideDays(value: string, amount: number): string {
  const date = parseDateKey(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return toDateKey(date);
}

export function addGuideMonths(value: string, amount: number): string {
  const date = parseDateKey(value);
  if (!date) return value;
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return toDateKey(date);
}

export function startOfGuideWeek(value: string): string {
  const date = parseDateKey(value);
  if (!date) return value;
  return addGuideDays(value, -date.getUTCDay());
}

export function getGuideDeparturePhase(
  departure: GuideDepartureSummary,
  todayIso: string,
): GuideDeparturePhase {
  if (departure.status === 'CANCELLED') return 'CANCELLED';
  if (departure.departsOn < todayIso) return 'COMPLETED';
  return departure.status === 'OPEN' ? 'OPEN' : 'UPCOMING';
}

export function filterGuideDepartures(
  departures: readonly GuideDepartureSummary[],
  todayIso: string,
  filter: GuideDepartureFilter,
): GuideDepartureSummary[] {
  return [...departures]
    .filter((departure) => {
      const phase = getGuideDeparturePhase(departure, todayIso);
      if (filter === 'ALL') return true;
      if (filter === 'UPCOMING') return phase === 'UPCOMING' || phase === 'OPEN';
      if (filter === 'OPEN') return phase === 'OPEN';
      return phase === 'COMPLETED';
    })
    .sort(compareDepartures);
}

export function buildGuideMonthDays(
  monthIso: string,
  departures: readonly GuideDepartureSummary[],
): GuideMonthDay[] {
  const month = parseDateKey(monthIso);
  if (!month) return [];
  month.setUTCDate(1);
  const monthKey = toDateKey(month);
  const departureCounts = new Map<string, number>();
  for (const departure of departures) {
    if (departure.status === 'CANCELLED') continue;
    departureCounts.set(
      departure.departsOn,
      (departureCounts.get(departure.departsOn) ?? 0) + 1,
    );
  }

  const firstCell = new Date(month);
  firstCell.setUTCDate(1 - month.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setUTCDate(firstCell.getUTCDate() + index);
    const key = toDateKey(date);
    return {
      key,
      dateLabel: String(date.getUTCDate()),
      weekdayIndex: date.getUTCDay(),
      departureCount: departureCounts.get(key) ?? 0,
      inMonth: key.slice(0, 7) === monthKey.slice(0, 7),
    };
  });
}

export function formatGuideDateKey(value: string): string {
  const date = parseDateKey(value);
  return date
    ? `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`
    : value;
}

export function guideDateParts(value: string): { year: number; month: number } | null {
  const date = parseDateKey(value);
  return date ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 } : null;
}
