/**
 * #1024：AI 客服 shop context 帶入行程與團次；資料取不到時不得讓 AI 說「沒開團」。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_DEPARTURE_LIMIT,
  TRIP_LIMIT,
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

// main（origin/main:src/server/ai-reply.ts）原 system prompt 寫法的逐字複本；
// 沒有行程目錄的店家 prompt 必須與它完全相同。
const mainPrompt = (shop: ShopContext): string => {
  const faq = (shop.ai.faq ?? []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
  return [
    `你是「${shop.name}」的 LINE 客服助理，用繁體中文、口語、簡短（100 字內）回覆顧客。`,
    `店家介紹：${shop.description}`,
    `營業時間：${shop.businessHours}`,
    shop.services.length ? `服務項目：\n${shop.services.join('\n')}` : '',
    shop.trips.length ? `行程與方案：\n${shop.trips.join('\n')}` : '',
    shop.departures.length
      ? `未來 14 天可報名團次（剩餘名額為即時資料）：\n${shop.departures.join('\n')}`
      : '',
    shop.ai.personaNotes ?? '',
    faq ? `常見問答：\n${faq}` : '',
    [
      '規則：',
      '1. 只回答與本店相關的問題。',
      '2. 名額、價格、日期一律以上面提供的資料為準，**絕對不要推測或編造**；',
      '   上面沒有的日期就說「那天目前沒有開團」。',
      `3. 顧客想預約時，附上訂購連結 ${shop.shopUrl} 或請他輸入「預約」。`,
      '4. 不確定，或涉及改期／退費／客訴／議價時，只回覆「UNSURE」讓真人接手。',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
};

describe('沒有行程目錄的店家：prompt 與 main 原文逐字相同', () => {
  it('非 GUIDE 店家（無日期窗、無旗標）', () => {
    const shop = baseShop({ services: ['剪髮 · 60 分鐘 · NT$800'], ai: { personaNotes: '親切', faq: [{ q: '停車？', a: '有' }] } });
    expect(buildAiSystemPrompt(shop)).toBe(mainPrompt(shop));
  });

  it('沒有已發布行程（buildCatalogContext 空目錄）也相同', () => {
    const ctx = buildCatalogContext({ ok: true, trips: [], plans: [], tripPlans: [], departures: [], truncated: false }, labels);
    const shop = baseShop({ ...ctx });
    expect(buildAiSystemPrompt(shop)).toBe(mainPrompt(shop));
  });
});

describe('日期窗（有行程目錄的店家）', () => {
  const window = { today: '2026-10-15', from: '2026-10-15', to: '2026-10-29' };

  it('團次為空：仍輸出今天與日期窗，並寫明此期間沒有團次；窗外 UNSURE', () => {
    const prompt = buildAiSystemPrompt(baseShop({ trips: ['T'], departureWindow: window }));
    expect(prompt).toContain('今天是 2026-10-15（店家時區）。2026-10-15～2026-10-29 可報名團次（剩餘名額為即時資料）：\n（此期間沒有可報名團次）');
    expect(prompt).toContain('只有 2026-10-15～2026-10-29 之間、上面沒有列出的日期，才說「那天目前沒有開團」；2026-10-29 之後（或 2026-10-15 之前）的日期、時段、名額只回覆「UNSURE」。');
    expect(prompt).not.toContain('上面沒有的日期就說');
  });

  it('有團次未截斷：列出團次，範圍只有一條規則', () => {
    const prompt = buildAiSystemPrompt(baseShop({ departures: ['2026-10-20 T　剩 3 位'], departureWindow: window }));
    expect(prompt).toContain('2026-10-15～2026-10-29 可報名團次（剩餘名額為即時資料）：\n2026-10-20 T　剩 3 位');
    expect(prompt.match(/那天目前沒有開團/g)).toHaveLength(1);
    expect(prompt).not.toContain('被截斷');
  });

  it('截斷：「沒開團」只到截斷日前一天，截斷日（含）之後 UNSURE，範圍描述只有一條', () => {
    const prompt = buildAiSystemPrompt(baseShop({ departures: ['x'], departureWindow: window, departuresTruncatedAfter: '2026-10-25' }));
    expect(prompt).toContain('只有 2026-10-15～2026-10-24 之間、上面沒有列出的日期，才說「那天目前沒有開團」；2026-10-25（含）之後（或 2026-10-15 之前）的日期、時段、名額只回覆「UNSURE」。');
    expect(prompt.match(/那天目前沒有開團/g)).toHaveLength(1);
    expect(prompt).not.toContain('2026-10-29 之後');
    expect(prompt).not.toContain('被截斷');
  });

  it('截斷日就是今天：不存在可說沒開團的日期，全部 UNSURE', () => {
    const prompt = buildAiSystemPrompt(baseShop({ departures: ['x'], departureWindow: window, departuresTruncatedAfter: '2026-10-15' }));
    expect(prompt).not.toContain('才說「那天目前沒有開團」');
    expect(prompt).toContain('2026-10-15 起的日期、時段、名額一律只回覆「UNSURE」');
  });

  it('catalogUnavailable 優先：不輸出團次段落與日期窗規則', () => {
    const prompt = buildAiSystemPrompt(baseShop({ catalogUnavailable: true, departureWindow: window }));
    expect(prompt).toContain('暫時無法取得');
    expect(prompt).not.toContain('今天是');
  });

  it('buildCatalogContext 帶出 departureWindow（today = from）；loadListableDepartures 回傳查詢用的 window', async () => {
    const r = await loadListableDepartures(fakeAdmin({ withPlan: [], noPlan: [], tz: 'Asia/Taipei' }), 'x', 'test', 10);
    expect(r.ok && r.window).toEqual({ from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    const ctx = buildCatalogContext({ ...ok, window: { from: '2026-10-15', to: '2026-10-29' } }, labels);
    expect(ctx.departureWindow).toEqual({ today: '2026-10-15', from: '2026-10-15', to: '2026-10-29' });
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
    expect(r.ok && r.lastListedDate).toBe('2026-10-20');
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

describe('trips 查詢上限', () => {
  const adminWithTrips = (n: number) => {
    const make = (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, is: () => q,
        maybeSingle: async () => ({ data: { basic: { timezone: 'Asia/Taipei' } }, error: null }),
        then: (resolve: any) => resolve({
          data: table === 'trips' ? Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `T${i}` })) : [],
          error: null,
        }),
      };
      return q;
    };
    return { from: make };
  };

  it('trips 取滿 TRIP_LIMIT → ok:false（不得把截斷的目錄當完整）', async () => {
    const r = await loadListableDepartures(adminWithTrips(TRIP_LIMIT), 'x', 'test', 10);
    expect(r).toEqual({ ok: false });
  });

  it('trips 未達上限 → 正常回傳', async () => {
    const r = await loadListableDepartures(adminWithTrips(TRIP_LIMIT - 1), 'x', 'test', 10);
    expect(r.ok && r.trips).toHaveLength(TRIP_LIMIT - 1);
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
