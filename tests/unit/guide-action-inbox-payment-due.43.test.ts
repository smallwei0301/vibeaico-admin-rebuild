import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildGuideActionInboxTourPaymentDueItem,
  getGuideActionInboxNotStartedDepartureFilter,
  guideActionInboxPaymentDueTuning,
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
    else if (m === 'or') {
      const embedded = (a[1] as { referencedTable?: string } | undefined)?.referencedTable;
      const get = (r: FakeRow, k: string) => (embedded ? field(r, `${embedded}.${k}`) : r[k]);
      const evalOr = (expr: string): ((r: FakeRow) => boolean) => {
        // 尚未出發：departs_on.gt.D,and(departs_on.eq.D,start_time.gt.T),and(departs_on.eq.D,start_time.is.null)
        const ns = expr.match(/^departs_on\.gt\.([^,]+),and\(departs_on\.eq\.\1,start_time\.gt\.([^)]+)\),and\(departs_on\.eq\.\1,start_time\.is\.null\)$/);
        // keyset：departs_on.gt.X,and(departs_on.eq.X,id.gt.Y)
        const ks = expr.match(/^departs_on\.gt\.([^,]+),and\(departs_on\.eq\.\1,id\.gt\.(.+)\)$/);
        if (ns) {
          return (r) => {
            const d = String(get(r, 'departs_on'));
            const st = get(r, 'start_time');
            return d > ns[1] || (d === ns[1] && (st == null || String(st) > ns[2]));
          };
        }
        if (ks) {
          return (r) => String(r.departs_on) > ks[1]
            || (String(r.departs_on) === ks[1] && String(r.id) > ks[2]);
        }
        throw new Error(`unsupported or(): ${expr}`);
      };
      const expr = String(a[0]);
      // or=(and(or(X),or(Y))) → 兩個 or 都要成立
      const both = expr.match(/^and\(or\((.+)\),or\((.+)\)\)$/);
      if (both) {
        const f1 = evalOr(both[1]);
        const f2 = evalOr(both[2]);
        out = out.filter((r) => f1(r) && f2(r));
      } else {
        out = out.filter(evalOr(expr));
      }
    } else if (m === 'gt') out = out.filter((r) => String(field(r, f)) > String(a[1]));
    else if (m === 'neq') out = out.filter((r) => field(r, f) !== a[1]);
    else if (m === 'gte') out = out.filter((r) => (field(r, f) as string) >= (a[1] as string));
    else if (m === 'in') out = out.filter((r) => (a[1] as unknown[]).includes(field(r, f)));
    else if (m === 'not' && a[1] === 'is' && a[2] === null) out = out.filter((r) => field(r, f) != null);
    else if (m === 'limit') out = out.slice(0, a[0] as number);
  }
  return out;
}

const recorded: { table: string; calls: Call[] }[] = [];
/** 模擬遠端 PostgREST `max_rows`：每次查詢最多回這麼多筆（count 仍是未截斷的總數）。 */
const server = { maxRows: Infinity };

/**
 * route 現在先讀 trip_departures（依出發時刻分批）再用 `.in('departure_id', ids)` 讀訂單。
 * 這裡由訂單 fixture 內嵌的 trip_departures 推導出團次表與 departure_id，並依出發時刻排序
 * （假 client 不套用 order，所以團次表必須先排好）。
 */
function withDepartures(tables: Record<string, FakeRow[]>): Record<string, FakeRow[]> {
  if (!tables.tour_orders || tables.trip_departures) return tables;
  const deps = new Map<string, FakeRow>();
  const orders = tables.tour_orders.map((o) => {
    const emb = o.trip_departures as FakeRow | undefined;
    if (!emb) return o;
    const id = `dep:${emb.departs_on}|${emb.start_time ?? ''}|${emb.status ?? ''}`;
    if (!deps.has(id)) {
      deps.set(id, { id, tenant_id: o.tenant_id, status: (emb.status as string) ?? 'OPEN', departs_on: emb.departs_on, start_time: emb.start_time ?? null });
    }
    return { ...o, departure_id: id };
  });
  const sorted = [...deps.values()].sort((a, b) =>
    String(a.departs_on).localeCompare(String(b.departs_on)) || String(a.start_time ?? '~').localeCompare(String(b.start_time ?? '~')));
  return { ...tables, tour_orders: orders, trip_departures: sorted };
}

function fakeSupabase(rawTables: Record<string, FakeRow[]>) {
  const tables = withDepartures(rawTables);
  return {
    from(table: string) {
      const calls: Call[] = [];
      recorded.push({ table, calls });
      const b: any = {};
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not', 'gt', 'or', 'order', 'limit']) {
        b[m] = (...a: unknown[]) => { calls.push([m, a]); return b; };
      }
      b.maybeSingle = async () => (table === 'tenant_settings'
        ? { data: { basic: { timezone: 'Asia/Taipei' } }, error: null }
        : { data: null, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const wantsCount = calls.some(([m, a]) => m === 'select' && (a[1] as { count?: string } | undefined)?.count === 'exact');
        const data = tables[table] ? apply(tables[table], calls) : [];
        const total = tables[table] ? apply(tables[table], calls.filter(([m]) => m !== 'limit')).length : 0;
        return Promise.resolve({
          data: data.slice(0, server.maxRows), error: null, count: wantsCount ? total : null,
        }).then(res, rej);
      };
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
      kind: 'TOUR_PAYMENT_DUE', stage: 'INITIAL', dueKind: 'HOLD', dueAt: '2026-09-22T10:00:00.000Z',
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
      stage: 'BALANCE', dueKind: 'DEPARTURE', balanceAmount: 13000, depositAmount: null, dueHasTime: true,
      dueAt: getGuideDepartureDueAt('2026-09-30', '09:00', TZ),
    });
    expect(item?.dueAt).toBe('2026-09-30T01:00:00.000Z');
  });

  it('excludes PENDING, CANCELLED, COMPLETED, PAID, REFUND_PENDING and unreserved/hold-less UNPAID', () => {
    expect(build({ status: 'PENDING', paymentStatus: 'PARTIAL', paidAmount: 5000 })).toBeNull();
    expect(build({ status: 'PENDING', salesMode: 'REQUEST' })).toBeNull(); // 未接受的 REQUEST
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

  it('PENDING + UNPAID + seats reserved + hold: FULL card (full payment only, no deposit shown)', () => {
    const item = build({ status: 'PENDING', seatsReserved: null, salesMode: 'FIXED_DEPARTURE' });
    expect(item).toMatchObject({ dueKind: 'HOLD', kind: 'TOUR_PAYMENT_DUE', stage: 'FULL', depositAmount: null, balanceAmount: null, totalAmount: 18000 });
  });

  it('PENDING + UNPAID without hold (what every create path writes today): FULL card with the departure deadline', () => {
    const item = build({ status: 'PENDING', holdExpiresAt: null, seatsReserved: null, salesMode: 'INSTANT' });
    expect(item).toMatchObject({
      stage: 'FULL', dueKind: 'DEPARTURE', dueHasTime: true, dueLocalDate: '2026-09-30', dueLocalTime: '09:00',
      dueAt: '2026-09-30T01:00:00.000Z', priority: 'UPCOMING',
    });
    // 缺 start_time：只顯示日期、不假造午夜；缺出發日 → 不顯示
    expect(build({ status: 'PENDING', holdExpiresAt: null, departureStartTime: null })).toMatchObject({ dueHasTime: false, dueLocalTime: null });
    expect(build({ status: 'PENDING', holdExpiresAt: null, departureDate: null })).toBeNull();
  });

  it('page labels the deadline from dueKind (HOLD → 付款期限, DEPARTURE → 出發日), not from stage', async () => {
    const page = readFileSync('src/app/tenant/dashboard/page.tsx', 'utf8');
    expect(page).toContain("item.dueKind === 'DEPARTURE'");
    expect(dashboardPage.actionInbox.tourPaymentDueDepartureDeadline).toBe('出發日');
    expect(dashboardPage.actionInbox.tourPaymentDueHoldDeadline).toBe('付款期限');
  });

  it('INITIAL/FULL exclude departures that already started today (exact start_time, tenant tz); missing start_time kept through the day', () => {
    // NOW = 2026-09-20 12:00 台北
    expect(build({ departureDate: '2026-09-20', departureStartTime: '09:00' })).toBeNull();
    expect(build({ status: 'PENDING', departureDate: '2026-09-20', departureStartTime: '12:00' })).toBeNull();
    expect(build({ departureDate: '2026-09-20', departureStartTime: '12:01' })).not.toBeNull();
    expect(build({ departureDate: '2026-09-20', departureStartTime: null })).not.toBeNull();
    expect(build({ departureDate: '2026-09-19', departureStartTime: null })).toBeNull();
  });

  it('INITIAL hold exactly at tenant midnight renders as next local day 00:00', () => {
    const item = build({ holdExpiresAt: '2026-09-20T16:00:00.000Z' });
    expect(item).toMatchObject({ dueLocalDate: '2026-09-21', dueLocalTime: '00:00' });
  });

  it('dedupe helper keeps one card per order id', () => {
    const kept = dropGuideActionInboxOrderCardsAlreadyCovered(
      [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'x' }],
    );
    expect(kept).toEqual([{ id: 'b' }]);
  });
});

describe('not-started departure filter string (#43 類別 2)', () => {
  it('is tenant-local: date after today, or today with later start_time, or today without start_time', () => {
    expect(getGuideActionInboxNotStartedDepartureFilter(NOW, TZ)).toBe(
      'departs_on.gt.2026-09-20,and(departs_on.eq.2026-09-20,start_time.gt.12:00:00),and(departs_on.eq.2026-09-20,start_time.is.null)',
    );
    // UTC 還是前一天、台北已是隔天 00:30
    expect(getGuideActionInboxNotStartedDepartureFilter(new Date('2026-09-19T16:30:05.000Z'), TZ)).toContain(
      'departs_on.gt.2026-09-20,and(departs_on.eq.2026-09-20,start_time.gt.00:30:05)',
    );
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
    // 一般固定團／即時預約：PENDING + UNPAID + 已鎖位 + hold → FULL 卡
    row({ id: 'pending-hold', status: 'PENDING', payment_status: 'UNPAID', hold_expires_at: future(3_600_000),
      seats_reserved: null, trip_plans: { sales_mode: 'FIXED_DEPARTURE', name: '標準團' } }),
    // 現行建單路徑不寫 hold、也不一定有 seats_reserved：仍要出現（期限＝出發時刻）
    row({ id: 'pending-nohold', status: 'PENDING', payment_status: 'UNPAID', hold_expires_at: null,
      seats_reserved: null, trip_plans: { sales_mode: 'INSTANT', name: '即時' } }),
    row({ id: 'unpaid-started-today', status: 'CONFIRMED', payment_status: 'UNPAID', hold_expires_at: future(3_600_000),
      trip_departures: { departs_on: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()), start_time: '00:00:00' } }),
    row({ id: 'partial-ok', status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 5000 }),
    row({ id: 'partial-past', status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 5000,
      trip_departures: { departs_on: day(-3), start_time: '09:00:00' } }),
    row({ id: 'partial-other-tenant', tenant_id: 'tenant-b', status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 5000 }),
    row({ id: 'partial-completed', status: 'COMPLETED', payment_status: 'PARTIAL', paid_amount: 5000 }),
    row({ id: 'paid', status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 18000 }),
    // TOUR_REQUEST 來源（PENDING + REQUEST）與 REFUND_PENDING 來源：不得同時冒出付款卡
    row({ id: 'request', status: 'PENDING', payment_status: 'UNPAID', hold_expires_at: future(3_600_000), seats_reserved: false,
      trip_plans: { sales_mode: 'REQUEST', name: '包船專案' } }),
    row({ id: 'refund', status: 'CANCELLED', payment_status: 'REFUND_PENDING', paid_amount: 5000, refunded_amount: 0,
      updated_at: '2026-09-11T00:00:00.000Z' }),
  ];

  beforeEach(() => {
    recorded.length = 0;
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
    expect(due.map((i) => i.id).sort()).toEqual(['partial-ok', 'pending-hold', 'pending-nohold', 'unpaid-ok']);
    expect(due.find((i) => i.id === 'pending-nohold')).toMatchObject({ stage: 'FULL', dueHasTime: true, dueLocalTime: '09:00' });
    expect(due.find((i) => i.id === 'pending-hold')).toMatchObject({ stage: 'FULL', depositAmount: null });
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

describe('route.ts: payment-due source filters, window and display fields (#43 類別 2)', () => {
  const T = 'tenant-a';
  const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const mk = (over: FakeRow): FakeRow => ({
    tenant_id: T, order_no: 'T', total_amount: 18000, deposit_amount: 5000, paid_amount: 5000,
    contact: { name: '旅客' }, hold_expires_at: null, seats_reserved: true, status: 'CONFIRMED',
    payment_status: 'PARTIAL', trip_plans: { name: 'p' }, trips: { title: 't' },
    trip_departures: { departs_on: dayStr(10), start_time: '09:00:00' },
    created_at: '2026-09-10T00:00:00.000Z', ...over,
  });
  const run = async (rows: FakeRow[]) => {
    recorded.length = 0;
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: fakeSupabase({ tour_orders: rows }), tenantId: T, user: { id: 'u' }, role: 'OWNER',
    });
    const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
    return ((await res.json()).data as any[]).filter((i) => i.kind === 'TOUR_PAYMENT_DUE');
  };

  it('both payment-due queries filter trip_departures.departs_on >= tenant today at the source', async () => {
    await run([mk({ id: 'seed' })]); // 有團次才會發出訂單查詢
    const queries = recorded.filter((r) => r.table === 'tour_orders'
      && r.calls.some(([m, a]) => m === 'eq' && a[0] === 'payment_status' && (a[1] === 'UNPAID' || a[1] === 'PARTIAL')));
    expect(queries).toHaveLength(3);
    const todayTaipei = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    for (const q of queries) {
      const gte = q.calls.find(([m, a]) => m === 'gte' && a[0] === 'trip_departures.departs_on');
      expect(gte?.[1][1]).toBe(todayTaipei);
      expect(q.calls.some(([m, a]) => m === 'eq' && a[0] === 'tenant_id' && a[1] === T)).toBe(true);
    }
  });

  it('Production safety: only the CONFIRMED+UNPAID query touches seats_reserved (0111); PENDING and PARTIAL queries never do', async () => {
    await run([mk({ id: 'seed' })]); // 有團次才會發出訂單查詢
    const sel = (q: { calls: Call[] }) => String(q.calls.find(([m]) => m === 'select')?.[1][0]);
    const byStatus = (status: string, pay: string) => recorded.find((r) => r.table === 'tour_orders'
      && r.calls.some(([m, a]) => m === 'eq' && a[0] === 'status' && a[1] === status)
      && r.calls.some(([m, a]) => m === 'eq' && a[0] === 'payment_status' && a[1] === pay))!;
    const pending = byStatus('PENDING', 'UNPAID');
    const partial = byStatus('CONFIRMED', 'PARTIAL');
    const confirmed = byStatus('CONFIRMED', 'UNPAID');
    expect(sel(confirmed)).toContain('seats_reserved');
    for (const q of [pending, partial]) {
      expect(sel(q)).not.toContain('seats_reserved');
      expect(q.calls.some(([, a]) => a[0] === 'seats_reserved')).toBe(false);
    }
    expect(pending.calls.some(([m, a]) => m === 'neq' && a[0] === 'trip_plans.sales_mode' && a[1] === 'REQUEST')).toBe(true);
    expect(sel(pending)).toContain('trip_plans!inner(name, sales_mode)');
  });

  it('drops UNPAID orders whose departure already passed (stale holds cannot crowd out new ones)', async () => {
    const hold = new Date(Date.now() + 3_600_000).toISOString();
    const due = await run([
      mk({ id: 'stale', payment_status: 'UNPAID', hold_expires_at: hold, trip_departures: { departs_on: dayStr(-5), start_time: '09:00:00' } }),
      mk({ id: 'live', payment_status: 'UNPAID', hold_expires_at: hold }),
    ]);
    expect(due.map((i) => i.id)).toEqual(['live']);
  });

  it('overdue UNPAID hold with a future departure still shows as an IMMEDIATE card', async () => {
    const due = await run([
      mk({ id: 'overdue', payment_status: 'UNPAID', hold_expires_at: new Date(Date.now() - 3_600_000).toISOString() }),
    ]);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ id: 'overdue', stage: 'INITIAL', priority: 'IMMEDIATE' });
  });

  const depWindowQueries = () => recorded.filter((r) => r.table === 'trip_departures'
    && r.calls.some(([m, a]) => m === 'select' && a[0] === 'id, departs_on, start_time'));
  const paymentOrderQueries = () => recorded.filter((r) => r.table === 'tour_orders'
    && r.calls.some(([m, a]) => m === 'eq' && a[0] === 'payment_status' && (a[1] === 'PARTIAL'
      || (a[1] === 'UNPAID' && r.calls.some(([m2, a2]) => m2 === 'eq' && a2[0] === 'status' && a2[1] === 'PENDING')))));

  it('small tenant (few orders, many departures): fast path only — no departure scan, 1 query per category', async () => {
    const rows = [mk({ id: 'only-partial' }), mk({ id: 'only-pending', status: 'PENDING', payment_status: 'UNPAID',
      trip_plans: { sales_mode: 'FIXED_DEPARTURE', name: 'p' } })];
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: `d${i}`, tenant_id: T, status: 'OPEN', departs_on: dayStr(1 + (i % 300)), start_time: '09:00:00',
    }));
    recorded.length = 0;
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: fakeSupabase({ tour_orders: rows, trip_departures: many }), tenantId: T, user: { id: 'u' }, role: 'OWNER',
    });
    const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
    const due: any[] = ((await res.json()).data as any[]).filter((i) => i.kind === 'TOUR_PAYMENT_DUE');
    expect(due.map((i) => i.id).sort()).toEqual(['only-partial', 'only-pending']);
    expect(depWindowQueries()).toHaveLength(0);
    expect(paymentOrderQueries()).toHaveLength(2); // ≤ 3
  });

  it('slow path orders departures by departs_on asc then id asc (keyset), tenant/non-cancelled/today-bounded', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => mk({
      id: `q${i}`, trip_departures: { departs_on: dayStr(300 - i), start_time: '09:00:00' },
    }));
    await run(rows);
    const dq = depWindowQueries();
    expect(dq.length).toBeGreaterThan(0);
    for (const q of dq) {
      const orders = q.calls.filter(([m]) => m === 'order').map(([, a]) => [a[0], (a[1] as any).ascending]);
      expect(orders).toEqual([['departs_on', true], ['id', true]]); // departs_on desc 會讓這裡失敗
      expect(q.calls.some(([m, a]) => m === 'eq' && a[0] === 'tenant_id' && a[1] === T)).toBe(true);
      expect(q.calls.some(([m, a]) => m === 'neq' && a[0] === 'status' && a[1] === 'CANCELLED')).toBe(true);
      expect(q.calls.some(([m, a]) => m === 'gte' && a[0] === 'departs_on')).toBe(true);
    }
    // 之後的批次帶 keyset 游標
    if (dq.length > 1) expect(dq[1].calls.some(([m]) => m === 'or')).toBe(true);
  });

  it('selects the window by departure time, not created_at: >200 PARTIAL orders, the newest-created one departs soonest → kept', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => mk({
      id: `q${i}`,
      // i 越大越晚建立，但出發越近：最晚建立的 q249 最近出發
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      trip_departures: { departs_on: dayStr(300 - i), start_time: '09:00:00' },
    }));
    const due = (await run(rows)).filter((i) => i.stage === 'BALANCE');
    expect(due).toHaveLength(20);
    expect(due.map((i) => i.id)).toEqual(Array.from({ length: 20 }, (_, k) => `q${249 - k}`));
    const ids = due.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // 無重複卡片
  });

  it('slow path keeps reading keyset batches until cards are found (near order sits on the 150th-soonest departure)', async () => {
    const fillers = Array.from({ length: 200 }, (_, i) => mk({
      id: `f${i}`, trip_departures: { departs_on: dayStr(300 + i), start_time: '09:00:00' },
    }));
    const near = mk({ id: 'near', trip_departures: { departs_on: dayStr(150), start_time: '09:00:00' } });
    const empties: FakeRow[] = Array.from({ length: 149 }, (_, i) => ({
      id: `empty-${String(i).padStart(3, '0')}`, tenant_id: T, status: 'OPEN', departs_on: dayStr(1 + i), start_time: '09:00:00',
    }));
    const derived = withDepartures({ tour_orders: [...fillers, near] });
    const allDeps = [...empties, ...(derived.trip_departures as FakeRow[])]
      .sort((a, b) => String(a.departs_on).localeCompare(String(b.departs_on)) || String(a.id).localeCompare(String(b.id)));
    recorded.length = 0;
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: fakeSupabase({ tour_orders: derived.tour_orders, trip_departures: allDeps }),
      tenantId: T, user: { id: 'u' }, role: 'OWNER',
    });
    const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
    const due: any[] = ((await res.json()).data as any[]).filter((i) => i.kind === 'TOUR_PAYMENT_DUE');
    expect(due[0].id).toBe('near');
    expect(due.filter((i) => i.stage === 'BALANCE')).toHaveLength(20);
    expect(depWindowQueries().length).toBeGreaterThanOrEqual(2);
  });

  it('both fast and slow paths exclude CANCELLED departures (trip_departures.status)', async () => {
    const cancelled = { departs_on: dayStr(2), start_time: '09:00:00', status: 'CANCELLED' };
    // 快路徑：少量訂單
    const fast = await run([mk({ id: 'live' }), mk({ id: 'cancelled', trip_departures: cancelled })]);
    expect(fast.map((i) => i.id)).toEqual(['live']);
    const fastQ = paymentOrderQueries();
    for (const q of fastQ) {
      expect(q.calls.some(([m, a]) => m === 'neq' && a[0] === 'trip_departures.status' && a[1] === 'CANCELLED')).toBe(true);
    }
    // 慢路徑：>200 筆強迫走團次掃描；已取消團次上的近期訂單仍不得出現
    const rows = [
      ...Array.from({ length: 250 }, (_, i) => mk({ id: `q${i}`, trip_departures: { departs_on: dayStr(300 - i), start_time: '09:00:00' } })),
      mk({ id: 'cancelled-near', trip_departures: { ...cancelled, departs_on: dayStr(1) } }),
    ];
    const slow = (await run(rows)).filter((i) => i.stage === 'BALANCE');
    expect(slow.map((i) => i.id)).not.toContain('cancelled-near');
    expect(slow).toHaveLength(20);
  });

  it('slow path does not stop at ≥20 cards when the batch boundary cuts inside a day: a same-day earlier-start order in the next batch is included', async () => {
    const day5 = dayStr(5);
    // 第一批最後一個團次 dep-a（day5 10:00）上有 20 筆訂單 → 第 20 張卡的出發日 == 本批最後出發日
    const aOrders = Array.from({ length: 20 }, (_, i) => mk({
      id: `a${i}`, departure_id: 'dep-a', trip_departures: { departs_on: day5, start_time: '10:00:00' },
    }));
    // 下一批的 dep-b（同一天、id 排在後、較早 08:00）上的訂單必須被納入
    const early = mk({ id: 'early', departure_id: 'dep-b', trip_departures: { departs_on: day5, start_time: '08:00:00' } });
    const fillers = Array.from({ length: 200 }, (_, i) => mk({
      id: `f${i}`, departure_id: `f${String(i).padStart(3, '0')}`,
      trip_departures: { departs_on: dayStr(300 + i), start_time: '09:00:00' },
    }));
    const empties: FakeRow[] = Array.from({ length: 99 }, (_, i) => ({
      id: `e${String(i).padStart(3, '0')}`, tenant_id: T, status: 'OPEN', departs_on: dayStr(1 + (i % 4)), start_time: '09:00:00',
    }));
    const deps: FakeRow[] = [
      ...empties,
      { id: 'dep-a', tenant_id: T, status: 'OPEN', departs_on: day5, start_time: '10:00:00' },
      { id: 'dep-b', tenant_id: T, status: 'OPEN', departs_on: day5, start_time: '08:00:00' },
      ...fillers.map((f) => ({ id: f.departure_id as string, tenant_id: T, status: 'OPEN',
        departs_on: (f.trip_departures as FakeRow).departs_on, start_time: '09:00:00' })),
    ].sort((a, b) => String(a.departs_on).localeCompare(String(b.departs_on)) || String(a.id).localeCompare(String(b.id)));
    recorded.length = 0;
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      // 填充訂單放最前面：快路徑 limit(200) 只會拿到它們 → 被塞滿 → 走慢路徑
      supabase: fakeSupabase({ tour_orders: [...fillers, ...aOrders, early], trip_departures: deps }),
      tenantId: T, user: { id: 'u' }, role: 'OWNER',
    });
    const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
    const due: any[] = ((await res.json()).data as any[]).filter((i) => i.kind === 'TOUR_PAYMENT_DUE' && i.stage === 'BALANCE');
    expect(due.map((i) => i.id)).toContain('early');
    expect(due[0].id).toBe('early'); // 08:00 早於 10:00
    expect(depWindowQueries().length).toBeGreaterThanOrEqual(2); // 沒在第一批就停
  });

  it('INITIAL (CONFIRMED+UNPAID) on a cancelled departure → no card; select carries departure status and the neq filter', async () => {
    const hold = new Date(Date.now() + 3_600_000).toISOString();
    const cancelled = { departs_on: dayStr(5), start_time: '09:00:00', status: 'CANCELLED' };
    const due = await run([
      mk({ id: 'init-live', payment_status: 'UNPAID', hold_expires_at: hold }),
      mk({ id: 'init-cancelled', payment_status: 'UNPAID', hold_expires_at: hold, trip_departures: cancelled }),
    ]);
    expect(due.map((i) => i.id)).toEqual(['init-live']);
    const q = recorded.find((r) => r.table === 'tour_orders'
      && r.calls.some(([m, a]) => m === 'eq' && a[0] === 'seats_reserved'))!;
    expect(String(q.calls.find(([m]) => m === 'select')?.[1][0])).toContain('trip_departures!inner(departs_on, start_time, status)');
    expect(q.calls.some(([m, a]) => m === 'neq' && a[0] === 'trip_departures.status' && a[1] === 'CANCELLED')).toBe(true);
  });

  it('builder defensively returns null for CANCELLED departures in all three stages', () => {
    expect(build({ departureStatus: 'CANCELLED' })).toBeNull(); // INITIAL
    expect(build({ status: 'PENDING', departureStatus: 'CANCELLED' })).toBeNull(); // FULL
    expect(build({ paymentStatus: 'PARTIAL', paidAmount: 5000, holdExpiresAt: null, departureStatus: 'CANCELLED' })).toBeNull(); // BALANCE
    expect(build({ departureStatus: 'OPEN' })).not.toBeNull();
  });

  /** 快路徑被 201 筆遠期訂單塞滿（count 201 > 上限 200，無法證明完整）；其前面有 emptyCount 個沒有訂單的近期團次。 */
  async function runFarOrders(emptyCount: number) {
    const fillers = Array.from({ length: 201 }, (_, i) => mk({
      id: `f${i}`, departure_id: `f${String(i).padStart(3, '0')}`,
      trip_departures: { departs_on: dayStr(400 + i), start_time: '09:00:00' },
    }));
    const empties: FakeRow[] = Array.from({ length: emptyCount }, (_, i) => ({
      id: `e${String(i).padStart(5, '0')}`, tenant_id: T, status: 'OPEN', departs_on: dayStr(1 + Math.floor(i / 50)), start_time: '09:00:00',
    }));
    const deps: FakeRow[] = [...empties, ...fillers.map((f) => ({
      id: f.departure_id as string, tenant_id: T, status: 'OPEN',
      departs_on: (f.trip_departures as FakeRow).departs_on, start_time: '09:00:00' }))]
      .sort((a, b) => String(a.departs_on).localeCompare(String(b.departs_on)) || String(a.id).localeCompare(String(b.id)));
    recorded.length = 0;
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: fakeSupabase({ tour_orders: fillers, trip_departures: deps }), tenantId: T, user: { id: 'u' }, role: 'OWNER',
    });
    const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
    return ((await res.json()).data as any[]).filter((i) => i.kind === 'TOUR_PAYMENT_DUE');
  }

  it('fast path full but all orders lie beyond the first 1000 future departures → cards still returned (continued scanning)', async () => {
    const due = await runFarOrders(1100);
    expect(due).toHaveLength(20);
    expect(due[0].id).toBe('f0');
    expect(depWindowQueries().length).toBeGreaterThan(10); // 超過舊的 10 批上限仍持續掃描
  });

  it('batch-cap hit: returns the seeded best-known set (non-empty) and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const due = await runFarOrders(10_050); // 超過 100 批 × 100 團次
    expect(due).toHaveLength(20);
    expect(due.every((i) => i.id.startsWith('f'))).toBe(true);
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('payment-due:partial') && m.includes('stopped early'))).toBe(true);
    warn.mockRestore();
  });

  it('time budget triggers before the batch cap: non-empty seeded result + warn with batches scanned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let tick = 0;
    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow + (tick += 600)); // 每次讀時鐘 +600ms
    try {
      const due = await runFarOrders(3000); // 遠不到 100 批上限（約 30 批）
      expect(due).toHaveLength(20);
      expect(due.every((i) => i.id.startsWith('f'))).toBe(true);
      const msgs = warn.mock.calls.map((c) => String(c[0]));
      const m = msgs.find((x) => x.includes('payment-due:partial') && x.includes('stopped early'));
      expect(m).toBeTruthy();
      const scanned = Number(String(m).match(/batches scanned: (\d+)/)?.[1]);
      expect(scanned).toBeGreaterThanOrEqual(1);
      expect(scanned).toBeLessThan(10); // 時間預算先於 100 批上限
    } finally {
      clock.mockRestore();
      warn.mockRestore();
    }
  });


  /*
   * N2：終止條件不得依賴伺服器 max_rows。模擬遠端每次最多只回 server.maxRows 筆（小於我方要求的頁大小），
   * count 仍是真實總數。
   */
  describe('max_rows 小於要求頁大小時不誤判讀到底', () => {
    const withServerCap = async (cap: number, fn: () => Promise<void>) => {
      server.maxRows = cap;
      try { await fn(); } finally { server.maxRows = Infinity; }
    };

    it('快路徑：250 筆符合、伺服器上限 150（< 要求的 200）→ 不誤判完整，慢路徑讀到全部，最近出發的卡片正確', async () => {
      const rows = Array.from({ length: 250 }, (_, i) => mk({
        id: `q${i}`, trip_departures: { departs_on: dayStr(300 - i), start_time: '09:00:00' },
      }));
      await withServerCap(150, async () => {
        const due = (await run(rows)).filter((i) => i.stage === 'BALANCE');
        expect(due).toHaveLength(20);
        expect(due.map((i) => i.id)).toEqual(Array.from({ length: 20 }, (_, k) => `q${249 - k}`));
        expect(depWindowQueries().length).toBeGreaterThan(0); // 走了慢路徑
      });
    });

    it('快路徑：只有 150 筆（< 要求的 200）但伺服器只回 100 → count 150 > 100，不可宣稱完整，改走慢路徑', async () => {
      const rows = Array.from({ length: 150 }, (_, i) => mk({
        id: `q${i}`, trip_departures: { departs_on: dayStr(300 - i), start_time: '09:00:00' },
      }));
      await withServerCap(100, async () => {
        const due = (await run(rows)).filter((i) => i.stage === 'BALANCE');
        expect(due).toHaveLength(20);
        expect(depWindowQueries().length).toBeGreaterThan(0);
        expect(due.map((i) => i.id)).toEqual(Array.from({ length: 20 }, (_, k) => `q${149 - k}`));
      });
    });

    it('慢路徑：團次批次與訂單分頁都被伺服器截斷（上限 7 < 要求的 100／10）仍讀到後面的團次與訂單', async () => {
      guideActionInboxPaymentDueTuning.orderPage = 10;
      const fillers = Array.from({ length: 201 }, (_, i) => mk({
        id: `f${String(i).padStart(4, '0')}`, departure_id: `fd${String(i).padStart(4, '0')}`,
        trip_departures: { departs_on: dayStr(400 + i), start_time: '09:00:00' },
      }));
      const near = mk({ id: 'zz-near', departure_id: 'dep-near', trip_departures: { departs_on: dayStr(60), start_time: '09:00:00' } });
      const empties: FakeRow[] = Array.from({ length: 40 }, (_, i) => ({
        id: `e${String(i).padStart(3, '0')}`, tenant_id: T, status: 'OPEN', departs_on: dayStr(1 + i), start_time: '09:00:00',
      }));
      const deps: FakeRow[] = [...empties,
        { id: 'dep-near', tenant_id: T, status: 'OPEN', departs_on: dayStr(60), start_time: '09:00:00' },
        ...fillers.map((f) => ({ id: f.departure_id as string, tenant_id: T, status: 'OPEN',
          departs_on: (f.trip_departures as FakeRow).departs_on, start_time: '09:00:00' }))]
        .sort((a, b) => String(a.departs_on).localeCompare(String(b.departs_on)) || String(a.id).localeCompare(String(b.id)));
      const orders = [...fillers, near].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      try {
        await withServerCap(7, async () => {
          recorded.length = 0;
          requireTenantMock.mockReset();
          requireTenantMock.mockResolvedValue({
            supabase: fakeSupabase({ tour_orders: orders, trip_departures: deps }), tenantId: T, user: { id: 'u' }, role: 'OWNER',
          });
          const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
          const due: any[] = ((await res.json()).data as any[]).filter((i) => i.kind === 'TOUR_PAYMENT_DUE' && i.stage === 'BALANCE');
          expect(due).toHaveLength(20);
          expect(due[0].id).toBe('zz-near'); // 位於被截斷批次之後的近期團次
          expect(depWindowQueries().length).toBeGreaterThan(5); // 每批只回 7 個團次 → 持續分批
        });
      } finally {
        guideActionInboxPaymentDueTuning.orderPage = 500;
      }
    });

    it('一般小店家（無截斷）：每類別訂單查詢 1 次、不讀團次；總 tour_orders 查詢數有上限', async () => {
      const rows = [mk({ id: 'p1' }), mk({ id: 'p2', trip_departures: { departs_on: dayStr(9), start_time: '09:00:00' } }),
        mk({ id: 'n1', status: 'PENDING', payment_status: 'UNPAID', trip_plans: { sales_mode: 'FIXED_DEPARTURE', name: 'p' } })];
      const due = await run(rows);
      expect(due.length).toBeGreaterThan(0);
      expect(depWindowQueries()).toHaveLength(0);
      expect(paymentOrderQueries()).toHaveLength(2); // PARTIAL 1 + PENDING 1
    });
  });

  const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  const orQueries = () => recorded.filter((r) => r.calls.some(([m]) => m === 'or'));
  const embeddedNotStarted = (q: { calls: Call[] }) => q.calls.find(([m, a]) => m === 'or'
    && (a[1] as any)?.referencedTable === 'trip_departures');

  it('≥200 INITIAL orders on departures that already started today do not crowd out a valid future order (query-level or-filter)', async () => {
    const hold = new Date(Date.now() + 3_600_000).toISOString();
    const departed = Array.from({ length: 200 }, (_, i) => mk({
      id: `gone${i}`, payment_status: 'UNPAID', hold_expires_at: hold,
      trip_departures: { departs_on: taipeiToday(), start_time: '00:00:00' },
    }));
    const future = mk({ id: 'future-init', payment_status: 'UNPAID', hold_expires_at: hold });
    const due = await run([...departed, future]);
    expect(due.map((i) => i.id)).toEqual(['future-init']);
    const q = recorded.find((r) => r.table === 'tour_orders'
      && r.calls.some(([m, a]) => m === 'eq' && a[0] === 'seats_reserved'))!;
    const orCall = embeddedNotStarted(q)!;
    expect(String(orCall[1][0])).toContain(`departs_on.gt.${taipeiToday()}`);
    expect(String(orCall[1][0])).toContain('start_time.gt.');
    expect(String(orCall[1][0])).toContain('start_time.is.null');
  });

  it('PARTIAL and PENDING fast paths: ≥200 departed-today orders do not make the window "complete" without the future one', async () => {
    const gone = { departs_on: taipeiToday(), start_time: '00:00:00' };
    const plan = { sales_mode: 'FIXED_DEPARTURE', name: 'p' };
    const rows = [
      ...Array.from({ length: 200 }, (_, i) => mk({ id: `pg${i}`, trip_departures: gone })),
      mk({ id: 'partial-future' }),
      ...Array.from({ length: 200 }, (_, i) => mk({ id: `ng${i}`, status: 'PENDING', payment_status: 'UNPAID', trip_plans: plan, trip_departures: gone })),
      mk({ id: 'pending-future', status: 'PENDING', payment_status: 'UNPAID', trip_plans: plan }),
    ];
    const due = await run(rows);
    expect(due.map((i) => i.id).sort()).toEqual(['partial-future', 'pending-future']);
    for (const q of paymentOrderQueries()) expect(embeddedNotStarted(q)).toBeTruthy();
  });

  it('slow-path departure scan also carries the not-started or-filter (top-level, next to the keyset or)', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => mk({ id: `q${i}`, trip_departures: { departs_on: dayStr(300 - i), start_time: '09:00:00' } }));
    await run(rows);
    const dq = depWindowQueries();
    expect(dq.length).toBeGreaterThan(0);
    for (const q of dq) {
      const filters = q.calls.filter(([m]) => m === 'or').map(([, a]) => String(a[0]));
      expect(filters.some((x) => x.includes(`start_time.gt.`) && x.includes('start_time.is.null'))).toBe(true);
      // 每個團次視窗查詢只有「一個」or 參數；有游標的批次是 and(or(notStarted),or(keyset)) 單一邏輯樹
      expect(filters).toHaveLength(1);
      if (filters[0].startsWith('and(')) expect(filters[0]).toMatch(/^and\(or\(.+\),or\(departs_on\.gt\..+\)\)$/);
    }
    // 之後的批次一定帶游標 → 走合併形式
    if (dq.length > 1) {
      expect(String(dq[1].calls.find(([m]) => m === 'or')?.[1][0])).toMatch(/^and\(or\(/);
    }
    expect(orQueries().length).toBeGreaterThan(0);
  });

  /** 頁大小調為 10：241 筆 PARTIAL 落在同一批 100 個團次內（快路徑 200 被塞滿）；最近出發的那筆 id 排在最後（超過第一頁）。 */
  async function runBigBatch() {
    guideActionInboxPaymentDueTuning.orderPage = 10;
    const others = Array.from({ length: 240 }, (_, i) => mk({
      id: `o${String(i).padStart(5, '0')}`, departure_id: `d${String(1 + (i % 99)).padStart(3, '0')}`,
      trip_departures: { departs_on: dayStr(2 + (i % 99)), start_time: '09:00:00' },
    }));
    const soonest = mk({ id: 'zz-soonest', departure_id: 'd000', trip_departures: { departs_on: dayStr(1), start_time: '09:00:00' } });
    const orders = [...others, soonest].sort((x, y) => String(x.id).localeCompare(String(y.id)));
    const deps: FakeRow[] = Array.from({ length: 100 }, (_, i) => ({
      id: `d${String(i).padStart(3, '0')}`, tenant_id: T, status: 'OPEN', departs_on: dayStr(1 + i), start_time: '09:00:00',
    }));
    recorded.length = 0;
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: fakeSupabase({ tour_orders: orders, trip_departures: deps }), tenantId: T, user: { id: 'u' }, role: 'OWNER',
    });
    try {
      const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
      return ((await res.json()).data as any[]).filter((i) => i.kind === 'TOUR_PAYMENT_DUE' && i.stage === 'BALANCE');
    } finally {
      guideActionInboxPaymentDueTuning.orderPage = 500; // 還原預設
    }
  }

  it('a batch with >1000 qualifying orders is read page by page (keyset by id): the soonest order beyond the first 1000 is included', async () => {
    // 凍結時鐘：假 client 處理上千筆較慢，不能讓真實時間觸發掃描預算而影響這個測試
    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow);
    let due: any[];
    try { due = await runBigBatch(); } finally { clock.mockRestore(); }
    expect(due).toHaveLength(20);
    expect(due[0].id).toBe('zz-soonest');
    const pageQueries = recorded.filter((r) => r.table === 'tour_orders'
      && r.calls.some(([m, a]) => m === 'in' && a[0] === 'departure_id'));
    expect(pageQueries.length).toBeGreaterThanOrEqual(2);
    for (const q of pageQueries) {
      expect(q.calls.filter(([m]) => m === 'order').map(([, a]) => [a[0], (a[1] as any).ascending])).toEqual([['id', true]]);
    }
    expect(pageQueries.some((q) => q.calls.some(([m, a]) => m === 'gt' && a[0] === 'id'))).toBe(true);
  });

  it('budget hit mid-batch: warns, returns a non-empty best-known set, never claims the batch complete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let tick = 0;
    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow + (tick += 2000));
    try {
      const due = await runBigBatch();
      expect(due.length).toBeGreaterThan(0);
      expect(due.map((i) => i.id)).not.toContain('zz-soonest'); // 第二頁沒讀到，不假裝完整
      expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('payment-due:partial') && m.includes('stopped early'))).toBe(true);
    } finally {
      clock.mockRestore();
      warn.mockRestore();
    }
  });

  it('with more than 20 PARTIAL rows keeps the soonest departures, not the oldest-created', async () => {
    // created_at 越早的出發越晚：若只照 created_at 取前 20，最近出發的 5 筆會被截掉。
    const rows = Array.from({ length: 25 }, (_, i) => mk({
      id: `p${i}`,
      created_at: `2026-09-${String(1 + (i % 9)).padStart(2, '0')}T00:00:${String(i).padStart(2, '0')}.000Z`,
      trip_departures: { departs_on: dayStr(60 - i), start_time: '09:00:00' }, // i 越大越近
    }));
    const due = await run(rows);
    const partial = due.filter((i) => i.stage === 'BALANCE');
    expect(partial).toHaveLength(20);
    const ids = partial.map((i) => i.id);
    for (let i = 24; i >= 5; i -= 1) expect(ids).toContain(`p${i}`);
    expect(ids).not.toContain('p0');
    expect(ids[0]).toBe('p24'); // 依期限由近到遠
  });

  it('carries tenant-local display fields (no browser-timezone conversion)', async () => {
    const dep = dayStr(10);
    const due = await run([
      mk({ id: 'bal-time' }),
      mk({ id: 'bal-date', trip_departures: { departs_on: dep, start_time: null } }),
      // 2026 年 12 月 31 日 17:30Z = 台北 2027/01/01 01:30，跨日也要用租戶時區
      mk({ id: 'hold', payment_status: 'UNPAID', hold_expires_at: '2099-12-31T17:30:00.000Z' }),
    ]);
    expect(due.find((i) => i.id === 'bal-time')).toMatchObject({ dueLocalDate: dep, dueLocalTime: '09:00' });
    expect(due.find((i) => i.id === 'bal-date')).toMatchObject({ dueLocalDate: dep, dueLocalTime: null, dueHasTime: false });
    expect(due.find((i) => i.id === 'hold')).toMatchObject({ dueLocalDate: '2100-01-01', dueLocalTime: '01:30' });
  });
});

describe('route.ts: payment-due schema tolerance (#43 類別 2, Production lacks 0111)', () => {
  const T = 'tenant-a';
  const dep = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

  /** payment 查詢（帶 seats_reserved 或 payment_status=PARTIAL 的 tour_orders）回指定錯誤；其餘照常。 */
  function setup(error: { code?: string; message: string } | null) {
    const other = fakeSupabase({ tour_orders: [{
      id: 'req', tenant_id: T, order_no: 'T', party_size: 2, total_amount: 100, contact: { name: 'x' },
      hold_expires_at: null, status: 'PENDING', seats_reserved: false, payment_status: 'UNPAID',
      trip_plans: { sales_mode: 'REQUEST', name: 'p' }, trips: { title: 't' },
      trip_departures: { departs_on: dep, start_time: '09:00:00' }, created_at: '2026-09-10T00:00:00.000Z',
    }] });
    const supabase = {
      from(table: string) {
        const b: any = other.from(table);
        if (table !== 'tour_orders' || !error) return b;
        let paymentQuery = false;
        let confirmed = false;
        let payStatus = '';
        const origEq = b.eq;
        b.eq = (...a: unknown[]) => {
          if (a[0] === 'status' && a[1] === 'CONFIRMED') confirmed = true;
          if (a[0] === 'payment_status') payStatus = String(a[1]);
          paymentQuery = confirmed && payStatus === 'UNPAID';
          return origEq(...a);
        };
        const origThen = b.then;
        b.then = (res: any, rej: any) => paymentQuery
          ? Promise.resolve({ data: null, error }).then(res, rej)
          : origThen(res, rej);
        return b;
      },
    };
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({ supabase, tenantId: T, user: { id: 'u' }, role: 'OWNER' });
  }

  it('undefined-column error on payment queries → other cards still returned, zero payment cards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const code of ['42703', '42P01', 'PGRST204']) {
      warn.mockClear();
      setup({ code, message: 'column tour_orders.seats_reserved does not exist' });
      const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
      expect(res.status).toBe(200);
      const items: any[] = (await res.json()).data;
      expect(items.filter((i) => i.kind === 'TOUR_PAYMENT_DUE')).toHaveLength(0);
      expect(items.filter((i) => i.kind === 'TOUR_REQUEST').map((i) => i.id)).toEqual(['req']);
      // 只有 CONFIRMED+UNPAID（需 0111 的 seats_reserved）來源降級並 warn 一次，只含來源名稱與錯誤碼
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(code);
      expect(messages[0]).toContain('payment-due:confirmed-unpaid');
    }
    warn.mockRestore();
  });

  it('any other error keeps the existing behaviour (request fails, like the other sources)', async () => {
    setup({ code: '57014', message: 'canceling statement due to statement timeout' });
    const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe('mock mode + copy (#43 類別 2)', () => {
  it('mock GUIDE inbox shows both payment-due cards with honest, relative deadlines and no overlap with TOUR_REQUEST', async () => {
    const items = await getGuideActionInbox();
    const due = items.filter((i) => i.kind === 'TOUR_PAYMENT_DUE');
    expect(due.map((i) => i.id).sort()).toEqual(['to_1', 'to_14', 'to_15']);
    expect(due.find((i) => i.id === 'to_1')).toMatchObject({ stage: 'FULL' });
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
