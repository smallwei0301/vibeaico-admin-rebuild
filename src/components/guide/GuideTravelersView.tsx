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

function orderStatus(
  order: GuideTravelerOrder,
  todayIso: string,
): { label: string; tone: 'neutral' | 'positive' | 'attention' | 'danger' | 'info' } {
  if (order.status === 'CANCELLED') return { label: navigation.travelers.order.cancelled, tone: 'danger' };
  if (order.status === 'COMPLETED' || order.departsOn < todayIso) {
    return { label: navigation.travelers.order.completed, tone: 'neutral' };
  }
  if (order.status === 'PENDING') return { label: navigation.travelers.order.pending, tone: 'attention' };
  return { label: navigation.travelers.order.confirmed, tone: 'positive' };
}

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#DCE5E0] bg-[#FAF8F3] p-4">
      <p className={GUIDE_UI_CLASSES.secondary}>{label}</p>
      <p className="mt-1 text-[28px] font-bold leading-none text-[#173F35] tabular-nums">{value}</p>
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
          className={cn(GUIDE_UI_CLASSES.touchTarget, 'inline-flex items-center justify-center rounded-xl text-[#63726C] hover:bg-[#FAF8F3]')}
          aria-label={navigation.travelers.detail.close}
        >
          <X size={20} aria-hidden />
        </button>
      )}
    >
      <GuidePersonRow
        name={row.customer.name}
        subtitle={row.customer.lineDisplayName ? `LINE：${row.customer.lineDisplayName}` : undefined}
        trailing={<GuideStatusPill tone={status.tone}>{status.label}</GuideStatusPill>}
      />

      <div className="mt-3 grid gap-2 rounded-2xl bg-[#FAF8F3] p-4 sm:grid-cols-2">
        <p className={cn(GUIDE_UI_CLASSES.body, 'flex min-w-0 items-center gap-2')}>
          <Phone size={18} className="shrink-0 text-[#63726C]" aria-hidden />
          <span className="truncate">{row.customer.phone || navigation.travelers.detail.notProvided}</span>
        </p>
        <p className={cn(GUIDE_UI_CLASSES.body, 'flex min-w-0 items-center gap-2')}>
          <Mail size={18} className="shrink-0 text-[#63726C]" aria-hidden />
          <span className="truncate">{row.customer.email || navigation.travelers.detail.notProvided}</span>
        </p>
      </div>

      <div className="mt-5">
        <h3 className={GUIDE_UI_CLASSES.cardText}>{navigation.travelers.detail.orders}</h3>
        {row.orders.length === 0 ? (
          <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-2')}>{navigation.travelers.detail.noOrders}</p>
        ) : (
          <div className="mt-2 divide-y divide-[#DCE5E0]">
            {row.orders.map((order) => {
              const state = orderStatus(order, todayIso);
              return (
                <div key={order.id} className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <CalendarDays size={18} className="mt-1 shrink-0 text-[#63726C]" aria-hidden />
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
            className={cn(GUIDE_UI_CLASSES.touchTarget, 'inline-flex items-center gap-2 rounded-xl bg-[#173F35] px-4 text-[16px] font-semibold text-white')}
          >
            <MessageCircle size={18} aria-hidden />
            {navigation.travelers.detail.viewChat}
          </Link>
        ) : null}
        {row.orders.length > 0 ? (
          <Link
            href="/tenant/tour-orders"
            className={cn(GUIDE_UI_CLASSES.touchTarget, 'inline-flex items-center gap-2 rounded-xl border border-[#DCE5E0] px-4 text-[16px] font-semibold text-[#173F35]')}
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

  return (
    <div className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
      <GuideHeader
        eyebrow={tenantName}
        title={navigation.travelers.title}
        subtitle={navigation.travelers.subtitle}
      />

      {loading ? (
        <GuideSectionCard title={navigation.travelers.loading}>
          <p className={GUIDE_UI_CLASSES.secondary}>{navigation.travelers.loadingDescription}</p>
        </GuideSectionCard>
      ) : error ? (
        <GuideSectionCard title={navigation.travelers.error.title}>
          <GuideEmptyState
            title={navigation.travelers.error.description}
            icon={<AlertTriangle size={20} />}
            action={(
              <button
                type="button"
                onClick={onRetry}
                className={cn(GUIDE_UI_CLASSES.touchTarget, 'rounded-xl bg-[#173F35] px-4 text-[16px] font-semibold text-white')}
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
            <div role="search">
              <label htmlFor="guideTravelerSearch" className="sr-only">{navigation.travelers.search.label}</label>
              <div className="relative">
                <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#63726C]" aria-hidden />
                <Input
                  id="guideTravelerSearch"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={navigation.travelers.search.placeholder}
                  className="min-h-[48px] w-full rounded-xl pl-11 pr-11 text-[16px]"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className={cn(GUIDE_UI_CLASSES.touchTarget, 'absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-xl text-[#63726C] hover:bg-[#FAF8F3]')}
                    aria-label={navigation.travelers.search.clear}
                  >
                    <X size={18} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" aria-label={navigation.travelers.filters.label}>
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
                      'inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border px-3 text-[16px] font-semibold sm:flex-none',
                      active ? 'border-[#173F35] bg-[#173F35] text-white' : 'border-[#DCE5E0] bg-white text-[#1D2A26] hover:bg-[#FAF8F3]',
                    )}
                  >
                    {navigation.travelers.filters[option]}
                    <span className={cn('tabular-nums', active ? 'text-white/80' : 'text-[#63726C]')}>{count}</span>
                  </button>
                );
              })}
            </div>
          </GuideSectionCard>

          <GuideSectionCard title={navigation.travelers.list.title} description={navigation.travelers.list.count(filtered.length)}>
            {filtered.length === 0 ? (
              <GuideEmptyState
                title={navigation.travelers.empty.title}
                description={navigation.travelers.empty.description}
              />
            ) : (
              <div className="divide-y divide-[#DCE5E0]">
                {filtered.map((row) => {
                  const status = travelerStatus(row, todayIso);
                  const itinerary = row.primaryOrder
                    ? `${row.primaryOrder.tripTitle} · ${dateLabel(row.primaryOrder.departsOn)}`
                    : navigation.travelers.list.noItinerary;
                  return (
                    <button
                      key={row.customer.id}
                      type="button"
                      aria-expanded={selectedId === row.customer.id}
                      onClick={() => setSelectedId(row.customer.id)}
                      className="flex min-h-[68px] w-full items-center rounded-xl text-left outline-none transition-colors hover:bg-[#FAF8F3] focus-visible:ring-2 focus-visible:ring-[#173F35] focus-visible:ring-offset-2"
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
                        trailing={<ChevronRight size={20} className="text-[#63726C]" aria-hidden />}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </GuideSectionCard>

          {selected ? <TravelerDetail row={selected} todayIso={todayIso} onClose={() => setSelectedId(null)} /> : null}
        </>
      )}
    </div>
  );
}
