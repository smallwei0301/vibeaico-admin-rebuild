import Link from 'next/link';
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Settings2,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import {
  GuideDepartureCard,
  GuideEmptyState,
  GuideHeader,
  GuideSectionCard,
  GuideStatusPill,
  GuideWeekStrip,
} from '@/components/guide';
import { GUIDE_UI_CLASSES, type GuideStatusTone } from '@/config/guide-ui';
import { guideDashboardPage as t } from '@/i18n/zh-TW/pages/guide-dashboard';
import type { DashboardAlerts, DashboardStats, SetupStatus } from '@/lib/types';
import {
  buildGuideWeekSummary,
  selectGuideFocusItems,
  selectUpcomingGuideDepartures,
  type GuideDepartureSummary,
  type GuideFocusItem,
  type GuideFocusItemKey,
} from '@/lib/guide-home';
import { cn, formatNumber } from '@/lib/utils';

export type GuideHomeViewProps = {
  tenantName: string;
  todayIso: string;
  alerts: DashboardAlerts | null;
  alertsLoading: boolean;
  alertsError: boolean;
  stats: DashboardStats | null;
  setup: SetupStatus | null;
  departures: readonly GuideDepartureSummary[];
  departuresLoading: boolean;
  departuresError: boolean;
};

const FOCUS_ICONS: Record<GuideFocusItemKey, LucideIcon> = {
  unprocessedBookings: ClipboardCheck,
  bookingCutoff: Clock3,
  pushQuota: BellRing,
  atRiskCustomers: UsersRound,
};

const FOCUS_TONES: Record<GuideFocusItemKey, 'attention' | 'danger' | 'info'> = {
  unprocessedBookings: 'attention',
  bookingCutoff: 'danger',
  pushQuota: 'danger',
  atRiskCustomers: 'attention',
};

function dateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return year && month && day ? `${year}/${month}/${day}` : dateKey;
}

function focusDescription(key: GuideFocusItemKey, count?: number): string {
  const description = t.focus[key].description;
  return typeof description === 'function' ? description(count ?? 0) : description;
}

function FocusCard({ item }: { item: GuideFocusItem }) {
  const Icon = FOCUS_ICONS[item.key];
  const copy = t.focus[item.key];

  return (
    <Link
      href={item.href}
      className={cn(GUIDE_UI_CLASSES.interactiveCard, GUIDE_UI_CLASSES.focusRing, 'flex items-center gap-3')}
    >
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full',
          item.key === 'bookingCutoff' || item.key === 'pushQuota'
            ? GUIDE_UI_CLASSES.focusDangerSurface
            : GUIDE_UI_CLASSES.focusAttentionSurface,
        )}
        aria-hidden
      >
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn(GUIDE_UI_CLASSES.cardText, 'block')}>{copy.title}</span>
        <span className={cn(GUIDE_UI_CLASSES.secondary, 'mt-1 block')}>
          {focusDescription(item.key, item.count)}
        </span>
      </span>
      <GuideStatusPill tone={FOCUS_TONES[item.key]}>{copy.action}</GuideStatusPill>
    </Link>
  );
}

function departureStatus(departure: GuideDepartureSummary): {
  label: string;
  tone: 'neutral' | 'positive' | 'attention' | 'danger' | 'info';
} {
  if (departure.status === 'CANCELLED') return { label: t.upcoming.status.CANCELLED, tone: 'danger' };
  if (departure.status === 'CLOSED') return { label: t.upcoming.status.CLOSED, tone: 'neutral' };
  if (departure.seatsBooked >= departure.capacity) return { label: t.upcoming.status.FULL, tone: 'positive' };
  return { label: t.upcoming.status.OPEN, tone: 'info' };
}

function lineHealth(stats: DashboardStats | null): { label: string; tone: GuideStatusTone } {
  if (!stats) return { label: t.health.unavailable, tone: 'neutral' as const };
  const tone = stats.linePlatformStatus === 'CONNECTED'
    ? 'positive'
    : stats.linePlatformStatus === 'ERROR' ? 'danger' : 'attention';
  return { label: t.health.lineStatus[stats.linePlatformStatus], tone };
}

function setupHealth(setup: SetupStatus | null) {
  if (!setup) return { label: t.health.unavailable, tone: 'neutral' as const };
  return {
    label: setup.percent >= 100 ? t.health.setupComplete : t.health.setupProgress(setup.percent),
    tone: setup.percent >= 100 ? 'positive' as const : 'attention' as const,
  };
}

export function GuideHomeView({
  tenantName,
  todayIso,
  alerts,
  alertsLoading,
  alertsError,
  stats,
  setup,
  departures,
  departuresLoading,
  departuresError,
}: GuideHomeViewProps) {
  const allFocusItems = selectGuideFocusItems(alerts, Number.MAX_SAFE_INTEGER);
  const focusItems = allFocusItems.slice(0, 3);
  const extraFocusItems = allFocusItems.slice(3);
  const upcoming = selectUpcomingGuideDepartures(departures, todayIso);
  const week = buildGuideWeekSummary(departures, todayIso);
  const line = lineHealth(stats);
  const setupStatus = setupHealth(setup);

  return (
    <div className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
      <GuideHeader
        eyebrow={tenantName}
        title={t.title}
        subtitle={t.subtitle}
      />

      <GuideSectionCard title={t.focus.title} aria-busy={alertsLoading}>
        {alertsLoading ? (
          <p className={GUIDE_UI_CLASSES.secondary} role="status" aria-live="polite">{t.focus.loading}</p>
        ) : alertsError ? (
          <GuideEmptyState
            role="alert"
            title={t.focus.errorTitle}
            description={t.focus.errorDescription}
            icon={<AlertTriangle size={20} />}
          />
        ) : focusItems.length === 0 ? (
          <GuideEmptyState
            title={t.focus.emptyTitle}
            description={t.focus.emptyDescription}
            icon={<CheckCircle2 size={20} />}
          />
        ) : (
          <>
            <div className="grid gap-2.5">
              {focusItems.map((item) => <FocusCard key={item.key} item={item} />)}
            </div>
            {extraFocusItems.length > 0 ? (
              <details className={cn('mt-3', GUIDE_UI_CLASSES.detailsSurface)}>
                <summary className={GUIDE_UI_CLASSES.detailsSummary}>
                  {t.focus.viewAll}
                </summary>
                <div className={GUIDE_UI_CLASSES.detailsContent}>
                  {extraFocusItems.map((item) => <FocusCard key={item.key} item={item} />)}
                </div>
              </details>
            ) : null}
          </>
        )}
      </GuideSectionCard>

      <GuideSectionCard
        title={t.upcoming.title}
        aria-busy={departuresLoading}
        action={
          <Link
            href="/tenant/calendar"
            className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.secondary, 'inline-flex items-center gap-1 rounded-xl px-2 py-1 font-semibold')}
          >
            <CalendarDays size={16} aria-hidden />
            {t.upcoming.viewAll}
          </Link>
        }
      >
        {departuresLoading ? (
          <p className={GUIDE_UI_CLASSES.secondary} role="status" aria-live="polite">{t.upcoming.loading}</p>
        ) : departuresError ? (
          <GuideEmptyState role="alert" title={t.upcoming.errorTitle} description={t.upcoming.errorDescription} />
        ) : upcoming.length === 0 ? (
          <GuideEmptyState title={t.upcoming.emptyTitle} description={t.upcoming.emptyDescription} />
        ) : (
          <div className="grid gap-2.5">
            {upcoming.map((departure) => {
              const status = departureStatus(departure);
              return (
                <GuideDepartureCard
                  key={departure.id}
                  title={departure.tripTitle || departure.planName}
                  dateLabel={t.upcoming.dateLabel(dateLabel(departure.departsOn))}
                  timeLabel={departure.startTime || undefined}
                  capacityLabel={t.upcoming.capacityLabel(departure.seatsBooked, departure.capacity)}
                  statusLabel={status.label}
                  statusTone={status.tone}
                  action={
                    <Link
                      href={`/tenant/trips/${departure.tripId}?tab=departures`}
                      className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.secondary, 'inline-flex items-center rounded-xl px-2 py-1 font-semibold')}
                    >
                      {t.upcoming.viewDeparture}
                    </Link>
                  }
                />
              );
            })}
          </div>
        )}
      </GuideSectionCard>

      <GuideSectionCard title={t.week.title} aria-busy={departuresLoading}>
        {departuresLoading ? (
          <p className={GUIDE_UI_CLASSES.secondary} role="status" aria-live="polite">{t.upcoming.loading}</p>
        ) : departuresError ? (
          <GuideEmptyState role="alert" title={t.upcoming.errorTitle} description={t.upcoming.errorDescription} />
        ) : week.length === 0 ? (
          <GuideEmptyState title={t.week.emptyTitle} description={t.week.emptyDescription} />
        ) : (
          <>
            <GuideWeekStrip
              days={week.map((day) => ({
                key: day.key,
                weekdayLabel: t.week.weekdays[day.weekdayIndex],
                dateLabel: day.dateLabel,
                countLabel: day.departureCount > 0 ? t.week.count(day.departureCount) : undefined,
                selected: day.selected,
              }))}
            />
            {week.every((day) => day.departureCount === 0) ? (
              <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-4')}>{t.week.emptyDescription}</p>
            ) : null}
          </>
        )}
      </GuideSectionCard>

      <GuideSectionCard title={t.quickActions.title}>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {t.quickActions.actions.slice(0, 3).map((action) => (
            <Link
              key={action.key}
              href={action.href}
              className={cn(GUIDE_UI_CLASSES.interactiveCard, GUIDE_UI_CLASSES.focusRing, 'flex min-h-[76px] items-center gap-3')}
            >
              <span className={cn(GUIDE_UI_CLASSES.avatarSurface, 'flex size-10 shrink-0 items-center justify-center rounded-xl')} aria-hidden>
                {action.key === 'tourOrders' ? <ClipboardCheck size={19} /> : action.key === 'trips' ? <CalendarDays size={19} /> : <BellRing size={19} />}
              </span>
              <span className={cn(GUIDE_UI_CLASSES.body, 'font-semibold')}>{action.label}</span>
            </Link>
          ))}
        </div>
      </GuideSectionCard>

      <GuideSectionCard
        title={t.health.title}
        action={
          <Link
            href="/tenant/settings"
            className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, GUIDE_UI_CLASSES.secondary, 'inline-flex items-center gap-1 rounded-xl px-2 py-1 font-semibold')}
          >
            <Settings2 size={16} aria-hidden />
            {t.health.openSettings}
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={cn('flex items-center justify-between gap-3 rounded-xl p-3', GUIDE_UI_CLASSES.subtleSurface)}>
            <span className={GUIDE_UI_CLASSES.body}>{t.health.line}</span>
            <GuideStatusPill tone={line.tone}>{line.label}</GuideStatusPill>
          </div>
          <div className={cn('flex items-center justify-between gap-3 rounded-xl p-3', GUIDE_UI_CLASSES.subtleSurface)}>
            <span className={GUIDE_UI_CLASSES.body}>{t.health.setup}</span>
            <GuideStatusPill tone={setupStatus.tone}>{setupStatus.label}</GuideStatusPill>
          </div>
        </div>
        {stats ? (
          <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-3')}>
            {t.health.todayBookings(formatNumber(stats.todayBookings))}
          </p>
        ) : null}
      </GuideSectionCard>
    </div>
  );
}
