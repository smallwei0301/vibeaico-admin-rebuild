/**
 * #1026：LINE「團次」指令（replyDepartures）與 AI 目錄共用同一套「公開頁可預約」規則（selectBookableDepartures），
 * 閘門只看 TOUR_MODULE（與 replyTrips 一致，不限 GUIDE）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  bookingPlansById: {} as Record<string, unknown>,
  tourActive: true,
  lineReplies: [] as Array<{ text: string }[]>,
}));

vi.mock('@/server/public-tour-booking', async (importActual) => ({
  ...(await importActual<typeof import('@/server/public-tour-booking')>()),
  loadPublicBookingPlan: async (_shop: string, planId: string) => fx.bookingPlansById[planId] ?? null,
}));
vi.mock('@/server/features', () => ({
  isFeatureActive: async () => fx.tourActive,
  featureActiveStatus: async () => (fx.tourActive ? 'active' : 'inactive'),
}));
vi.mock('@/server/line', () => ({
  lineReply: async (_t: string, _r: string, msgs: Array<{ text: string }>) => { fx.lineReplies.push(msgs); },
  lineProfile: async () => null,
}));

import { replyDepartures } from '@/server/line-events';
import { selectBookableDepartures, BEYOND_CANDIDATES_MARK, type ListableDeparturesResult } from '@/server/line-catalog';
import { resolvePublicTimeZone, tenantNowParts } from '@/lib/public-time-zone';

const today = tenantNowParts(resolvePublicTimeZone('Asia/Taipei'), Date.now()).today;
const dayFromNow = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const FUTURE = dayFromNow(4);

type Plan = Record<string, unknown>;
const plan = (id: string, over: Plan = {}): Plan => ({
  id, name: `方案${id}`, sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 1, price_per_person: 1000, price_type: 'PER_PERSON', ...over,
});
const dep = (id: string, planId: string | null, over: Record<string, unknown> = {}) => ({
  id, trip_id: 'tr', plan_id: planId, departs_on: FUTURE, start_time: null, capacity: 5, seats_booked: 1, ...over,
});
const bookingPlan = (departureId: string, seatsLeft = 4, minParty = 1) => ({
  tenantId: 't', shopName: 's', tripId: 'tr', tripTitle: 'T', planId: 'p', planName: 'P',
  planDescription: '', pricePerPerson: 100, priceType: 'PER_PERSON', minParty, maxParty: 8, refundPolicyType: 'STANDARD',
  departures: [{ id: departureId, departsOn: FUTURE, startTime: '', seatsLeft }],
});

function makeAdmin(deps: any[], plans: Plan[], opts: { seasonsError?: boolean; seasons?: unknown[]; neqLog?: Array<[string, unknown]>; limitLog?: number[] } = {}) {
  const build = (table: string) => {
    let noPlan = false;
    let limit = 1000;
    const neqs: Array<[string, unknown]> = [];
    const q: any = {
      select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q,
      neq: (k: string, v: unknown) => { neqs.push([k, v]); opts.neqLog?.push([k, v]); return q; },
      limit: (n: number) => { limit = n; opts.limitLog?.push(n); return q; }, order: () => q, range: () => q,
      is: () => { noPlan = true; return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: any) => {
        if (table === 'trips') return resolve({ data: [{ id: 'tr', title: '行程' }], error: null });
        if (table === 'trip_plans') return resolve({ data: plans, error: null });
        if (table === 'trip_plan_seasons') return resolve(opts.seasonsError ? { data: null, error: { message: 'boom' } } : { data: opts.seasons ?? [], error: null });
        if (table === 'trip_departures') {
          const data = noPlan
            ? deps.filter((d) => d.plan_id == null)
            : deps.filter((d) => d.plan_id != null).map((d) => ({ ...d, trip_plans: plans.find((p) => p.id === d.plan_id) ?? null })).filter((d) => d.trip_plans)
              .filter((d) => neqs.every(([k, v]) => k !== 'trip_plans.sales_mode' || d.trip_plans.sales_mode !== v));
          return resolve({ data: data.slice(0, limit), error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { from: (t: string) => build(t) };
}

const run = async (admin: unknown, businessType = 'GUIDE') => {
  fx.lineReplies.length = 0;
  const handled = await replyDepartures({
    admin, token: 'k', replyToken: 'r', userId: 'u', lineConfig: {},
    tenant: { id: 'ten', shop_code: 'demo', name: 'D', business_type: businessType },
  } as any);
  return { handled, text: fx.lineReplies[0]?.[0]?.text ?? '' };
};
const linesOf = (text: string) => text.split('\n').filter((l) => l.startsWith('・'));

beforeEach(() => { fx.tourActive = true; fx.bookingPlansById = {}; fx.lineReplies.length = 0; });

describe('replyDepartures：公開頁可預約規則', () => {
  it('INSTANT 方案的團次不列（只剩 INSTANT → 沒有團次回覆）', async () => {
    const r = await run(makeAdmin([dep('d1', 'pi')], [plan('pi', { sales_mode: 'INSTANT' })]));
    expect(r.handled).toBe(true);
    expect(linesOf(r.text)).toHaveLength(0);
    expect(r.text).toContain('目前沒有');
  });

  it('plan_id 為 null 的團次不列', async () => {
    const r = await run(makeAdmin([dep('d1', null), dep('d2', 'pf')], [plan('pf')]));
    expect(linesOf(r.text)).toHaveLength(1);
    expect(r.text).toContain('方案pf');
  });

  it('今天已開始的團次不列；今天 start_time 為 null 與明天照列', async () => {
    const r = await run(makeAdmin([
      dep('started', 'pf', { departs_on: today, start_time: '00:00:00' }),
      dep('nulltime', 'pf', { departs_on: today, start_time: null }),
      dep('tomorrow', 'pf', { departs_on: dayFromNow(1), start_time: '06:00:00' }),
    ], [plan('pf')]));
    expect(linesOf(r.text)).toHaveLength(2);
    expect(r.text).not.toContain('00:00');
  });

  it('剩餘名額 < min_party（非 REQUEST）：顯示額滿、不給名額、不附直達連結；達 min_party 照列並附連結', async () => {
    fx.bookingPlansById = { pf: { ...bookingPlan('few', 1, 2), departures: [
      { id: 'few', departsOn: FUTURE, startTime: '', seatsLeft: 1 }, { id: 'ok', departsOn: FUTURE, startTime: '', seatsLeft: 2 },
    ] } };
    const r = await run(makeAdmin([
      dep('few', 'pf', { capacity: 5, seats_booked: 4 }),
      dep('ok', 'pf', { capacity: 5, seats_booked: 3 }),
    ], [plan('pf', { min_party: 2 })]));
    const lines = r.text.split('\n');
    const fewLine = lines.find((l) => l.startsWith('・') && l.includes('已額滿'))!;
    expect(fewLine).toBeTruthy();
    expect(fewLine).not.toContain('剩');
    expect(r.text).not.toContain('departure=few');
    expect(r.text).toContain('剩 2 位');
    expect(r.text).toContain('departure=ok');
  });

  it('REQUEST 方案：名額 < min_party 仍照列剩餘名額（不標額滿）', async () => {
    const r = await run(makeAdmin([dep('r1', 'pr', { capacity: 5, seats_booked: 4 })], [plan('pr', { sales_mode: 'REQUEST', min_party: 2 })]));
    expect(r.text).toContain('剩 1 位');
    expect(r.text).not.toContain('已額滿');
  });

  it('季節單價解析不出（季節查詢失敗）：不給名額、加註請聯絡店家、不附直達連結', async () => {
    fx.bookingPlansById = { pf: bookingPlan('d1') };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await run(makeAdmin([dep('d1', 'pf')], [plan('pf')], { seasonsError: true }));
    warn.mockRestore();
    expect(r.handled).toBe(true);
    expect(r.text).toContain(BEYOND_CANDIDATES_MARK);
    expect(r.text).not.toContain('剩');
    expect(r.text).not.toContain('departure=');
  });

  it('季節資料完整且解析得出單價：照列名額並附連結', async () => {
    fx.bookingPlansById = { pf: bookingPlan('d1') };
    const seasons = [{ id: 's', plan_id: 'pf', start_month: 1, start_day: 1, end_month: 12, end_day: 31, price_override: 1500, sort_order: 0 }];
    const r = await run(makeAdmin([dep('d1', 'pf')], [plan('pf')], { seasons }));
    expect(r.text).toContain('剩 4 位');
    expect(r.text).toContain('departure=d1');
  });

  it('非季節方案、預約頁載入失敗（null）：照列名額、不附連結（既有行為）', async () => {
    const r = await run(makeAdmin([dep('d1', 'pf')], [plan('pf')]));
    expect(r.text).toContain('剩 4 位');
    expect(r.text).not.toContain('departure=');
  });
});

describe('selectBookableDepartures：每方案候選上限', () => {
  it('同一方案 14 個未滿團次：前 12 個 NORMAL，其後 CONTACT_SHOP（仍列出）', () => {
    const result: Extract<ListableDeparturesResult, { ok: true }> = {
      ok: true, trips: [{ id: 'tr', title: 'T' }], plans: [plan('pf') as any], tripPlans: [],
      departures: Array.from({ length: 14 }, (_, i) => dep(`d${String(i).padStart(2, '0')}`, 'pf', { departs_on: dayFromNow(1 + i) }) as any),
      truncated: false, now: { today, hm: '08:00' },
    };
    const out = selectBookableDepartures(result);
    expect(out).toHaveLength(14);
    expect(out.slice(0, 12).every((b) => b.display === 'NORMAL')).toBe(true);
    expect(out.slice(12).every((b) => b.display === 'CONTACT_SHOP')).toBe(true);
  });
});

describe('replyDepartures：TOUR_MODULE 閘門（不限業態）', () => {
  it.each(['LOCAL_SHOP', 'CLINIC', 'GUIDE'])('%s 啟用 TOUR_MODULE：回應團次清單', async (bt) => {
    const r = await run(makeAdmin([dep('d1', 'pf')], [plan('pf')]), bt);
    expect(r.handled).toBe(true);
    expect(linesOf(r.text)).toHaveLength(1);
  });

  it.each(['LOCAL_SHOP', 'CLINIC', 'GUIDE'])('%s 未啟用 TOUR_MODULE：不回應（return false、不查詢）', async (bt) => {
    fx.tourActive = false;
    const from = vi.fn(() => { throw new Error('should not query'); });
    const r = await run({ from }, bt);
    expect(r.handled).toBe(false);
    expect(fx.lineReplies).toHaveLength(0);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('replyDepartures：limit 先於過濾的問題（#1026 追加）', () => {
  it('INSTANT 在查詢端排除（neq）：大量 INSTANT 團次不吃掉 limit，可報名團次仍列出', async () => {
    const neqLog: Array<[string, unknown]> = [];
    const instants = Array.from({ length: 12 }, (_, i) => dep(`i${i}`, 'pi', { departs_on: dayFromNow(1) }));
    const r = await run(makeAdmin([...instants, dep('ok', 'pf', { departs_on: dayFromNow(9) })], [plan('pi', { sales_mode: 'INSTANT' }), plan('pf')], { neqLog }));
    expect(neqLog).toContainEqual(['trip_plans.sales_mode', 'INSTANT']);
    expect(linesOf(r.text)).toHaveLength(1);
    expect(r.text).toContain('方案pf');
  });

  it('不查 plan_id null 的團次：它們不佔 limit', async () => {
    const nulls = Array.from({ length: 12 }, (_, i) => dep(`n${i}`, null, { departs_on: dayFromNow(1) }));
    const r = await run(makeAdmin([...nulls, dep('ok', 'pf', { departs_on: dayFromNow(9) })], [plan('pf')]));
    expect(linesOf(r.text)).toHaveLength(1);
  });

  it('最近 10 筆都已開始（被過濾）且被截斷：不回「沒有團次」，改引導看預約頁', async () => {
    const started = Array.from({ length: 10 }, (_, i) => dep(`s${i}`, 'pf', { departs_on: today, start_time: '00:00:00' }));
    const r = await run(makeAdmin([...started, dep('later', 'pf', { departs_on: dayFromNow(9) })], [plan('pf')]));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('近期團次請見預約頁');
    expect(r.text).toContain('/s/demo');
    expect(r.text).not.toContain('目前沒有');
  });

  it('未截斷且過濾後為空：仍回「沒有團次」', async () => {
    const r = await run(makeAdmin([dep('s0', 'pf', { departs_on: today, start_time: '00:00:00' })], [plan('pf')]));
    expect(r.text).toContain('目前沒有');
  });
});
