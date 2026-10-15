/**
 * #1024：AI 客服 shop context 帶入行程與團次；資料取不到時不得讓 AI 說「沒開團」。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCatalogContext,
  formatDepartureLine,
  formatTripLine,
  type ListableDeparturesResult,
} from '@/server/line-catalog';
import { buildAiSystemPrompt, type ShopContext } from '@/server/ai-reply';

const labels = { seatsLeft: (n: number) => `剩 ${n} 位`, full: '已額滿' };

const ok: ListableDeparturesResult = {
  ok: true,
  trips: [
    { id: 't1', title: '龜山島賞鯨' },
    { id: 't2', title: '無方案行程' },
  ],
  plans: [
    { id: 'p1', name: '標準團', active: true },
    { id: 'p2', name: '包船', active: true },
  ],
  tripPlans: [
    { id: 'p1', trip_id: 't1', name: '標準團', active: true },
    { id: 'p2', trip_id: 't1', name: '包船', active: true },
    { id: 'p3', trip_id: 't2', name: '無團次方案', active: true },
  ],
  departures: [
    { id: 'd1', trip_id: 't1', plan_id: 'p1', departs_on: '2026-10-20', start_time: '09:00:00', capacity: 10, seats_booked: 7 },
    { id: 'd2', trip_id: 't1', plan_id: 'p2', departs_on: '2026-10-21', start_time: null, capacity: 4, seats_booked: 5 },
  ],
};

const baseShop = (extra: Partial<ShopContext> = {}): ShopContext => ({
  name: '測試嚮導',
  description: '介紹',
  businessHours: '09:00–18:00',
  services: [],
  trips: [],
  departures: [],
  ai: {},
  shopUrl: 'https://example.test/s/x',
  ...extra,
});

describe('catalog shop context 格式化', () => {
  it('團次一行：日期 時間 行程 方案 剩餘名額；額滿與負數夾 0', () => {
    const ctx = buildCatalogContext(ok, labels);
    expect(ctx.catalogUnavailable).toBe(false);
    expect(ctx.departures).toEqual([
      '2026-10-20 09:00 龜山島賞鯨（標準團）　剩 3 位',
      '2026-10-21 龜山島賞鯨（包船）　已額滿',
    ]);
  });

  it('行程列出啟用方案名稱；沒有方案只列名稱，不含價格', () => {
    const ctx = buildCatalogContext(ok, labels);
    expect(ctx.trips).toEqual(['龜山島賞鯨 · 標準團、包船', '無方案行程 · 無團次方案']);
    expect(formatTripLine({ id: 'x', title: 'T' }, [])).toBe('T');
  });

  it('plan_id 為 null 的團次不附方案名', () => {
    const line = formatDepartureLine(
      { trip_id: 't1', plan_id: null, departs_on: '2026-10-20', capacity: 2, seats_booked: 0 },
      new Map([['t1', 'A']]),
      new Map(),
      labels,
    );
    expect(line).toBe('2026-10-20 A　剩 2 位');
  });

  it('沒有已發布行程（非導遊）：空陣列且 catalogUnavailable 為 false', () => {
    expect(buildCatalogContext({ ok: true, trips: [], plans: [], tripPlans: [], departures: [] }, labels)).toEqual({
      trips: [],
      departures: [],
      catalogUnavailable: false,
    });
  });

  it('查詢失敗：catalogUnavailable 為 true，清單為空', () => {
    expect(buildCatalogContext({ ok: false }, labels)).toEqual({
      trips: [],
      departures: [],
      catalogUnavailable: true,
    });
  });
});

describe('buildAiSystemPrompt', () => {
  it('旗標為假：維持「那天目前沒有開團」規則，不含無法取得規則', () => {
    const prompt = buildAiSystemPrompt(baseShop({ departures: ['x'] }));
    expect(prompt).toContain('那天目前沒有開團');
    expect(prompt).not.toContain('暫時無法取得');
  });

  it('旗標為真：改用 UNSURE 規則，不含「那天目前沒有開團」規則', () => {
    const prompt = buildAiSystemPrompt(baseShop({ catalogUnavailable: true }));
    expect(prompt).not.toContain('那天目前沒有開團');
    expect(prompt).toContain('暫時無法取得');
    expect(prompt).toContain('UNSURE');
  });

  it('帶入行程與團次段落', () => {
    const ctx = buildCatalogContext(ok, labels);
    const prompt = buildAiSystemPrompt(baseShop({ trips: ctx.trips, departures: ctx.departures }));
    expect(prompt).toContain('行程與方案：');
    expect(prompt).toContain('2026-10-20 09:00 龜山島賞鯨（標準團）　剩 3 位');
  });
});
