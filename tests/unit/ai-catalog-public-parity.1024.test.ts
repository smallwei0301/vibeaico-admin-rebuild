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
});
