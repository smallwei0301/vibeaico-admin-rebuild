/**
 * Issue 749 F5：季節價資料無法確認時，預約／申請頁每個團次都沒有 unitPrice、送不出去；
 * 首頁與詳情頁的入口必須用同一規則改為 price-not-loaded（聯絡店家），不再顯示可線上預約。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type PlanFx = { mode: 'FIXED_DEPARTURE' | 'REQUEST' | 'INSTANT'; seasons?: boolean };
const fx = vi.hoisted(() => ({
  plans: {} as Record<string, PlanFx>,
  seasonFail: false,
  seasonThrow: false,
  seasonCalls: [] as Array<string[]>,
  // 非 null 時，季節查詢改回傳這份（已依 plan_id、id 排序）資料並尊重 range，用來模擬分頁上限。
  seasonPaged: null as null | Array<Record<string, unknown>>,
  // 每 30 個方案一個行程（首頁每行程最多判定 30 個方案）；預設 1 個行程。
  tripCount: 1,
  // 季節查詢的 IN 清單含此 plan_id 時，該次查詢回傳錯誤。
  seasonFailForId: null as null | string,
}));
const tripOf = (i: number) => `trip-${Math.floor(i / 30) + 1}`;

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const inFilters: Record<string, unknown[]> = {};
      let single = false;
      let rangeFrom = 0;
      let rangeTo = Number.MAX_SAFE_INTEGER;
      const run = async () => {
        if (table === 'tenants') return { data: { id: 'tenant-1', shop_code: 'demo', name: 'Demo', business_type: null, tenant_settings: null }, error: null };
        if (table === 'trips') {
          const rows = Array.from({ length: fx.tripCount }, (_, n) => ({ id: `trip-${n + 1}`, slug: `trip-${n + 1}`, title: 't', summary: '', location: '', cover_image_url: null, duration_hours: 2, refund_policy_type: 'STANDARD', status: 'PUBLISHED' }));
          return single ? { data: rows[0], error: null } : { data: rows, error: null };
        }
        if (table === 'trip_plans') {
          return { data: Object.entries(fx.plans).map(([id, p], n) => ({
            id, trip_id: tripOf(n), sort_order: 0, name: id, description: '', price_per_person: 100, price_type: 'PER_PERSON',
            min_party: 1, max_party: 8, sales_mode: p.mode,
          })), error: null };
        }
        if (table === 'trip_plan_seasons') {
          fx.seasonCalls.push([...((inFilters.plan_id ?? []) as string[])]);
          if (fx.seasonThrow) throw new Error('boom');
          if (fx.seasonPaged) return { data: fx.seasonPaged.slice(rangeFrom, rangeTo + 1), error: null };
          if (fx.seasonFailForId && inFilters.plan_id?.includes(fx.seasonFailForId)) return { data: null, error: { message: 'boom' } };
          if (fx.seasonFail) return { data: null, error: { message: 'relation missing' } };
          return { data: Object.entries(fx.plans).filter(([, p]) => p.seasons).map(([id]) => ({
            id: `s-${id}`, plan_id: id, start_month: 1, start_day: 1, end_month: 12, end_day: 31, price_override: 200, sort_order: 0,
          })), error: null };
        }
        if (table === 'trip_departures') {
          return { data: [{ id: 'd1', plan_id: Object.keys(fx.plans)[0], trip_id: 'trip-1', departs_on: '2098-01-01', start_time: null, capacity: 10, seats_booked: 0 }]
            .flatMap((r) => Object.keys(fx.plans).map((pid, i) => ({ ...r, id: `d-${i}`, plan_id: pid, trip_id: tripOf(i) }))), error: null };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: (k: string, v: unknown[]) => { inFilters[k] = v; return chain; },
        gte: () => chain, order: () => chain,
        range: (from: number, to: number) => { rangeFrom = from; rangeTo = to; return chain; },
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
import { seasonalPriceUnknown } from '@/server/public-plan-seasons';

const dep = [{ seatsLeft: 5 }];
const base = { minParty: 1, departures: dep };

describe('#749 (a) bookingCtaState 與 seasonalPriceUnknown', () => {
  it('FIXED／REQUEST 季節價未知 → price-not-loaded', () => {
    expect(bookingCtaState({ ...base, salesMode: 'FIXED_DEPARTURE', seasonalPriceUnknown: true })).toBe('price-not-loaded');
    expect(bookingCtaState({ ...base, salesMode: 'REQUEST', seasonalPriceUnknown: true })).toBe('price-not-loaded');
  });
  it('未知旗標為 false／未給 → 行為不變', () => {
    expect(bookingCtaState({ ...base, salesMode: 'FIXED_DEPARTURE' })).toBe('fixed');
    expect(bookingCtaState({ ...base, salesMode: 'REQUEST', seasonalPriceUnknown: false })).toBe('request');
  });
  it('departuresNotLoaded 優先於 price-not-loaded', () => {
    expect(bookingCtaState({ ...base, salesMode: 'FIXED_DEPARTURE', departuresNotLoaded: true, seasonalPriceUnknown: true })).toBe('dates-not-loaded');
  });
  it('其他 salesMode 不受影響；沒有可訂團次也先回 price-not-loaded（無法確認價格比無日期更根本）', () => {
    expect(bookingCtaState({ ...base, salesMode: 'INSTANT', seasonalPriceUnknown: true })).toBe('none');
    expect(bookingCtaState({ minParty: 1, departures: [], salesMode: 'FIXED_DEPARTURE', seasonalPriceUnknown: true })).toBe('price-not-loaded');
  });
});

describe('#749 (b) helper 規則：incomplete 即未知', () => {
  it('incomplete=true → 未知；false → 已知（含有季節、無季節）', () => {
    expect(seasonalPriceUnknown({ incomplete: true })).toBe(true);
    expect(seasonalPriceUnknown({ incomplete: false })).toBe(false);
  });
});

describe('#749 (c)(d) 首頁與詳情頁 loader', () => {
  beforeEach(() => {
    fx.plans = { f: { mode: 'FIXED_DEPARTURE' }, r: { mode: 'REQUEST' }, i: { mode: 'INSTANT' } };
    fx.seasonFail = false; fx.seasonThrow = false; fx.seasonCalls = []; fx.seasonPaged = null; fx.tripCount = 1; fx.seasonFailForId = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  const home = async () => Object.fromEntries((await loadPublicShop('demo'))!.trips[0].plans.map((p) => [p.id, p.bookingCta]));
  const detail = async () => Object.fromEntries((await loadPublicTripDetails('demo', 'trip-1'))!.trip.plans.map((p) => [p.id, bookingCtaState(p)]));

  it('季節完整（無季節）→ 入口不變', async () => {
    expect(await home()).toEqual({ f: 'fixed', r: 'request', i: 'none' });
    expect(await detail()).toEqual({ f: 'fixed', r: 'request', i: 'none' });
  });

  it('季節完整（有季節）→ 入口不變', async () => {
    fx.plans.f.seasons = true;
    expect(await home()).toEqual({ f: 'fixed', r: 'request', i: 'none' });
    expect(await detail()).toEqual({ f: 'fixed', r: 'request', i: 'none' });
  });

  it('季節查詢失敗（如缺 trip_plan_seasons 表）→ FIXED／REQUEST 為 price-not-loaded，INSTANT 不變', async () => {
    fx.seasonFail = true;
    expect(await home()).toEqual({ f: 'price-not-loaded', r: 'price-not-loaded', i: 'none' });
    expect(await detail()).toEqual({ f: 'price-not-loaded', r: 'price-not-loaded', i: 'none' });
  });

  it('首頁讀取季節時丟錯 → fail-safe 為未知，不讓整頁失敗', async () => {
    fx.seasonThrow = true;
    expect(await home()).toEqual({ f: 'price-not-loaded', r: 'price-not-loaded', i: 'none' });
  });

  it('首頁季節資料在分頁上限被截斷：只有截斷點（plan_id 排序）及之後的方案為 price-not-loaded，之前的不受影響', async () => {
    // SEASON_PAGE_SIZE=1000、MAX_SEASON_PAGES=5 非可注入常數：用尊重 range 的 5000 列滿頁模擬。
    // 排序為 plan_id、id：f 只有 1 列，r 佔其餘 4999 列 → 最後一列屬於 r → 截斷點為 r。
    fx.plans = { f: { mode: 'FIXED_DEPARTURE' }, r: { mode: 'REQUEST' }, i: { mode: 'INSTANT' } };
    const row = (planId: string, n: number) => ({
      id: `s-${planId}-${String(n).padStart(5, '0')}`, plan_id: planId, start_month: 1, start_day: 1, end_month: 12, end_day: 31, price_override: 200, sort_order: 0,
    });
    fx.seasonPaged = [row('f', 0), ...Array.from({ length: 4999 }, (_, n) => row('r', n))];
    expect(await home()).toEqual({ f: 'fixed', r: 'price-not-loaded', i: 'none' });
    expect(fx.seasonCalls).toHaveLength(5);
  });

  it('首頁只批次查一次季節，且只帶會判定團次的方案', async () => {
    await home();
    expect(fx.seasonCalls).toHaveLength(1);
    expect([...fx.seasonCalls[0]].sort()).toEqual(['f', 'r']);
  });

  // 250 個 FIXED 方案分在 9 個行程（每行程最多判定 30 個）→ 3 塊（100、100、50）。
  const manyPlans = () => {
    fx.tripCount = 9;
    fx.plans = Object.fromEntries(Array.from({ length: 250 }, (_, n) => [`p${String(n).padStart(3, '0')}`, { mode: 'FIXED_DEPARTURE' } as PlanFx]));
  };
  const homeAll = async () => (await loadPublicShop('demo'))!.trips.flatMap((tr) => tr.plans);

  it('方案超過 100 個：季節查詢分塊，每次 .in 的 ID 數 <= 100，且涵蓋全部會判定的方案', async () => {
    manyPlans();
    const plans = await homeAll();
    expect(plans.length).toBe(250);
    expect(fx.seasonCalls.length).toBeGreaterThan(1);
    expect(Math.max(...fx.seasonCalls.map((c) => c.length))).toBeLessThanOrEqual(100);
    expect(new Set(fx.seasonCalls.flat()).size).toBe(fx.seasonCalls.flat().length);
    expect(plans.filter((p) => p.bookingCta === 'price-not-loaded')).toHaveLength(0);
  });

  it('其中一塊季節查詢失敗：只有該塊方案為 price-not-loaded，其他塊不受影響', async () => {
    manyPlans();
    const probe = await homeAll();
    const judged = probe.map((p) => p.id).filter((id) => fx.seasonCalls.flat().includes(id));
    fx.seasonCalls = [];
    fx.seasonFailForId = judged[0];
    const plans = await homeAll();
    const failedChunk = new Set(fx.seasonCalls.find((c) => c.includes(judged[0])));
    expect(failedChunk.size).toBeLessThanOrEqual(100);
    expect(failedChunk.size).toBeGreaterThan(0);
    for (const p of plans) {
      if (failedChunk.has(p.id)) expect(p.bookingCta).toBe('price-not-loaded');
      else expect(p.bookingCta).not.toBe('price-not-loaded');
    }
    expect(plans.some((p) => !failedChunk.has(p.id))).toBe(true);
  });

  it('詳情頁只對未知的方案輸出 seasonalPriceUnknown', async () => {
    expect((await loadPublicTripDetails('demo', 'trip-1'))!.trip.plans.some((p) => p.seasonalPriceUnknown)).toBe(false);
    fx.seasonFail = true;
    expect((await loadPublicTripDetails('demo', 'trip-1'))!.trip.plans.every((p) => p.seasonalPriceUnknown === true)).toBe(true);
  });
});

describe('#749 (e) 消費端呈現（原始碼斷言，比照既有 client 測試）', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  it('首頁與詳情頁都處理 price-not-loaded 且用 i18n 文案', () => {
    const page = read('src/app/s/[shopCode]/page.tsx');
    const client = read('src/components/public/PublicTripDetailsClient.tsx');
    expect(page).toContain("plan.bookingCta === 'price-not-loaded'");
    expect(page).toContain('t.trips.priceNotLoadedHint');
    expect(client).toContain("bookingCtaState(plan) === 'price-not-loaded'");
    expect(client).toContain('t.departures.priceNotLoaded');
  });
});
