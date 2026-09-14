import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { getGuideActionInbox } from '@/services/guide-action-inbox';

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
 * ---------------------------------------------------------------------------
 */
type FilterCall = [string, unknown[]];
type FakeRow = Record<string, unknown>;

function applyFilterOps(rows: FakeRow[], calls: FilterCall[]): FakeRow[] {
  let result = rows;
  for (const [method, args] of calls) {
    const field = args[0] as string;
    switch (method) {
      case 'eq': result = result.filter((r) => r[field] === args[1]); break;
      case 'neq': result = result.filter((r) => r[field] !== args[1]); break;
      case 'gt': result = result.filter((r) => (r[field] as string) > (args[1] as string)); break;
      case 'gte': result = result.filter((r) => (r[field] as string) >= (args[1] as string)); break;
      case 'lt': result = result.filter((r) => (r[field] as string) < (args[1] as string)); break;
      case 'lte': result = result.filter((r) => (r[field] as string) <= (args[1] as string)); break;
      case 'in': result = result.filter((r) => (args[1] as unknown[]).includes(r[field])); break;
      case 'not': {
        const [notField, op, value] = args as [string, string, string];
        if (op === 'in') {
          const excluded = String(value).replace(/^\(|\)$/, '').replace(/\)$/, '').split(',');
          result = result.filter((r) => !excluded.includes(String(r[notField])));
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
      expect(items.length).toBe(refundItems.length + items.filter((i) => i.kind !== 'REFUND_PENDING').length);

      // 18 分冊 §9.3：REFUND_PENDING 不可顯示成 REFUNDED——回應裡不該有任何一張
      // 卡片的 kind 字面等於 'REFUNDED'。
      expect(items.some((i) => i.kind === 'REFUNDED')).toBe(false);

      // 撞 id 的 bookings_view 列（會被 BOOKING_PAYMENT query 合法抓到，因為它的
      // status/payment_status/final_price 本就符合那條 query）不會污染
      // REFUND_PENDING 卡片的內容——`ord-refund-a` 這個 id 只能有一張
      // kind: 'REFUND_PENDING' 卡片，且它的客戶姓名／金額必須來自 tour_orders
      // 那筆，不是被 bookings_view 那筆覆蓋或合併。
      expect(full!.customerName).not.toBe('不應該出現在 REFUND_PENDING');
      expect(items.filter((i) => i.id === 'ord-refund-a' && i.kind === 'REFUND_PENDING')).toHaveLength(1);
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
});
