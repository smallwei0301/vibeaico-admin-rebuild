/**
 * #747：店家首頁方案的預約／申請入口必須與詳情頁同一套規則（bookingCtaState＋同一個團次視窗）。
 * 修復前首頁只看 salesMode，客滿、人數不足、團次未載入的方案仍顯示可點入口。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { departs_on?: string; start_time?: string | null; capacity: number; seats_booked: number };
type PlanFx = { trip?: string; sort?: number; mode: 'FIXED_DEPARTURE' | 'REQUEST' | 'INSTANT'; min: number; rows: Row[]; fail?: boolean };

const fx = vi.hoisted(() => ({
  plans: {} as Record<string, PlanFx>, tripRows: [] as Array<Record<string, unknown>>, trips: ['trip-1'] as string[],
  /** Issue 760：每一次 supabase `from()` 呼叫的資料表名稱（用來斷言查詢數）。 */
  calls: [] as string[],
  /** Issue 760：批次團次查詢的頁數上限測試用；>0 時每頁只回這麼多列（模擬較小的 page size 之外不使用）。 */
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      fx.calls.push(table);
      const filters: Record<string, unknown> = {};
      const inFilters: Record<string, unknown[]> = {};
      let selectCols = '';
      let single = false;
      let range: [number, number] | null = null;
      const orders: string[] = [];
      const run = async () => {
        if (table === 'tenants') {
          return { data: { id: 'tenant-1', shop_code: 'demo', name: 'Demo', business_type: null, tenant_settings: null }, error: null };
        }
        if (table === 'trips') {
          const rows = fx.trips.map((id) => ({ id, slug: id, title: id, summary: '', location: '', cover_image_url: null, duration_hours: 2, refund_policy_type: 'STANDARD', status: 'PUBLISHED', tenant_id: 'tenant-1' }));
          if (single) return { data: rows.find((r) => r.slug === filters.slug) ?? null, error: null };
          return { data: rows, error: null };
        }
        if (table === 'trip_plans') {
          // 模擬 DB：只依呼叫端實際下的 order() 欄位排序；沒下 id 排序時同 sort_order 保持插入順序。
          let all = Object.entries(fx.plans).map(([id, p]) => ({
            id, trip_id: p.trip ?? 'trip-1', sort_order: p.sort ?? 0, name: id, description: '', price_per_person: 100, price_type: 'PER_PERSON',
            min_party: p.min, max_party: 8, sales_mode: p.mode,
          }));
          if (filters.trip_id) all = all.filter((r) => r.trip_id === filters.trip_id);
          all = all.map((r, i) => ({ r, i })).sort((x, y) => {
            for (const col of orders) {
              const xv = (x.r as Record<string, unknown>)[col] as string | number;
              const yv = (y.r as Record<string, unknown>)[col] as string | number;
              if (xv < yv) return -1;
              if (xv > yv) return 1;
            }
            return x.i - y.i;
          }).map((e) => e.r);
          const [a, b] = range ?? [0, all.length];
          return { data: all.slice(a, b + 1), error: null };
        }
        if (table === 'trip_departures' && filters.plan_id) {
          const p = fx.plans[filters.plan_id as string];
          if (p.fail) return { data: null, error: { message: 'boom' } };
          const [a, b] = range ?? [0, p.rows.length];
          return { data: p.rows.slice(a, b + 1).map((r, i) => ({ id: `d-${a + i}`, departs_on: '2098-01-01', start_time: null, ...r })), error: null };
        }
        if (table === 'trip_departures' && selectCols.includes('plan_id')) {
          // Issue 760：首頁批次查詢（以行程為範圍、不帶 plan_id eq）。模擬 DB 的全域排序（departs_on、start_time、id）與 range。
          const planIds = Object.keys(fx.plans).filter((id) => (inFilters.trip_id ?? []).includes(fx.plans[id].trip ?? 'trip-1'));
          if (planIds.some((id) => fx.plans[id].fail)) return { data: null, error: { message: 'boom' } };
          const all = planIds.flatMap((id) => fx.plans[id].rows.map((r, i) => ({
            id: `${id}-d${String(i).padStart(4, '0')}`, plan_id: id, departs_on: '2098-01-01', start_time: null, ...r,
          })));
          all.sort((x, y) => String(x.departs_on).localeCompare(String(y.departs_on))
            || String(x.start_time ?? '').localeCompare(String(y.start_time ?? '')) || x.id.localeCompare(y.id));
          const [a, b] = range ?? [0, all.length];
          return { data: all.slice(a, b + 1), error: null };
        }
        if (table === 'trip_departures') return { data: fx.tripRows, error: null };
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: (cols?: string) => { selectCols = cols ?? ''; return chain; },
        in: (k: string, v: unknown[]) => { inFilters[k] = v; return chain; },
        gte: () => chain, order: (col: string) => { orders.push(col); return chain; },
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
  beforeEach(() => { fx.plans = {}; fx.tripRows = []; fx.trips = ['trip-1']; fx.calls = []; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

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

  it('Issue 760：2 個行程 × 20 方案：30 的上限是每個行程各自計算，兩個行程的 20 個方案都載入', async () => {
    fx.trips = ['trip-1', 'trip-2'];
    fx.plans = {};
    for (const t of fx.trips) for (let i = 0; i < 20; i += 1) {
      fx.plans[`${t}-p${String(i).padStart(2, '0')}`] = { trip: t, sort: i, mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] };
    }
    const data = await loadPublicShop('demo');
    for (const trip of data!.trips) for (const p of trip.plans) expect(p.bookingCta, p.id).toBe('fixed');
  });

  it('Issue 760：2 個行程 × 35 方案：每個行程各自只有前 30 個載入（不是全店 30 個）', async () => {
    fx.trips = ['trip-1', 'trip-2'];
    fx.plans = {};
    for (const t of fx.trips) for (let i = 0; i < 35; i += 1) {
      fx.plans[`${t}-p${String(i).padStart(2, '0')}`] = { trip: t, sort: i, mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] };
    }
    const data = await loadPublicShop('demo');
    for (const trip of data!.trips) {
      trip.plans.forEach((p, i) => expect(p.bookingCta, p.id).toBe(i < 30 ? 'fixed' : 'dates-not-loaded'));
      const detail = await loadPublicTripDetails('demo', trip.slug);
      for (const plan of detail!.trip.plans) {
        expect(trip.plans.find((p) => p.id === plan.id)!.bookingCta, plan.id).toBe(bookingCtaState(plan));
      }
    }
  });

  it('Issue 760：40 個行程 × 1 方案：全部載入（首頁不再有全店 30 個方案的上限）', async () => {
    fx.trips = Array.from({ length: 40 }, (_, i) => `trip-${String(i).padStart(2, '0')}`);
    fx.plans = Object.fromEntries(fx.trips.map((t) => [`${t}-p`, { trip: t, mode: 'REQUEST', min: 1, rows: [ok(2)] } as PlanFx]));
    const data = await loadPublicShop('demo');
    data!.trips.forEach((trip) => expect(trip.plans[0].bookingCta, trip.id).toBe('request'));
  });

  it('Issue 760：INSTANT 排在 >30 個 FIXED 之前，首頁與詳情頁選到同一批（.filter(hasPublicDepartureList) 的守門測試）', async () => {
    // 5 個 INSTANT（sort 0..4）先於 35 個 FIXED（sort 5..39）。INSTANT 占輸出名額、不占團次名額：
    // 團次集合是前 30 個 FIXED（f00..f29），f30..f34 未載入。少了 hasPublicDepartureList 過濾，INSTANT 會吃掉 5 個額度。
    fx.plans = {};
    for (let i = 0; i < 5; i += 1) fx.plans[`i${i}`] = { sort: i, mode: 'INSTANT', min: 1, rows: [ok(2)] };
    for (let i = 0; i < 35; i += 1) fx.plans[`f${String(i).padStart(2, '0')}`] = { sort: 5 + i, mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] };
    const home = await homeCta();
    const detail = await loadPublicTripDetails('demo', 'trip-1');
    for (const plan of detail!.trip.plans) expect(home[plan.id], plan.id).toBe(bookingCtaState(plan));
    expect(home.f29).toBe('fixed');
    expect(home.f30).toBe('dates-not-loaded');
    expect(home.i0).toBe('none');
  });

  it('Issue 760：行程有 >= 60 個方案：首頁只考慮詳情頁會輸出的前 60 個方案', async () => {
    // 55 個 INSTANT 在前（sort 0..54），其後 10 個 FIXED（sort 55..64）。詳情頁只輸出前 60 個方案
    // → 只有 f00..f04 進團次集合；f05..f09 詳情頁看不到，首頁不得替它們開入口。
    fx.plans = {};
    for (let i = 0; i < 55; i += 1) fx.plans[`i${String(i).padStart(2, '0')}`] = { sort: i, mode: 'INSTANT', min: 1, rows: [] };
    for (let i = 0; i < 10; i += 1) fx.plans[`f${String(i).padStart(2, '0')}`] = { sort: 55 + i, mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] };
    const home = await homeCta();
    const detail = await loadPublicTripDetails('demo', 'trip-1');
    const detailIds = new Set(detail!.trip.plans.map((p) => p.id));
    expect(detailIds.size).toBe(60);
    for (let i = 0; i < 10; i += 1) {
      const id = `f${String(i).padStart(2, '0')}`;
      if (detailIds.has(id)) expect(home[id], id).toBe('fixed');
      else expect(home[id], id).toBe('dates-not-loaded');
    }
    expect(home.f04).toBe('fixed');
    expect(home.f05).toBe('dates-not-loaded');
    for (const plan of detail!.trip.plans) expect(home[plan.id], plan.id).toBe(bookingCtaState(plan));
  });

  it('Issue 760：查詢數不隨方案數放大（35 個 FIXED 方案、多頁團次也只有常數次 supabase 呼叫）', async () => {
    fx.trips = ['trip-1', 'trip-2'];
    fx.plans = {};
    for (const t of fx.trips) for (let i = 0; i < 30; i += 1) {
      // 每個方案前 20 個團次客滿、第 21 個才可訂：舊作法每個方案要多頁掃描。
      fx.plans[`${t}-p${String(i).padStart(2, '0')}`] = {
        trip: t, sort: i, mode: 'FIXED_DEPARTURE', min: 1, rows: [...Array.from({ length: 20 }, () => full), ok(2)],
      };
    }
    fx.calls = [];
    const data = await loadPublicShop('demo');
    for (const trip of data!.trips) for (const p of trip.plans) expect(p.bookingCta, p.id).toBe('fixed');
    // 60 個方案 × 21 列 = 1260 列 → 批次 2 頁（每頁 1000）。tenants、trips、services、trip_plans、行程團次列表 ＝ 5，
    // 加批次 2 頁共 7 次；舊作法是 4 ＋ 60 個方案 × 每方案 >= 1 次（本 fixture 每方案 1 頁＋1 次 lookahead 以上）＝ 約 124 次。
    expect(fx.calls.length).toBe(7);
    expect(fx.calls.filter((t) => t === 'trip_departures').length).toBe(3);
  });

  it('Issue 760：代表性店家（3 個行程 × 30 方案、團次少）只需 6 次 supabase 呼叫（舊作法：5 ＋ 全店最多 30 個方案各 1 次 ＝ 35 次，團次多時最多 4 ＋ 30 × 6 ＝ 184 次）', async () => {
    fx.trips = ['trip-1', 'trip-2', 'trip-3'];
    fx.plans = {};
    for (const t of fx.trips) for (let i = 0; i < 30; i += 1) {
      fx.plans[`${t}-p${String(i).padStart(2, '0')}`] = { trip: t, sort: i, mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] };
    }
    fx.calls = [];
    await loadPublicShop('demo');
    expect(fx.calls.length).toBe(6);
  });

  it('Issue 760：單一方案 600 列掃描上限與詳情頁一致（第 601 列才可訂 → 兩邊都無入口）', async () => {
    fx.plans = {
      far: { mode: 'FIXED_DEPARTURE', min: 1, rows: [...Array.from({ length: 600 }, () => full), ok(2)] },
      near: { mode: 'FIXED_DEPARTURE', min: 1, rows: [...Array.from({ length: 599 }, () => full), ok(2)] },
    };
    const home = await homeCta();
    const detail = await loadPublicTripDetails('demo', 'trip-1');
    expect(home).toEqual({ far: 'fixed-unavailable', near: 'fixed' });
    for (const plan of detail!.trip.plans) expect(home[plan.id], plan.id).toBe(bookingCtaState(plan));
  });

  it('Issue 760：批次頁數用完仍未判定的方案 → dates-not-loaded（不猜測、不誤開入口）', async () => {
    // INSTANT 方案的列不會被判定，卻占滿批次頁（5 頁 × 1000 列）；排在最後的 FIXED 方案讀不到自己的團次。
    fx.plans = {
      i: { mode: 'INSTANT', min: 1, rows: Array.from({ length: 5200 }, () => ok(2)) },
      f: { sort: 1, mode: 'FIXED_DEPARTURE', min: 1, rows: [{ departs_on: '2099-01-01', capacity: 5, seats_booked: 0 }] },
    };
    const home = await homeCta();
    expect(home).toEqual({ i: 'none', f: 'dates-not-loaded' });
    expect(fx.calls.filter((t) => t === 'trip_departures').length).toBe(1 + 5);
  });

  it('Issue 760：同 sort_order、同 id 順序下，兩個頁面選到同一批方案（tie-break 守門）', async () => {
    // 插入順序與 id 相反，且正好 31 個：沒有 id 次序時首頁會選到不同的 30 個。
    const ids = Array.from({ length: 31 }, (_, i) => `p${String(i).padStart(2, '0')}`).reverse();
    fx.plans = Object.fromEntries(ids.map((id) => [id, { mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] } as PlanFx]));
    const home = await homeCta();
    const detail = await loadPublicTripDetails('demo', 'trip-1');
    for (const plan of detail!.trip.plans) expect(home[plan.id], plan.id).toBe(bookingCtaState(plan));
    expect(Object.entries(home).filter(([, v]) => v === 'dates-not-loaded').map(([k]) => k)).toEqual(['p30']);
  });

  it('同 sort_order 的方案以 id 排序，與詳情頁順序一致（首頁超過上限時被選中的是同一批）', async () => {
    // 插入順序故意與 id 相反；同 sort_order，總共 31 個方案，第 31 個（id 最大）應是未載入的那個。
    const ids = Array.from({ length: 31 }, (_, i) => `p${String(i).padStart(2, '0')}`).reverse();
    fx.plans = Object.fromEntries(ids.map((id) => [id, { mode: 'FIXED_DEPARTURE', min: 1, rows: [ok(2)] } as PlanFx]));
    const data = await loadPublicShop('demo');
    const detail = await loadPublicTripDetails('demo', 'trip-1');
    const homeIds = data!.trips[0].plans.map((p) => p.id);
    expect(homeIds).toEqual(detail!.trip.plans.map((p) => p.id));
    expect(homeIds).toEqual([...ids].sort());
    expect(data!.trips[0].plans.find((p) => p.id === 'p30')!.bookingCta).toBe('dates-not-loaded');
    expect(data!.trips[0].plans.find((p) => p.id === 'p00')!.bookingCta).toBe('fixed');
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
    const detail = await loadPublicTripDetails('demo', 'trip-1');
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
