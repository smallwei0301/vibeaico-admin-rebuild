'use client';

import * as React from 'react';
import { ArrowRight, CalendarDays, Layers, MapPin, RefreshCw, Route, Search } from 'lucide-react';
import Link from 'next/link';

import { GUIDE_UI_CLASSES, type GuideStatusTone } from '@/config/guide-ui';
import { guideNavigation } from '@/i18n/zh-TW/pages/guide-navigation';
import { filterGuideTrips, summarizeGuideTrips, type GuideTripFilter } from '@/lib/guide-trips';
import type { Trip, TripStatus } from '@/lib/types';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';

import { GuideEmptyState } from './GuideEmptyState';
import { GuideHeader } from './GuideHeader';
import { GuideSectionCard } from './GuideSectionCard';
import { GuideStatusPill } from './GuideStatusPill';

export type GuideTripsViewProps = {
  trips: readonly Trip[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

const FILTERS: readonly GuideTripFilter[] = ['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'];

const STATUS_TONES: Record<TripStatus, GuideStatusTone> = {
  PUBLISHED: 'positive',
  DRAFT: 'neutral',
  ARCHIVED: 'attention',
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(GUIDE_UI_CLASSES.quietSurface, 'min-w-0')}>
      <p className={GUIDE_UI_CLASSES.secondary}>{label}</p>
      <p className={cn(GUIDE_UI_CLASSES.cardText, 'mt-1')}>{value}</p>
    </div>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  const copy = guideNavigation.trips;
  const price = trip.planCount > 0 ? formatCurrency(trip.minPrice) : copy.card.noPrice;

  return (
    <article className={cn(GUIDE_UI_CLASSES.card, GUIDE_UI_CLASSES.cardPadding)}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(GUIDE_UI_CLASSES.avatarSurface, 'flex size-11 shrink-0 items-center justify-center rounded-full')}
            aria-hidden
          >
            <Route size={20} />
          </div>
          <div className="min-w-0">
            <h3 className={cn(GUIDE_UI_CLASSES.cardText, 'break-words')}>{trip.title}</h3>
            <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1')}>
              <span className="inline-flex min-w-0 items-center gap-1 break-words">
                <MapPin size={14} aria-hidden />{trip.region}
              </span>
              {trip.category ? <span className="break-words">{trip.category}</span> : null}
            </p>
          </div>
        </div>
        <GuideStatusPill tone={STATUS_TONES[trip.status]}>{copy.status[trip.status]}</GuideStatusPill>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label={copy.card.plans} value={formatNumber(trip.planCount)} />
        <Metric label={copy.card.departures} value={formatNumber(trip.upcomingDepartureCount)} />
        <Metric label={copy.card.startingPrice} value={price} />
        <Metric label={copy.card.channel} value={copy.card.channelValue[trip.status]} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          href={`/tenant/trips/${trip.id}`}
          className={cn(
            GUIDE_UI_CLASSES.touchTarget,
            'inline-flex items-center justify-center gap-2 rounded-xl border border-[#DCE5E0] px-3 py-2 text-center text-[16px] font-semibold text-[#173F35] hover:bg-[#FAF8F3]',
          )}
          aria-label={`${copy.actions.view}：${trip.title}`}
        >
          {copy.actions.view}<ArrowRight size={17} aria-hidden />
        </Link>
        <Link
          href={`/tenant/trips/${trip.id}?tab=departures`}
          className={cn(
            GUIDE_UI_CLASSES.touchTarget,
            'inline-flex items-center justify-center gap-2 rounded-xl bg-[#E8F0EC] px-3 py-2 text-center text-[16px] font-semibold text-[#173F35] hover:bg-[#DCE9E2]',
          )}
          aria-label={`${copy.actions.departures}：${trip.title}`}
        >
          <CalendarDays size={17} aria-hidden />{copy.actions.departures}
        </Link>
      </div>
    </article>
  );
}

export function GuideTripsView({ trips, loading, error, onRetry }: GuideTripsViewProps) {
  const copy = guideNavigation.trips;
  const [filter, setFilter] = React.useState<GuideTripFilter>('ALL');
  const [query, setQuery] = React.useState('');
  const summary = React.useMemo(() => summarizeGuideTrips(trips), [trips]);
  const visible = React.useMemo(() => filterGuideTrips(trips, filter, query), [filter, query, trips]);
  const hasCriteria = Boolean(query.trim()) || filter !== 'ALL';

  if (loading) {
    return (
      <main className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
        <GuideHeader title={copy.title} subtitle={copy.subtitle} />
        <GuideSectionCard title={copy.loading}>
          <p className={GUIDE_UI_CLASSES.bodyMuted}>{copy.loadingDescription}</p>
        </GuideSectionCard>
      </main>
    );
  }

  if (error) {
    return (
      <main className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
        <GuideHeader title={copy.title} subtitle={copy.subtitle} />
        <GuideSectionCard title={copy.error.title}>
          <GuideEmptyState
            title={copy.error.title}
            description={copy.error.description}
            icon={<RefreshCw size={20} />}
            action={<button type="button" className={cn(GUIDE_UI_CLASSES.touchTarget, 'rounded-xl bg-[#173F35] px-4 py-2 text-[16px] font-semibold text-white')} onClick={onRetry}>{copy.retry}</button>}
          />
        </GuideSectionCard>
      </main>
    );
  }

  return (
    <main className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
      <GuideHeader title={copy.title} subtitle={copy.subtitle} />

      <GuideSectionCard title={copy.summary.title} description={copy.summary.description}>
        <div className="grid grid-cols-2 gap-2">
          <Metric label={copy.summary.total} value={formatNumber(summary.total)} />
          <Metric label={copy.summary.published} value={formatNumber(summary.published)} />
          <Metric label={copy.summary.draft} value={formatNumber(summary.draft)} />
          <Metric label={copy.summary.upcomingDepartures} value={formatNumber(summary.upcomingDepartures)} />
        </div>
      </GuideSectionCard>

      <GuideSectionCard title={copy.search.title}>
        <label className="relative block">
          <span className="sr-only">{copy.search.label}</span>
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#63726C]" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search.placeholder}
            className={cn(GUIDE_UI_CLASSES.touchTarget, 'w-full rounded-xl border border-[#DCE5E0] bg-white py-2 pl-10 pr-3 text-[16px] text-[#1D2A26] outline-none focus:border-[#173F35] focus:ring-2 focus:ring-[#E8F0EC]')}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={copy.filters.label}>
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              className={cn(
                GUIDE_UI_CLASSES.touchTarget,
                'rounded-full border px-3 py-2 text-[16px] font-semibold',
                filter === option ? 'border-[#173F35] bg-[#E8F0EC] text-[#173F35]' : 'border-[#DCE5E0] bg-white text-[#63726C] hover:bg-[#FAF8F3]',
              )}
              onClick={() => setFilter(option)}
            >
              {copy.filters[option]}
            </button>
          ))}
        </div>
      </GuideSectionCard>

      <GuideSectionCard title={copy.list.title} description={copy.list.count(visible.length)}>
        {visible.length === 0 ? (
          <GuideEmptyState
            title={hasCriteria ? copy.empty.filteredTitle : copy.empty.title}
            description={hasCriteria ? copy.empty.filteredDescription : copy.empty.description}
            icon={<Layers size={20} />}
          />
        ) : (
          <div className="space-y-3">
            {visible.map((trip) => <TripCard key={trip.id} trip={trip} />)}
          </div>
        )}
      </GuideSectionCard>
    </main>
  );
}
