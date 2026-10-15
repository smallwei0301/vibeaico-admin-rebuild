/**
 * #1024 Codex review 修正：方案價格、季節價可用性、方案查詢上限、INSTANT 截斷反向區間、catalogUnavailable 降級範圍。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCatalogContext, formatTripLine, loadListableDepartures, BEYOND_CANDIDATES_MARK, PRICE_BY_DATE_MARK, TRIP_PLAN_LIMIT,
  type ListableDeparturesResult,
} from '@/server/line-catalog';
import { buildAiSystemPrompt, type ShopContext } from '@/server/ai-reply';

const labels = { seatsLeft: (n: number) => `剩 ${n} 位`, full: '已額滿' };
const trip = { id: 't1', title: '龜山島賞鯨' };
const dayFromNow = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('formatTripLine 方案價格', () => {
  it('非季節、> 0：帶確定價與計價單位', () => {
    const line = formatTripLine(trip, [
      { id: 'p1', trip_id: 't1', name: '標準團', price_per_person: 1280, price_type: 'PER_PERSON' },
      { id: 'p2', trip_id: 't1', name: '包船', price_per_person: '18000', price_type: 'PER_GROUP' },
    ]);
    expect(line).toBe('龜山島賞鯨 · 標準團 NT$1,280/人、包船 NT$18,000/團');
  });

  it('季節定價（含季節資料不完整）或價格 <= 0：不給數字', () => {
    const line = formatTripLine(trip, [
      { id: 'p1', trip_id: 't1', name: '旺季', price_per_person: 1000, seasons: [{ id: 's', startMonth: 7, startDay: 1, endMonth: 8, endDay: 31, priceOverride: 1500, sortOrder: 0 }] },
      { id: 'p2', trip_id: 't1', name: '未知', price_per_person: 1000, seasonsIncomplete: true },
      { id: 'p3', trip_id: 't1', name: '零元', price_per_person: 0 },
    ]);
    expect(line).not.toContain('NT$');
    expect(line.split(PRICE_BY_DATE_MARK).length - 1).toBe(3);
  });
});

describe('季節定價方案的團次可用性（與預約頁 isDepartureBookableOnPage 一致）', () => {
  const base = (planOver: Record<string, unknown>): ListableDeparturesResult => ({
    ok: true, trips: [trip],
    plans: [{ id: 'p1', name: '標準團', sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 1 }],
    tripPlans: [{ id: 'p1', trip_id: 't1', name: '標準團', sales_mode: 'FIXED_DEPARTURE', active: true, price_per_person: 1000, ...planOver }],
    departures: [{ id: 'd1', trip_id: 't1', plan_id: 'p1', departs_on: dayFromNow(3), start_time: null, capacity: 10, seats_booked: 2 }],
    truncated: false,
    now: { today: dayFromNow(0), hm: '08:00' },
  });

  it('季節資料不完整：團次改標示請聯絡店家，不給名額', () => {
    const ctx = buildCatalogContext(base({ seasonsIncomplete: true }), labels);
    expect(ctx.departures[0]).toContain(BEYOND_CANDIDATES_MARK);
    expect(ctx.departures[0]).not.toContain('剩');
  });

  it('季節資料完整：解析得出單價，照常列名額', () => {
    const seasons = [{ id: 's', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, priceOverride: 1500, sortOrder: 0 }];
    const ctx = buildCatalogContext(base({ seasons }), labels);
    expect(ctx.departures[0]).toContain('剩 8 位');
  });

  it('非季節方案：照常列名額', () => {
    expect(buildCatalogContext(base({}), labels).departures[0]).toContain('剩 8 位');
  });
});

function planAdmin(planRows: unknown[]) {
  const make = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, is: () => q, range: () => q,
      maybeSingle: async () => ({ data: { basic: { timezone: 'Asia/Taipei' } }, error: null }),
      then: (resolve: any) => {
        if (table === 'trips') return resolve({ data: [{ id: 't1', title: 'T' }], error: null });
        if (table === 'trip_plans') return resolve({ data: planRows, error: null });
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { from: (table: string) => make(table) };
}
const rows = (n: number, mode = 'FIXED_DEPARTURE') =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, trip_id: 't1', name: `P${i}`, sales_mode: i === n - 1 ? mode : 'FIXED_DEPARTURE', active: true, price_per_person: 100, price_type: 'PER_PERSON' }));

describe('trip_plans 查詢上限', () => {
  it('取滿 TRIP_PLAN_LIMIT：無法證明完整 → ok:false', async () => {
    const r = await loadListableDepartures(planAdmin(rows(TRIP_PLAN_LIMIT, 'INSTANT')), 'x', 'test', 10, { includeTripPlans: true, timeZone: 'Asia/Taipei' });
    expect(r.ok).toBe(false);
  });

  it('未達上限：ok 且帶價格欄位', async () => {
    const r = await loadListableDepartures(planAdmin(rows(3)), 'x', 'test', 10, { includeTripPlans: true, timeZone: 'Asia/Taipei' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tripPlans[0]).toMatchObject({ price_per_person: 100, seasons: [], seasonsIncomplete: false });
  });
});

const shop = (over: Partial<ShopContext>): ShopContext => ({
  name: '店', description: 'd', businessHours: 'h', services: ['剪髮 · 60 分鐘 · NT$800'], trips: [], departures: [],
  shopUrl: 'https://x.test/s', ai: {}, hasInstantPlan: true,
  departureWindow: { today: '2026-10-15', from: '2026-10-15', to: '2026-10-29' }, ...over,
});

describe('INSTANT 截斷日 <= 日期窗起點', () => {
  it('cut === from（= today）：不產生反向聯絡區間', () => {
    const p = buildAiSystemPrompt(shop({ departuresTruncatedAfter: '2026-10-15' }));
    expect(p).not.toMatch(/2026-10-15～2026-10-14/);
    expect(p).not.toContain('請顧客聯絡店家確認可預約時段');
    expect(p).toContain('2026-10-15（含）之後的日期、時段、名額只回覆「UNSURE」');
  });

  it('cut 在窗內之後：仍保留聯絡區間', () => {
    const p = buildAiSystemPrompt(shop({ departuresTruncatedAfter: '2026-10-17' }));
    expect(p).toContain('2026-10-15～2026-10-16 之間');
  });
});

describe('catalogUnavailable 降級範圍', () => {
  it('只限行程／方案價格與團次日期名額；服務資料照常可答', () => {
    const p = buildAiSystemPrompt(shop({ catalogUnavailable: true, hasInstantPlan: false, departureWindow: undefined }));
    expect(p).toContain('行程／方案價格、團次日期或名額時，只回覆「UNSURE」');
    expect(p).toContain('服務項目');
    expect(p).toContain('含服務價格');
    expect(p).not.toContain('被問到日期、名額、價格時');
  });
});
