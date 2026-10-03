/**
 * #747：店家首頁方案的預約／申請入口必須與詳情頁同一套規則（bookingCtaState＋同一個團次視窗）。
 * 修復前首頁只看 salesMode，客滿、人數不足、團次未載入的方案仍顯示可點入口。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { departs_on?: string; start_time?: string | null; capacity: number; seats_booked: number };
type PlanFx = { mode: 'FIXED_DEPARTURE' | 'REQUEST' | 'INSTANT'; min: number; rows: Row[]; fail?: boolean };

const fx = vi.hoisted(() => ({ plans: {} as Record<string, PlanFx>, tripRows: [] as Array<Record<string, unknown>> }));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let single = false;
      let range: [number, number] | null = null;
      const run = async () => {
        if (table === 'tenants') {
          return { data: { id: 'tenant-1', shop_code: 'demo', name: 'Demo', business_type: null, tenant_settings: null }, error: null };
        }
        if (table === 'trips') {
          const row = { id: 'trip-1', slug: 'hike', title: 'Hike', summary: '', location: '', cover_image_url: null, duration_hours: 2, refund_policy_type: 'STANDARD', status: 'PUBLISHED', tenant_id: 'tenant-1' };
          return { data: single ? row : [row], error: null };
        }
        if (table === 'trip_plans') {
          const all = Object.entries(fx.plans).map(([id, p]) => ({
            id, trip_id: 'trip-1', name: id, description: '', price_per_person: 100, price_type: 'PER_PERSON',
            min_party: p.min, max_party: 8, sales_mode: p.mode,
          }));
          const [a, b] = range ?? [0, all.length];
          return { data: all.slice(a, b + 1), error: null };
        }
        if (table === 'trip_departures' && filters.plan_id) {
          const p = fx.plans[filters.plan_id as string];
          if (p.fail) return { data: null, error: { message: 'boom' } };
          const [a, b] = range ?? [0, p.rows.length];
          return { data: p.rows.slice(a, b + 1).map((r, i) => ({ id: `d-${a + i}`, departs_on: '2098-01-01', start_time: null, ...r })), error: null };
        }
        if (table === 'trip_departures') return { data: fx.tripRows, error: null };
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain, in: () => chain, gte: () => chain, order: () => chain,
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
import { bookingCtaState } from '@/lib/public-trip-client-state';

const ok = (n: number): Row => ({ capacity: 10, seats_booked: 10 - n });
const full: Row = { capacity: 5, seats_booked: 5 };

async function homeCta() {
  const data = await loadPublicShop('demo');
  return Object.fromEntries(data!.trips[0].plans.map((p) => [p.id, p.bookingCta]));
}

describe('#747 首頁方案入口與詳情頁一致', () => {
  beforeEach(() => { fx.plans = {}; fx.tripRows = []; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('FIXED 有可訂團次 → fixed；REQUEST 有可訂團次 → request', async () => {
    fx.plans = { f: { mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(3)] }, r: { mode: 'REQUEST', min: 2, rows: [ok(3)] } };
    expect(await homeCta()).toEqual({ f: 'fixed', r: 'request' });
  });

  it('全部客滿或 seatsLeft < minParty → unavailable（無入口）', async () => {
    fx.plans = {
      f1: { mode: 'FIXED_DEPARTURE', min: 1, rows: [full] },
      f2: { mode: 'FIXED_DEPARTURE', min: 4, rows: [ok(3)] },
      r1: { mode: 'REQUEST', min: 1, rows: [full] },
      r2: { mode: 'REQUEST', min: 4, rows: [ok(3)] },
      f0: { mode: 'FIXED_DEPARTURE', min: 1, rows: [] },
    };
    expect(await homeCta()).toEqual({
      f1: 'fixed-unavailable', f2: 'fixed-unavailable', r1: 'request-unavailable', r2: 'request-unavailable', f0: 'fixed-unavailable',
    });
  });

  it('團次載入失敗 → dates-not-loaded，不丟錯、不開入口', async () => {
    fx.plans = { f: { mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(3)], fail: true }, r: { mode: 'REQUEST', min: 1, rows: [ok(3)], fail: true } };
    expect(await homeCta()).toEqual({ f: 'dates-not-loaded', r: 'dates-not-loaded' });
  });

  it('超過方案數上限（30）的方案 → dates-not-loaded', async () => {
    fx.plans = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`p${String(i).padStart(2, '0')}`, { mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] } as PlanFx]));
    const cta = await homeCta();
    expect(cta.p29).toBe('fixed');
    expect(cta.p30).toBe('dates-not-loaded');
  });

  it('INSTANT → none', async () => {
    fx.plans = { i: { mode: 'INSTANT', min: 1, rows: [ok(3)] } };
    expect(await homeCta()).toEqual({ i: 'none' });
  });

  it('同一組 fixture：首頁決定 === 詳情頁 bookingCtaState', async () => {
    fx.plans = {
      f: { mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(3)] },
      f2: { mode: 'FIXED_DEPARTURE', min: 4, rows: [ok(3), full] },
      r: { mode: 'REQUEST', min: 1, rows: [full] },
      r2: { mode: 'REQUEST', min: 2, rows: [ok(2)] },
      i: { mode: 'INSTANT', min: 1, rows: [] },
    };
    const home = await homeCta();
    const detail = await loadPublicTripDetails('demo', 'hike');
    expect(detail).not.toBeNull();
    for (const plan of detail!.trip.plans) {
      expect(home[plan.id], plan.id).toBe(bookingCtaState(plan));
    }
  });

  describe('今天已開始的團次（店家時區）', () => {
    // 2098-01-01T02:00Z = 台北 10:00
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2098-01-01T02:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });
    const trow = (id: string, start: string) => ({ id, trip_id: 'trip-1', departs_on: '2098-01-01', start_time: start, capacity: 10, seats_booked: 0 });

    it('已過開始時間的今天團次：不列出、也不算入 CTA；稍晚的今天團次照列', async () => {
      fx.tripRows = [trow('past', '09:00:00'), trow('later', '15:00:00')];
      fx.plans = {
        p1: { mode: 'FIXED_DEPARTURE', min: 1, rows: [{ departs_on: '2098-01-01', start_time: '09:00:00', capacity: 5, seats_booked: 0 }] },
        p2: { mode: 'FIXED_DEPARTURE', min: 1, rows: [{ departs_on: '2098-01-01', start_time: '15:00:00', capacity: 5, seats_booked: 0 }] },
      };
      const data = await loadPublicShop('demo');
      const listed = data!.trips[0].departures.map((d) => d.id);
      expect(listed).toEqual(['later']);
      const cta = Object.fromEntries(data!.trips[0].plans.map((p) => [p.id, p.bookingCta]));
      expect(cta).toEqual({ p1: 'fixed-unavailable', p2: 'fixed' });
    });
  });

  it('提示文案用首頁專屬 key，不沿用詳情頁「本頁列出的日期」字串', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/s/[shopCode]/page.tsx'), 'utf8');
    const i18n = readFileSync(resolve(process.cwd(), 'src/i18n/zh-TW/pages/public-shop.ts'), 'utf8');
    for (const key of ['noRequestableHint', 'noBookableHint', 'datesNotLoadedHint']) {
      expect(page).toContain(`t.trips.${key}`);
      expect(i18n).toContain(`${key}:`);
    }
    expect(page).not.toContain('public-trip-details');
    expect(page).not.toMatch(/departures\.(noRequestable|noBookable|notLoaded)/);
    expect(i18n).not.toContain('本頁列出的日期');
  });

  it('頁面只依 bookingCta 顯示入口，不再只看 salesMode', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/s/[shopCode]/page.tsx'), 'utf8');
    expect(page).toContain("plan.bookingCta === 'request'");
    expect(page).toContain("plan.bookingCta === 'fixed'");
    expect(page).not.toMatch(/plan\.salesMode === '(REQUEST|FIXED_DEPARTURE)'/);
  });
});
