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
        <div className="mt-5" role="status">
          <GuideEmptyState title={guideNavigation.departures.loading} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={GUIDE_UI_CLASSES.page}>
        <GuideHeader title={guideNavigation.departures.title} subtitle={guideNavigation.departures.subtitle} />
        <div className="mt-5">
          <GuideEmptyState
            title={guideNavigation.departures.error.title}
            description={guideNavigation.departures.error.description}
            action={(
              <button
                type="button"
                className={cn(GUIDE_UI_CLASSES.touchTarget, 'inline-flex items-center gap-2 rounded-xl bg-[#173F35] px-4 text-[16px] font-semibold text-white')}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" role="group" aria-label={guideNavigation.departures.view.label}>
          {(['month', 'week'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={cn(
                GUIDE_UI_CLASSES.touchTarget,
                'rounded-xl border px-3 text-[16px] font-semibold',
                view === option
                  ? 'border-[#173F35] bg-[#173F35] text-white'
                  : 'border-[#DCE5E0] bg-white text-[#1D2A26]',
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
            className={cn(GUIDE_UI_CLASSES.touchTarget, 'rounded-xl border border-[#DCE5E0] bg-white p-2 text-[#173F35]')}
            aria-label={guideNavigation.departures.period.previous}
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <button
            type="button"
            className={cn(GUIDE_UI_CLASSES.touchTarget, 'rounded-xl border border-[#DCE5E0] bg-white px-3 text-[16px] font-semibold text-[#173F35]')}
            onClick={() => { setAnchorIso(safeToday); setSelectedIso(safeToday); }}
          >
            {guideNavigation.departures.period.today}
          </button>
          <button
            type="button"
            className={cn(GUIDE_UI_CLASSES.touchTarget, 'rounded-xl border border-[#DCE5E0] bg-white p-2 text-[#173F35]')}
            aria-label={guideNavigation.departures.period.next}
            onClick={() => shift(1)}
          >
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={guideNavigation.departures.filters.label}>
        {(['ALL', 'UPCOMING', 'OPEN', 'COMPLETED'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            className={cn(
              GUIDE_UI_CLASSES.touchTarget,
              'shrink-0 rounded-full border px-4 text-[16px] font-semibold',
              filter === option
                ? 'border-[#8DAA9D] bg-[#E8F0EC] text-[#173F35]'
                : 'border-[#DCE5E0] bg-white text-[#63726C]',
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
          <div className="grid grid-cols-7 gap-1" aria-hidden>
            {guideNavigation.departures.weekdays.map((weekday) => (
              <span key={weekday} className="py-1 text-center text-[14px] font-semibold text-[#63726C]">{weekday}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label={guideNavigation.departures.monthViewTitle}>
            {monthDays.map((day) => (
              <button
                key={day.key}
                type="button"
                role="gridcell"
                aria-pressed={selectedIso === day.key}
                aria-label={guideNavigation.departures.dayLabel(formatGuideDateKey(day.key), day.departureCount)}
                className={cn(
                  'flex min-h-[60px] min-w-0 flex-col items-center justify-center rounded-xl border px-1 py-2 text-center',
                  GUIDE_UI_CLASSES.touchTarget,
                  selectedIso === day.key
                    ? 'border-[#173F35] bg-[#173F35] text-white'
                    : day.inMonth
                      ? 'border-[#DCE5E0] bg-white text-[#1D2A26]'
                      : 'border-transparent bg-[#FAF8F3] text-[#A2AEA8]',
                )}
                onClick={() => selectDate(day.key)}
              >
                <span className="text-[16px] font-bold">{day.dateLabel}</span>
                <span className="mt-1 text-[14px] leading-none">
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
                      className={cn(GUIDE_UI_CLASSES.touchTarget, 'inline-flex items-center rounded-xl bg-[#E8F0EC] px-4 text-[16px] font-semibold text-[#173F35]')}
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
