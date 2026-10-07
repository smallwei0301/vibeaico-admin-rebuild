import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildGuideActionInboxFormationHref,
  buildGuideActionInboxFormationItem,
  getGuideActionInboxNotStartedDepartureFilter,
  resolveGuideInboxDepartureFocus,
} from '@/lib/guide-action-inbox';

/*
 * #43 成團待決策／今日明日團次：以「真的套用過濾鏈」的 PostgREST fake 呼叫真正的
 * route handler。fake 的 `.or()` 只實作 getGuideActionInboxNotStartedDepartureFilter()
 * 產生的那一種字串（今天之後，或今天且 start_time 較晚／為空），其餘過濾與
 * guide-action-inbox.43.test.ts 的 harness 同一種語意。
 */
type FakeRow = Record<string, unknown>;
type Call = [string, unknown[]];

const NOW = new Date('2026-10-07T04:00:00.000Z'); // 12:00 Asia/Taipei
const TENANT_ID = 'tenant-a';

function applyOr(rows: FakeRow[], filter: string): FakeRow[] {
  const today = /departs_on\.gt\.([\d-]+)/.exec(filter)![1];
  const time = /start_time\.gt\.([\d:]+)/.exec(filter)![1];
  return rows.filter((r) => {
    const d = String(r.departs_on);
    const st = r.start_time as string | null | undefined;
    return d > today || (d === today && (st == null || st > time));
  });
}

function applyCalls(rows: FakeRow[], calls: Call[]): FakeRow[] {
  let out = rows;
  for (const [m, a] of calls) {
    const f = a[0] as string;
    if (m === 'eq') out = out.filter((r) => r[f] === a[1]);
    else if (m === 'neq') out = out.filter((r) => r[f] !== a[1]);
    else if (m === 'gt') out = out.filter((r) => String(r[f]) > String(a[1]));
    else if (m === 'gte') out = out.filter((r) => String(r[f]) >= String(a[1]));
    else if (m === 'lte') out = out.filter((r) => String(r[f]) <= String(a[1]));
    else if (m === 'in') out = out.filter((r) => (a[1] as unknown[]).includes(r[f]));
    else if (m === 'not') {
      const excluded = String(a[2]).replace(/[()]/g, '').split(',');
      out = out.filter((r) => !excluded.includes(String(r[a[0] as string])));
    } else if (m === 'or') out = applyOr(out, a[0] as string);
    else if (m === 'limit') out = out.slice(0, a[0] as number);
  }
  return out;
}

const queries: Array<{ table: string; calls: Call[] }> = [];

function makeFake(tables: Record<string, FakeRow[]>) {
  return {
    from(table: string) {
      const calls: Call[] = [];
      queries.push({ table, calls });
      const b: any = {};
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not', 'or', 'order', 'limit']) {
        b[m] = (...a: unknown[]) => { calls.push([m, a]); return b; };
      }
      b.maybeSingle = async () => ({
        data: table === 'tenant_settings' ? { basic: { timezone: 'Asia/Taipei' } } : null,
        error: null,
      });
      b.then = (resolveFn: (v: unknown) => unknown, rejectFn?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ? applyCalls(tables[table], calls) : [], error: null })
          .then(resolveFn, rejectFn);
      return b;
    },
  };
}

const requireTenantMock = vi.fn();
vi.mock('@/server/tenant', () => ({
  requireTenant: (...a: unknown[]) => requireTenantMock(...a),
}));
import { GET } from '@/app/api/guide/action-inbox/route';

function dep(id: string, over: FakeRow): FakeRow {
  return {
    id, tenant_id: TENANT_ID, trip_id: `trip-${id}`, plan_id: 'plan-1',
    departs_on: '2026-10-07', start_time: '15:00:00', status: 'OPEN',
    capacity: 10, seats_booked: 2, formation_status: 'COLLECTING',
    formation_deadline_at: null, min_to_depart_snapshot: 4, formed_participants: null,
    created_at: '2026-10-01T00:00:00.000Z',
    trips: { title: `行程-${id}` }, trip_plans: { name: '方案' },
    trip_departure_staff: [{ staff_id: 's1', role: 'PRIMARY', staff: { name: '導遊' } }],
    ...over,
  };
}

const ROWS: FakeRow[] = [
  dep('rr-today', { formation_status: 'REVIEW_REQUIRED', formation_deadline_at: '2026-10-07T08:00:00.000Z' }),
  dep('ar-tomorrow', { formation_status: 'AT_RISK', departs_on: '2026-10-08', start_time: '09:00:00', formed_participants: 5 }),
  dep('rr-started', { formation_status: 'REVIEW_REQUIRED', start_time: '09:00:00' }),
  dep('rr-cancelled', { formation_status: 'REVIEW_REQUIRED', status: 'CANCELLED' }),
  dep('rr-other', { formation_status: 'REVIEW_REQUIRED', tenant_id: 'tenant-b' }),
  dep('soon-today', { start_time: '18:00:00' }),
  dep('soon-tomorrow', { departs_on: '2026-10-08', start_time: '10:00:00' }),
  dep('soon-started', { start_time: '08:00:00' }),
  dep('soon-later', { departs_on: '2026-10-09' }),
  dep('ar-today', { formation_status: 'AT_RISK', start_time: '16:00:00' }),
];

async function load(rows: FakeRow[] = ROWS) {
  requireTenantMock.mockResolvedValue({
    supabase: makeFake({ trip_departures: rows }), tenantId: TENANT_ID, user: { id: 'u' }, role: 'OWNER',
  });
  const res = await GET(new Request('https://app.test/api/guide/action-inbox'), {});
  expect(res.status).toBe(200);
  return (await res.json()).data as Array<Record<string, any>>;
}

describe('收件匣：成團待決策與今日／明日團次 (#43)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    queries.length = 0;
    requireTenantMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('REVIEW_REQUIRED／AT_RISK 出卡，排除已取消、已出發與他租戶', async () => {
    const items = await load();
    const formation = items.filter((i) => i.kind === 'REVIEW_REQUIRED' || i.kind === 'AT_RISK');
    expect(formation.map((i) => i.id).sort()).toEqual(['ar-today', 'ar-tomorrow', 'rr-today']);
  });

  it('分區：截止／出發時刻決定 TODAY 或 UPCOMING，AT_RISK 用出發時刻', async () => {
    const items = await load();
    const get = (id: string) => items.find((i) => i.id === id && i.kind !== 'DEPARTURE')!;
    expect(get('rr-today')).toMatchObject({ kind: 'REVIEW_REQUIRED', priority: 'TODAY', dueAt: '2026-10-07T08:00:00.000Z' });
    expect(get('ar-today').priority).toBe('TODAY');
    expect(get('ar-tomorrow').priority).toBe('UPCOMING');
  });

  it('deep link 帶團次 id 並開團次分頁', async () => {
    const items = await load();
    expect(items.find((i) => i.id === 'rr-today')!.href)
      .toBe('/tenant/trips/trip-rr-today?tab=departures&departureId=rr-today');
    expect(buildGuideActionInboxFormationHref('t 1', 'a&b')).toBe('/tenant/trips/t 1?tab=departures&departureId=a%26b');
  });

  it('今日／明日團次：今天放 TODAY、明天放 UPCOMING，已出發與後天排除，並顯示目前人數', async () => {
    const items = await load();
    const dep = items.filter((i) => i.kind === 'DEPARTURE');
    expect(dep.map((i) => i.id).sort()).toEqual(['soon-today', 'soon-tomorrow']);
    expect(dep.find((i) => i.id === 'soon-today')).toMatchObject({ departureDay: 'TODAY', priority: 'TODAY', seatsBooked: 2, capacity: 10 });
    expect(dep.find((i) => i.id === 'soon-tomorrow')).toMatchObject({ departureDay: 'TOMORROW', priority: 'UPCOMING' });
  });

  it('同一個團次只出一張卡（formation 優先於 DEPARTURE）', async () => {
    const items = await load();
    for (const id of ['rr-today', 'ar-today', 'ar-tomorrow']) {
      expect(items.filter((i) => i.id === id)).toHaveLength(1);
    }
  });

  it('團次查詢一律帶 tenant_id、未出發過濾與有界 limit', async () => {
    await load();
    const notStarted = getGuideActionInboxNotStartedDepartureFilter(NOW, 'Asia/Taipei');
    const targets = queries.filter((q) => q.table === 'trip_departures'
      && q.calls.some(([m, a]) => m === 'or' && a[0] === notStarted));
    expect(targets).toHaveLength(2); // DEPARTURE 與 formation 兩個查詢
    for (const q of targets) {
      expect(q.calls).toContainEqual(['eq', ['tenant_id', TENANT_ID]]);
      const limit = q.calls.find(([m]) => m === 'limit');
      expect(limit && (limit[1][0] as number)).toBeLessThanOrEqual(20);
    }
  });

  it('截斷防護：超過 20 筆時最多回傳 20 張 formation 卡', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      dep(`rr-${i}`, { formation_status: 'REVIEW_REQUIRED', departs_on: '2026-10-20' }));
    const items = await load(many);
    expect(items.filter((i) => i.kind === 'REVIEW_REQUIRED').length).toBeLessThanOrEqual(20);
  });
});

describe('團次頁 deep link 解析', () => {
  it('只在團次存在時定位', () => {
    const deps = [{ id: 'a' }, { id: 'b' }];
    expect(resolveGuideInboxDepartureFocus('b', deps)).toBe('b');
    expect(resolveGuideInboxDepartureFocus('zzz', deps)).toBeNull();
    expect(resolveGuideInboxDepartureFocus(null, deps)).toBeNull();
    expect(resolveGuideInboxDepartureFocus('', deps)).toBeNull();
  });

  it('builder 的 href 與 helper 一致', () => {
    const item = buildGuideActionInboxFormationItem({
      id: 'd1', tripId: 't1', tripName: 'x', planName: 'p', departureDate: '2026-10-08', startTime: '09:00',
      capacity: 8, seatsBooked: 1, minToDepart: 4, formationStatus: 'AT_RISK',
      formationDeadlineAt: null, formedParticipants: 4, createdAt: '2026-10-01T00:00:00.000Z',
    }, NOW);
    expect(item.href).toBe(buildGuideActionInboxFormationHref('t1', 'd1'));
  });

  it('團次頁實際使用解析函式（非死碼）', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/tenant/trips/[id]/page.tsx'), 'utf8');
    expect(src).toContain('resolveGuideInboxDepartureFocus(inboxDepartureParam, departures)');
    expect(src).toContain('rowId={(d) => `departure-row-${d.id}`}');
  });
});
