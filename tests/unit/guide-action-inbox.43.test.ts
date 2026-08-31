import { describe, expect, it } from 'vitest';
import {
  buildGuideActionInbox,
  guideInboxWindow,
  loadGuideActionSources,
  normalizeGuideTimeZone,
  sourcesFromRows,
} from '@/server/guide-action-inbox';
import type { GuideActionSource } from '@/lib/types';
import { SHOP_A } from '../fixtures';

const now = new Date('2026-08-28T02:00:00.000Z'); // Asia/Taipei 10:00
const window = {
  now,
  todayEndsAt: new Date('2026-08-28T15:59:59.999Z'),
  upcomingEndsAt: new Date('2026-09-04T15:59:59.999Z'),
};

const action = (overrides: Partial<GuideActionSource>): GuideActionSource => ({
  id: 'order-1',
  reason: 'PAYMENT_DUE',
  primaryAction: 'REVIEW_PAYMENT',
  subject: '阿里山日出團',
  detail: '王小明・訂單 T-001',
  dueAt: '2026-08-28T07:00:00.000Z',
  actionDate: null,
  createdAt: '2026-08-27T08:00:00.000Z',
  href: '/tenant/tour-orders?keyword=T-001',
  ...overrides,
});

describe('GUIDE 行動收件匣（#43）', () => {
  it('將逾期、今日與未來行動分區；同期限時依建立時間與 id 穩定排序', () => {
    const inbox = buildGuideActionInbox([
      action({ id: 'later-created', createdAt: '2026-08-27T09:00:00.000Z' }),
      action({ id: 'overdue', dueAt: '2026-08-27T07:00:00.000Z' }),
      action({ id: 'earlier-created', createdAt: '2026-08-27T07:00:00.000Z' }),
      action({ id: 'upcoming', reason: 'DEPARTURE_UPCOMING', dueAt: '2026-08-30T01:00:00.000Z' }),
      action({ id: 'a-same', dueAt: '2026-08-30T02:00:00.000Z', createdAt: null }),
      action({ id: 'b-same', dueAt: '2026-08-30T02:00:00.000Z', createdAt: null }),
    ], window);

    expect(inbox.immediate.map((item) => item.id)).toEqual(['overdue']);
    expect(inbox.today.map((item) => item.id)).toEqual(['earlier-created', 'later-created']);
    expect(inbox.upcoming.map((item) => item.id)).toEqual(['upcoming', 'a-same', 'b-same']);
    expect(inbox.immediate[0]).toMatchObject({ overdue: true, urgency: 'IMMEDIATE' });
  });

  it('讓沒有截止日的待付款保留在接下來，且 REQUEST 即使無日期仍是立即處理', () => {
    const inbox = buildGuideActionInbox([
      action({ id: 'payment-without-deadline', dueAt: null }),
      action({ id: 'request', reason: 'REQUEST_PENDING', dueAt: null }),
    ], window);

    expect(inbox.immediate).toEqual([expect.objectContaining({ id: 'request', dueAt: null })]);
    expect(inbox.upcoming).toEqual([expect.objectContaining({ id: 'payment-without-deadline', dueAt: null })]);
  });

  it('從既有訂單、團次與指派事實推導行動和 deep link，不建立第二套狀態', () => {
    const sources = sourcesFromRows({
      orders: [
        {
          id: 'request', order_no: 'T-001', contact: { name: '陳小美' }, status: 'PENDING',
          payment_status: 'UNPAID', hold_expires_at: null, created_at: '2026-08-26T08:00:00.000Z',
          departure_id: 'request-departure',
          trip_plans: { name: '客製申請', booking_type: 'REQUEST', trips: { title: '台南散策' } },
        },
        {
          id: 'payment', order_no: 'T-002', contact: { name: '王小明' }, status: 'PENDING',
          payment_status: 'UNPAID', hold_expires_at: '2026-08-28T08:00:00.000Z',
          created_at: '2026-08-27T08:00:00.000Z', departure_id: 'payment-departure',
          trip_plans: { name: '一般團', booking_type: 'SCHEDULED', trips: { title: '阿里山日出團' } },
        },
      ],
      departures: [
        {
          id: 'review', trip_id: 'trip-review', departs_on: '2026-08-29', start_time: '10:00:00',
          status: 'OPEN', trips: { title: '太魯閣健行' }, trip_plans: { name: '健行團', booking_type: 'SCHEDULED' },
        },
      ],
      assignments: [],
    }, 'Asia/Taipei', now);

    expect(sources.map((item) => item.reason)).toEqual([
      'REQUEST_PENDING', 'PAYMENT_DUE', 'GUIDE_UNASSIGNED',
    ]);
    expect(sources.find((item) => item.id === 'request:request')?.href)
      .toBe('/tenant/tour-orders?keyword=T-001');
    expect(sources.find((item) => item.id === 'unassigned:review')?.href)
      .toBe('/tenant/trips/trip-review?tab=departures');
  });

  it('使用租戶時區劃分今天，無效時區安全回退 Asia/Taipei', () => {
    const losAngeles = guideInboxWindow(new Date('2026-08-28T06:00:00.000Z'), 'America/Los_Angeles');

    expect(losAngeles.todayEndsAt.toISOString()).toBe('2026-08-28T06:59:59.999Z');
    expect(losAngeles.fromDate).toBe('2026-08-27');
    expect(losAngeles.departureToDate).toBe('2026-09-03');
    expect(normalizeGuideTimeZone('not/a-timezone')).toBe('Asia/Taipei');
  });

  it('不把已取消或已結束的團次宣稱為未來待辦', () => {
    const sources = sourcesFromRows({
      orders: [],
      departures: [
        { id: 'cancelled', trip_id: 't', departs_on: '2026-08-29', start_time: '10:00:00', status: 'CANCELLED' },
        { id: 'past', trip_id: 't', departs_on: '2026-08-27', start_time: '09:00:00', status: 'OPEN' },
      ],
      assignments: [],
    }, 'Asia/Taipei', now);

    expect(sources).toEqual([]);
  });

  it('停售但已成團的未指派團次仍列為不可履約的立即處理事項', () => {
    const sources = sourcesFromRows({
      orders: [],
      departures: [{
        id: 'closed-unassigned', trip_id: 'trip', departs_on: '2026-08-29', start_time: '10:00:00',
        status: 'CLOSED', trips: { title: '已成團行程' },
      }],
      assignments: [],
    }, 'Asia/Taipei', now);
    const inbox = buildGuideActionInbox(sources, window);

    expect(inbox.immediate).toEqual([expect.objectContaining({
      id: 'unassigned:closed-unassigned', reason: 'GUIDE_UNASSIGNED', primaryAction: 'ASSIGN_GUIDE',
    })]);
  });

  it('把沒有開始時間、但落在租戶今天的團次放在今天，且不假造截止時間', () => {
    const sources = sourcesFromRows({
      orders: [],
      departures: [{
        id: 'all-day', trip_id: 'trip', departs_on: '2026-08-28', start_time: null,
        status: 'OPEN', trips: { title: '全天行程' },
      }],
      assignments: [{ departure_id: 'all-day' }],
    }, 'Asia/Taipei', now);
    const inbox = buildGuideActionInbox(sources, { ...window, todayDate: '2026-08-28' });

    expect(inbox.today).toEqual([expect.objectContaining({
      id: 'departure:all-day', dueAt: null, actionDate: '2026-08-28', urgency: 'TODAY',
    })]);
  });

  it('缺少尚未落地的旅遊資料表時誠實回傳空收件匣，且每個查詢都鎖 tenant_id', async () => {
    const tenantFilters: string[] = [];
    const missingTable = {
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
    };
    const builder = () => ({
      select: () => builder(),
      eq: (column: string, value: string) => {
        if (column === 'tenant_id') tenantFilters.push(value);
        return builder();
      },
      in: () => builder(),
      gte: () => builder(),
      lte: () => builder(),
      then: <T>(resolve: (value: typeof missingTable) => T) => Promise.resolve(missingTable).then(resolve),
    });
    const supabase = { from: () => builder() };

    await expect(loadGuideActionSources({
      supabase: supabase as never,
      tenantId: SHOP_A.id,
      fromDate: '2026-08-28',
      departureToDate: '2026-09-04',
    })).resolves.toEqual([]);
    expect(tenantFilters).toEqual([SHOP_A.id, SHOP_A.id, SHOP_A.id]);
  });

  it('部分旅遊來源尚未落地、其餘查詢成功時仍誠實回傳空收件匣', async () => {
    const missing = { data: null, error: { code: 'PGRST205', message: 'Could not find table' } };
    const success = { data: [], error: null };
    const results = [missing, success, success];
    let query = 0;
    const builder = (result: typeof results[number]) => ({
      select: () => builder(result), eq: () => builder(result), in: () => builder(result),
      gte: () => builder(result), lte: () => builder(result),
      then: <T>(resolve: (value: typeof result) => T) => Promise.resolve(result).then(resolve),
    });
    const supabase = { from: () => builder(results[query++]) };

    await expect(loadGuideActionSources({
      supabase: supabase as never, tenantId: SHOP_A.id,
      fromDate: '2026-08-28', departureToDate: '2026-09-04',
    })).resolves.toEqual([]);
  });

  it('部分來源缺表時仍會回報另一來源的權限錯誤', async () => {
    const missing = { data: null, error: { code: 'PGRST205', message: 'Could not find table' } };
    const denied = { data: null, error: { code: '42501', message: 'permission denied' } };
    const success = { data: [], error: null };
    const results = [missing, denied, success];
    let query = 0;
    const builder = (result: typeof results[number]) => ({
      select: () => builder(result), eq: () => builder(result), in: () => builder(result),
      gte: () => builder(result), lte: () => builder(result),
      then: <T>(resolve: (value: typeof result) => T) => Promise.resolve(result).then(resolve),
    });
    const supabase = { from: () => builder(results[query++]) };

    await expect(loadGuideActionSources({
      supabase: supabase as never, tenantId: SHOP_A.id,
      fromDate: '2026-08-28', departureToDate: '2026-09-04',
    })).rejects.toMatchObject({ code: '42501' });
  });

  it('從 tenant-scoped 查詢的正常結果聚合既有事實', async () => {
    const rows = {
      tour_orders: {
        data: [{
          id: 'request', order_no: 'T-003', contact: { name: '小美' }, status: 'PENDING',
          payment_status: 'UNPAID', trip_plans: { booking_type: 'REQUEST', trips: { title: '北投散策' } },
        }],
        error: null,
      },
      trip_departures: {
        data: [{
          id: 'departure', trip_id: 'trip', departs_on: '2026-08-29', start_time: '10:00:00',
          status: 'OPEN', trips: { title: '陽明山步道' },
        }],
        error: null,
      },
      trip_departure_staff: { data: [{ departure_id: 'departure' }], error: null },
    };
    const builder = (table: keyof typeof rows) => ({
      select: () => builder(table), eq: () => builder(table), in: () => builder(table),
      gte: () => builder(table), lte: () => builder(table),
      then: <T>(resolve: (value: typeof rows[typeof table]) => T) => Promise.resolve(rows[table]).then(resolve),
    });
    const supabase = { from: (table: keyof typeof rows) => builder(table) };

    await expect(loadGuideActionSources({
      supabase: supabase as never,
      tenantId: SHOP_A.id,
      fromDate: '2026-08-28',
      departureToDate: '2026-09-04',
      timeZone: 'Asia/Taipei',
      now,
    })).resolves.toMatchObject([
      { id: 'request:request', reason: 'REQUEST_PENDING', href: '/tenant/tour-orders?keyword=T-003' },
      { id: 'departure:departure', reason: 'DEPARTURE_UPCOMING', href: '/tenant/trips/trip?tab=departures' },
    ]);
  });

  it('不會把權限或查詢錯誤假裝成空收件匣', async () => {
    const denied = { data: null, error: { code: '42501', message: 'permission denied' } };
    const builder = () => ({
      select: () => builder(), eq: () => builder(), in: () => builder(),
      gte: () => builder(), lte: () => builder(),
      then: <T>(resolve: (value: typeof denied) => T) => Promise.resolve(denied).then(resolve),
    });
    const supabase = { from: () => builder() };

    await expect(loadGuideActionSources({
      supabase: supabase as never,
      tenantId: SHOP_A.id,
      fromDate: '2026-08-28',
      departureToDate: '2026-09-04',
    })).rejects.toMatchObject({ code: '42501' });
  });
});
