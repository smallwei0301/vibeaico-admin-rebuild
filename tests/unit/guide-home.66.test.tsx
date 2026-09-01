import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GuideHomeView } from '@/components/guide';
import {
  buildGuideWeekSummary,
  selectGuideFocusItems,
  selectUpcomingGuideDepartures,
  type GuideDepartureSummary,
} from '@/lib/guide-home';
import type { DashboardAlerts, DashboardStats } from '@/lib/types';

const departure = (overrides: Partial<GuideDepartureSummary> = {}): GuideDepartureSummary => ({
  id: 'dp-1',
  tripId: 'trip-1',
  planId: 'plan-1',
  planName: '標準方案',
  tripTitle: '海岸線半日遊',
  departsOn: '2026-09-02',
  startTime: '09:00',
  capacity: 8,
  seatsBooked: 3,
  status: 'OPEN',
  note: '',
  ...overrides,
});

const alerts = (overrides: Partial<DashboardAlerts> = {}): DashboardAlerts => ({
  unprocessedBookings: 2,
  lowStockProducts: 1,
  atRiskCustomers: 4,
  bookingCutoffPassed: true,
  bookingCutoffDate: '2026-09-01',
  pushQuotaExhausted: true,
  expiredFeatures: ['BASIC_REPORT'],
  expiringFeatures: [{ code: 'KEYWORD_REPLY', expiresAt: '2026-09-05' }],
  ...overrides,
});

const stats: DashboardStats = {
  todayBookings: 2,
  pendingBookings: 2,
  monthRevenue: 0,
  totalCustomers: 0,
  pushQuotaUsed: 0,
  pushQuotaTotal: 0,
  linePlatformStatus: 'CONNECTED',
};

describe('GUIDE home selectors (#66 Phase C)', () => {
  it('prioritizes real alert fields and caps the first-screen actions at three', () => {
    expect(selectGuideFocusItems(alerts())).toEqual([
      { key: 'unprocessedBookings', count: 2, href: '/tenant/bookings?status=PENDING' },
      { key: 'bookingCutoff', href: '/tenant/tour-orders' },
      { key: 'pushQuota', href: '/tenant/line-settings' },
    ]);
    expect(selectGuideFocusItems(alerts({ unprocessedBookings: 0 }), 2)).toHaveLength(2);
  });

  it('keeps low-frequency inventory and feature expiry notices out of primary focus', () => {
    expect(selectGuideFocusItems(alerts({
      unprocessedBookings: 0,
      bookingCutoffPassed: false,
      pushQuotaExhausted: false,
      atRiskCustomers: 0,
    }))).toEqual([]);
  });

  it('does not create a focus card for zero or false alert fields', () => {
    expect(selectGuideFocusItems(alerts({
      unprocessedBookings: 0,
      lowStockProducts: 0,
      atRiskCustomers: 0,
      bookingCutoffPassed: false,
      pushQuotaExhausted: false,
      expiredFeatures: [],
      expiringFeatures: [],
    }))).toEqual([]);
  });

  it('sorts upcoming departures, excludes cancellations, and caps the list', () => {
    expect(selectUpcomingGuideDepartures([
      departure({ id: 'later', departsOn: '2026-09-04' }),
      departure({ id: 'cancelled', departsOn: '2026-09-01', status: 'CANCELLED' }),
      departure({ id: 'first', departsOn: '2026-09-02', startTime: '08:00' }),
      departure({ id: 'past', departsOn: '2026-08-31' }),
    ], '2026-09-01')).toMatchObject([
      { id: 'first' },
      { id: 'later' },
    ]);
  });

  it('builds a seven-day count summary from active departure dates', () => {
    const summary = buildGuideWeekSummary([
      departure({ id: 'one', departsOn: '2026-09-01' }),
      departure({ id: 'two', departsOn: '2026-09-01' }),
      departure({ id: 'cancelled', departsOn: '2026-09-03', status: 'CANCELLED' }),
    ], '2026-09-01');
    expect(summary).toHaveLength(7);
    expect(summary[0]).toMatchObject({ key: '2026-09-01', departureCount: 2, selected: true });
    expect(summary[2]).toMatchObject({ key: '2026-09-03', departureCount: 0 });
  });

  it('renders action-first sections from caller-provided facts without baseline demo values', () => {
    const html = renderToStaticMarkup(
      <GuideHomeView
        tenantName="測試嚮導工作室"
        todayIso="2026-09-01"
        alerts={alerts({
          bookingCutoffPassed: false,
          pushQuotaExhausted: false,
          expiredFeatures: [],
          expiringFeatures: [],
        })}
        alertsLoading={false}
        alertsError={false}
        stats={stats}
        setup={null}
        departures={[departure()]}
        departuresLoading={false}
        departuresError={false}
      />,
    );
    expect(html).toContain('今天重點');
    expect(html).toContain('接下來出發');
    expect(html).toContain('本週行程概覽');
    expect(html).toContain('/tenant/bookings?status=PENDING');
    expect(html).toContain('海岸線半日遊');
    expect(html).not.toContain('268900');
    expect(html).not.toContain('412');
  });

  it('renders an explicit disclosure when more than three primary focus items exist', () => {
    const html = renderToStaticMarkup(
      <GuideHomeView
        tenantName="測試嚮導工作室"
        todayIso="2026-09-01"
        alerts={alerts()}
        alertsLoading={false}
        alertsError={false}
        stats={stats}
        setup={null}
        departures={[]}
        departuresLoading={false}
        departuresError={false}
      />,
    );
    expect(html).toContain('查看全部待辦');
    expect(html).toContain('/tenant/customers?atRisk=true');
  });

  it('keeps a loaded empty week separate from the loading state', () => {
    const html = renderToStaticMarkup(
      <GuideHomeView
        tenantName="測試嚮導工作室"
        todayIso="2026-09-01"
        alerts={null}
        alertsLoading={false}
        alertsError={false}
        stats={null}
        setup={null}
        departures={[]}
        departuresLoading={false}
        departuresError={false}
      />,
    );
    expect(html).toContain('本週尚無團次');
    expect(html).not.toContain('正在載入團次…');
  });

  it('does not turn an alert fetch failure into a no-items message', () => {
    const html = renderToStaticMarkup(
      <GuideHomeView
        tenantName="測試嚮導工作室"
        todayIso="2026-09-01"
        alerts={null}
        alertsLoading={false}
        alertsError
        stats={null}
        setup={null}
        departures={[]}
        departuresLoading={false}
        departuresError={false}
      />,
    );
    expect(html).toContain('待辦暫時無法載入');
    expect(html).not.toContain('目前沒有待處理事項');
  });
  it('keeps Home disclosure styling behind shared GUIDE tokens', () => {
    const source = readFileSync('src/components/guide/GuideHomeView.tsx', 'utf8');
    expect(source).toContain('GUIDE_UI_CLASSES.detailsSurface');
    expect(source).toContain('GUIDE_UI_CLASSES.detailsSummary');
    expect(source).toContain('GUIDE_UI_CLASSES.detailsContent');
    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(source).not.toMatch(/text-\[[0-9]+px\]/);
  });


  it('announces Home loading and error states semantically', () => {
    const source = readFileSync('src/components/guide/GuideHomeView.tsx', 'utf8');
    expect(source).toContain('aria-busy={alertsLoading}');
    expect(source).toContain('aria-busy={departuresLoading}');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="alert"');
  });


});
