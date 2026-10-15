/**
 * #1024：有 INSTANT 方案的店家，AI 不得把未列出的日期說成沒開團（公開頁：請先聯絡店家確認可預約時段）。
 */
import { describe, expect, it } from 'vitest';
import { buildCatalogContext, type CatalogDeparture, type ListableDeparturesResult } from '@/server/line-catalog';
import { buildAiSystemPrompt, type ShopContext } from '@/server/ai-reply';

const labels = { seatsLeft: (n: number) => `剩 ${n} 位`, full: '已額滿' };
const NO_OPEN = '那天目前沒有開團';
const win = { from: '2026-10-15', to: '2026-10-28' };

const result = (
  plans: { id: string; name: string; sales_mode: string; min_party?: number }[],
  departures: CatalogDeparture[],
): ListableDeparturesResult => ({
  ok: true,
  trips: [{ id: 't1', title: '賞鯨' }],
  plans: plans.map((p) => ({ ...p, active: true })),
  tripPlans: plans.map((p) => ({ ...p, trip_id: 't1', active: true })),
  departures,
  truncated: false,
  window: win,
});

const toShop = (ctx: ReturnType<typeof buildCatalogContext>): ShopContext => ({
  name: '店', description: 'd', businessHours: 'h', services: [], trips: ctx.trips, departures: ctx.departures,
  ...(ctx.departureWindow ? { departureWindow: ctx.departureWindow } : {}),
  ...(ctx.hasInstantPlan ? { hasInstantPlan: true } : {}),
  ai: {}, shopUrl: 'https://example.test/s/x',
});

const dep = (id: string, plan_id: string | null, cap = 10, booked = 0) =>
  ({ id, trip_id: 't1', plan_id, departs_on: '2026-10-20', start_time: '09:00:00', capacity: cap, seats_booked: booked });

describe('INSTANT 方案的 AI 規則', () => {
  it('只有 INSTANT：不說沒開團，改請聯絡店家並附連結；空團次文字不暗示全部沒開團', () => {
    const ctx = buildCatalogContext(result([{ id: 'p1', name: '包車', sales_mode: 'INSTANT' }], [dep('d1', 'p1')]), labels);
    expect(ctx.hasInstantPlan).toBe(true);
    expect(ctx.departures).toEqual([]);
    expect(ctx.trips[0]).toContain('包車（需與店家確認時段）');
    const prompt = buildAiSystemPrompt(toShop(ctx));
    expect(prompt).not.toContain(NO_OPEN);
    expect(prompt).not.toContain('此期間沒有可報名團次');
    expect(prompt).toContain('不得說任何日期「沒有開團」');
    expect(prompt).toContain('聯絡店家確認可預約時段並附上 https://example.test/s/x');
    expect(prompt).toContain('部分方案可另與店家確認時段');
  });

  it('混合 FIXED＋INSTANT：仍列 FIXED 團次，且不說沒開團', () => {
    const ctx = buildCatalogContext(
      result([{ id: 'p1', name: '標準', sales_mode: 'FIXED' }, { id: 'p2', name: '包車', sales_mode: 'INSTANT' }],
        [dep('d1', 'p1', 10, 7), dep('d2', 'p2')]),
      labels,
    );
    const prompt = buildAiSystemPrompt(toShop(ctx));
    expect(prompt).toContain('賞鯨（標準）　剩 3 位');
    expect(prompt).not.toContain('賞鯨（包車）');
    expect(prompt).not.toContain(NO_OPEN);
    expect(prompt).toContain('聯絡店家確認可預約時段');
  });

  it('只有 FIXED：規則維持原樣（仍可說沒開團）', () => {
    const ctx = buildCatalogContext(result([{ id: 'p1', name: '標準', sales_mode: 'FIXED' }], [dep('d1', 'p1')]), labels);
    expect(ctx.hasInstantPlan).toBeUndefined();
    const prompt = buildAiSystemPrompt(toShop(ctx));
    expect(prompt).toContain(NO_OPEN);
    expect(prompt).not.toContain('聯絡店家確認可預約時段');
  });

  it('REQUEST 方案名額低於 min_party 不標額滿', () => {
    const ctx = buildCatalogContext(
      result([{ id: 'p1', name: '詢問', sales_mode: 'REQUEST', min_party: 4 }], [dep('d1', 'p1', 10, 8)]),
      labels,
    );
    expect(ctx.departures).toEqual(['2026-10-20 09:00 賞鯨（詢問）　剩 2 位']);
  });

  it('plan_id 為 null 的團次不進 AI context', () => {
    const ctx = buildCatalogContext(result([{ id: 'p1', name: '標準', sales_mode: 'FIXED' }], [dep('d1', null), dep('d2', 'p1')]), labels);
    expect(ctx.departures).toHaveLength(1);
    expect(ctx.departures[0]).toContain('（標準）');
  });
});
