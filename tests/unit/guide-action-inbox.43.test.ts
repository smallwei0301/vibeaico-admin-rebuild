import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_TENANT_TIME_ZONE,
  basicSettingsSchema,
} from '@/config/tenant-settings';
import {
  buildGuideActionInboxFormationItem,
  buildGuideActionInboxTourRequestItem,
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  isGuideActionInboxFormationStatus,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';
import { getGuideActionInbox } from '@/services/guide-action-inbox';
import { dashboardPage } from '@/i18n/zh-TW/pages/dashboard';

/*
 * ---------------------------------------------------------------------------
 * Behavioural harness for the DEPARTURE / formation query exclusivity + bound
 * (replaces the three source-grep tests that used to sit here — see PB-027 /
 * PB-039 discussion above the two tests that use this harness for why).
 *
 * This is a minimal generic PostgREST-query-builder fake: it records the
 * chained filter calls (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`/`not`/`limit`)
 * for each `.from('trip_departures')` invocation and *actually applies them*
 * to an in-memory row set when the chain is awaited. Because the real
 * `route.ts` is imported and exercised unmodified, a rewrite that keeps the
 * same behaviour still passes, and a rewrite that drops or misapplies a
 * filter changes which rows come back — not just which substrings appear in
 * the file.
 *
 * Coverage boundary (PR #442 Final Risk F2, recorded honestly, not fixed here):
 * `.select()` and `.order()` are recorded into `calls` but never applied by
 * `applyFilterOps()` — only `eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`/`not`/`limit`
 * actually filter the in-memory rows. `.or()` isn't implemented at all in this
 * harness (only `tests/unit/tour-orders-deep-link.43.test.ts` has an `.or()`
 * call, and that harness doesn't apply it either — see that file's own header).
 * Consequence: a mutation that removes the route's server-side `.order(...)`
 * before `.limit(...)` is undetectable here — `limit()` truncates whatever
 * order the fixture array is already in, not what the DB would return, so
 * dropping the real `.order()` doesn't change which rows this harness keeps.
 * That class of mutation needs an integration test against real TEST Supabase;
 * it is out of scope for this PR, and the harness is deliberately left as-is
 * rather than extended to cover it (that would be a different PR's scope).
 *
 * Coverage boundary (#43 類別 7 STAFF_CONFLICT, recorded honestly, not fixed
 * here): `src/server/staff-availability.ts`'s `loadStaffLoad()` reads "other
 * departures a staff member is occupied by" via
 * `.from('trip_departure_staff').select(...).neq('trip_departures.status', …)
 * .gte('trip_departures.departs_on', …).lte('trip_departures.departs_on', …)`
 * — PostgREST's dot-path syntax for filtering on a joined table.
 *
 * As of #43 類別 1 this harness's `applyFilterOps()` is join-aware: the
 * `getFieldValue()` helper above resolves a `關聯.欄位` path by reading the
 * named relation off the row (unwrapping the first element if it's an array,
 * matching how PostgREST embeds work) before comparing — every filter branch
 * (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`) goes through it. A dot-path filter
 * on a *genuinely nested* fixture value is evaluated for real here, it is not
 * a no-op.
 *
 * `loadStaffLoad()`'s `departures` array is nonetheless still always `[]`
 * under the STAFF_CONFLICT describe block below — but the reason is one layer
 * earlier than any dot-path question: that block's `makeFakeSupabase(...)`
 * only registers `trip_departures` / `shifts` / `bookings` / `block_times` as
 * top-level tables. It never registers a top-level `trip_departure_staff`
 * table. `then()` (above) returns `[]` whenever `tables[table]` is
 * `undefined` — for an unregistered table, `applyFilterOps()` is never even
 * called, so `loadStaffLoad()`'s filter chain (dot-path or not) is never
 * evaluated at all. This has nothing to do with whether `getFieldValue()` can
 * resolve dot-paths — it never gets the chance to try.
 *
 * A likely misread here (this file has already made it once): fixture rows in
 * `TRIP_DEPARTURE_ROWS` below do carry a `trip_departure_staff: [...]` key,
 * and it's tempting to treat that as "the `trip_departure_staff` table, just
 * with the wrong shape." It isn't. That key is an *embed nested inside a
 * `trip_departures` row* — it's what feeds `route.ts`'s own
 * `.from('trip_departures').select('..., trip_departure_staff(...)')` query
 * for departure staff assignments. It is unrelated to, and can't stand in
 * for, `loadStaffLoad()`'s separate `.from('trip_departure_staff')` query,
 * which this harness never sees hit any registered table.
 * Two consequences, both real and both untested here:
 *   1. The `'DEPARTURE'` conflict reason (staff double-booked across two
 *      departures) can never actually fire through this route-level harness.
 *      It is not uncovered in the codebase, though — the pure function itself
 *      (`findStaffConflicts`) already has direct behavioural coverage of the
 *      `DEPARTURE` branch in `tests/unit/departure-guide-assignment.37.test.ts`
 *      ("其他團次重疊 → DEPARTURE，且指得出是哪一團"); what's untested is only
 *      the route's glue code that feeds it real `trip_departure_staff` rows.
 *   2. `route.ts`'s per-departure self-exclusion
 *      (`load.departures.filter((d) => d.departureId !== c.row.id)`, needed so
 *      a departure's own occupied slot isn't mistaken for a conflict with
 *      itself) can't be exercised either, because `load.departures` is always
 *      empty regardless of whether that filter runs.
 * This gap is fixable, not structural, and has been verified by hand: adding
 * a top-level `trip_departure_staff` table to this describe block's
 * `makeFakeSupabase(...)` call — rows carrying `tenant_id` / `departure_id` /
 * `staff_id` plus a nested `trip_departures: { id, departs_on, start_time,
 * status, trips: { duration_hours } }` — with the same staff member also
 * assigned to a second, time-overlapping departure in the window, makes
 * `dep-clean` immediately surface as `conflicts: [{ staffId: 's-clean',
 * staffName: '阿海', reason: 'DEPARTURE' }]`. That fixture/table addition is
 * left for a future PR (#448's `DEPARTURE`-reason route-level coverage is its
 * own follow-up), not attempted here.
 * The `BOOKING`, `BLOCK` and `SHIFT` reasons don't have this problem —
 * `loadStaffLoad()`'s `bookings`/`block_times`/`shifts` queries only ever
 * filter on the queried table's own columns (`tenant_id`, `status`,
 * `start_at`/`end_at`, `recurrence`, `work_date`), never a joined table's
 * column, so this harness filters them correctly; the STAFF_CONFLICT describe
 * block below covers all three plus the tenant boundary and a genuinely
 * clean (no-conflict) control row.
 *
 * Three further `getFieldValue()` boundaries, recorded because each fails
 * *silently* (rows get filtered out, not an error) rather than throwing:
 *   1. It only `split('.')`s into two segments. A three-level path like
 *      `trip_departures.trips.duration_hours` would compare against the
 *      middle relation object itself, never the leaf value — always `false`.
 *      No query in this codebase currently does this, but one added later
 *      would silently fail under this harness.
 *   2. A to-many embed only ever reads its first element
 *      (`Array.isArray(relationValue) ? relationValue[0] : relationValue`).
 *      Real PostgREST filters inside the array; this harness can't.
 *   3. Every dot-path filter here behaves as if the join were `!inner`
 *      (a row whose relation is missing/null is dropped). That happens to
 *      match every dot-path query that exists in this file today
 *      (`loadStaffLoad()`'s `trip_departures!inner`, and the `TOUR_REQUEST`
 *      query's `trip_plans!inner`), but this harness has no way to represent
 *      a non-inner embed filter, where a row with a null relation should
 *      survive with the embed as `null` rather than being dropped.
 *
 * Related but distinct boundary: the `TOUR_REQUEST` query's
 * `trip_plans!inner(sales_mode, name)` has no behavioural coverage of the
 * `!inner` keyword itself — changing it to `trip_plans(sales_mode, name)`
 * (a left join) leaves all 24 tests in this file passing, because this fake
 * `applyFilterOps()` always drops a row when a dot-path filter's relation is
 * missing regardless of `!inner`/left-join wording (see boundary 3 above).
 * Under real PostgREST, dropping `!inner` would turn the embed into `null`
 * for non-REQUEST plans instead of excluding the row, and every tenant-scoped
 * PENDING order — not just REQUEST-mode ones — would leak into the
 * `TOUR_REQUEST` category. It doesn't threaten the tenant boundary itself
 * (`.eq('tenant_id', ...)` still applies and is independently covered), only
 * the sales_mode-narrowing correctness of this one category. A source-grep
 * assertion (`expect(apiSource).toContain("trip_plans!inner(sales_mode")`)
 * would catch a literal accidental edit, but this file has already been
 * burned twice by exactly that pattern — a real call commented out, with the
 * expected substring left sitting in the comment, all 18 tests still green.
 * Deliberately not adding one here; joining the boundary list above `.order`/
 * `.limit` (PR #442 Final Risk F2) instead of an assertion that the same
 * trick would defeat.
 * ---------------------------------------------------------------------------
 */
type FilterCall = [string, unknown[]];
type FakeRow = Record<string, unknown>;

/**
 * #43 類別 1 擴充：route.ts 的新 TOUR_REQUEST query 用
 * `.eq('trip_plans.sales_mode', 'REQUEST')` 過濾內嵌關聯欄位（PostgREST
 * `!inner` join 的寫法，見 `src/app/api/reports/top-products/route.ts` 的既有
 * 先例）。原本的 `applyFilterOps` 只認得扁平欄位（`r[field]`），遇到帶點號的
 * 內嵌路徑會直接讀到 `undefined`、把所有列都濾掉。這裡加一個小 helper 支援
 * `關聯.欄位` 這種路徑（關聯值可能是物件或陣列，比照 route.ts 的 embed 慣例
 * 取第一筆），純粹是新增能力、不改變既有扁平欄位呼叫的行為。
 */
function getFieldValue(row: FakeRow, field: string): unknown {
  if (!field.includes('.')) return row[field];
  const [relation, key] = field.split('.');
  const relationValue = row[relation];
  const relationRow = Array.isArray(relationValue) ? relationValue[0] : relationValue;
  return relationRow && typeof relationRow === 'object'
    ? (relationRow as FakeRow)[key]
    : undefined;
}

function applyFilterOps(rows: FakeRow[], calls: FilterCall[]): FakeRow[] {
  let result = rows;
  for (const [method, args] of calls) {
    const field = args[0] as string;
    switch (method) {
      case 'eq': result = result.filter((r) => getFieldValue(r, field) === args[1]); break;
      case 'neq': result = result.filter((r) => getFieldValue(r, field) !== args[1]); break;
      case 'gt': result = result.filter((r) => (getFieldValue(r, field) as string) > (args[1] as string)); break;
      case 'gte': result = result.filter((r) => (getFieldValue(r, field) as string) >= (args[1] as string)); break;
      case 'lt': result = result.filter((r) => (getFieldValue(r, field) as string) < (args[1] as string)); break;
      case 'lte': result = result.filter((r) => (getFieldValue(r, field) as string) <= (args[1] as string)); break;
      case 'in': result = result.filter((r) => (args[1] as unknown[]).includes(getFieldValue(r, field))); break;
      case 'not': {
        const [notField, op, value] = args as [string, string, string];
        if (op === 'in') {
          const excluded = String(value).replace(/^\(|\)$/, '').replace(/\)$/, '').split(',');
          result = result.filter((r) => !excluded.includes(String(getFieldValue(r, notField))));
        }
        break;
      }
      case 'limit': result = result.slice(0, args[0] as number); break;
      default: break;
    }
  }
  return result;
}

const requireTenantMock = vi.fn();
vi.mock('@/server/tenant', () => ({
  requireTenant: (...a: unknown[]) => requireTenantMock(...a),
}));

/**
 * #43 類別 5 擴充：原本只特化 `trip_departures` 一張表——`then()` 對任何其他表一律
 * 回空陣列。REFUND_PENDING 的行為測試需要對 `tour_orders` 也做同樣的「真的套用過濾
 * 鏈」驗證，所以這裡改成任意表名 → fixture rows 的對照表；沒有列在 `tableRows` 裡的
 * 表仍然乖乖回空陣列（維持既有呼叫端 `makeFakeSupabase(TRIP_DEPARTURE_ROWS)` 的
 * 行為不變，見下方相容 overload）。
 */
function makeFakeSupabase(tableRows: FakeRow[] | Record<string, FakeRow[]>) {
  const tables: Record<string, FakeRow[]> = Array.isArray(tableRows)
    ? { trip_departures: tableRows }
    : tableRows;
  return {
    from(table: string) {
      const calls: FilterCall[] = [];
      const builder: any = {
        select: (...a: unknown[]) => { calls.push(['select', a]); return builder; },
        eq: (...a: unknown[]) => { calls.push(['eq', a]); return builder; },
        neq: (...a: unknown[]) => { calls.push(['neq', a]); return builder; },
        gt: (...a: unknown[]) => { calls.push(['gt', a]); return builder; },
        gte: (...a: unknown[]) => { calls.push(['gte', a]); return builder; },
        lt: (...a: unknown[]) => { calls.push(['lt', a]); return builder; },
        lte: (...a: unknown[]) => { calls.push(['lte', a]); return builder; },
        in: (...a: unknown[]) => { calls.push(['in', a]); return builder; },
        not: (...a: unknown[]) => { calls.push(['not', a]); return builder; },
        order: (...a: unknown[]) => { calls.push(['order', a]); return builder; },
        limit: (...a: unknown[]) => { calls.push(['limit', a]); return builder; },
        maybeSingle: async () => {
          if (table === 'tenant_settings') {
            return { data: { basic: { timezone: 'Asia/Taipei' } }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const rows = tables[table] ? applyFilterOps(tables[table], calls) : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

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
const dashboardI18nSource = readFileSync(
  resolve(process.cwd(), 'src/i18n/zh-TW/pages/dashboard.ts'),
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

// 真正的 route handler——下面兩個行為測試直接呼叫它，不重新實作一份過濾邏輯。
import { GET as guideActionInboxGET } from '@/app/api/guide/action-inbox/route';

describe('GUIDE action inbox (#43-A / #43-B / #43-C / #43 類別 3／4)', () => {
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

  it('exposes mock REVIEW_REQUIRED / AT_RISK cards from the single aggregated inbox, without inventing demo data for other statuses', async () => {
    const items = await getGuideActionInbox();
    const reviewRequired = items.filter((item) => item.kind === 'REVIEW_REQUIRED');
    const atRisk = items.filter((item) => item.kind === 'AT_RISK');

    // dp_4（REVIEW_REQUIRED）與 dp_8（AT_RISK）是 mock/tours.ts 既有唯二符合的 fixture；
    // 其餘 formation_status（COLLECTING/FORMED/FAILED）與已取消的 dp_6 都必須誠實地不
    // 出現在這兩個類別，不得為了畫面好看而多加。
    expect(reviewRequired).toHaveLength(1);
    expect(reviewRequired[0]).toMatchObject({ id: 'dp_4', href: '/tenant/trips/tp_1' });
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0]).toMatchObject({ id: 'dp_8', href: '/tenant/trips/tp_2' });
    expect([...reviewRequired, ...atRisk].every((item) =>
      'minToDepart' in item && 'formedParticipants' in item)).toBe(true);

    // #43 §4：單一聚合端點/函式，不是前端自己併兩份清單。這裡直接鎖住 getGuideActionInbox()
    // 是「唯一入口」——結果同時含五種 kind，且已經是排序好的一份陣列。
    const kinds = new Set(items.map((item) => item.kind));
    expect(kinds.has('REVIEW_REQUIRED')).toBe(true);
    expect(kinds.has('AT_RISK')).toBe(true);
    expect(kinds.has('BOOKING_REQUEST')).toBe(true);
  });

  it('sorts a mixed list containing formation items by the same priority/dueAt/createdAt/id rule as everything else', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const reviewItem = buildGuideActionInboxFormationItem({
      id: 'dp_review',
      tripId: 'trip_1',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-08-19',
      startTime: '20:00',
      capacity: 8,
      seatsBooked: 2,
      minToDepart: 4,
      formationStatus: 'REVIEW_REQUIRED',
      formationDeadlineAt: '2026-08-18T23:00:00.000Z', // 已過 now（2026-08-19T00:00），因此是 IMMEDIATE
      formedParticipants: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    const atRiskItem = buildGuideActionInboxFormationItem({
      id: 'dp_at_risk',
      tripId: 'trip_2',
      tripName: '行程二',
      planName: '方案二',
      departureDate: '2026-08-25',
      startTime: '09:00',
      capacity: 10,
      seatsBooked: 3,
      minToDepart: 4,
      formationStatus: 'AT_RISK',
      formationDeadlineAt: null,
      formedParticipants: 5,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei'); // 出發還有幾天 → UPCOMING
    const booking: GuideActionInboxItem = {
      id: 'booking-today',
      kind: 'BOOKING_REQUEST',
      bookingNo: 'booking-today',
      customerName: '顧客',
      serviceName: '服務',
      priority: 'TODAY',
      dueAt: '2026-08-19T10:00:00.000Z',
      createdAt: '2026-08-19T00:00:00.000Z',
      href: '/tenant/bookings?status=PENDING&bookingId=booking-today',
    };

    expect(reviewItem.priority).toBe('IMMEDIATE');
    expect(atRiskItem.priority).toBe('UPCOMING');
    expect(sortGuideActionInboxItems([atRiskItem, booking, reviewItem]).map((item) => item.id))
      .toEqual(['dp_review', 'booking-today', 'dp_at_risk']);
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

  it('derives #43 類別 3／4 only from trip_departures.formation_status, in the same single aggregated endpoint, never a parallel status', () => {
    // #43 §4：單一聚合端點；不可另開一支端點讓前端自己拼湊。
    expect(apiSource).toContain('formation_status, formation_deadline_at, min_to_depart_snapshot, formed_participants');
    expect(apiSource).toContain(".in('formation_status', ['REVIEW_REQUIRED', 'AT_RISK'])");
    expect(apiSource).toContain(".neq('status', 'CANCELLED')");
    expect(apiSource).toContain('buildGuideActionInboxFormationItem');
    expect(apiSource).toContain('isGuideActionInboxFormationStatus');
    expect(apiSource).toContain('formationResult');
    expect(apiSource).toContain('requireTenant');
    // 只有一次 sortGuideActionInboxItems(...)：四類資料先彙整再排序一次，不是各自排序。
    expect(apiSource.match(/sortGuideActionInboxItems\(/g)).toHaveLength(1);
    expect(serviceSource).toContain('buildGuideActionInboxFormationItem');
    expect(serviceSource).toContain('isGuideActionInboxFormationStatus');
    expect(serviceSource.match(/sortGuideActionInboxItems\(/g)).toHaveLength(1);
    expect(serviceSource).toContain('MOCK_TRIP_DEPARTURES');
    // 沒有獨立的 formation 端點／service 函式殘留。
    expect(serviceSource).not.toContain('getGuideActionInboxFormationItems');
    expect(apiSource).not.toContain('/api/guide/action-inbox/formation');
  });

  it('exhaustively narrows item.kind on the dashboard card instead of an unsafe catch-all else branch', () => {
    // #43 §3：加入新 kind 時 typecheck 必須擋下忘記處理的分支，不是靜默落到 else。
    expect(pageSource).toContain('const _exhaustive: never = item');
    expect((pageSource.match(/const _exhaustive: never = item/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(pageSource).toContain("case 'BOOKING_REQUEST':");
    expect(pageSource).toContain("case 'BOOKING_PAYMENT':");
    expect(pageSource).toContain("case 'TOUR_REQUEST':");
    expect(pageSource).toContain("case 'DEPARTURE':");
    expect(pageSource).toContain("case 'REVIEW_REQUIRED':");
    expect(pageSource).toContain("case 'AT_RISK':");

    // 白話文案（#43 §3）：差幾人成團／已跌破門檻，來自 i18n，不在元件裡寫死中文字面值。
    expect(pageSource).toContain('t.actionInbox.reviewRequired');
    expect(pageSource).toContain('t.actionInbox.atRisk');
    expect(pageSource).toContain('t.actionInbox.formationSeatsShort');
    expect(pageSource).toContain('t.actionInbox.formationAtRiskDetail');

    expect(dashboardI18nSource).toContain('reviewRequired:');
    expect(dashboardI18nSource).toContain('atRisk:');
    expect(dashboardI18nSource).toMatch(/formationSeatsShort:\s*\(n: number\)/);
    expect(dashboardI18nSource).toMatch(/formationAtRiskDetail:\s*\(current: number, min: number\)/);

    // #43 類別 1：TOUR_REQUEST 白話文案，同樣來自 i18n，不在元件裡寫死中文字面值。
    expect(pageSource).toContain('t.actionInbox.tourRequestSubmitted');
    expect(pageSource).toContain('t.actionInbox.tourRequestParty');
    expect(dashboardI18nSource).toContain('tourRequest:');
    expect(dashboardI18nSource).toContain('tourRequestSubmitted:');
    expect(dashboardI18nSource).toMatch(/tourRequestParty:\s*\(n: number\)/);
    expect(dashboardI18nSource).toContain('openTourRequest:');
    // 19 分冊 §1.6 誠實狀態表：REQUEST 已送出、尚未接受時不可顯示成「預約成功」。
    expect(dashboardPage.actionInbox.tourRequestSubmitted).not.toContain('預約成功');
  });

  it('degrades the AT_RISK copy instead of claiming "已跌破成團門檻" when seats_booked has already caught back up to the threshold (LOW finding #3)', () => {
    // AT_RISK 是唯讀觀察值：#41 §6 的自動轉態還沒做，人數事後追回門檻不會自動變回
    // FORMED。這種不一致資料上不能繼續顯示「已跌破」字樣——那是對使用者的誤導。
    expect(pageSource).toContain('t.actionInbox.formationAtRiskInconsistent');
    expect(pageSource).toContain('item.seatsBooked < item.minToDepart');
    expect(dashboardI18nSource).toMatch(/formationAtRiskInconsistent:\s*\(current: number, min: number\)/);
  });

  describe('route.ts behaviour: DEPARTURE / formation query exclusivity + formation lower bound', () => {
    // PB-027／PB-039：上一輪這裡的三個測試只斷言 apiSource 這個字串裡有沒有出現
    // 特定子字串。Final Risk 覆核證明它們是空殼——把 `.not(...)` 與 formation
    // 的 `.gte(...)` 呼叫都註解掉（字面文字留在註解裡）,18 個測試照樣全綠，因為
    // 斷言檢查的是「符號出現」而不是「那件事真的發生」。
    //
    // 下面改用一個會把每次 `.from('trip_departures')` 的過濾鏈實際套用在一組
    // in-memory fixture 上的假 supabase client（見檔案頂端 `applyFilterOps` /
    // `makeFakeSupabase`），直接呼叫真正的 route handler。這樣：
    //   - 拿掉 `.not(...)` 呼叫 → dep-review 會同時以 DEPARTURE 卡片出現 → 失敗。
    //   - 把排除的狀態集合換成語意錯誤的值（或整條掛到 formation query 而非
    //     DEPARTURE query）→ dep-review／dep-atrisk 的出現方式跟著錯 → 失敗。
    //   - 拿掉 formation query 的 `.gte('departs_on', today)` 下限 → 已過期的
    //     dep-stale 會冒出來 → 失敗。
    // 三種 mutation 都已經在 route.ts 上實測過（見本輪 PR 報告），不是只靠推論。
    const NOW = new Date('2026-09-20T04:00:00.000Z'); // 12:00 Asia/Taipei
    const { today, tomorrow } = getGuideActionInboxDateWindow(NOW, 'Asia/Taipei');
    const YESTERDAY = '2026-09-10';

    const TENANT_ID = 'tenant-a';

    const TRIP_DEPARTURE_ROWS: FakeRow[] = [
      {
        id: 'dep-open', tenant_id: TENANT_ID, trip_id: 't1', plan_id: 'p1',
        departs_on: today, start_time: '10:00:00', status: 'OPEN',
        capacity: 10, seats_booked: 3, created_at: '2026-09-01T00:00:00.000Z',
        formation_status: 'COLLECTING', formation_deadline_at: null,
        min_to_depart_snapshot: 5, formed_participants: null,
        trips: { title: 'Trip One' }, trip_plans: { name: 'Plan One' },
      },
      {
        id: 'dep-review', tenant_id: TENANT_ID, trip_id: 't2', plan_id: 'p1',
        departs_on: today, start_time: '11:00:00', status: 'OPEN',
        capacity: 10, seats_booked: 2, created_at: '2026-09-01T00:00:00.000Z',
        formation_status: 'REVIEW_REQUIRED', formation_deadline_at: '2026-09-19T10:00:00.000Z',
        min_to_depart_snapshot: 5, formed_participants: null,
        trips: { title: 'Trip Two' }, trip_plans: { name: 'Plan One' },
      },
      {
        id: 'dep-atrisk', tenant_id: TENANT_ID, trip_id: 't3', plan_id: 'p1',
        departs_on: tomorrow, start_time: '09:00:00', status: 'CLOSED',
        capacity: 8, seats_booked: 3, created_at: '2026-09-01T00:00:00.000Z',
        formation_status: 'AT_RISK', formation_deadline_at: null,
        min_to_depart_snapshot: 4, formed_participants: 3,
        trips: { title: 'Trip Three' }, trip_plans: { name: 'Plan One' },
      },
      {
        // 已出發過的舊 REVIEW_REQUIRED——formation query 的 `.gte('departs_on', today)`
        // 下限要把它擋掉；它不在今日／明日窗內，DEPARTURE query 本來就看不到它。
        id: 'dep-stale', tenant_id: TENANT_ID, trip_id: 't4', plan_id: 'p1',
        departs_on: YESTERDAY, start_time: '08:00:00', status: 'OPEN',
        capacity: 6, seats_booked: 1, created_at: '2026-08-01T00:00:00.000Z',
        formation_status: 'REVIEW_REQUIRED', formation_deadline_at: '2026-09-09T00:00:00.000Z',
        min_to_depart_snapshot: 2, formed_participants: null,
        trips: { title: 'Trip Four' }, trip_plans: { name: 'Plan One' },
      },
      {
        // #440 帶進來、被 PB-048 記錄的缺口：DEPARTURE query 的
        // `.in('status', ['OPEN', 'CLOSED'])` 之前只有原始碼比對斷言覆蓋——刪掉它
        // 測試仍全綠，因為 fixture 裡沒有一筆 CANCELLED 團次能證明這條過濾器真的在
        // 擋東西。這一筆除了 `status: 'CANCELLED'` 以外，其餘條件（tenant、今日出發、
        // 非 formation 狀態）都符合 DEPARTURE query 的其他條件，用來讓這條過濾器有
        // 真正的行為覆蓋：拿掉 `.in('status', ...)` 之後，它會混進 DEPARTURE 卡片。
        id: 'dep-cancelled', tenant_id: TENANT_ID, trip_id: 't5', plan_id: 'p1',
        departs_on: today, start_time: '12:00:00', status: 'CANCELLED',
        capacity: 10, seats_booked: 4, created_at: '2026-09-01T00:00:00.000Z',
        formation_status: 'COLLECTING', formation_deadline_at: null,
        min_to_depart_snapshot: 5, formed_participants: null,
        trips: { title: 'Trip Five' }, trip_plans: { name: 'Plan One' },
      },
    ];

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      requireTenantMock.mockReset();
      requireTenantMock.mockResolvedValue({
        supabase: makeFakeSupabase(TRIP_DEPARTURE_ROWS),
        tenantId: TENANT_ID,
        user: { id: 'user-a' },
        role: 'OWNER',
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('produces exactly one card per departure — no DEPARTURE/REVIEW_REQUIRED or DEPARTURE/AT_RISK duplicate, and drops the stale REVIEW_REQUIRED row', async () => {
      const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
      expect(res.status).toBe(200);
      const body = await res.json();
      const items: Array<{ id: string; kind: string }> = body.data;

      const byId = (id: string) => items.filter((item) => item.id === id);

      expect(byId('dep-open')).toEqual([expect.objectContaining({ id: 'dep-open', kind: 'DEPARTURE' })]);
      // dep-review 只能以 REVIEW_REQUIRED 出現一次——如果 `.not(...)` 被拿掉或排除
      // 的狀態集合寫錯，這裡會多出一張 kind: 'DEPARTURE' 的重複卡片，斷言失敗。
      expect(byId('dep-review')).toEqual([expect.objectContaining({ id: 'dep-review', kind: 'REVIEW_REQUIRED' })]);
      expect(byId('dep-atrisk')).toEqual([expect.objectContaining({ id: 'dep-atrisk', kind: 'AT_RISK' })]);
      // dep-stale 在今日之前出發，formation query 沒有 `.gte('departs_on', today)`
      // 下限的話它會被抓回來並顯示為「立即處理」；有下限則完全不出現。
      expect(byId('dep-stale')).toEqual([]);
      // dep-cancelled 的其他條件都符合 DEPARTURE query（tenant、今日出發、非
      // formation 狀態），唯獨 status 是 CANCELLED——如果 `.in('status', ['OPEN',
      // 'CLOSED'])` 被拿掉，它會混進來變成一張 DEPARTURE 卡片。
      expect(byId('dep-cancelled')).toEqual([]);

      expect(items).toHaveLength(3);
    });

  });

  describe('route.ts behaviour: #43 類別 5 REFUND_PENDING (tour_orders)', () => {
    // 行為測試，不是字串比對（本檔開頭已說明理由）：一個會把
    // `.from('tour_orders')` 的過濾鏈實際套用在 in-memory fixture 上的假
    // supabase client，直接呼叫真正的 route handler。
    //
    // 可證的不相交性（PR 報告會重複貼一次結論）：REFUND_PENDING 讀
    // `tour_orders`，BOOKING_PAYMENT 讀 `bookings_view`（其底層 `public.bookings`
    // 的 `payment_status` 用 0002 的 `payment_status` enum，值域裡根本沒有
        // `REFUND_PENDING` 這個標籤）——兩者是不同表、不同 enum 值域，data-level
    // 不可能重疊，不需要事後去重。這裡的 fixture 刻意也在 `bookings_view` 放一筆
    // 同 id 的列，用來證明就算 id 撞名，兩張表的查詢各自獨立、不會互相污染。
    const TENANT_ID = 'tenant-a';
    const OTHER_TENANT_ID = 'tenant-b';

    const TOUR_ORDER_ROWS: FakeRow[] = [
      {
        // 目標列：tenant-a、REFUND_PENDING，應該出現，且金額算法要對
        // （paid_amount - refunded_amount = 2670 - 0 = 2670）。
        id: 'ord-refund-a', tenant_id: TENANT_ID, order_no: 'T2609180001',
        contact: { name: '許家瑜' }, paid_amount: 2670, refunded_amount: 0,
        payment_status: 'REFUND_PENDING',
        updated_at: '2026-09-18T02:00:00.000Z', created_at: '2026-09-10T00:00:00.000Z',
      },
      {
        // 部分退款中的列：paid_amount - refunded_amount = 1000 - 400 = 600。
        id: 'ord-refund-partial', tenant_id: TENANT_ID, order_no: 'T2609170002',
        contact: { name: '王小明' }, paid_amount: 1000, refunded_amount: 400,
        payment_status: 'REFUND_PENDING',
        updated_at: '2026-09-17T01:00:00.000Z', created_at: '2026-09-05T00:00:00.000Z',
      },
      {
        // 同租戶但 PAID：不應該出現。用來證明 query 真的在過濾 payment_status，
        // 不是只憑 tenant_id 就把整張表當成 REFUND_PENDING。
        id: 'ord-paid-a', tenant_id: TENANT_ID, order_no: 'T2609160003',
        contact: { name: '陳大文' }, paid_amount: 1000, refunded_amount: 0,
        payment_status: 'PAID',
        updated_at: '2026-09-16T00:00:00.000Z', created_at: '2026-09-01T00:00:00.000Z',
      },
      {
        // 其他租戶的 REFUND_PENDING：不應該出現。證明 tenant_id 過濾真的在擋。
        id: 'ord-refund-b', tenant_id: OTHER_TENANT_ID, order_no: 'T2609190004',
        contact: { name: '林小美' }, paid_amount: 500, refunded_amount: 0,
        payment_status: 'REFUND_PENDING',
        updated_at: '2026-09-19T00:00:00.000Z', created_at: '2026-09-11T00:00:00.000Z',
      },
    ];

    // 刻意跟 `ord-refund-a` 撞同一個 id，證明兩張表的查詢互不污染（見上方說明）。
    const BOOKINGS_VIEW_ROWS: FakeRow[] = [
      {
        id: 'ord-refund-a', tenant_id: TENANT_ID, booking_no: 'BK-COLLIDE',
        customer_name: '不應該出現在 REFUND_PENDING', service_name: 'x',
        status: 'CONFIRMED', payment_status: 'UNPAID', final_price: 999,
        start_at: '2026-09-20T01:00:00.000Z', created_at: '2026-09-01T00:00:00.000Z',
      },
    ];

    beforeEach(() => {
      requireTenantMock.mockReset();
      requireTenantMock.mockResolvedValue({
        supabase: makeFakeSupabase({
          tour_orders: TOUR_ORDER_ROWS,
          bookings_view: BOOKINGS_VIEW_ROWS,
        }),
        tenantId: TENANT_ID,
        user: { id: 'user-a' },
        role: 'OWNER',
      });
    });

    it('reads only tenant-scoped REFUND_PENDING tour_orders, computes the outstanding amount honestly, and never as REFUNDED', async () => {
      const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
      expect(res.status).toBe(200);
      const body = await res.json();
      const items: any[] = body.data;
      const refundItems = items.filter((i) => i.kind === 'REFUND_PENDING');

      // 只有 tenant-a 的兩筆 REFUND_PENDING 出現；PAID（ord-paid-a）與其他租戶
      // （ord-refund-b）都不在——如果 `.eq('payment_status', 'REFUND_PENDING')`
      // 被拿掉，ord-paid-a 會混進來；如果 `.eq('tenant_id', ...)` 被拿掉或
      // payment_status 的值寫錯，ord-refund-b 會混進來或 ord-refund-a 會消失。
      expect(refundItems.map((i) => i.id).sort()).toEqual(['ord-refund-a', 'ord-refund-partial']);

      const full = refundItems.find((i) => i.id === 'ord-refund-a');
      expect(full).toMatchObject({
        orderNo: 'T2609180001',
        customerName: '許家瑜',
        refundOutstandingAmount: 2670,
        priority: 'IMMEDIATE',
        href: '/tenant/tour-orders?paymentStatus=REFUND_PENDING&orderId=ord-refund-a',
      });

      const partial = refundItems.find((i) => i.id === 'ord-refund-partial');
      expect(partial).toMatchObject({
        refundOutstandingAmount: 600,
        priority: 'IMMEDIATE',
      });

      // #43 §4：唯一入口，只排序一次。
      //
      // 上一版這裡寫的是 `items.length === refundItems.length + items.filter(kind !==
      // 'REFUND_PENDING').length`——這是 |A| = |A∩P| + |A∩¬P|，對任何陣列恆成立，
      // 沒有任何 mutation 能讓它失敗（PB-039／PB-041）。換成從 fixture 可推得的實際
      // 總筆數與 kind 分佈：這份 fixture 除了 2 筆 tenant-a 的 REFUND_PENDING，
      // `bookings_view` 裡故意撞 id 那筆（status=CONFIRMED、payment_status=UNPAID、
      // final_price=999>0）會合法命中 BOOKING_PAYMENT 查詢條件，`trip_departures`
      // 表未提供、視為空表——所以預期總筆數是 3，且只有 REFUND_PENDING（2）與
      // BOOKING_PAYMENT（1）兩種 kind，沒有第三種。拿掉 payment_status 過濾會讓
      // ord-paid-a 混入、拿掉 tenant_id 過濾會讓 ord-refund-b 混入，兩者都會把
      // REFUND_PENDING 的筆數從 2 變成別的數字，被下面的 toHaveLength 抓到。
      expect(items).toHaveLength(3);
      expect(items.filter((i) => i.kind === 'REFUND_PENDING')).toHaveLength(2);
      expect(items.filter((i) => i.kind === 'BOOKING_PAYMENT')).toHaveLength(1);
      expect(
        items.filter((i) => i.kind !== 'REFUND_PENDING' && i.kind !== 'BOOKING_PAYMENT'),
      ).toHaveLength(0);

      // `sortGuideActionInboxItems` 只被套用一次、且是套在合併後的整份清單上：兩筆
      // REFUND_PENDING 的 priority 都是 'IMMEDIATE'，所以要靠下一層 tie-break
      // （dueAt = updated_at 升冪）決定順序——ord-refund-partial（updated_at
      // 09-17）必須排在 ord-refund-a（updated_at 09-18）之前。如果 route.ts 對
      // REFUND_PENDING 子清單多排序一次、漏排、或把不同來源的清單各自排序後才
      // concat（而不是先 concat 再排序一次），這個相對順序會被打亂或變成插入順序。
      const refundIdsInOrder = items
        .filter((i) => i.kind === 'REFUND_PENDING')
        .map((i) => i.id);
      expect(refundIdsInOrder).toEqual(['ord-refund-partial', 'ord-refund-a']);

      // 18 分冊 §9.3：REFUND_PENDING 不可顯示成「已退款」。`kind` 是型別層級的
      // union 字面量（沒有 'REFUNDED' 這個成員，TS 編譯期就會擋），所以對 kind 字面
      // 比對是恆假斷言、沒有 mutation 能讓它紅。真正會壞的是 i18n copy：斷言
      // dashboard 的 REFUND_PENDING 相關文案（`refundPending`／`openRefund`／
      // `refundOutstanding(...)`）都不包含「已退款」三個字——把 `refundPending`
      // 改成 '已退款' 這個 mutation 必須讓這條斷言紅。
      const refundCopy = dashboardPage.actionInbox;
      expect(refundCopy.refundPending).not.toContain('已退款');
      expect(refundCopy.openRefund).not.toContain('已退款');
      expect(refundCopy.refundOutstanding('NT$2,670')).not.toContain('已退款');

      // 撞 id 的 bookings_view 列（會被 BOOKING_PAYMENT query 合法抓到，因為它的
      // status/payment_status/final_price 本就符合那條 query）不會污染
      // REFUND_PENDING 卡片的內容——`ord-refund-a` 這個 id 只能有一張
      // kind: 'REFUND_PENDING' 卡片，且它的客戶姓名／金額必須來自 tour_orders
      // 那筆，不是被 bookings_view 那筆覆蓋或合併。
      expect(full!.customerName).not.toBe('不應該出現在 REFUND_PENDING');
      expect(items.filter((i) => i.id === 'ord-refund-a' && i.kind === 'REFUND_PENDING')).toHaveLength(1);
    });
  });

  describe('route.ts behaviour: #43 類別 7 STAFF_CONFLICT (trip_departure_staff + staff-availability engine)', () => {
    // 行為測試，不是字串比對：直接呼叫真正的 route handler，撞班判斷本身也是真正
    // 呼叫 `src/server/staff-availability.ts` 的 `loadStaffLoad()`/`findStaffConflicts()`
    // （issue #37 canonical、已有自己的 `tests/unit/departure-guide-assignment.37.test.ts`
    // 覆蓋），這裡只驗證 route.ts 的「挑候選、餵資料、組卡片」glue 是否正確——見本檔
    // 頂端「Coverage boundary (#43 類別 7 STAFF_CONFLICT...)」，DEPARTURE 這個
    // conflict reason 在這個假 harness 上無法真正觸發，改由既有的
    // `departure-guide-assignment.37.test.ts` 覆蓋 `findStaffConflicts` 本身。
    const NOW = new Date('2026-09-25T04:00:00.000Z'); // 12:00 Asia/Taipei
    const TENANT_ID = 'tenant-a';
    const OTHER_TENANT_ID = 'tenant-b';

    const assignment = (staffId: string, staffName: string) => ([{
      staff_id: staffId, role: 'PRIMARY', staff: { name: staffName },
    }]);

    // `dep-conflict-booking` 與 `dep-other-tenant` 刻意共用同一位員工
    // （`s-shared`）與同一段時間——這是下面「不洩漏跨租戶」測試需要的：真正的
    // BOOKING 衝突資料只存在於 tenant-a，如果 route.ts 的
    // `.eq('tenant_id', t.tenantId)` 被拿掉，`dep-other-tenant`（tenant-b）會被
    // 撈進候選名單，然後套用 tenant-a 的 `loadStaffLoad()`（它本身有自己獨立的
    // tenant 過濾，不受這個 mutation 影響）算出同一個假衝突，因而錯誤地出現在
    // 結果裡。
    const TRIP_DEPARTURE_ROWS: FakeRow[] = [
      {
        id: 'dep-conflict-booking', tenant_id: TENANT_ID, trip_id: 't-book', plan_id: 'p1',
        departs_on: '2026-09-28', start_time: '09:00:00', status: 'OPEN',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Booking Conflict Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: assignment('s-shared', '雨後'),
      },
      {
        id: 'dep-conflict-block', tenant_id: TENANT_ID, trip_id: 't-block', plan_id: 'p1',
        departs_on: '2026-09-29', start_time: '14:00:00', status: 'OPEN',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Block Conflict Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: assignment('s-block', '阿凱'),
      },
      {
        id: 'dep-conflict-shift', tenant_id: TENANT_ID, trip_id: 't-shift', plan_id: 'p1',
        departs_on: '2026-09-30', start_time: '10:00:00', status: 'OPEN',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Shift Conflict Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: assignment('s-noshift', '小美'),
      },
      {
        // 對照組：有指派、有班表覆蓋、沒有任何預約／封鎖／團次衝突——必須誠實地
        // 不出現在 STAFF_CONFLICT，不是「只要有指派就一定產生卡片」。
        id: 'dep-clean', tenant_id: TENANT_ID, trip_id: 't-clean', plan_id: 'p1',
        departs_on: '2026-10-01', start_time: '10:00:00', status: 'OPEN',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Clean Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: assignment('s-clean', '阿海'),
      },
      {
        // 對照組：#43 §7 只涵蓋「已指派但撞期」，未指派人員的既有團次（10-TOUR-
        // DOMAIN §1.3 相容策略）在這裡先被排除，不進入撞班判斷。
        id: 'dep-unassigned', tenant_id: TENANT_ID, trip_id: 't-unassigned', plan_id: 'p1',
        departs_on: '2026-10-02', start_time: '10:00:00', status: 'OPEN',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Unassigned Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: [],
      },
      {
        // 跨租戶對照組，見上方說明。
        id: 'dep-other-tenant', tenant_id: OTHER_TENANT_ID, trip_id: 't-other', plan_id: 'p1',
        departs_on: '2026-09-28', start_time: '09:00:00', status: 'OPEN',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Other Tenant Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: assignment('s-shared', '雨後'),
      },
      {
        // `.in('status', ['OPEN', 'CLOSED'])` 對照組：租戶、未來日期、有指派、
        // 該員工在該時段確實有一筆真正的 BOOKING 衝突——除了 `status` 是
        // `CANCELLED`（不在 `['OPEN', 'CLOSED']` 內）以外，其餘條件都會讓它成為
        // 衝突卡片。拿掉 `.in('status', ...)` 這一段過濾器，這筆必須冒出來。
        id: 'dep-cancelled-conflict', tenant_id: TENANT_ID, trip_id: 't-cancelled', plan_id: 'p1',
        departs_on: '2026-10-03', start_time: '09:00:00', status: 'CANCELLED',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Cancelled Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: assignment('s-cancelled', '阿聰'),
      },
      {
        // `.gte('departs_on', today)` 對照組：同理，除了 `departs_on` 落在 NOW
        // （2026-09-25）之前以外，其餘條件都會讓它成為衝突卡片。拿掉這段下限，
        // 這筆必須冒出來。
        id: 'dep-stale-conflict', tenant_id: TENANT_ID, trip_id: 't-stale', plan_id: 'p1',
        departs_on: '2026-09-20', start_time: '09:00:00', status: 'OPEN',
        created_at: '2026-09-01T00:00:00.000Z',
        trips: { title: 'Stale Trip', duration_hours: 2 },
        trip_plans: { name: 'Plan' },
        trip_departure_staff: assignment('s-stale', '子欣'),
      },
    ];

    const fullDayShift = (staffId: string, workDate: string) => ({
      tenant_id: TENANT_ID, staff_id: staffId, work_date: workDate,
      start_time: '00:00:00', end_time: '23:59:00',
    });

    const SHIFT_ROWS: FakeRow[] = [
      fullDayShift('s-shared', '2026-09-28'),
      fullDayShift('s-block', '2026-09-29'),
      // `s-noshift` 那天租戶確實有班表資料（`s-other` 的班），但 `s-noshift` 自己
      // 沒有——`tenantHasShiftsThatDay=true` 但 `mine=[]`，因而是 SHIFT 衝突，不是
      // 「這個租戶完全沒有班表資料」的全時段可排放行情況。
      { tenant_id: TENANT_ID, staff_id: 's-other', work_date: '2026-09-30', start_time: '00:00:00', end_time: '23:59:00' },
      fullDayShift('s-clean', '2026-10-01'),
      fullDayShift('s-cancelled', '2026-10-03'),
      fullDayShift('s-stale', '2026-09-20'),
    ];

    const BOOKING_ROWS: FakeRow[] = [
      {
        tenant_id: TENANT_ID, staff_id: 's-shared', status: 'CONFIRMED',
        start_at: '2026-09-28T02:00:00.000Z', end_at: '2026-09-28T04:00:00.000Z',
      },
      {
        // `dep-cancelled-conflict` 的真正 BOOKING 衝突來源——證明它「除了 status
        // 是 CANCELLED 以外」本來就會被判定撞期。
        tenant_id: TENANT_ID, staff_id: 's-cancelled', status: 'CONFIRMED',
        start_at: '2026-10-03T02:00:00.000Z', end_at: '2026-10-03T04:00:00.000Z',
      },
      {
        // `dep-stale-conflict` 的真正 BOOKING 衝突來源——證明它「除了日期在今天
        // 之前以外」本來就會被判定撞期。
        tenant_id: TENANT_ID, staff_id: 's-stale', status: 'CONFIRMED',
        start_at: '2026-09-20T02:00:00.000Z', end_at: '2026-09-20T04:00:00.000Z',
      },
    ];

    const BLOCK_TIME_ROWS: FakeRow[] = [
      {
        id: 'bt-1', tenant_id: TENANT_ID, staff_id: 's-block', recurrence: 'SINGLE',
        start_at: '2026-09-29T07:00:00.000Z', end_at: '2026-09-29T09:00:00.000Z',
        reason: '', title: '', day_of_week: null, full_day: false, auto: false,
      },
    ];

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      requireTenantMock.mockReset();
      requireTenantMock.mockResolvedValue({
        supabase: makeFakeSupabase({
          trip_departures: TRIP_DEPARTURE_ROWS,
          shifts: SHIFT_ROWS,
          bookings: BOOKING_ROWS,
          block_times: BLOCK_TIME_ROWS,
        }),
        tenantId: TENANT_ID,
        user: { id: 'user-a' },
        role: 'OWNER',
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('flags only departures whose assigned staff genuinely conflicts (BOOKING/BLOCK/SHIFT), never a clean or unassigned departure, and never leaks another tenant', async () => {
      const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
      expect(res.status).toBe(200);
      const body = await res.json();
      const items: any[] = body.data;
      const conflictItems = items.filter((i) => i.kind === 'STAFF_CONFLICT');
      const ids = conflictItems.map((i) => i.id).sort();

      // 三種真正撞期的團次都出現，乾淨、未指派、跨租戶的都不出現。
      expect(ids).toEqual(['dep-conflict-block', 'dep-conflict-booking', 'dep-conflict-shift']);

      const byId = (id: string) => conflictItems.find((i) => i.id === id);

      const bookingItem = byId('dep-conflict-booking');
      expect(bookingItem).toMatchObject({
        tripId: 't-book', tripName: 'Booking Conflict Trip', priority: 'IMMEDIATE',
        href: '/tenant/trips/t-book',
      });
      expect(bookingItem.conflicts).toEqual([{ staffId: 's-shared', staffName: '雨後', reason: 'BOOKING' }]);

      const blockItem = byId('dep-conflict-block');
      expect(blockItem.conflicts).toEqual([{ staffId: 's-block', staffName: '阿凱', reason: 'BLOCK' }]);
      expect(blockItem.priority).toBe('IMMEDIATE');

      const shiftItem = byId('dep-conflict-shift');
      expect(shiftItem.conflicts).toEqual([{ staffId: 's-noshift', staffName: '小美', reason: 'SHIFT' }]);
      expect(shiftItem.priority).toBe('IMMEDIATE');

      // 對照組：有指派、有班表覆蓋、沒有其他撞期來源的 `dep-clean`，以及未指派的
      // `dep-unassigned`，兩者都誠實地不產生卡片——不是「只要有指派就一定顯示」。
      expect(items.some((i) => i.id === 'dep-clean')).toBe(false);
      expect(items.some((i) => i.id === 'dep-unassigned')).toBe(false);

      // `.in('status', ['OPEN', 'CLOSED'])` 與 `.gte('departs_on', today)` 對照
      // 組：`dep-cancelled-conflict`／`dep-stale-conflict` 除了 status／日期以外
      // 都會被判定撞期（見上方 fixture 註解），必須誠實地不出現——拿掉任一段
      // 過濾器都要讓這兩行紅。
      expect(items.some((i) => i.id === 'dep-cancelled-conflict')).toBe(false);
      expect(items.some((i) => i.id === 'dep-stale-conflict')).toBe(false);

      // 跨租戶：`dep-other-tenant` 與 `dep-conflict-booking` 共用同一位員工、同一段
      // 時間，如果 `.eq('tenant_id', t.tenantId)` 被拿掉，它會被撈進候選名單並套
      // 用 tenant-a 的撞班資料而「被誤判撞期」，出現在這裡——見上方 fixture 註解。
      expect(items.some((i) => i.id === 'dep-other-tenant')).toBe(false);
    });
  });

  describe('route.ts behaviour: #43 類別 1 TOUR_REQUEST (tour_orders + trip_plans.sales_mode)', () => {
    // 行為測試，不是字串比對：一個會把 `.from('tour_orders')` 的過濾鏈（含
    // `trip_plans.sales_mode` 這種內嵌關聯路徑，見檔案頂端 `getFieldValue` 擴充）
    // 實際套用在 in-memory fixture 上的假 supabase client，直接呼叫真正的 route
    // handler。
    const TENANT_ID = 'tenant-a';
    const OTHER_TENANT_ID = 'tenant-b';

    const TOUR_ORDER_ROWS: FakeRow[] = [
      {
        // 目標列：tenant-a、PENDING、方案 sales_mode 是 REQUEST——應該出現。
        id: 'ord-request-a', tenant_id: TENANT_ID, order_no: 'T2609200001',
        party_size: 6, total_amount: 18000, contact: { name: '蔡欣妤' },
        hold_expires_at: null, status: 'PENDING',
        trip_plans: { sales_mode: 'REQUEST', name: '包船專案' },
        trips: { title: '龜山島賞鯨半日遊' },
        trip_departures: { departs_on: '2026-09-25', start_time: '08:00:00' },
        created_at: '2026-09-12T00:00:00.000Z',
      },
      {
        // 同租戶、同樣 REQUEST 方案，但訂單已經是 CONFIRMED：導遊已經決定過了，
        // 不該再出現在「待接受／拒絕」的收件匣裡。證明 query 真的在濾 status，
        // 不是只憑方案的 sales_mode 就把整張表當成待處理。
        id: 'ord-confirmed-request', tenant_id: TENANT_ID, order_no: 'T2609190002',
        party_size: 2, total_amount: 2560, contact: { name: '已確認旅客' },
        hold_expires_at: null, status: 'CONFIRMED',
        trip_plans: { sales_mode: 'REQUEST', name: '包船專案' },
        trips: { title: '龜山島賞鯨半日遊' },
        trip_departures: { departs_on: '2026-09-24', start_time: '09:00:00' },
        created_at: '2026-09-10T00:00:00.000Z',
      },
      {
        // 同租戶、PENDING，但方案是 FIXED_DEPARTURE（固定團次，不是先申請再確認）：
        // 不該出現。證明 query 真的在濾 `trip_plans.sales_mode`，不是只憑
        // tenant_id + status 就把整張表當成 REQUEST。
        id: 'ord-pending-fixed', tenant_id: TENANT_ID, order_no: 'T2609180003',
        party_size: 2, total_amount: 2560, contact: { name: '固定團次旅客' },
        hold_expires_at: null, status: 'PENDING',
        trip_plans: { sales_mode: 'FIXED_DEPARTURE', name: '標準團（共乘）' },
        trips: { title: '龜山島賞鯨半日遊' },
        trip_departures: { departs_on: '2026-09-24', start_time: '09:00:00' },
        created_at: '2026-09-09T00:00:00.000Z',
      },
      {
        // 其他租戶，PENDING + REQUEST：不該出現。證明 tenant_id 過濾真的在擋。
        id: 'ord-request-b', tenant_id: OTHER_TENANT_ID, order_no: 'T2609170004',
        party_size: 4, total_amount: 6800, contact: { name: '別家旅客' },
        hold_expires_at: null, status: 'PENDING',
        trip_plans: { sales_mode: 'REQUEST', name: '私人包團' },
        trips: { title: '九份山城夜訪散策' },
        trip_departures: { departs_on: '2026-09-23', start_time: '17:00:00' },
        created_at: '2026-09-08T00:00:00.000Z',
      },
    ];

    beforeEach(() => {
      requireTenantMock.mockReset();
      requireTenantMock.mockResolvedValue({
        supabase: makeFakeSupabase({ tour_orders: TOUR_ORDER_ROWS }),
        tenantId: TENANT_ID,
        user: { id: 'user-a' },
        role: 'OWNER',
      });
    });

    it('reads only tenant-scoped PENDING orders whose plan sales_mode is REQUEST, honestly labelled as awaiting the guide\'s decision', async () => {
      const res = await guideActionInboxGET(new Request('https://app.test/api/guide/action-inbox'), {});
      expect(res.status).toBe(200);
      const body = await res.json();
      const items: any[] = body.data;
      const requestItems = items.filter((i) => i.kind === 'TOUR_REQUEST');

      // 只有 ord-request-a 出現——如果拿掉 `.eq('status', 'PENDING')`，
      // ord-confirmed-request 會混進來；如果拿掉 `.eq('trip_plans.sales_mode',
      // 'REQUEST')`，ord-pending-fixed 會混進來；如果拿掉
      // `.eq('tenant_id', ...)`，ord-request-b 會混進來。三者都會讓這個陣列
      // 不再只有一筆。
      expect(requestItems.map((i) => i.id)).toEqual(['ord-request-a']);

      expect(requestItems[0]).toMatchObject({
        orderNo: 'T2609200001',
        customerName: '蔡欣妤',
        tripName: '龜山島賞鯨半日遊',
        planName: '包船專案',
        partySize: 6,
        totalAmount: 18000,
        href: '/tenant/tour-orders?orderId=ord-request-a',
      });

      // 唯一入口：整份清單裡只有這一種 kind，且長度可由 fixture 精確推得——
      // trip_departures／bookings_view 未提供，視為空表。
      expect(items).toHaveLength(1);
    });
  });

  describe('buildGuideActionInboxTourRequestItem (#43 類別 1 due-at)', () => {
    it('uses hold_expires_at when present, falls back to the departure instant, and finally to createdAt', () => {
      const now = new Date('2026-09-14T00:00:00.000Z');

      const withHold = buildGuideActionInboxTourRequestItem({
        id: 'req-1', orderNo: 'T1', customerName: '旅客一', tripName: '行程',
        planName: '方案', partySize: 2, totalAmount: 2000,
        holdExpiresAt: '2026-09-15T05:00:00.000Z',
        departureDate: '2026-09-20', departureStartTime: '09:00',
        createdAt: '2026-09-10T00:00:00.000Z',
        href: '/tenant/tour-orders?orderId=req-1',
      }, now, 'Asia/Taipei');
      expect(withHold.dueAt).toBe('2026-09-15T05:00:00.000Z');

      const withoutHold = buildGuideActionInboxTourRequestItem({
        id: 'req-2', orderNo: 'T2', customerName: '旅客二', tripName: '行程',
        planName: '方案', partySize: 2, totalAmount: 2000,
        holdExpiresAt: null,
        departureDate: '2026-09-20', departureStartTime: '09:00',
        createdAt: '2026-09-10T00:00:00.000Z',
        href: '/tenant/tour-orders?orderId=req-2',
      }, now, 'Asia/Taipei');
      expect(withoutHold.dueAt).toBe(getGuideDepartureDueAt('2026-09-20', '09:00', 'Asia/Taipei'));

      const withNeither = buildGuideActionInboxTourRequestItem({
        id: 'req-3', orderNo: 'T3', customerName: '旅客三', tripName: '行程',
        planName: '方案', partySize: 2, totalAmount: 2000,
        holdExpiresAt: null,
        departureDate: null, departureStartTime: null,
        createdAt: '2026-09-10T00:00:00.000Z',
        href: '/tenant/tour-orders?orderId=req-3',
      }, now, 'Asia/Taipei');
      expect(withNeither.dueAt).toBe('2026-09-10T00:00:00.000Z');
      expect(withNeither.kind).toBe('TOUR_REQUEST');
    });
  });

  describe('mock service exclusivity (demo mode)', () => {
    // `getGuideActionInbox()` 的 mock adapter 用真正的 `setTimeout` 模擬延遲——
    // 跟上面那個 describe 共用 `vi.useFakeTimers()` 會讓它永遠等不到那個 timer
    // 觸發，所以獨立成不受假時鐘影響的 describe，而不是把這個行為斷言搬回文字斷言。
    it('mock service applies the same exclusivity rule (demo mode must not reproduce the duplicate-card bug)', async () => {
      // 這條留下行為斷言而非文字斷言：直接讀 mock 服務的真實輸出，確認同一顆
      // trip_departure 不會同時以 DEPARTURE 與 REVIEW_REQUIRED/AT_RISK 兩種
      // kind 出現。
      const items = await getGuideActionInbox();
      const departureIds = new Set(items.filter((i) => i.kind === 'DEPARTURE').map((i) => i.id));
      const formationIds = items
        .filter((i) => i.kind === 'REVIEW_REQUIRED' || i.kind === 'AT_RISK')
        .map((i) => i.id);
      expect(formationIds.length).toBeGreaterThan(0);
      for (const id of formationIds) {
        expect(departureIds.has(id)).toBe(false);
      }
    });

    it('exposes the mock TOUR_REQUEST card (#43 類別 1) from the same single aggregated inbox', async () => {
      const items = await getGuideActionInbox();
      const requestItems = items.filter((i) => i.kind === 'TOUR_REQUEST');
      // to_9 是 mock/tours.ts 裡唯一 status=PENDING 且方案 salesMode='REQUEST'
      // 的 fixture（pl_2「包船專案」）；其餘 PENDING 訂單（to_1）掛在
      // FIXED_DEPARTURE 方案下，誠實地不出現在這裡。
      expect(requestItems).toHaveLength(1);
      expect(requestItems[0]).toMatchObject({
        id: 'to_9',
        planName: '包船專案',
        href: '/tenant/tour-orders?orderId=to_9',
      });
    });
  });

  // #43 の `min_to_depart_snapshot ?? 1` dead-code cleanup（上一輪第三個 source-grep
  // 測試）は削除した：`min_to_depart_snapshot` is declared `NOT NULL` by 0107, so the
  // only input that would make `?? 1` differ from a direct read (`null`/`undefined`)
  // is schema-impossible on the real API row — there is no behavioural fixture that
  // can distinguish "reads the field directly" from "falls back to 1 for a value that
  // can never occur". A genuine behavioural unit test is not achievable here; keeping
  // a source-grep assertion for it would be exactly the PB-027/PB-039 failure mode
  // this round is fixing, so it is deleted rather than kept hollow. If this ever
  // regresses in a way that matters, it will show up as a real DB constraint
  // violation on `min_to_depart_snapshot`, not as a value silently defaulting to 1.

  it('mock formation cards are remapped to today/tomorrow, not left on the stale fixture date (LOW finding: past-dated formation departures must not sit in the inbox forever)', async () => {
    const now = new Date();
    const { today, tomorrow } = getGuideActionInboxDateWindow(now);
    const items = await getGuideActionInbox();
    const formationItems = items.filter(
      (item) => item.kind === 'REVIEW_REQUIRED' || item.kind === 'AT_RISK',
    );

    // dp_4／dp_8 是 mock/tours.ts 裡唯二的 REVIEW_REQUIRED／AT_RISK fixture，兩者都必須
    // 出現，且都要被 remap 到今日／明日——跟 route.ts 新加的 `.gte('departs_on', today)`
    // 下限保持一致，不能再是 fixture 寫死的 2026-08 過期日期。
    expect(formationItems).toHaveLength(2);
    for (const item of formationItems) {
      expect('departureDate' in item ? item.departureDate : null).not.toBeNull();
      if ('departureDate' in item) {
        expect([today, tomorrow]).toContain(item.departureDate);
      }
    }
  });

  it('shows the slice only in GUIDE mode and renders a mobile-safe action', () => {
    expect(pageSource).toContain('modePreset.showActionInbox');
    expect(pageSource).not.toContain("businessType === 'GUIDE'");
    expect(pageSource).not.toContain("if (businessType !== 'GUIDE') return;");
    expect(pageSource).toContain('setActionInbox([])');
    expect(pageSource).toContain('getGuideActionInbox');
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

  it('mock GUIDE mode never fabricates a STAFF_CONFLICT demo card (#43 §4: 無資料時回誠實空陣列)', async () => {
    // `MOCK_TRIP_DEPARTURES` 的檔頭註解明講示範資料刻意不得撞班；這裡直接讀
    // `getGuideActionInbox()` 的真實輸出，鎖住「demo 模式沒有第 7 類卡片」這個
    // 行為本身，而不是只檢查原始碼裡有沒有寫 `STAFF_CONFLICT` 這個字面值——後者
    // 就算真的塞了一筆假衝突資料也會通過，是恆真的假保護。
    const items = await getGuideActionInbox();
    expect(items.filter((item) => item.kind === 'STAFF_CONFLICT')).toEqual([]);
  });

  it('exhaustively narrows STAFF_CONFLICT on the dashboard card with i18n-only copy (#43 類別 7)', () => {
    // 三個 switch 都要有 STAFF_CONFLICT 分支，否則 `const _exhaustive: never = item`
    // 在加入這個 kind 後會讓 typecheck 失敗——見檔案頂端 `_exhaustive` 的說明。
    expect(pageSource).toContain("case 'STAFF_CONFLICT':");
    expect((pageSource.match(/case 'STAFF_CONFLICT':/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(pageSource).toContain('t.actionInbox.staffConflict');
    expect(pageSource).toContain('t.actionInbox.staffConflictSummary');
    expect(pageSource).toContain('t.actionInbox.staffConflictReason');
    expect(pageSource).toContain('t.actionInbox.openStaffConflict');

    expect(dashboardI18nSource).toContain('staffConflict:');
    expect(dashboardI18nSource).toMatch(/staffConflictSummary:\s*\(n: number\)/);
    expect(dashboardI18nSource).toContain('staffConflictReason:');
    expect(dashboardI18nSource).toContain('openStaffConflict:');
  });
});
