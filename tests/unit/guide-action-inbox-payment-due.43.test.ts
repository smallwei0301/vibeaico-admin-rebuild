import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGuideActionInboxTourPaymentDueItem,
  dropGuideActionInboxOrderCardsAlreadyCovered,
  getGuideDepartureDueAt,
  type GuideActionInboxTourPaymentDueInput,
} from '@/lib/guide-action-inbox';
import { getGuideActionInbox } from '@/services/guide-action-inbox';
import { dashboardPage } from '@/i18n/zh-TW/pages/dashboard';
import { GET as guideActionInboxGET } from '@/app/api/guide/action-inbox/route';

/*
 * #43 類別 2：等待訂金、尾款或付款即將到期（TOUR_PAYMENT_DUE）。
 * 純函式測 builder 規則；route 層用最小假 supabase（會真的套用 eq/gte/in/not/limit 與
 * `關聯.欄位` 路徑過濾；order/select 只記錄不套用，邊界同 guide-action-inbox.43.test.ts）。
 */
type FakeRow = Record<string, unknown>;
type Call = [string, unknown[]];

function field(row: FakeRow, path: string): unknown {
  if (!path.includes('.')) return row[path];
  const [rel, key] = path.split('.');
  const v = row[rel];
  const r = Array.isArray(v) ? v[0] : v;
  return r && typeof r === 'object' ? (r as FakeRow)[key] : undefined;
}

function apply(rows: FakeRow[], calls: Call[]): FakeRow[] {
  let out = rows;
  for (const [m, a] of calls) {
    const f = a[0] as string;
    if (m === 'eq') out = out.filter((r) => field(r, f) === a[1]);
    else if (m === 'gte') out = out.filter((r) => (field(r, f) as string) >= (a[1] as string));
    else if (m === 'in') out = out.filter((r) => (a[1] as unknown[]).includes(field(r, f)));
    else if (m === 'not' && a[1] === 'is' && a[2] === null) out = out.filter((r) => field(r, f) != null);
    else if (m === 'limit') out = out.slice(0, a[0] as number);
  }
  return out;
}

function fakeSupabase(tables: Record<string, FakeRow[]>) {
  return {
    from(table: string) {
      const calls: Call[] = [];
      const b: any = {};
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not', 'order', 'limit']) {
        b[m] = (...a: unknown[]) => { calls.push([m, a]); return b; };
      }
      b.maybeSingle = async () => (table === 'tenant_settings'
        ? { data: { basic: { timezone: 'Asia/Taipei' } }, error: null }
        : { data: null, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ? apply(tables[table], calls) : [], error: null }).then(res, rej);
      return b;
    },
  };
}

const requireTenantMock = vi.fn();
vi.mock('@/server/tenant', () => ({ requireTenant: (...a: unknown[]) => requireTenantMock(...a) }));

const NOW = new Date('2026-09-20T04:00:00.000Z'); // 12:00 Asia/Taipei
const TZ = 'Asia/Taipei';

const base: GuideActionInboxTourPaymentDueInput = {
  id: 'o1', orderNo: 'T1', customerName: '旅客', tripName: '行程', planName: '方案',
  status: 'CONFIRMED', paymentStatus: 'UNPAID', seatsReserved: true,
  holdExpiresAt: '2026-09-22T10:00:00.000Z', depositAmount: 5000, totalAmount: 18000, paidAmount: 0,
  departureDate: '2026-09-30', departureStartTime: '09:00',
  createdAt: '2026-09-15T00:00:00.000Z', href: '/tenant/tour-orders?orderId=o1',
};
const build = (over: Partial<GuideActionInboxTourPaymentDueInput> = {}, now = NOW) =>
  buildGuideActionInboxTourPaymentDueItem({ ...base, ...over }, now, TZ);

describe('buildGuideActionInboxTourPaymentDueItem (#43 類別 2)', () => {
  it('UNPAID accepted order: INITIAL card, deadline = hold_expires_at, deposit exposed', () => {
    const item = build();
    expect(item).toMatchObject({
      kind: 'TOUR_PAYMENT_DUE', stage: 'INITIAL', dueAt: '2026-09-22T10:00:00.000Z',
      depositAmount: 5000, balanceAmount: null, totalAmount: 18000, dueHasTime: true,
      priority: 'UPCOMING', href: '/tenant/tour-orders?orderId=o1',
    });
  });

  it('full-pay-only order (no partial deposit) exposes depositAmount null', () => {
    expect(build({ depositAmount: 0 })?.depositAmount).toBeNull();
    expect(build({ depositAmount: 18000 })?.depositAmount).toBeNull();
  });

  it('PARTIAL: BALANCE card, deadline = departure start in tenant timezone, balance = total - paid', () => {
    const item = build({ paymentStatus: 'PARTIAL', paidAmount: 5000, holdExpiresAt: null });
    expect(item).toMatchObject({
      stage: 'BALANCE', balanceAmount: 13000, depositAmount: null, dueHasTime: true,
      dueAt: getGuideDepartureDueAt('2026-09-30', '09:00', TZ),
    });
    expect(item?.dueAt).toBe('2026-09-30T01:00:00.000Z');
  });

  it('excludes PENDING, CANCELLED, COMPLETED, PAID, REFUND_PENDING and unreserved/hold-less UNPAID', () => {
    expect(build({ status: 'PENDING' })).toBeNull();
    expect(build({ status: 'CANCELLED' })).toBeNull();
    expect(build({ status: 'COMPLETED', paymentStatus: 'PARTIAL', paidAmount: 5000 })).toBeNull();
    expect(build({ paymentStatus: 'PAID' })).toBeNull();
    expect(build({ paymentStatus: 'REFUND_PENDING' })).toBeNull();
    expect(build({ seatsReserved: false })).toBeNull();
    expect(build({ seatsReserved: null })).toBeNull();
    expect(build({ holdExpiresAt: null })).toBeNull();
    expect(build({ holdExpiresAt: 'not-a-date' })).toBeNull();
  });

  it('excludes PARTIAL whose departure already started or whose balance is zero', () => {
    const partial = { paymentStatus: 'PARTIAL', paidAmount: 5000, holdExpiresAt: null };
    expect(build({ ...partial, departureDate: '2026-09-20', departureStartTime: '12:00' })).toBeNull(); // 剛好出發
    expect(build({ ...partial, departureDate: '2026-09-19', departureStartTime: '09:00' })).toBeNull();
    expect(build({ ...partial, departureDate: null })).toBeNull();
    expect(build({ ...partial, paidAmount: 18000 })).toBeNull();
    expect(build({ ...partial, departureDate: '2026-09-20', departureStartTime: '12:01' })).not.toBeNull();
  });

  it('buckets by tenant-local boundaries: overdue hold → IMMEDIATE, same tenant day → TODAY, next day → UPCOMING', () => {
    expect(build({ holdExpiresAt: '2026-09-20T03:59:59.000Z' })?.priority).toBe('IMMEDIATE');
    expect(build({ holdExpiresAt: '2026-09-20T15:59:59.000Z' })?.priority).toBe('TODAY'); // 23:59:59 台北
    expect(build({ holdExpiresAt: '2026-09-20T16:00:00.000Z' })?.priority).toBe('UPCOMING'); // 隔日 00:00 台北
    const partial = { paymentStatus: 'PARTIAL', paidAmount: 5000, holdExpiresAt: null };
    expect(build({ ...partial, departureDate: '2026-09-20', departureStartTime: '18:00' })?.priority).toBe('TODAY');
    expect(build({ ...partial, departureDate: '2026-09-21', departureStartTime: '00:00' })?.priority).toBe('UPCOMING');
    // 跨日：UTC 還是前一天，租戶（台北）已是新的一天
    const lateNow = new Date('2026-09-19T23:30:00.000Z');
    expect(build({ holdExpiresAt: '2026-09-20T08:00:00.000Z' }, lateNow)?.priority).toBe('TODAY');
  });

  it('PARTIAL with missing start_time never fakes midnight: date-only, today is TODAY (not IMMEDIATE), past date excluded', () => {
    const partial = { paymentStatus: 'PARTIAL', paidAmount: 5000, holdExpiresAt: null, departureStartTime: null };
    const today = build({ ...partial, departureDate: '2026-09-20' });
    expect(today).toMatchObject({ dueHasTime: false, priority: 'TODAY' });
    expect(build({ ...partial, departureDate: '2026-09-25' })).toMatchObject({ dueHasTime: false, priority: 'UPCOMING' });
    expect(build({ ...partial, departureDate: '2026-09-19' })).toBeNull();
  });

  it('dedupe helper keeps one card per order id', () => {
    const kept = dropGuideActionInboxOrderCardsAlreadyCovered(
      [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'x' }],
    );
    expect(kept).toEqual([{ id: 'b' }]);
  });
});

describe('route.ts behaviour: #43 類別 2 TOUR_PAYMENT_DUE', () => {
  const T = 'tenant-a';
  const future = (ms: number) => new Date(Date.now() + ms).toISOString();
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const row = (over: FakeRow): FakeRow => ({
    tenant_id: T, order_no: 'T', party_size: 2, total_amount: 18000, deposit_amount: 5000, paid_amount: 0,
    contact: { name: '旅客' }, hold_expires_at: null, seats_reserved: true,
    trip_plans: { name: '包船專案' }, trips: { title: '龜山島' },
    trip_departures: { departs_on: day(10), start_time: '09:00:00' },
    created_at: '2026-09-10T00:00:00.000Z', ...over,
  });

  const ROWS: FakeRow[] = [
    row({ id: 'unpaid-ok', status: 'CONFIRMED', payment_status: 'UNPAID', hold_expires_at: future(3 * 3_600_000) }),
    row({ id: 'unpaid-no-hold', status: 'CONFIRMED', payment_status: 'UNPAID', hold_expires_at: null }),
    row({ id: 'unpaid-unreserved', status: 'CONFIRMED', payment_status: 'UNPAID', hold_expires_at: future(3_600_000), seats_reserved: false }),
    row({ id: 'unpaid-other-tenant', tenant_id: 'tenant-b', status: 'CONFIRMED', payment_status: 'UNPAID', hold_expires_at: future(3_600_000) }),
    row({ id: 'unpaid-cancelled', status: 'CANCELLED', payment_status: 'UNPAID', hold_expires_at: future(3_600_000) }),
    row({ id: 'pending-hold', status: 'PENDING', payment_status: 'UNPAID', hold_expires_at: future(3_600_000) }),
    row({ id: 'partial-ok', status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 5000 }),
    row({ id: 'partial-past', status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 5000,
      trip_departures: { departs_on: day(-3), start_time: '09:00:00' } }),
    row({ id: 'partial-other-tenant', tenant_id: 'tenant-b', status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 5000 }),
    row({ id: 'partial-completed', status: 'COMPLETED', payment_status: 'PARTIAL', paid_amount: 5000 }),
    row({ id: 'paid', status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 18000 }),
    // TOUR_REQUEST 來源（PENDING + REQUEST）與 REFUND_PENDING 來源：不得同時冒出付款卡
    row({ id: 'request', status: 'PENDING', payment_status: 'UNPAID', hold_expires_at: future(3_600_000),
      trip_plans: { sales_mode: 'REQUEST', name: '包船專案' } }),
    row({ id: 'refund', status: 'CANCELLED', payment_status: 'REFUND_PENDING', paid_amount: 5000, refunded_amount: 0,
      updated_at: '2026-09-11T00:00:00.000Z' }),
  ];

  beforeEach(() => {
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: fakeSupabase({ tour_orders: ROWS }), tenantId: T, user: { id: 'u' }, role: 'OWNER',
    });
  });

  it('returns tenant-scoped INITIAL and BALANCE cards only, one card per order, excluded states absent', async () => {
    const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
    expect(res.status).toBe(200);
    const items: any[] = (await res.json()).data;
    const due = items.filter((i) => i.kind === 'TOUR_PAYMENT_DUE');
    expect(due.map((i) => i.id).sort()).toEqual(['partial-ok', 'unpaid-ok']);
    expect(due.find((i) => i.id === 'unpaid-ok')).toMatchObject({
      stage: 'INITIAL', depositAmount: 5000, totalAmount: 18000, customerName: '旅客',
      href: '/tenant/tour-orders?orderId=unpaid-ok',
    });
    expect(due.find((i) => i.id === 'partial-ok')).toMatchObject({ stage: 'BALANCE', balanceAmount: 13000, dueHasTime: true });
    // 其他來源仍各自出現，且同一 id 不會同時有兩張卡
    expect(items.filter((i) => i.id === 'request').map((i) => i.kind)).toEqual(['TOUR_REQUEST']);
    expect(items.filter((i) => i.id === 'refund').map((i) => i.kind)).toEqual(['REFUND_PENDING']);
    const orderIds = items.filter((i) => ['TOUR_REQUEST', 'REFUND_PENDING', 'TOUR_PAYMENT_DUE'].includes(i.kind)).map((i) => i.id);
    expect(new Set(orderIds).size).toBe(orderIds.length);
  });
});

describe('mock mode + copy (#43 類別 2)', () => {
  it('mock GUIDE inbox shows both payment-due cards with honest, relative deadlines and no overlap with TOUR_REQUEST', async () => {
    const items = await getGuideActionInbox();
    const due = items.filter((i) => i.kind === 'TOUR_PAYMENT_DUE');
    expect(due.map((i) => i.id).sort()).toEqual(['to_14', 'to_15']);
    for (const i of due) expect(i.href).toBe(`/tenant/tour-orders?orderId=${i.id}`);
    const requestIds = new Set(items.filter((i) => i.kind === 'TOUR_REQUEST').map((i) => i.id));
    for (const i of due) expect(requestIds.has(i.id)).toBe(false);
  });

  it('i18n copy is plain-language and never claims the order is already paid', () => {
    const a = dashboardPage.actionInbox;
    expect(a.tourPaymentDueInitial).toBe('等待付款（訂金或全額）');
    expect(a.tourPaymentDueBalance).toBe('等待尾款');
    expect(a.openTourPaymentDue).toContain('收款');
  });
});
