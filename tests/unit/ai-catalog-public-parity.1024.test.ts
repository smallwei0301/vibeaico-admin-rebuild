/**
 * #1024：AI「可報名團次」與公開頁同規則；模組狀態查詢失敗交真人。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildCatalogContext, loadListableDepartures, type ListableDeparturesResult } from '@/server/line-catalog';

const featureResult = vi.hoisted(() => ({ value: { data: null as any, error: null as any, throws: false } }));
vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from: () => {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => {
          if (featureResult.value.throws) throw new Error('boom');
          return { data: featureResult.value.data, error: featureResult.value.error };
        },
      };
      return q;
    },
  }),
}));

import { featureActiveStatus } from '@/server/features';
import { buildShopContext } from '@/server/line-events';

const labels = { seatsLeft: (n: number) => `剩 ${n} 位`, full: '已額滿' };
const now = { today: '2026-10-15', hm: '10:00' };

const base: ListableDeparturesResult = {
  ok: true,
  trips: [{ id: 't1', title: '賞鯨' }],
  plans: [
    { id: 'pf', name: '固定團', sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 2 },
    { id: 'pi', name: '即時包船', sales_mode: 'INSTANT', active: true, min_party: 1 },
  ],
  tripPlans: [],
  departures: [],
  truncated: false,
  now,
};
const d = (over: Record<string, unknown>) => ({
  id: 'x', trip_id: 't1', plan_id: 'pf', departs_on: '2026-10-20', start_time: '09:00:00', capacity: 10, seats_booked: 0, ...over,
}) as any;

describe('AI context 與公開頁同規則', () => {
  it('INSTANT 方案的 OPEN 團次不進 AI context', () => {
    const ctx = buildCatalogContext({ ...base, departures: [d({ id: 'a', plan_id: 'pi' }), d({ id: 'b' })] }, labels);
    expect(ctx.departures).toHaveLength(1);
    expect(ctx.departures[0]).toContain('固定團');
  });

  it('剩餘名額 < min_party 不描述為可報名（標示額滿）；剛好等於 min_party 仍可報名', () => {
    const ctx = buildCatalogContext({
      ...base,
      departures: [d({ id: 'a', seats_booked: 9 }), d({ id: 'b', seats_booked: 8 })],
    }, labels);
    expect(ctx.departures[0]).toContain('已額滿');
    expect(ctx.departures[0]).not.toContain('剩 1 位');
    expect(ctx.departures[1]).toContain('剩 2 位');
  });

  it('今天已開始的團次排除；今天未開始、start_time 為 null、明天不受影響', () => {
    const ctx = buildCatalogContext({
      ...base,
      departures: [
        d({ id: 'a', departs_on: '2026-10-15', start_time: '09:30:00' }),
        d({ id: 'b', departs_on: '2026-10-15', start_time: '10:00:00' }),
        d({ id: 'c', departs_on: '2026-10-15', start_time: '14:00:00' }),
        d({ id: 'e', departs_on: '2026-10-15', start_time: null }),
        d({ id: 'f', departs_on: '2026-10-16', start_time: '06:00:00' }),
      ],
    }, labels);
    expect(ctx.departures).toHaveLength(3);
    expect(ctx.departures.join('\n')).not.toContain('09:30');
  });

  it('replyDepartures 路徑（result.departures）不被過濾', () => {
    const r = { ...base, departures: [d({ id: 'a', plan_id: 'pi' })] };
    buildCatalogContext(r, labels);
    expect(r.departures).toHaveLength(1);
  });

  it('截斷判定以原始列計算：過濾後仍保留 truncated／lastListedDate', async () => {
    const mk = (day: number) => ({
      id: `d${day}`, trip_id: 't1', plan_id: 'pi', departs_on: `2026-10-${day}`, start_time: null, capacity: 5, seats_booked: 0,
      trip_plans: { id: 'pi', name: 'I', sales_mode: 'INSTANT', active: true, min_party: 1 },
    });
    const rows = [mk(20), mk(21), mk(22)];
    const make = (table: string, np: { v: boolean }) => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q,
        is: () => { np.v = true; return q; },
        maybeSingle: async () => ({ data: { basic: { timezone: 'Asia/Taipei' } }, error: null }),
        then: (res: any) => table === 'trips' ? res({ data: [{ id: 't1', title: 'T' }], error: null })
          : table === 'trip_departures' ? res({ data: np.v ? [] : rows, error: null }) : res({ data: [], error: null }),
      };
      return q;
    };
    const r = await loadListableDepartures({ from: (t: string) => make(t, { v: false }) }, 'x', 'test', 3);
    expect(r.ok && r.truncated).toBe(true);
    const ctx = buildCatalogContext(r, labels);
    expect(ctx.departures).toEqual([]);
    expect(ctx.departuresTruncatedAfter).toBe('2026-10-22');
  });
});

describe('featureActiveStatus / buildShopContext', () => {
  beforeEach(() => { featureResult.value = { data: null, error: null, throws: false }; });

  it('active／inactive／過期／error／throw', async () => {
    featureResult.value = { data: { active: true, expires_at: null }, error: null, throws: false };
    expect(await featureActiveStatus('t', 'TOUR_MODULE')).toBe('active');
    featureResult.value = { data: null, error: null, throws: false };
    expect(await featureActiveStatus('t', 'TOUR_MODULE')).toBe('inactive');
    featureResult.value = { data: { active: true, expires_at: '2000-01-01' }, error: null, throws: false };
    expect(await featureActiveStatus('t', 'TOUR_MODULE')).toBe('inactive');
    featureResult.value = { data: null, error: { message: 'x' }, throws: false };
    expect(await featureActiveStatus('t', 'TOUR_MODULE')).toBe('error');
    featureResult.value = { data: null, error: null, throws: true };
    expect(await featureActiveStatus('t', 'TOUR_MODULE')).toBe('error');
  });

  const shopAdmin = { from: () => { const q: any = { select: () => q, eq: () => q, order: () => q, then: (r: any) => r({ data: [], error: null }) }; return q; } } as any;
  const tenant = { id: 't', name: 'T', shop_code: 'x', business_type: 'GUIDE' } as any;

  it('GUIDE 且模組狀態查詢失敗 → catalogUnavailable=true', async () => {
    featureResult.value = { data: null, error: { message: 'x' }, throws: false };
    const shop = await buildShopContext(shopAdmin, tenant, {}, {}, {});
    expect(shop.catalogUnavailable).toBe(true);
    expect(shop.departures).toEqual([]);
  });

  it('GUIDE 確定未啟用 → 維持 main 行為（空目錄、非 unavailable）', async () => {
    const shop = await buildShopContext(shopAdmin, tenant, {}, {}, {});
    expect(shop.catalogUnavailable).toBeUndefined();
    expect(shop.trips).toEqual([]);
  });

  // 業態只是預設、可加開模組：非 GUIDE 只要 TOUR_MODULE active，就與 replyTrips 一致帶入行程與團次。
  const tourAdmin = {
    from: (table: string) => {
      const rows: Record<string, any[]> = {
        trips: [{ id: 't1', title: '賞鯨' }],
        trip_plans: [{ id: 'pf', trip_id: 't1', name: '固定團', sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 1 }],
        trip_departures: [{
          id: 'd1', trip_id: 't1', plan_id: 'pf', departs_on: '2099-01-02', start_time: null, capacity: 10, seats_booked: 2,
          trip_plans: { id: 'pf', name: '固定團', sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 1 },
        }],
      };
      const q: any = {
        select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, is: () => q, range: () => q,
        maybeSingle: async () => ({ data: { basic: { timezone: 'Asia/Taipei' } }, error: null }),
        then: (r: any) => r({ data: rows[table] ?? [], error: null }),
      };
      return q;
    },
  } as any;

  it.each(['LOCAL_SHOP', 'CLINIC'])('%s 租戶 TOUR_MODULE active 且有已發布行程 → AI context 含行程與團次', async (business_type) => {
    featureResult.value = { data: { active: true, expires_at: null }, error: null, throws: false };
    const shop = await buildShopContext(tourAdmin, { ...tenant, business_type }, {}, {}, {});
    expect(shop.catalogUnavailable).toBeFalsy();
    expect(shop.trips.join('\n')).toContain('賞鯨');
    expect(shop.departures.join('\n')).toContain('固定團');
  });

  it('LOCAL_SHOP 未啟用 TOUR_MODULE → 維持空目錄（與 main 相同）', async () => {
    const shop = await buildShopContext(tourAdmin, { ...tenant, business_type: 'LOCAL_SHOP' }, {}, {}, {});
    expect(shop.catalogUnavailable).toBeUndefined();
    expect(shop.trips).toEqual([]);
    expect(shop.departures).toEqual([]);
  });
});

describe('AI context 套用預約頁候選上限（每個方案前 12 個）', () => {
  it('單一方案 15 個未滿團次：前 12 個標名額，第 13～15 個標請聯絡店家確認且仍列出', () => {
    const departures = Array.from({ length: 15 }, (_, i) =>
      d({ id: `d${String(i).padStart(2, '0')}`, departs_on: `2026-10-${String(16 + i).padStart(2, '0')}`, capacity: 20, seats_booked: i }));
    const ctx = buildCatalogContext({ ...base, departures: [...departures].reverse() }, labels);
    expect(ctx.departures).toHaveLength(15);
    const byDate = (day: number) => ctx.departures.find((l) => l.startsWith(`2026-10-${day}`))!;
    for (let i = 0; i < 12; i++) expect(byDate(16 + i)).toContain(`剩 ${20 - i} 位`);
    for (let i = 12; i < 15; i++) {
      const line = byDate(16 + i);
      expect(line).toContain('（請聯絡店家確認）');
      expect(line).not.toMatch(/剩 \d+ 位|已額滿/);
    }
  });

  it('候選上限依方案分別計算', () => {
    const planB = { id: 'pg', name: '另一團', sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 1 };
    const departures = [
      ...Array.from({ length: 13 }, (_, i) => d({ id: `a${i}`, departs_on: `2026-10-${String(16 + i).padStart(2, '0')}` })),
      d({ id: 'b0', plan_id: 'pg', departs_on: '2026-10-29' }),
    ];
    const ctx = buildCatalogContext({ ...base, plans: [...base.plans, planB], departures }, labels);
    expect(ctx.departures.filter((l) => l.includes('請聯絡店家確認'))).toHaveLength(1);
    expect(ctx.departures.find((l) => l.includes('另一團'))).toContain('剩 10 位');
  });
});
