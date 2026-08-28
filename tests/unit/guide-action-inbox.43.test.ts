import { describe, expect, it } from 'vitest';
import {
  buildGuideActionInbox, sourcesFromRows, type GuideActionSource,
  guideInboxWindow,
} from '@/server/guide-action-inbox';

const now = new Date('2026-08-28T02:00:00.000Z'); // 台北 10:00
const todayEndsAt = new Date('2026-08-28T15:59:59.999Z');
const upcomingEndsAt = new Date('2026-09-04T15:59:59.999Z');

const source = (overrides: Partial<GuideActionSource>): GuideActionSource => ({
  id: 'order-1',
  reason: 'PAYMENT_DUE',
  subject: '阿里山日出團',
  detail: '王小明・訂單 T-001',
  dueAt: '2026-08-28T07:00:00.000Z',
  href: '/tenant/tour-orders?keyword=T-001',
  ...overrides,
});

describe('GUIDE 行動收件匣', () => {
  it('依真實狀態分成立即、今天與接下來，並把逾期項目排最前面', () => {
    const inbox = buildGuideActionInbox([
      source({ id: 'today', dueAt: '2026-08-28T07:00:00.000Z' }),
      source({ id: 'future', reason: 'DEPARTURE_UPCOMING', dueAt: '2026-08-30T01:00:00.000Z' }),
      source({ id: 'overdue', dueAt: '2026-08-27T07:00:00.000Z' }),
      source({ id: 'risk', reason: 'AT_RISK', dueAt: null }),
    ], { now, todayEndsAt, upcomingEndsAt });

    expect(inbox.immediate.map((item) => item.id)).toEqual(['overdue', 'risk']);
    expect(inbox.today.map((item) => item.id)).toEqual(['today']);
    expect(inbox.upcoming.map((item) => item.id)).toEqual(['future']);
    expect(inbox.immediate[0]).toMatchObject({ overdue: true, urgency: 'IMMEDIATE' });
  });

  it('高風險狀態沒有期限時仍需立即處理', () => {
    const inbox = buildGuideActionInbox([
      source({ id: 'review', reason: 'REVIEW_REQUIRED', dueAt: null }),
      source({ id: 'refund', reason: 'REFUND_PENDING', dueAt: null }),
      source({ id: 'delivery', reason: 'DELIVERY_DEAD', dueAt: null }),
      source({ id: 'request', reason: 'REQUEST_PENDING', dueAt: null }),
    ], { now, todayEndsAt, upcomingEndsAt });

    expect(inbox.immediate.map((item) => item.id)).toEqual([
      'review', 'refund', 'delivery', 'request',
    ]);
  });

  it('不放示範資料，沒有來源就回傳誠實空收件匣', () => {
    expect(buildGuideActionInbox([], { now, todayEndsAt, upcomingEndsAt })).toEqual({
      immediate: [], today: [], upcoming: [],
    });
  });

  it('忽略超出接下來七天範圍的團次，避免首頁變成完整行事曆', () => {
    const inbox = buildGuideActionInbox([
      source({ id: 'later', reason: 'DEPARTURE_UPCOMING', dueAt: '2026-09-10T01:00:00.000Z' }),
    ], { now, todayEndsAt, upcomingEndsAt });

    expect(inbox).toEqual({ immediate: [], today: [], upcoming: [] });
  });

  it('直接從 #37/#40/#41 的事實推導卡片，不建立另一套待辦狀態', () => {
    const sources = sourcesFromRows({
      orders: [{
        id: 'o1', order_no: 'T-001', customer_name: '王小明', status: 'CANCELLED',
        payment_status: 'REFUND_PENDING', departure_id: 'd1', hold_expires_at: null,
      }],
      departures: [{
        id: 'd1', trip_id: 't1', departs_on: '2026-08-29', start_time: '08:00:00',
        status: 'OPEN', formation_status: 'AT_RISK', formation_deadline_at: null,
        trips: { title: '阿里山日出團' }, trip_plans: { name: '小團', booking_type: 'SCHEDULED' },
      }],
      assignments: [],
      deadDeliveries: [{
        id: 'n1', last_error_code: 'TELEGRAM_BLOCKED',
        notification_outbox: { aggregate_type: 'TOUR_ORDER', aggregate_id: 'o1', event_name: 'TOUR_REFUND_PENDING' },
      }],
    });

    expect(sources.map((item) => item.reason)).toEqual([
      'REFUND_PENDING', 'AT_RISK', 'GUIDE_UNASSIGNED', 'DEPARTURE_UPCOMING', 'DELIVERY_DEAD',
    ]);
    expect(sources[0].href).toBe('/tenant/tour-orders?keyword=T-001');
  });

  it('尚未建立團次的 REQUEST 仍從訂單自己的方案辨識', () => {
    const sources = sourcesFromRows({
      orders: [{
        id: 'o2', order_no: 'T-002', customer_name: '林小美', status: 'PENDING',
        payment_status: 'UNPAID', departure_id: null, hold_expires_at: null,
        trip_plans: { name: '客製申請', booking_type: 'REQUEST', trips: { title: '台南散策' } },
      }],
      departures: [], assignments: [], deadDeliveries: [],
    });

    expect(sources).toEqual([expect.objectContaining({ reason: 'REQUEST_PENDING', subject: '台南散策' })]);
  });

  it('依租戶時區切今天，不把 UTC 換日當成店家的今天', () => {
    const window = guideInboxWindow(new Date('2026-08-28T06:00:00.000Z'), 'America/Los_Angeles');
    expect(window.todayEndsAt.toISOString()).toBe('2026-08-28T06:59:59.999Z');
    expect(window.upcomingEndsAt.toISOString()).toBe('2026-09-04T06:59:59.999Z');
    expect(window.fromDate).toBe('2026-08-27');
    expect(window.toDate).toBe('2026-09-03');
  });

  it('訂金已付但尚未成團時顯示成團進度，不誤寫成尚未付款', () => {
    const sources = sourcesFromRows({
      orders: [{
        id: 'o3', order_no: 'T-003', customer_name: '陳小華', status: 'CONFIRMED',
        payment_status: 'PARTIAL', departure_id: 'd3', hold_expires_at: null,
      }],
      departures: [{
        id: 'd3', trip_id: 't3', departs_on: '2026-08-30', start_time: '08:00:00', status: 'OPEN',
        formation_status: 'COLLECTING', formation_deadline_at: '2026-08-29T08:00:00.000Z',
        trips: { title: '花蓮小團' }, trip_plans: { name: '散客團', booking_type: 'SCHEDULED' },
      }],
      assignments: [{ departure_id: 'd3' }], deadDeliveries: [],
    });

    expect(sources.filter((item) => item.id.includes('o3'))).toEqual([
      expect.objectContaining({ reason: 'FORMATION_COLLECTING' }),
    ]);
  });
});
