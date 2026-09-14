import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_TENANT_TIME_ZONE,
  basicSettingsSchema,
} from '@/config/tenant-settings';
import {
  buildGuideActionInboxFormationItem,
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  isGuideActionInboxFormationStatus,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';
import { getGuideActionInbox, getGuideActionInboxFormationItems } from '@/services/guide-action-inbox';

const apiSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/guide/action-inbox/route.ts'),
  'utf8',
);
const formationApiSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/guide/action-inbox/formation/route.ts'),
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
const bookingsPageSource = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/bookings/page.tsx'),
  'utf8',
);
const bookingsApiSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/bookings/route.ts'),
  'utf8',
);

describe('GUIDE action inbox (#43-A / #43-B / #43-C)', () => {
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
      priority, dueAt, createdAt, href: '/tenant/bookings?status=PENDING&bookingId=id',
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

  it('sorts mixed booking and departure work by the tenant-local instant', () => {
    const departureDueAt = getGuideDepartureDueAt('2026-09-02', '17:00', 'Asia/Taipei');
    expect(departureDueAt).toBe('2026-09-02T09:00:00.000Z');

    const booking: GuideActionInboxItem = {
      id: 'booking',
      kind: 'BOOKING_REQUEST',
      bookingNo: 'booking',
      customerName: '顧客',
      serviceName: '服務',
      priority: 'TODAY',
      dueAt: '2026-09-02T08:30:00.000Z',
      createdAt: '2026-09-02T00:00:00.000Z',
      href: '/tenant/bookings?status=PENDING&bookingId=booking',
    };
    const departure: GuideActionInboxItem = {
      id: 'departure',
      kind: 'DEPARTURE',
      tripId: 'trip',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-09-02',
      startTime: '17:00',
      capacity: 10,
      seatsBooked: 2,
      departureDay: 'TODAY',
      priority: 'TODAY',
      dueAt: departureDueAt,
      createdAt: '2026-09-02T00:00:00.000Z',
      href: '/tenant/trips/trip',
    };

    expect(sortGuideActionInboxItems([departure, booking]).map((item) => item.id))
      .toEqual(['booking', 'departure']);
  });

  it('keeps mock GUIDE mode useful by exposing two actionable departures', async () => {
    const items = await getGuideActionInbox();
    const departures = items.filter((item) => item.kind === 'DEPARTURE');
    const payments = items.filter((item) => item.kind === 'BOOKING_PAYMENT');

    expect(departures).toHaveLength(2);
    expect(departures.map((item) => item.departureDay)).toEqual(['TODAY', 'TOMORROW']);
    expect(departures.every((item) => item.href.startsWith('/tenant/trips/'))).toBe(true);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      bookingNo: 'BK20260822001',
      amount: 800,
      href: '/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID&bookingId=b_g2',
    });
  });

  it('only treats REVIEW_REQUIRED and AT_RISK formation_status as inbox-worthy (#43 類別 3／4)', () => {
    expect(isGuideActionInboxFormationStatus('REVIEW_REQUIRED')).toBe(true);
    expect(isGuideActionInboxFormationStatus('AT_RISK')).toBe(true);
    expect(isGuideActionInboxFormationStatus('COLLECTING')).toBe(false);
    expect(isGuideActionInboxFormationStatus('FORMED')).toBe(false);
    expect(isGuideActionInboxFormationStatus('FAILED')).toBe(false);
    expect(isGuideActionInboxFormationStatus(null)).toBe(false);
    expect(isGuideActionInboxFormationStatus(undefined)).toBe(false);
  });

  it('derives formation card due-at honestly from real DB columns, never fabricating a deadline', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');

    // REVIEW_REQUIRED：有 formation_deadline_at 就直接用它作為截止時間。
    const reviewWithDeadline = buildGuideActionInboxFormationItem({
      id: 'dp_review',
      tripId: 'trip_1',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-08-26',
      startTime: '13:30',
      capacity: 8,
      seatsBooked: 0,
      minToDepart: 4,
      formationStatus: 'REVIEW_REQUIRED',
      formationDeadlineAt: '2026-08-19T15:59:00.000Z',
      formedParticipants: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    expect(reviewWithDeadline).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      dueAt: '2026-08-19T15:59:00.000Z',
      href: '/tenant/trips/trip_1',
      minToDepart: 4,
      formationDeadlineAt: '2026-08-19T15:59:00.000Z',
      formedParticipants: null,
    });

    // REVIEW_REQUIRED 但缺 formation_deadline_at（舊資料）：誠實退回出發時刻，
    // 不得虛構一個不存在的截止時間。
    const reviewWithoutDeadline = buildGuideActionInboxFormationItem({
      id: 'dp_review_2',
      tripId: 'trip_1',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-08-26',
      startTime: '13:30',
      capacity: 8,
      seatsBooked: 0,
      minToDepart: 4,
      formationStatus: 'REVIEW_REQUIRED',
      formationDeadlineAt: null,
      formedParticipants: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    expect(reviewWithoutDeadline.dueAt).toBe(getGuideDepartureDueAt('2026-08-26', '13:30', 'Asia/Taipei'));

    // AT_RISK：即使 formation_deadline_at 還留著舊值，下一個真正的期限是出發時刻，不是它。
    const atRisk = buildGuideActionInboxFormationItem({
      id: 'dp_at_risk',
      tripId: 'trip_2',
      tripName: '行程二',
      planName: '方案二',
      departureDate: '2026-08-30',
      startTime: '16:30',
      capacity: 10,
      seatsBooked: 3,
      minToDepart: 4,
      formationStatus: 'AT_RISK',
      formationDeadlineAt: '2026-08-18T15:59:00.000Z',
      formedParticipants: 5,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    expect(atRisk.dueAt).toBe(getGuideDepartureDueAt('2026-08-30', '16:30', 'Asia/Taipei'));
    expect(atRisk.kind).toBe('AT_RISK');
    expect(atRisk.formedParticipants).toBe(5);
  });

  it('exposes mock REVIEW_REQUIRED / AT_RISK departures without inventing demo data for other statuses', async () => {
    const items = await getGuideActionInboxFormationItems();
    const reviewRequired = items.filter((item) => item.kind === 'REVIEW_REQUIRED');
    const atRisk = items.filter((item) => item.kind === 'AT_RISK');

    // dp_4（REVIEW_REQUIRED）與 dp_8（AT_RISK）是 mock/tours.ts 既有唯二符合的 fixture；
    // 其餘 formation_status（COLLECTING/FORMED/FAILED）與已取消的 dp_6 都必須誠實地不
    // 出現在這兩個類別，不得為了畫面好看而多加。
    expect(reviewRequired).toHaveLength(1);
    expect(reviewRequired[0]).toMatchObject({ id: 'dp_4', href: '/tenant/trips/tp_1' });
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0]).toMatchObject({ id: 'dp_8', href: '/tenant/trips/tp_2' });
    expect(items.every((item) => 'minToDepart' in item && 'formedParticipants' in item)).toBe(true);

    // #43 類別 3／4 是獨立匯出（見 lib/service/route 的說明）：既有的統一收件匣清單
    // `getGuideActionInbox()` 不受影響，繼續只回舊的三種 kind，不會偷偷多出新卡片，
    // 因為它的回傳型別被 dashboard 頁面（不在 FILE_OWNERSHIP 內）直接消費。
    const baseItems = await getGuideActionInbox();
    expect(baseItems.every((item) =>
      item.kind === 'BOOKING_REQUEST' || item.kind === 'BOOKING_PAYMENT' || item.kind === 'DEPARTURE')).toBe(true);
  });

  it('reads only tenant-scoped pending and unpaid confirmed bookings plus the tenant timezone', () => {
    expect(apiSource).toContain(".from('bookings_view')");
    expect(apiSource).toContain(".eq('tenant_id', t.tenantId)");
    expect(apiSource).toContain(".eq('status', 'PENDING')");
    expect(apiSource).toContain(".eq('status', 'CONFIRMED')");
    expect(apiSource).toContain(".eq('payment_status', 'UNPAID')");
    expect(apiSource).toContain(".gt('final_price', 0)");
    expect(apiSource).toContain("kind: 'BOOKING_PAYMENT'");
    expect(apiSource).toContain('final_price');
    expect(apiSource).toContain(".from('trip_departures')");
    expect(apiSource).toContain(".eq('tenant_id', t.tenantId)");
    expect(apiSource).toContain(".in('status', ['OPEN', 'CLOSED'])");
    expect(apiSource).toContain('getGuideDepartureDay');
    expect(apiSource).toContain('getGuideDepartureDueAt');
    expect(apiSource).toContain(".from('tenant_settings')");
    expect(apiSource).toContain(".select('basic')");
    expect(apiSource).toContain('normalizeGuideTimeZone');
    expect(apiSource).toContain('bookingId=${encodeURIComponent(row.id)}');
    expect(serviceSource).toContain('bookingId=${encodeURIComponent(id)}');
    expect(serviceSource).toContain("request<GuideActionInboxItem[]>('/api/guide/action-inbox')");
    expect(serviceSource).toContain("kind: 'BOOKING_PAYMENT'");
    expect(serviceSource).toContain("kind: 'DEPARTURE'");
  });

  it('derives #43 類別 3／4 only from trip_departures.formation_status, never a parallel status', () => {
    expect(formationApiSource).toContain('formation_status, formation_deadline_at, min_to_depart_snapshot, formed_participants');
    expect(formationApiSource).toContain(".in('formation_status', ['REVIEW_REQUIRED', 'AT_RISK'])");
    expect(formationApiSource).toContain(".neq('status', 'CANCELLED')");
    expect(formationApiSource).toContain(".eq('tenant_id', t.tenantId)");
    expect(formationApiSource).toContain('buildGuideActionInboxFormationItem');
    expect(formationApiSource).toContain('isGuideActionInboxFormationStatus');
    expect(formationApiSource).toContain('requireTenant');
    expect(serviceSource).toContain('buildGuideActionInboxFormationItem');
    expect(serviceSource).toContain('isGuideActionInboxFormationStatus');
    expect(serviceSource).toContain('getGuideActionInboxFormationItems');
    expect(serviceSource).toContain("request<GuideActionInboxFormationItem[]>('/api/guide/action-inbox/formation')");
    expect(serviceSource).toContain('MOCK_TRIP_DEPARTURES');

    // 類別 3／4 不進既有統一收件匣端點的回應——那支端點的型別被 dashboard 頁面
    // （不在 FILE_OWNERSHIP 內）直接消費，還不認得這兩種新 kind。
    expect(apiSource).not.toContain('formation_status');
    expect(apiSource).not.toContain('buildGuideActionInboxFormationItem');
  });

  it('shows the slice only in GUIDE mode and renders a mobile-safe action', () => {
    expect(pageSource).toContain('modePreset.showActionInbox');
    expect(pageSource).not.toContain("businessType === 'GUIDE'");
    expect(pageSource).not.toContain("if (businessType !== 'GUIDE') return;");
    expect(pageSource).toContain('setActionInbox([])');
    expect(pageSource).toContain('getGuideActionInbox');
    expect(pageSource).toContain("item.kind === 'BOOKING_REQUEST'");
    expect(pageSource).toContain("item.kind === 'BOOKING_PAYMENT'");
    expect(pageSource).toContain('paymentAmount');
    expect(pageSource).toContain('openPayment');
    expect(pageSource).toContain('departureDay');
    expect(pageSource).toContain('w-full flex-shrink-0 sm:w-auto');
    expect(bookingsPageSource).toContain("params.get('paymentStatus') === 'UNPAID'");
    expect(bookingsPageSource).toContain("params.get('bookingId')");
    expect(bookingsPageSource).toContain('requestedBookingId');
    expect(bookingsPageSource).toContain('bookingId: requestedBookingId');
    expect(bookingsPageSource).toContain('applyClientFilters(exact.content)');
    expect(bookingsPageSource).toContain('setDetailTarget(requested)');
    expect(bookingsApiSource).toContain('bookingId: z.string().uuid().optional()');
    expect(bookingsApiSource).toContain("query.eq('id', q.bookingId)");
    expect(bookingsPageSource).toContain('paymentStatusFilter');
    expect(bookingsPageSource).toContain('paymentStatus: paymentStatusFilter || undefined');
  });
});
