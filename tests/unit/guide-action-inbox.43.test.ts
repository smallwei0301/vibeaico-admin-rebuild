import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_TENANT_TIME_ZONE,
  basicSettingsSchema,
} from '@/config/tenant-settings';
import {
  getGuideActionInboxDateWindow,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';
import { getGuideActionInbox } from '@/services/guide-action-inbox';

const apiSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/guide/action-inbox/route.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/services/guide-action-inbox.ts'),
  'utf8',
);
const pageSource = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/dashboard/page.tsx'),
  'utf8',
);

describe('GUIDE action inbox (#43-A / #43-B)', () => {
  it('prioritizes overdue, tenant-today, and future pending work', () => {
    const now = new Date('2026-09-02T04:00:00.000Z'); // 12:00 Asia/Taipei

    expect(getGuideActionInboxPriority('2026-09-02T03:59:59.000Z', now)).toBe('IMMEDIATE');
    expect(getGuideActionInboxPriority('2026-09-02T06:00:00.000Z', now)).toBe('TODAY');
    expect(getGuideActionInboxPriority('2026-09-03T02:00:00.000Z', now)).toBe('UPCOMING');

    const crossDateNow = new Date('2026-09-01T23:30:00.000Z');
    const crossDateStart = '2026-09-02T08:00:00.000Z';
    expect(getGuideActionInboxPriority(crossDateStart, crossDateNow, 'Asia/Taipei')).toBe('TODAY');
    expect(getGuideActionInboxPriority(crossDateStart, crossDateNow, 'America/Los_Angeles')).toBe('UPCOMING');
    expect(normalizeGuideTimeZone('Not/A_Real_Zone')).toBe('Asia/Taipei');

    const item = (id: string, priority: GuideActionInboxItem['priority'], dueAt: string, createdAt: string): GuideActionInboxItem => ({
      id, kind: 'BOOKING_REQUEST', bookingNo: id, customerName: id, serviceName: id,
      priority, dueAt, createdAt, href: '/tenant/bookings?status=PENDING',
    });
    expect(sortGuideActionInboxItems([
      item('future', 'UPCOMING', '2026-09-03T02:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      item('today-late', 'TODAY', '2026-09-02T08:00:00.000Z', '2026-09-02T01:00:00.000Z'),
      item('today-early', 'TODAY', '2026-09-02T06:00:00.000Z', '2026-09-02T02:00:00.000Z'),
      item('past', 'IMMEDIATE', '2026-09-02T03:59:59.000Z', '2026-09-02T03:00:00.000Z'),
    ]).map((entry) => entry.id)).toEqual(['past', 'today-early', 'today-late', 'future']);
  });

  it('makes tenant timezone a real persisted basic setting instead of an untyped JSON ghost field', () => {
    const required = { tenantName: '測試店家', shopCode: 'test-shop' };

    expect(basicSettingsSchema.parse(required).timezone).toBe(DEFAULT_TENANT_TIME_ZONE);
    expect(basicSettingsSchema.parse({
      ...required,
      timezone: 'America/Los_Angeles',
    }).timezone).toBe('America/Los_Angeles');
    expect(() => basicSettingsSchema.parse({
      ...required,
      timezone: 'Not/A_Real_Zone',
    })).toThrow();
  });

  it('limits departure items to today/tomorrow in the tenant timezone', () => {
    const now = new Date('2026-09-02T04:00:00.000Z'); // 12:00 Asia/Taipei
    const window = getGuideActionInboxDateWindow(now, 'Asia/Taipei');

    expect(getGuideDepartureDay(window.today, now, 'Asia/Taipei')).toBe('TODAY');
    expect(getGuideDepartureDay(window.tomorrow, now, 'Asia/Taipei')).toBe('TOMORROW');
    expect(getGuideDepartureDay('2026-09-04', now, 'Asia/Taipei')).toBeNull();
  });

  it('keeps mock GUIDE mode useful by exposing two actionable departures', async () => {
    const items = await getGuideActionInbox();
    const departures = items.filter((item) => item.kind === 'DEPARTURE');

    expect(departures).toHaveLength(2);
    expect(departures.map((item) => item.departureDay)).toEqual(['TODAY', 'TOMORROW']);
    expect(departures.every((item) => item.href.startsWith('/tenant/trips/'))).toBe(true);
  });

  it('reads only tenant-scoped pending bookings and the tenant timezone', () => {
    expect(apiSource).toContain(".from('bookings_view')");
    expect(apiSource).toContain(".eq('tenant_id', t.tenantId)");
    expect(apiSource).toContain(".eq('status', 'PENDING')");
    expect(apiSource).toContain(".from('trip_departures')");
    expect(apiSource).toContain(".eq('tenant_id', t.tenantId)");
    expect(apiSource).toContain(".in('status', ['OPEN', 'CLOSED'])");
    expect(apiSource).toContain('getGuideDepartureDay');
    expect(apiSource).toContain(".from('tenant_settings')");
    expect(apiSource).toContain(".select('basic')");
    expect(apiSource).toContain('normalizeGuideTimeZone');
    expect(apiSource).toContain("href: '/tenant/bookings?status=PENDING'");
    expect(serviceSource).toContain("request<GuideActionInboxItem[]>('/api/guide/action-inbox')");
    expect(serviceSource).toContain("kind: 'DEPARTURE'");
  });

  it('shows the slice only in GUIDE mode and renders a mobile-safe action', () => {
    expect(pageSource).toContain('modePreset.showActionInbox');
    expect(pageSource).not.toContain("businessType === 'GUIDE'");
    expect(pageSource).not.toContain("if (businessType !== 'GUIDE') return;");
    expect(pageSource).toContain('setActionInbox([])');
    expect(pageSource).toContain('getGuideActionInbox');
    expect(pageSource).toContain("item.kind === 'BOOKING_REQUEST'");
    expect(pageSource).toContain('departureDay');
    expect(pageSource).toContain('w-full flex-shrink-0 sm:w-auto');
  });
});
