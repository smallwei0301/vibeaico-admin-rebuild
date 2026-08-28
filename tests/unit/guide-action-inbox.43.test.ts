import { describe, expect, it } from 'vitest';
import {
  buildGuideActionInbox,
  guideInboxWindow,
  sourcesFromRows,
} from '@/server/guide-action-inbox';
import type { GuideActionSource } from '@/lib/types';

const now = new Date('2026-08-28T02:00:00.000Z'); // Asia/Taipei 10:00
const window = {
  now,
  todayEndsAt: new Date('2026-08-28T15:59:59.999Z'),
  upcomingEndsAt: new Date('2026-09-04T15:59:59.999Z'),
};

const action = (overrides: Partial<GuideActionSource>): GuideActionSource => ({
  id: 'order-1',
  reason: 'PAYMENT_DUE',
  subject: '阿里山日出團',
  detail: '王小明・訂單 T-001',
  dueAt: '2026-08-28T07:00:00.000Z',
  createdAt: '2026-08-27T08:00:00.000Z',
  href: '/tenant/tour-orders?keyword=T-001',
  ...overrides,
});

describe('GUIDE 行動收件匣（#43）', () => {
  it('將逾期、今日與未來行動分區；同期限時依建立時間穩定排序', () => {
    const inbox = buildGuideActionInbox([
      action({ id: 'later-created', createdAt: '2026-08-27T09:00:00.000Z' }),
      action({ id: 'overdue', dueAt: '2026-08-27T07:00:00.000Z' }),
      action({ id: 'earlier-created', createdAt: '2026-08-27T07:00:00.000Z' }),
      action({ id: 'upcoming', reason: 'DEPARTURE_UPCOMING', dueAt: '2026-08-30T01:00:00.000Z' }),
    ], window);

    expect(inbox.immediate.map((item) => item.id)).toEqual(['overdue']);
    expect(inbox.today.map((item) => item.id)).toEqual(['earlier-created', 'later-created']);
    expect(inbox.upcoming.map((item) => item.id)).toEqual(['upcoming']);
    expect(inbox.immediate[0]).toMatchObject({ overdue: true, urgency: 'IMMEDIATE' });
  });

  it('保留無到期日的待付款項目，但不偽造期限', () => {
    const inbox = buildGuideActionInbox([action({ dueAt: null })], window);

    expect(inbox.upcoming).toEqual([expect.objectContaining({ dueAt: null, urgency: 'UPCOMING' })]);
  });

  it('從 PR49 已有的訂單、團次與指派事實推導行動與直接處理網址', () => {
    const sources = sourcesFromRows({
      orders: [
        {
          id: 'request', order_no: 'T-001', customer_name: '陳小美', status: 'PENDING',
          payment_status: 'UNPAID', hold_expires_at: null, created_at: '2026-08-26T08:00:00.000Z',
          departure_id: 'request-departure',
          trip_plans: { name: '客製申請', booking_type: 'REQUEST', trips: { title: '台南散策' } },
        },
        {
          id: 'payment', order_no: 'T-002', customer_name: '王小明', status: 'PENDING',
          payment_status: 'UNPAID', hold_expires_at: '2026-08-28T08:00:00.000Z',
          created_at: '2026-08-27T08:00:00.000Z', departure_id: 'payment-departure',
          trip_plans: { name: '一般團', booking_type: 'SCHEDULED', trips: { title: '阿里山日出團' } },
        },
      ],
      departures: [
        {
          id: 'review', trip_id: 'trip-review', departs_on: '2026-08-29', start_time: '10:00:00',
          trips: { title: '太魯閣健行' }, trip_plans: { name: '健行團', booking_type: 'SCHEDULED' },
        },
      ],
      assignments: [],
    });

    expect(sources.map((item) => item.reason)).toEqual([
      'REQUEST_PENDING', 'PAYMENT_DUE', 'GUIDE_UNASSIGNED', 'DEPARTURE_UPCOMING',
    ]);
    expect(sources.find((item) => item.id === 'request:request')?.href)
      .toBe('/tenant/tour-orders?keyword=T-001');
    expect(sources.find((item) => item.id === 'departure:review')?.href)
      .toBe('/tenant/trips/trip-review?tab=departures');
  });

  it('以租戶時區劃分今天，避免 UTC 換日把行動放錯區段', () => {
    const losAngeles = guideInboxWindow(new Date('2026-08-28T06:00:00.000Z'), 'America/Los_Angeles');

    expect(losAngeles.todayEndsAt.toISOString()).toBe('2026-08-28T06:59:59.999Z');
    expect(losAngeles.fromDate).toBe('2026-08-27');
    expect(losAngeles.departureToDate).toBe('2026-09-03');
  });
});
