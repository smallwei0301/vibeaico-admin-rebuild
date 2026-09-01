import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildGuideTravelers,
  filterGuideTravelers,
  loadAllGuidePages,
  summarizeGuideTravelers,
} from '@/lib/guide-travelers';
import type { Customer, TourOrder } from '@/lib/types';

const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'c-1',
  name: '林小明',
  phone: '0912-000-111',
  email: 'ming@example.com',
  gender: 'MALE',
  birthday: '',
  note: '',
  lineUserId: 'U-1',
  lineDisplayName: 'Ming',
  membershipLevelId: null,
  membershipLevelName: null,
  tags: ['海島'],
  bookingCount: 3,
  totalSpent: 12_800,
  points: 128,
  lastVisitAt: '2026-08-20T09:00:00+08:00',
  atRisk: false,
  active: true,
  createdAt: '2026-01-01T09:00:00+08:00',
  ...overrides,
});

const order = (overrides: Partial<TourOrder> = {}): TourOrder => ({
  id: 'o-1',
  orderNo: 'T-001',
  tripId: 'trip-1',
  tripTitle: '東北角海線一日遊',
  planName: '標準團',
  departsOn: '2026-09-01',
  startTime: '09:00',
  customerName: '林小明',
  customerPhone: '0912-000-111',
  partySize: 2,
  unitPrice: 2_000,
  totalAmount: 4_000,
  depositAmount: 0,
  status: 'CONFIRMED',
  paymentStatus: 'PAID',
  paymentMethodLabel: '線上付款',
  paymentRef: 'ref-1',
  source: 'MANUAL',
  holdExpiresAt: null,
  note: '',
  createdAt: '2026-08-25T09:00:00+08:00',
  ...overrides,
});

describe('GUIDE traveler selectors (#66 Phase E)', () => {
  const rows = buildGuideTravelers(
    [
      customer(),
      customer({
        id: 'c-2',
        name: '很長很長很長很長很長很長的旅客姓名',
        phone: '0922-111-222',
        lineUserId: null,
        tags: [],
        bookingCount: 1,
        atRisk: true,
      }),
    ],
    [
      order(),
      order({ id: 'o-2', orderNo: 'T-002', departsOn: '2026-09-04', customerName: '林小明', customerPhone: '0912-000-111' }),
      order({ id: 'o-3', orderNo: 'T-003', departsOn: '2026-09-01', tripTitle: '花蓮溪谷探索行程', customerName: '很長很長很長很長很長很長的旅客姓名', customerPhone: '0922-111-222', status: 'PENDING' }),
    ],
    [
      { id: 'U-1', customerId: 'c-1', customerName: '林小明', unread: 2 },
      { id: 'U-2', customerId: 'c-2', customerName: '長姓名', unread: 0 },
    ],
    '2026-09-01',
  );

  it('joins current customer, itinerary and unread facts without inventing another model', () => {
    expect(rows[0]).toMatchObject({
      todayDeparture: true,
      waitingReply: true,
      unreadCount: 2,
      returning: true,
      primaryOrder: { id: 'o-1', tripTitle: '東北角海線一日遊' },
    });
    expect(rows[1]).toMatchObject({
      todayDeparture: true,
      waitingReply: false,
      returning: false,
      primaryOrder: { id: 'o-3', status: 'PENDING' },
    });
  });

  it('loads every source page instead of treating the API page size as a result cap', async () => {
    const calls: Array<[number, number]> = [];
    const pageRows = [
      Array.from({ length: 200 }, (_, index) => index),
      Array.from({ length: 200 }, (_, index) => index + 200),
      [400],
    ];

    const result = await loadAllGuidePages(async (page, size) => {
      calls.push([page, size]);
      return {
        content: pageRows[page] ?? [],
        totalElements: 401,
        totalPages: 3,
        number: page,
        size,
      };
    });

    expect(calls).toEqual([[0, 200], [1, 200], [2, 200]]);
    expect(result).toHaveLength(401);
    expect(result.at(-1)).toBe(400);
  });

  it('only falls back to a unique name when phone identity is unavailable and unambiguous', () => {
    const duplicateWithPhone = customer({ id: 'c-duplicate-phone', name: '同名旅客', phone: '0900-000-001' });
    const duplicateWithoutPhone = customer({ id: 'c-duplicate-empty', name: '同名旅客', phone: '' });
    const knownPhone = customer({ id: 'c-known-phone', name: '電話衝突旅客', phone: '0900-000-002' });
    const legacyCustomer = customer({ id: 'c-legacy', name: '唯一舊資料旅客', phone: '' });
    const joined = buildGuideTravelers(
      [duplicateWithPhone, duplicateWithoutPhone, knownPhone, legacyCustomer],
      [
        order({ id: 'o-exact-phone', customerName: '同名旅客', customerPhone: '0900-000-001' }),
        order({ id: 'o-conflicting-phone', customerName: '電話衝突旅客', customerPhone: '0900-000-099' }),
        order({ id: 'o-unique-name', customerName: '唯一舊資料旅客', customerPhone: '0900-000-099' }),
      ],
      [],
      '2026-09-01',
    );

    expect(joined.find((row) => row.customer.id === duplicateWithPhone.id)?.orders.map((item) => item.id))
      .toEqual(['o-exact-phone']);
    expect(joined.find((row) => row.customer.id === duplicateWithoutPhone.id)?.orders).toEqual([]);
    expect(joined.find((row) => row.customer.id === knownPhone.id)?.orders).toEqual([]);
    expect(joined.find((row) => row.customer.id === legacyCustomer.id)?.orders.map((item) => item.id))
      .toEqual(['o-unique-name']);
  });

  it('computes all four quick filters and searches contact and itinerary fields', () => {
    expect(filterGuideTravelers(rows, 'ALL')).toHaveLength(2);
    expect(filterGuideTravelers(rows, 'TODAY')).toHaveLength(2);
    expect(filterGuideTravelers(rows, 'REPLY').map((row) => row.customer.id)).toEqual(['c-1']);
    expect(filterGuideTravelers(rows, 'RETURNING').map((row) => row.customer.id)).toEqual(['c-1']);
    expect(filterGuideTravelers(rows, 'ALL', '東北角')).toHaveLength(1);
    expect(filterGuideTravelers(rows, 'ALL', '0922-111-222')).toHaveLength(1);
  });

  it('summarizes only values present in the joined rows', () => {
    expect(summarizeGuideTravelers(rows)).toEqual({
      total: 2,
      todayDeparture: 2,
      waitingReply: 1,
      returning: 1,
    });
  });

  it('wires the GUIDE surface to readable mobile controls and truthful states', () => {
    const source = readFileSync('src/components/guide/GuideTravelersView.tsx', 'utf8');
    const pageSource = readFileSync('src/app/tenant/customers/page.tsx', 'utf8');
    const guidePageSource = pageSource.slice(
      pageSource.indexOf('function GuideTravelersPage()'),
      pageSource.indexOf('export default function CustomersPage'),
    );
    expect(source).toContain('navigation.travelers.search.placeholder');
    expect(source).toContain('GUIDE_UI_CLASSES.touchTarget');
    expect(source).toContain('filterGuideTravelers');
    expect(source).toContain('navigation.travelers.empty.title');
    expect(source).toContain('GUIDE_UI_CLASSES.page');
    expect(source).not.toContain('42%');
    expect(source).not.toContain('128 位旅客');
    expect(guidePageSource).toContain('loadAllGuidePages((page, size) => listCustomers({ page, size }))');
    expect(guidePageSource).toContain('loadAllGuidePages((page, size) => listTourOrders({ page, size }))');
    expect(guidePageSource).not.toMatch(/listCustomers\(\{\s*page:\s*0\s*,\s*size:\s*200\s*\}\)/);
    expect(guidePageSource).not.toMatch(/listTourOrders\(\{\s*page:\s*0\s*,\s*size:\s*200\s*\}\)/);
  });

  it('keeps traveler visual values behind shared GUIDE UI tokens', () => {
    const source = readFileSync('src/components/guide/GuideTravelersView.tsx', 'utf8');

    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(source).not.toMatch(/text-\[[0-9]+px\]/);
    expect(source).not.toMatch(/min-[hw]-\[[0-9]+px\]/);
    expect(source).toMatch(/GUIDE_UI_CLASSES\.(metricCard|metricValue|primaryButton|secondaryButton|searchInput|filterButton|travelerRow)/);
  });
});
