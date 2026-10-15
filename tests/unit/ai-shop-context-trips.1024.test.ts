/**
 * #1024：AI 客服 shop context 帶入行程與團次；資料取不到時不得讓 AI 說「沒開團」。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_DEPARTURE_LIMIT,
  buildCatalogContext,
  buildTourCatalogContext,
  loadListableDepartures,
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
  truncated: false,
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
    expect(buildCatalogContext({ ok: true, trips: [], plans: [], tripPlans: [], departures: [], truncated: false }, labels)).toEqual({
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

describe('團次清單截斷（AI 路徑）', () => {
  it('未截斷：prompt 與無旗標逐字相同，不含「只列到」', () => {
    const base = baseShop({ departures: ['x'] });
    expect(buildAiSystemPrompt({ ...base, departuresTruncatedAfter: undefined })).toBe(buildAiSystemPrompt(base));
    expect(buildAiSystemPrompt(base)).not.toContain('被截斷');
  });

  it('截斷：{date} 當天（含）之後一律 UNSURE，「沒開團」只適用早於 {date}', () => {
    const prompt = buildAiSystemPrompt(baseShop({ departures: ['x'], departuresTruncatedAfter: '2026-10-25' }));
    expect(prompt).toContain('團次清單在 2026-10-25 被截斷：2026-10-25（含）之後的日期、時段、名額只回覆「UNSURE」');
    expect(prompt).toContain('2026-10-25 之前上面沒有的日期才說「那天目前沒有開團」');
    expect(prompt).not.toContain('2026-10-25（含）之前');
    expect(prompt).not.toContain('\n   上面沒有的日期就說「那天目前沒有開團」。');
  });

  it('buildCatalogContext 把 lastListedDate 帶成 departuresTruncatedAfter；未截斷不帶', () => {
    expect(buildCatalogContext({ ...ok, truncated: true, lastListedDate: '2026-10-21' }, labels).departuresTruncatedAfter).toBe('2026-10-21');
    expect('departuresTruncatedAfter' in buildCatalogContext(ok, labels)).toBe(false);
  });
});

function fakeAdmin(opts: { withPlan: any[]; noPlan: any[]; tz?: string; settingsCalls?: { n: number } }) {
  const make = (table: string, noPlanQuery: { v: boolean }) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q,
      is: () => { noPlanQuery.v = true; return q; },
      maybeSingle: async () => {
        if (table === 'tenant_settings' && opts.settingsCalls) opts.settingsCalls.n++;
        return { data: { basic: { timezone: opts.tz ?? 'Asia/Taipei' } }, error: null };
      },
      then: (resolve: any) => {
        if (table === 'trips') return resolve({ data: [{ id: 't1', title: 'T' }], error: null });
        if (table === 'trip_departures') return resolve({ data: noPlanQuery.v ? opts.noPlan : opts.withPlan, error: null });
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { from: (table: string) => make(table, { v: false }) };
}

const dep = (day: number, withPlan = true) => ({
  id: `d${day}`, trip_id: 't1', plan_id: withPlan ? 'p1' : null,
  departs_on: `2026-10-${String(day).padStart(2, '0')}`, start_time: null, capacity: 5, seats_booked: 0,
  ...(withPlan ? { trip_plans: { id: 'p1', name: 'P', sales_mode: 'PER_PERSON', active: true } } : {}),
});

describe('loadListableDepartures 截斷旗標', () => {
  it('A 取滿 limit：truncated=true 且 lastListedDate 為最後一筆日期', async () => {
    const admin = fakeAdmin({ withPlan: [dep(20), dep(21), dep(22)], noPlan: [] });
    const r = await loadListableDepartures(admin, 'x', 'test', 3);
    expect(r.ok && r.truncated).toBe(true);
    expect(r.ok && r.lastListedDate).toBe('2026-10-22');
  });

  it('B 取滿且日期較早：lastListedDate 取較小者（A 在其後可能不完整）', async () => {
    const admin = fakeAdmin({ withPlan: [dep(25)], noPlan: [dep(20, false), dep(21, false)] });
    const r = await loadListableDepartures(admin, 'x', 'test', 2);
    expect(r.ok && r.truncated).toBe(true);
    expect(r.ok && r.lastListedDate).toBe('2026-10-21');
  });

  it('合併後被 slice 截掉：truncated=true', async () => {
    const admin = fakeAdmin({ withPlan: [dep(20)], noPlan: [dep(21, false)] });
    const r = await loadListableDepartures(admin, 'x', 'test', 1);
    expect(r.ok && r.truncated).toBe(true);
  });

  it('未取滿：truncated=false 且無 lastListedDate', async () => {
    const admin = fakeAdmin({ withPlan: [dep(20)], noPlan: [dep(21, false)] });
    const r = await loadListableDepartures(admin, 'x', 'test', 10);
    expect(r.ok && r.truncated).toBe(false);
    expect(r.ok && r.lastListedDate).toBeUndefined();
  });

  it('options.timeZone 給了就不再查 tenant_settings；沒給則查', async () => {
    const calls = { n: 0 };
    await loadListableDepartures(fakeAdmin({ withPlan: [], noPlan: [], settingsCalls: calls }), 'x', 'test', 10, { timeZone: 'Asia/Tokyo' });
    expect(calls.n).toBe(0);
    await loadListableDepartures(fakeAdmin({ withPlan: [], noPlan: [], settingsCalls: calls }), 'x', 'test', 10);
    expect(calls.n).toBe(1);
  });

  it('AI_DEPARTURE_LIMIT 大於 LINE 清單上限 10', () => {
    expect(AI_DEPARTURE_LIMIT).toBe(60);
  });
});

describe('buildTourCatalogContext', () => {
  it('查詢 throw：catalogUnavailable=true，不往外拋', async () => {
    const ctx = await buildTourCatalogContext(async () => { throw new Error('boom'); }, labels);
    expect(ctx).toEqual({ trips: [], departures: [], catalogUnavailable: true });
  });

  it('正常：等同 buildCatalogContext', async () => {
    expect(await buildTourCatalogContext(async () => ok, labels)).toEqual(buildCatalogContext(ok, labels));
  });
});
