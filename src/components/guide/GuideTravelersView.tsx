'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CalendarDays, ChevronRight, Mail, MessageCircle, Phone, Search, X,
} from 'lucide-react';

import { GuideEmptyState } from './GuideEmptyState';
import { GuideHeader } from './GuideHeader';
import { GuidePersonRow } from './GuidePersonRow';
import { GuideSectionCard } from './GuideSectionCard';
import { GuideStatusPill } from './GuideStatusPill';
import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { guideNavigation as navigation } from '@/i18n/zh-TW/pages/guide-navigation';
import { Input } from '@/components/ui/Form';
import type { GuideTraveler, GuideTravelerFilter, GuideTravelerOrder } from '@/lib/guide-travelers';
import { filterGuideTravelers, summarizeGuideTravelers } from '@/lib/guide-travelers';
import { cn } from '@/lib/utils';

export type GuideTravelersViewProps = {
  tenantName?: string;
  todayIso: string;
  travelers: readonly GuideTraveler[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

const FILTERS: readonly GuideTravelerFilter[] = ['ALL', 'TODAY', 'REPLY', 'RETURNING'];

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${year}/${month}/${day}` : value;
}

function travelerDetailId(customerId: string): string {
  return `guide-traveler-detail-${encodeURIComponent(customerId)}`;
}

function travelerStatus(
  row: GuideTraveler,
  todayIso: string,
): { label: string; tone: 'neutral' | 'positive' | 'attention' | 'danger' | 'info' } {
  if (row.waitingReply) return { label: navigation.travelers.status.reply, tone: 'attention' };
  if (row.todayDeparture) return { label: navigation.travelers.status.today, tone: 'info' };
  if (row.customer.atRisk) return { label: navigation.travelers.status.atRisk, tone: 'danger' };
  if (row.primaryOrder && row.primaryOrder.departsOn >= todayIso) {
    return { label: navigation.travelers.status.upcoming, tone: 'positive' };
  }
  if (row.returning) return { label: navigation.travelers.status.returning, tone: 'positive' };
  return { label: row.customer.active ? navigation.travelers.status.active : navigation.travelers.status.inactive, tone: 'neutral' };
}

export function orderStatus(
  order: GuideTravelerOrder,
): { label: string; tone: 'neutral' | 'positive' | 'attention' | 'danger' | 'info' } {
  // The order status is authoritative; a date alone must not rewrite pending/confirmed data.
  if (order.status === 'CANCELLED') return { label: navigation.travelers.order.cancelled, tone: 'danger' };
  if (order.status === 'COMPLETED') return { label: navigation.travelers.order.completed, tone: 'neutral' };
  if (order.status === 'PENDING') return { label: navigation.travelers.order.pending, tone: 'attention' };
  if (order.status === 'CONFIRMED') return { label: navigation.travelers.order.confirmed, tone: 'positive' };
  return { label: navigation.travelers.order.confirmed, tone: 'positive' };
}

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className={GUIDE_UI_CLASSES.metricCard}>
      <p className={GUIDE_UI_CLASSES.secondary}>{label}</p>
      <p className={GUIDE_UI_CLASSES.metricValue}>{value}</p>
      {hint ? <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-2')}>{hint}</p> : null}
    </div>
  );
}

function TravelerDetail({
  row,
  todayIso,
  onClose,
}: {
  row: GuideTraveler;
  todayIso: string;
  onClose: () => void;
}) {
  const status = travelerStatus(row, todayIso);
  return (
    <GuideSectionCard
      title={navigation.travelers.detail.title}
      action={(
        <button
          type="button"
          onClick={onClose}
          className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.iconButton)}
          aria-label={navigation.travelers.detail.close}
        >
          <X size={20} aria-hidden />
        </button>
      )}
    >
      <GuidePersonRow
        name={row.customer.name}
        subtitle={row.customer.lineDisplayName ? navigation.travelers.detail.lineDisplayName(row.customer.lineDisplayName) : undefined}
        trailing={<GuideStatusPill tone={status.tone}>{status.label}</GuideStatusPill>}
      />

      <div className={cn(GUIDE_UI_CLASSES.insetSurface, 'mt-3 grid gap-2 sm:grid-cols-2')}>
        <p className={cn(GUIDE_UI_CLASSES.body, 'flex min-w-0 items-center gap-2')}>
          <Phone size={18} className={cn('shrink-0', GUIDE_UI_CLASSES.mutedIcon)} aria-hidden />
          <span className="truncate">{row.customer.phone || navigation.travelers.detail.notProvided}</span>
        </p>
        <p className={cn(GUIDE_UI_CLASSES.body, 'flex min-w-0 items-center gap-2')}>
          <Mail size={18} className={cn('shrink-0', GUIDE_UI_CLASSES.mutedIcon)} aria-hidden />
          <span className="truncate">{row.customer.email || navigation.travelers.detail.notProvided}</span>
        </p>
      </div>

      <div className="mt-5">
        <h3 className={GUIDE_UI_CLASSES.cardText}>{navigation.travelers.detail.orders}</h3>
        {row.orders.length === 0 ? (
          <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-2')}>{navigation.travelers.detail.noOrders}</p>
        ) : (
          <div className={cn(GUIDE_UI_CLASSES.listDivider, 'mt-2 divide-y')}>
            {row.orders.map((order) => {
              const state = orderStatus(order);
              return (
                <div key={order.id} className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <CalendarDays size={18} className={cn('mt-1 shrink-0', GUIDE_UI_CLASSES.mutedIcon)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn(GUIDE_UI_CLASSES.body, 'truncate font-semibold')}>{order.tripTitle}</p>
                    <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-1 truncate')}>
                      {dateLabel(order.departsOn)}{order.startTime ? ` · ${order.startTime}` : ''} · {order.partySize}{navigation.travelers.detail.people}
                    </p>
                  </div>
                  <GuideStatusPill tone={state.tone}>{state.label}</GuideStatusPill>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5">
        <h3 className={GUIDE_UI_CLASSES.cardText}>{navigation.travelers.detail.privateTags}</h3>
        <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-2 break-words')}>
          {row.customer.tags.length > 0 ? row.customer.tags.join('、') : navigation.travelers.detail.noTags}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {row.waitingReply ? (
          <Link
            href="/tenant/chat"
            className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.primaryButton)}
          >
            <MessageCircle size={18} aria-hidden />
            {navigation.travelers.detail.viewChat}
          </Link>
        ) : null}
        {row.orders.length > 0 ? (
          <Link
            href="/tenant/tour-orders"
            className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.secondaryButton)}
          >
            {navigation.travelers.detail.viewOrders}
          </Link>
        ) : null}
      </div>
    </GuideSectionCard>
  );
}

export function GuideTravelersView({
  tenantName,
  todayIso,
  travelers,
  loading,
  error,
  onRetry,
}: GuideTravelersViewProps) {
  const [filter, setFilter] = React.useState<GuideTravelerFilter>('ALL');
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const metrics = React.useMemo(() => summarizeGuideTravelers(travelers), [travelers]);
  const filtered = React.useMemo(
    () => filterGuideTravelers(travelers, filter, query),
    [filter, query, travelers],
  );
  const selected = selectedId ? travelers.find((row) => row.customer.id === selectedId) ?? null : null;
  const selectedDetailId = selected ? travelerDetailId(selected.customer.id) : null;
  const selectedDetailRef = React.useRef<HTMLDivElement>(null);
  const travelerRowRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const restoreFocusId = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (selected) {
      selectedDetailRef.current?.focus();
      return;
    }

    if (restoreFocusId.current) {
      travelerRowRefs.current[restoreFocusId.current]?.focus();
      restoreFocusId.current = null;
    }
  }, [selectedId]);

  const closeSelected = () => {
    if (selectedId) restoreFocusId.current = selectedId;
    setSelectedId(null);
  };

  return (
    <div className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
      <GuideHeader
        eyebrow={tenantName}
        title={navigation.travelers.title}
        subtitle={navigation.travelers.subtitle}
      />

      {loading ? (
        <GuideSectionCard title={navigation.travelers.loading} aria-busy={loading}>
          <p className={GUIDE_UI_CLASSES.secondary} role="status" aria-live="polite">
            {navigation.travelers.loadingDescription}
          </p>
        </GuideSectionCard>
      ) : error ? (
        <GuideSectionCard title={navigation.travelers.error.title}>
          <GuideEmptyState
            role="alert"
            title={navigation.travelers.error.description}
            icon={<AlertTriangle size={20} />}
            action={(
              <button
                type="button"
                onClick={onRetry}
                className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.primaryButton)}
              >
                {navigation.travelers.retry}
              </button>
            )}
          />
        </GuideSectionCard>
      ) : (
        <>
          <section aria-label={navigation.travelers.metrics.label} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Metric label={navigation.travelers.metrics.total} value={metrics.total} />
            <Metric label={navigation.travelers.metrics.today} value={metrics.todayDeparture} />
            <Metric label={navigation.travelers.metrics.reply} value={metrics.waitingReply} />
            <Metric label={navigation.travelers.metrics.returning} value={metrics.returning} hint={navigation.travelers.metrics.returningHint} />
          </section>

          <GuideSectionCard title={navigation.travelers.search.title}>
            <div role="search" aria-label={navigation.travelers.search.label}>
              <label htmlFor="guideTravelerSearch" className="sr-only">{navigation.travelers.search.label}</label>
              <div className="relative">
                <Search size={20} className={cn('pointer-events-none absolute left-3 top-1/2 -translate-y-1/2', GUIDE_UI_CLASSES.mutedIcon)} aria-hidden />
                <Input
                  id="guideTravelerSearch"
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  aria-controls="guide-traveler-results"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={navigation.travelers.search.placeholder}
                  className={cn(GUIDE_UI_CLASSES.searchInput, GUIDE_UI_CLASSES.focusRing)}
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.iconButton, 'absolute right-1 top-1/2 -translate-y-1/2')}
                    aria-label={navigation.travelers.search.clear}
                  >
                    <X size={18} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={navigation.travelers.filters.label}>
              {FILTERS.map((option) => {
                const count = filterGuideTravelers(travelers, option).length;
                const active = filter === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(option)}
                    className={cn(
                      GUIDE_UI_CLASSES.touchTarget,
                      GUIDE_UI_CLASSES.focusRing,
                      GUIDE_UI_CLASSES.filterButton,
                      active ? GUIDE_UI_CLASSES.filterActive : GUIDE_UI_CLASSES.filterInactive,
                    )}
                  >
                    {navigation.travelers.filters[option]}
                    <span className={cn(
                      'tabular-nums',
                      active ? GUIDE_UI_CLASSES.filterCountActive : GUIDE_UI_CLASSES.filterCountInactive,
                    )}>{count}</span>
                  </button>
                );
              })}
            </div>
          </GuideSectionCard>

          <GuideSectionCard title={navigation.travelers.list.title} description={navigation.travelers.list.count(filtered.length)}>
            <div id="guide-traveler-results" className="min-w-0">
              {filtered.length === 0 ? (
                <GuideEmptyState
                  title={navigation.travelers.empty.title}
                  description={navigation.travelers.empty.description}
                />
              ) : (
                <ul className={cn(GUIDE_UI_CLASSES.listDivider, 'min-w-0 divide-y')} role="list" aria-label={navigation.travelers.list.title}>
                  {filtered.map((row) => {
                    const status = travelerStatus(row, todayIso);
                    const itinerary = row.primaryOrder
                      ? `${row.primaryOrder.tripTitle} · ${dateLabel(row.primaryOrder.departsOn)}`
                      : navigation.travelers.list.noItinerary;
                    const isSelected = selectedId === row.customer.id;
                    const detailId = isSelected ? selectedDetailId ?? undefined : undefined;
                    return (
                      <li key={row.customer.id} className="min-w-0">
                        <button
                          ref={(node) => { travelerRowRefs.current[row.customer.id] = node; }}
                          type="button"
                          aria-expanded={isSelected}
                          aria-controls={isSelected ? detailId : undefined}
                          onClick={() => setSelectedId((currentId) => currentId === row.customer.id ? null : row.customer.id)}
                          className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.travelerRow)}
                        >
                          <GuidePersonRow
                            className="min-w-0 flex-1 px-1"
                            name={row.customer.name || navigation.travelers.list.unnamed}
                            subtitle={itinerary}
                            meta={(
                              <div className="flex flex-wrap items-center gap-2">
                                <GuideStatusPill tone={status.tone}>{status.label}</GuideStatusPill>
                                {row.unreadCount > 0 ? (
                                  <span className={GUIDE_UI_CLASSES.secondary}>{navigation.travelers.list.unread(row.unreadCount)}</span>
                                ) : null}
                              </div>
                            )}
                            trailing={<ChevronRight size={20} className={GUIDE_UI_CLASSES.mutedIcon} aria-hidden />}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </GuideSectionCard>

          {selected ? (
            <div
              id={selectedDetailId ?? undefined}
              ref={selectedDetailRef}
              tabIndex={-1}
              role="region"
              aria-label={navigation.travelers.detail.title}
              className={GUIDE_UI_CLASSES.detailFocusTarget}
            >
              <TravelerDetail row={selected} todayIso={todayIso} onClose={closeSelected} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
