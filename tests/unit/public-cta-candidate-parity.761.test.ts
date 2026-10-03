/**
 * #761：詳情頁、店家首頁的入口（bookingCtaState）與預約／申請頁必須用同一套候選規則。
 * 修復前入口只看詳情頁的前 6 筆可售團次；前 6 筆剩餘名額都 < minParty、第 7 筆才夠時，
 * 詳情頁／首頁顯示「沒有可預約日期」，預約頁卻能預約。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id?: string; capacity: number; seats_booked: number };
type PlanFx = { trip?: string; sort?: number; mode: 'FIXED_DEPARTURE' | 'REQUEST' | 'INSTANT'; min: number; rows: Row[] };

const fx = vi.hoisted(() => ({ plans: {} as Record<string, PlanFx> }));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let single = false;
      let range: [number, number] | null = null;
      const orders: string[] = [];
      const run = async () => {
        if (table === 'tenants') {
          return { data: { id: 'tenant-1', shop_code: 'demo', name: 'Demo', business_type: null, tenant_settings: null }, error: null };
        }
        if (table === 'trips') {
          const row = { id: 'trip-1', slug: 'trip-1', title: 'trip-1', summary: '', location: '', cover_image_url: null, duration_hours: 2, refund_policy_type: 'STANDARD', status: 'PUBLISHED', tenant_id: 'tenant-1', active: true };
          return { data: single ? row : [row], error: null };
        }
        if (table === 'trip_plans') {
          let all = Object.entries(fx.plans).map(([id, p]) => ({
            id, trip_id: 'trip-1', sort_order: p.sort ?? 0, name: id, description: '', price_per_person: 100, price_type: 'PER_PERSON',
            min_party: p.min, max_party: 8, sales_mode: p.mode, active: true, request_hold_hours: 12,
          }));
          if (filters.id) all = all.filter((r) => r.id === filters.id);
          all = all.map((r, i) => ({ r, i })).sort((x, y) => {
            for (const col of orders) {
              const xv = (x.r as Record<string, unknown>)[col] as string | number;
              const yv = (y.r as Record<string, unknown>)[col] as string | number;
              if (xv < yv) return -1;
              if (xv > yv) return 1;
            }
            return x.i - y.i;
          }).map((e) => e.r);
          if (single) return { data: all[0] ?? null, error: null };
          const [a, b] = range ?? [0, all.length];
          return { data: all.slice(a, b + 1), error: null };
        }
        if (table === 'trip_departures' && filters.plan_id) {
          const p = fx.plans[filters.plan_id as string];
          // 模擬 DB：只依呼叫端實際下的 order() 欄位排序（沒下 id 排序時同日同時間保持插入順序）。
          const all = p.rows.map((r, i) => ({ id: `d-${String(i).padStart(3, '0')}`, departs_on: '2098-01-01', start_time: null, ...r }))
            .map((r, i) => ({ r, i })).sort((x, y) => {
              for (const col of orders) {
                if (col !== 'id') continue;
                if (x.r.id < y.r.id) return -1;
                if (x.r.id > y.r.id) return 1;
              }
              return x.i - y.i;
            }).map((e) => e.r);
          const [a, b] = range ?? [0, all.length];
          return { data: all.slice(a, b + 1), error: null };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain, in: () => chain, gte: () => chain, order: (col: string) => { orders.push(col); return chain; },
        range: (a: number, b: number) => { range = [a, b]; return chain; },
        eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
        maybeSingle: () => { single = true; return run(); },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));
import { loadPublicShop, loadPublicTripDetails } from '@/server/public-shop';
import { loadPublicBookingPlan } from '@/server/public-tour-booking';
import { loadPublicRequestPlan } from '@/server/public-tour-request';
import { bookingCtaState } from '@/lib/public-trip-client-state';
import { hasBookableCandidate, MAX_BOOKING_CANDIDATE_DEPARTURES } from '@/lib/public-departure-candidates';

const PLAN = '11111111-1111-4111-8111-111111111111';
const left = (n: number): Row => ({ capacity: 10, seats_booked: 10 - n });
const full: Row = { capacity: 5, seats_booked: 5 };
const times = (n: number, row: Row): Row[] => Array.from({ length: n }, () => row);

async function surfaces(mode: 'FIXED_DEPARTURE' | 'REQUEST', min: number, rows: Row[]) {
  fx.plans = { [PLAN]: { mode, min, rows } };
  const home = (await loadPublicShop('demo'))!.trips[0].plans[0].bookingCta;
  const detailPlan = (await loadPublicTripDetails('demo', 'trip-1'))!.trip.plans[0];
  const detail = bookingCtaState(detailPlan);
  const page = mode === 'FIXED_DEPARTURE'
    ? await loadPublicBookingPlan('demo', PLAN, { withSeasonPrices: false })
    : await loadPublicRequestPlan('demo', PLAN, { withSeasonPrices: false });
  const pageHasBookable = page!.departures.some((d) => d.seatsLeft >= page!.minParty);
  return { home, detail, pageHasBookable, pageCount: page!.departures.length, detailPlan };
}

describe('#761 入口與預約／申請頁同一套候選規則', () => {
  beforeEach(() => { fx.plans = {}; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  for (const [mode, yes, no] of [
    ['FIXED_DEPARTURE', 'fixed', 'fixed-unavailable'],
    ['REQUEST', 'request', 'request-unavailable'],
  ] as const) {
    describe(mode, () => {
      it('(a) 前 6 筆剩餘名額 < minParty、第 7 筆足夠：詳情頁與首頁有入口，且第 7 筆在預約／申請頁候選內', async () => {
        const r = await surfaces(mode, 3, [...times(6, left(1)), left(5)]);
        expect(r.detail).toBe(yes);
        expect(r.home).toBe(yes);
        expect(r.pageHasBookable).toBe(true);
        expect(r.detailPlan.departures).toHaveLength(6); // 列出視窗不變
      });

      it('(b) 足夠的團次只在預約頁 12 筆候選之外：不顯示入口（沒有假入口）', async () => {
        const r = await surfaces(mode, 3, [...times(MAX_BOOKING_CANDIDATE_DEPARTURES, left(1)), left(5)]);
        expect(r.pageCount).toBe(MAX_BOOKING_CANDIDATE_DEPARTURES);
        expect(r.pageHasBookable).toBe(false);
        expect(r.detail).toBe(no);
        expect(r.home).toBe(no);
      });

      it('(b2) 邊界：第 12 筆候選足夠 → 有入口；客滿列不占 12 筆候選', async () => {
        const r1 = await surfaces(mode, 3, [...times(11, left(1)), left(5)]);
        expect([r1.detail, r1.home, r1.pageHasBookable]).toEqual([yes, yes, true]);
        const r2 = await surfaces(mode, 3, [...times(4, full), ...times(5, left(1)), ...times(3, full), ...times(6, left(1)), left(5)]);
        expect([r2.detail, r2.home, r2.pageHasBookable]).toEqual([yes, yes, true]);
        const r3 = await surfaces(mode, 3, [...times(4, full), ...times(12, left(1)), ...times(3, full), left(5)]);
        expect([r3.detail, r3.home, r3.pageHasBookable]).toEqual([no, no, false]);
      });

      it('(c) 全部剩餘名額不足 → unavailable', async () => {
        const r = await surfaces(mode, 3, times(9, left(2)));
        expect([r.detail, r.home, r.pageHasBookable]).toEqual([no, no, false]);
      });
    });
  }
});

describe('#761 同日同時間的候選以 id 作 tie-break（候選集合各處一致）', () => {
  beforeEach(() => { fx.plans = {}; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  const idRow = (id: string, n: number): Row => ({ id, ...left(n) });
  // 13 筆同日同時間、以非 id 順序插入；足夠名額的那筆插在最前面。
  const insufficient = Array.from({ length: 12 }, (_, i) => `b-${String(i).padStart(2, '0')}`);

  for (const mode of ['FIXED_DEPARTURE', 'REQUEST'] as const) {
    it(`${mode}：足夠者依 id 排第 13 → 預約／申請頁候選 = 前 12 個 id，入口一致為無`, async () => {
      const rows = [idRow('z-enough', 5), ...[...insufficient].reverse().map((id) => idRow(id, 1))];
      fx.plans = { [PLAN]: { mode, min: 3, rows } };
      const page = mode === 'FIXED_DEPARTURE'
        ? await loadPublicBookingPlan('demo', PLAN, { withSeasonPrices: false })
        : await loadPublicRequestPlan('demo', PLAN, { withSeasonPrices: false });
      expect(page!.departures.map((d) => d.id)).toEqual(insufficient);
      const home = (await loadPublicShop('demo'))!.trips[0].plans[0].bookingCta;
      const detail = bookingCtaState((await loadPublicTripDetails('demo', 'trip-1'))!.trip.plans[0]);
      expect([home, detail]).toEqual(Array(2).fill(mode === 'FIXED_DEPARTURE' ? 'fixed-unavailable' : 'request-unavailable'));
    });

    it(`${mode}：足夠者依 id 排第 12 → 入口與頁面都可訂`, async () => {
      const rows = [...[...insufficient].reverse().slice(1).map((id) => idRow(id, 1)), idRow('b-11', 5)].reverse();
      fx.plans = { [PLAN]: { mode, min: 3, rows: [idRow('z-extra', 1), ...rows] } };
      const page = mode === 'FIXED_DEPARTURE'
        ? await loadPublicBookingPlan('demo', PLAN, { withSeasonPrices: false })
        : await loadPublicRequestPlan('demo', PLAN, { withSeasonPrices: false });
      expect(page!.departures.map((d) => d.id)).toEqual(insufficient);
      expect(page!.departures.some((d) => d.seatsLeft >= page!.minParty)).toBe(true);
      const home = (await loadPublicShop('demo'))!.trips[0].plans[0].bookingCta;
      const detail = bookingCtaState((await loadPublicTripDetails('demo', 'trip-1'))!.trip.plans[0]);
      expect([home, detail]).toEqual(Array(2).fill(mode === 'FIXED_DEPARTURE' ? 'fixed' : 'request'));
    });
  }
});

describe('#761 6 筆視窗之後跨頁續掃（每頁 120 列、上限 600 列）', () => {
  beforeEach(() => { fx.plans = {}; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  async function all(mode: 'FIXED_DEPARTURE' | 'REQUEST', min: number, rows: Row[]) {
    const r = await surfaces(mode, min, rows);
    return r;
  }

  for (const [mode, yes, no] of [
    ['FIXED_DEPARTURE', 'fixed', 'fixed-unavailable'],
    ['REQUEST', 'request', 'request-unavailable'],
  ] as const) {
    it(`${mode}(a) 6 筆不足 + 200 筆客滿 + 1 筆足夠：入口開啟、預約頁含該筆；旗標 mayBeTruncated／soldOutOmitted 為真`, async () => {
      const r = await all(mode, 2, [...times(6, left(1)), ...times(200, full), left(5)]);
      expect([r.detail, r.home, r.pageHasBookable]).toEqual([yes, yes, true]);
      expect(r.detailPlan.departures).toHaveLength(6);
      expect(r.detailPlan.departuresMayBeTruncated).toBe(true);
      expect(r.detailPlan.soldOutOmitted).toBe(true);
    });

    it(`${mode}(b) 足夠者在 600 列掃描上限之後：保守不開入口（沒有假入口）`, async () => {
      const r = await all(mode, 2, [...times(6, left(1)), ...times(700, full), left(5)]);
      expect(r.detail).toBe(no);
      expect(r.home).toBe(no);
    });

    it(`${mode}(c) 6 筆之後只有客滿：soldOutOmitted 真、mayBeTruncated 假、入口關閉`, async () => {
      const r = await all(mode, 2, [...times(6, left(1)), ...times(20, full)]);
      expect([r.detail, r.home]).toEqual([no, no]);
      expect(r.detailPlan.soldOutOmitted).toBe(true);
      expect(r.detailPlan.departuresMayBeTruncated).toBe(false);
    });
  }
});

describe('#761 共用 predicate', () => {
  it('只有前 12 個候選算數；minParty 缺值視為 1', () => {
    expect(hasBookableCandidate([...Array(12).fill(1), 9], 3)).toBe(false);
    expect(hasBookableCandidate([1, 1, 4], 3)).toBe(true);
    expect(hasBookableCandidate([1], undefined)).toBe(true);
    expect(hasBookableCandidate([], 1)).toBe(false);
  });
});

describe('#760 item 5：INSTANT 方案排在前面不占首頁 30 個方案額度', () => {
  beforeEach(() => { fx.plans = {}; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('5 個 INSTANT（sort 0）在 31 個 FIXED（sort 1）前：首頁與詳情頁同為前 30 個 FIXED 載入、第 31 個未載入', async () => {
    const plans: Record<string, PlanFx> = {};
    for (let i = 0; i < 5; i += 1) plans[`i${i}`] = { sort: 0, mode: 'INSTANT', min: 1, rows: [left(3)] };
    for (let i = 0; i < 31; i += 1) plans[`f${String(i).padStart(2, '0')}`] = { sort: 1, mode: 'FIXED_DEPARTURE', min: 1, rows: [left(3)] };
    fx.plans = plans;
    const home = Object.fromEntries((await loadPublicShop('demo'))!.trips[0].plans.map((p) => [p.id, p.bookingCta]));
    const detail = Object.fromEntries((await loadPublicTripDetails('demo', 'trip-1'))!.trip.plans.map((p) => [p.id, bookingCtaState(p)]));
    for (let i = 0; i < 5; i += 1) expect(home[`i${i}`]).toBe('none');
    for (let i = 0; i < 30; i += 1) expect(home[`f${String(i).padStart(2, '0')}`], `f${i}`).toBe('fixed');
    expect(home.f30).toBe('dates-not-loaded');
    expect(home).toEqual(detail);
  });
});
