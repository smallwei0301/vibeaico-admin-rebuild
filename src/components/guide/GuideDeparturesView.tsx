'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

import { GuideDepartureCard } from './GuideDepartureCard';
import { GuideEmptyState } from './GuideEmptyState';
import { GuideHeader } from './GuideHeader';
import { GuideMonthSummary } from './GuideMonthSummary';
import { GuideSectionCard } from './GuideSectionCard';
import { GuideWeekStrip } from './GuideWeekStrip';
import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { guideNavigation } from '@/i18n/zh-TW/pages/guide-navigation';
import {
  addGuideDays,
  addGuideMonths,
  buildGuideMonthDays,
  filterGuideDepartures,
  formatGuideDateKey,
  getGuideDeparturePhase,
  guideDateParts,
  startOfGuideWeek,
  type GuideDepartureFilter,
} from '@/lib/guide-departures';
import { dateKeyFromDate, buildGuideWeekSummary, type GuideDepartureSummary } from '@/lib/guide-home';
import { cn } from '@/lib/utils';

type GuideDeparturesViewProps = {
  departures: readonly GuideDepartureSummary[];
  todayIso: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

type GuideCalendarView = 'month' | 'week';

const STATUS_TONES = {
  UPCOMING: 'info',
  OPEN: 'positive',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
} as const;

export function GuideDeparturesView({
  departures,
  todayIso,
  loading,
  error,
  onRetry,
}: GuideDeparturesViewProps) {
  const safeToday = todayIso || dateKeyFromDate(new Date());
  const [anchorIso, setAnchorIso] = React.useState(safeToday);
  const [selectedIso, setSelectedIso] = React.useState(safeToday);
  const [view, setView] = React.useState<GuideCalendarView>('month');
  const [filter, setFilter] = React.useState<GuideDepartureFilter>('ALL');

  React.useEffect(() => {
    if (!todayIso) return;
    setAnchorIso(todayIso);
    setSelectedIso(todayIso);
  }, [todayIso]);

  const monthDays = React.useMemo(
    () => buildGuideMonthDays(anchorIso, departures),
    [anchorIso, departures],
  );
  const weekDays = React.useMemo(
    () => buildGuideWeekSummary(departures, startOfGuideWeek(anchorIso), selectedIso),
    [anchorIso, departures, selectedIso],
  );
  const filteredDepartures = React.useMemo(
    () => filterGuideDepartures(departures, safeToday, filter),
    [departures, filter, safeToday],
  );
  const selectedDepartures = filteredDepartures.filter((departure) => departure.departsOn === selectedIso);
  const currentMonth = guideDateParts(anchorIso);
  const monthCells = monthDays.filter((day) => day.inMonth);
  const monthTotal = monthCells.reduce((total, day) => total + day.departureCount, 0);
  const monthUpcoming = departures.filter((departure) => {
    const phase = getGuideDeparturePhase(departure, safeToday);
    return departure.departsOn.slice(0, 7) === anchorIso.slice(0, 7)
      && (phase === 'UPCOMING' || phase === 'OPEN');
  }).length;
  const monthCompleted = departures.filter((departure) =>
    departure.departsOn.slice(0, 7) === anchorIso.slice(0, 7)
    && getGuideDeparturePhase(departure, safeToday) === 'COMPLETED',
  ).length;

  const shift = (amount: number) => {
    const next = view === 'month'
      ? addGuideMonths(anchorIso, amount)
      : addGuideDays(anchorIso, amount * 7);
    setAnchorIso(next);
    setSelectedIso(next);
  };

  const selectDate = (value: string) => {
    setSelectedIso(value);
    if (value.slice(0, 7) !== anchorIso.slice(0, 7)) setAnchorIso(value);
  };

  if (loading) {
    return (
      <div className={GUIDE_UI_CLASSES.page}>
        <GuideHeader title={guideNavigation.departures.title} subtitle={guideNavigation.departures.subtitle} />
        <div className="mt-5" role="status" aria-live="polite">
          <GuideEmptyState title={guideNavigation.departures.loading} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={GUIDE_UI_CLASSES.page}>
        <GuideHeader title={guideNavigation.departures.title} subtitle={guideNavigation.departures.subtitle} />
        <div className="mt-5" role="alert">
          <GuideEmptyState
            title={guideNavigation.departures.error.title}
            description={guideNavigation.departures.error.description}
            action={(
              <button
                type="button"
                className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.primaryButton)}
                onClick={onRetry}
              >
                <RefreshCw size={17} aria-hidden />
                {guideNavigation.departures.retry}
              </button>
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
      <GuideHeader title={guideNavigation.departures.title} subtitle={guideNavigation.departures.subtitle} />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" role="group" aria-label={guideNavigation.departures.view.label}>
          {(['month', 'week'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={cn(
                GUIDE_UI_CLASSES.touchTarget,
                GUIDE_UI_CLASSES.focusRing,
                GUIDE_UI_CLASSES.viewToggle,
                view === option ? GUIDE_UI_CLASSES.viewToggleActive : GUIDE_UI_CLASSES.viewToggleInactive,
              )}
              onClick={() => setView(option)}
            >
              {guideNavigation.departures.view[option]}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label={guideNavigation.departures.period.label}>
          <button
            type="button"
            className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.outlinedIconButton)}
            aria-label={guideNavigation.departures.period.previous}
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <button
            type="button"
            className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.secondaryButton)}
            onClick={() => { setAnchorIso(safeToday); setSelectedIso(safeToday); }}
          >
            {guideNavigation.departures.period.today}
          </button>
          <button
            type="button"
            className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.outlinedIconButton)}
            aria-label={guideNavigation.departures.period.next}
            onClick={() => shift(1)}
          >
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
      </div>

      <div className={cn('-mx-1 flex gap-2 px-1 pb-1', GUIDE_UI_CLASSES.mobileScroll)} role="group" aria-label={guideNavigation.departures.filters.label}>
        {(['ALL', 'UPCOMING', 'OPEN', 'COMPLETED'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            className={cn(
              GUIDE_UI_CLASSES.touchTarget,
              GUIDE_UI_CLASSES.focusRing,
              GUIDE_UI_CLASSES.filterPill,
              filter === option ? GUIDE_UI_CLASSES.filterPillActive : GUIDE_UI_CLASSES.filterPillInactive,
            )}
            onClick={() => setFilter(option)}
          >
            {guideNavigation.departures.filters[option]}
          </button>
        ))}
      </div>

      <GuideMonthSummary
        monthLabel={currentMonth
          ? guideNavigation.departures.monthLabel(currentMonth.year, currentMonth.month)
          : guideNavigation.departures.title}
        items={[
          { key: 'total', label: guideNavigation.departures.summary.total, value: monthTotal },
          { key: 'upcoming', label: guideNavigation.departures.summary.upcoming, value: monthUpcoming },
          { key: 'completed', label: guideNavigation.departures.summary.completed, value: monthCompleted },
        ]}
      />

      {view === 'month' ? (
        <GuideSectionCard title={guideNavigation.departures.monthViewTitle}>
          <div className={GUIDE_UI_CLASSES.calendarGrid} aria-hidden>
            {guideNavigation.departures.weekdays.map((weekday) => (
              <span key={weekday} className={GUIDE_UI_CLASSES.calendarWeekday}>{weekday}</span>
            ))}
          </div>
          <div className={GUIDE_UI_CLASSES.calendarGrid} role="group" aria-label={guideNavigation.departures.monthViewTitle}>
            {monthDays.map((day) => (
              <button
                key={day.key}
                type="button"
                aria-pressed={selectedIso === day.key}
                aria-label={guideNavigation.departures.dayLabel(formatGuideDateKey(day.key), day.departureCount)}
                className={cn(
                  GUIDE_UI_CLASSES.calendarCell,
                  GUIDE_UI_CLASSES.touchTarget,
                  GUIDE_UI_CLASSES.focusRing,
                  selectedIso === day.key
                    ? GUIDE_UI_CLASSES.calendarSelected
                    : day.inMonth
                      ? GUIDE_UI_CLASSES.calendarInMonth
                      : GUIDE_UI_CLASSES.calendarOutside,
                )}
                onClick={() => selectDate(day.key)}
              >
                <span className={GUIDE_UI_CLASSES.calendarDate}>{day.dateLabel}</span>
                <span className={GUIDE_UI_CLASSES.calendarCount}>
                  {day.departureCount > 0
                    ? guideNavigation.departures.countLabel(day.departureCount)
                    : guideNavigation.departures.noCount}
                </span>
              </button>
            ))}
          </div>
        </GuideSectionCard>
      ) : (
        <GuideSectionCard title={guideNavigation.departures.weekViewTitle}>
          <GuideWeekStrip
            days={weekDays.map((day) => ({
              key: day.key,
              weekdayLabel: guideNavigation.departures.weekdays[day.weekdayIndex],
              dateLabel: day.dateLabel,
              ariaLabel: guideNavigation.departures.dayLabel(formatGuideDateKey(day.key), day.departureCount),
              countLabel: day.departureCount > 0
                ? guideNavigation.departures.countLabel(day.departureCount)
                : guideNavigation.departures.noCount,
              selected: day.selected,
            }))}
            onSelect={selectDate}
          />
        </GuideSectionCard>
      )}

      <GuideSectionCard
        title={guideNavigation.departures.selectedTitle(formatGuideDateKey(selectedIso))}
        description={guideNavigation.departures.selectedDescription}
        aria-live="polite"
      >
        {selectedDepartures.length > 0 ? (
          <div className="space-y-3">
            {selectedDepartures.map((departure) => {
              const phase = getGuideDeparturePhase(departure, safeToday);
              return (
                <GuideDepartureCard
                  key={departure.id}
                  title={`${departure.tripTitle}｜${departure.planName}`}
                  dateLabel={formatGuideDateKey(departure.departsOn)}
                  timeLabel={departure.startTime
                    ? guideNavigation.departures.startTime(departure.startTime)
                    : undefined}
                  capacityLabel={guideNavigation.departures.capacity(departure.seatsBooked, departure.capacity)}
                  statusLabel={guideNavigation.departures.status[phase]}
                  statusTone={STATUS_TONES[phase]}
                  action={(
                    <Link
                      href={`/tenant/trips/${encodeURIComponent(departure.tripId)}?tab=departures`}
                      className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.accentButton)}
                    >
                      {guideNavigation.departures.viewDetails}
                    </Link>
                  )}
                />
              );
            })}
          </div>
        ) : (
          <GuideEmptyState
            title={guideNavigation.departures.empty.title}
            description={guideNavigation.departures.empty.description}
          />
        )}
      </GuideSectionCard>

      {filteredDepartures.length > selectedDepartures.length ? (
        <p className={cn(GUIDE_UI_CLASSES.secondary, 'text-center')}>
          {guideNavigation.departures.totalHint(filteredDepartures.length)}
        </p>
      ) : null}
    </div>
  );
}
