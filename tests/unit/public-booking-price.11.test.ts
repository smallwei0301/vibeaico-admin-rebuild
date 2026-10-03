import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  priceType: 'PER_PERSON' as string,
  mode: 'FIXED_DEPARTURE' as string,
  seasons: [] as Array<Record<string, unknown>>,
  departs: ['2098-07-15', '2098-09-15'] as string[],
  seasonCalls: [] as Array<Record<string, unknown>>,
  seasonError: false,
  tz: undefined as unknown,
  depRows: undefined as undefined | Array<{ departs_on: string; start_time: string | null }>,
  depFilters: {} as Record<string, unknown>,
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const run = async () => {
        if (table === 'trip_plan_seasons') { state.seasonCalls.push({ ...filters }); return state.seasonError ? { data: null, error: { message: 'boom' } } : { data: state.seasons, error: null }; }
        if (table === 'tenants') return { data: { id: 't1', tenant_settings: { basic: { tenantName: 'Shop', ...(state.tz === undefined ? {} : { timezone: state.tz }) } } }, error: null };
        if (table === 'trip_plans') {
          return {
            data: {
              id: '11111111-1111-4111-8111-111111111111', trip_id: 'trip1', name: 'P', description: '', price_per_person: 1000,
              price_type: state.priceType, min_party: 1, max_party: 6, sales_mode: state.mode,
              active: true, request_hold_hours: 12,
            },
            error: null,
          };
        }
        if (table === 'trips') return { data: { id: 'trip1', title: 'T', status: 'PUBLISHED', refund_policy_type: 'STANDARD' }, error: null };
        if (table === 'trip_departures') {
          state.depFilters = { ...filters };
          if (state.depRows) return { data: state.depRows.map((r, i) => ({ id: `r${i}`, ...r, capacity: 5, seats_booked: 0 })), error: null };
          return { data: state.departs.map((d, i) => ({ id: `d${i}`, departs_on: d, start_time: '09:00:00', capacity: 5, seats_booked: 0 })), error: null };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain, order: () => chain, range: () => chain, in: (k: string, v: unknown) => { filters['in_' + k] = v; return chain; }, gte: (k: string, v: unknown) => { filters['gte_' + k] = v; return chain; },
        eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
        maybeSingle: () => run(),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));

import { canSubmitBooking, resolveBookingTotal, seasonalHeadlineKind } from '@/lib/public-booking-price';
import { loadPublicBookingPlan } from '@/server/public-tour-booking';
import { loadPublicRequestPlan } from '@/server/public-tour-request';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const season = (over: Record<string, unknown> = {}) => ({
  id: 's1', plan_id: PLAN_ID, start_month: 7, start_day: 1, end_month: 8, end_day: 31, price_override: 3000, sort_order: 0, ...over,
});
const PLAN_ID = '11111111-1111-4111-8111-111111111111';

describe('#11 resolveBookingTotal（與 0132 同順序：季節單價 → PER_GROUP 一口價／PER_PERSON × 人數）', () => {
  it.each([
    ['PER_PERSON 無季節（基本價 1000）× 3 人', { unitPrice: undefined }, { pricePerPerson: 1000, priceType: 'PER_PERSON' as const }, 3, { unitPrice: 1000, total: 3000 }],
    ['PER_PERSON 有季節（2500）× 3 人', { unitPrice: 2500 }, { pricePerPerson: 1000, priceType: 'PER_PERSON' as const, seasonalPricing: true }, 3, { unitPrice: 2500, total: 7500 }],
    ['PER_GROUP 無季節：一口價 1000，與人數無關', { unitPrice: undefined }, { pricePerPerson: 1000, priceType: 'PER_GROUP' as const }, 4, { unitPrice: 1000, total: 1000 }],
    ['PER_GROUP 有季節（8000）：一口價 8000，與人數無關', { unitPrice: 8000 }, { pricePerPerson: 1000, priceType: 'PER_GROUP' as const, seasonalPricing: true }, 4, { unitPrice: 8000, total: 8000 }],
    ['季節 override 為 0（免費價）', { unitPrice: 0 }, { pricePerPerson: 1000, priceType: 'PER_PERSON' as const, seasonalPricing: true }, 2, { unitPrice: 0, total: 0 }],
  ])('%s', (_l, dep, plan, party, expected) => {
    expect(resolveBookingTotal(dep, plan, party)).toEqual(expected);
  });

  it('沒選團次、人數無效、或方案有季節但團次沒有 unitPrice（資料不完整）→ null（不顯示金額）', () => {
    const plan = { pricePerPerson: 1000, priceType: 'PER_PERSON' as const };
    expect(resolveBookingTotal(undefined, plan, 2)).toBeNull();
    expect(resolveBookingTotal({ unitPrice: 1 }, plan, 0)).toBeNull();
    expect(resolveBookingTotal({ unitPrice: 1 }, plan, 1.5)).toBeNull();
    expect(resolveBookingTotal({}, { ...plan, seasonalPricing: true }, 2)).toBeNull();
  });
});

describe('#11 canSubmitBooking（季節價算不出金額時不可送出）', () => {
  const ok = { departureId: 'd1', contactName: 'Amy', hasContact: true, partySize: 2, minParty: 1, maxParty: 4, submitting: false };
  it('無季節：與舊行為相同（不依賴 bookingTotal）', () => {
    expect(canSubmitBooking({ ...ok, bookingTotal: null })).toBe(true);
    expect(canSubmitBooking({ ...ok, seasonalPricing: false, bookingTotal: null })).toBe(true);
  });
  it('有季節且有總額 → 可送出', () => {
    expect(canSubmitBooking({ ...ok, seasonalPricing: true, bookingTotal: { total: 1 } })).toBe(true);
  });
  it('有季節但總額為 null → 不可送出', () => {
    expect(canSubmitBooking({ ...ok, seasonalPricing: true, bookingTotal: null })).toBe(false);
  });
  it.each([
    ['沒選團次', { departureId: '' }],
    ['姓名空白', { contactName: '   ' }],
    ['沒有聯絡方式', { hasContact: false }],
    ['人數低於下限', { partySize: 0 }],
    ['人數高於上限', { partySize: 5 }],
    ['送出中', { submitting: true }],
  ])('原必填條件：%s → 不可送出（有無季節皆同）', (_l, over) => {
    expect(canSubmitBooking({ ...ok, ...over, bookingTotal: { total: 1 } })).toBe(false);
    expect(canSubmitBooking({ ...ok, ...over, seasonalPricing: true, bookingTotal: { total: 1 } })).toBe(false);
  });
  it('金額無法確認時的畫面文案', () => {
    expect(read('src/i18n/zh-TW/pages/public-tour-booking.ts')).toContain('目前無法確認此日期的金額，請聯絡店家或改選其他日期。');
    expect(read('src/i18n/zh-TW/pages/public-tour-request.ts')).toContain('目前無法確認此日期的金額，請聯絡店家或改選其他日期。');
  });
});

describe('#11 seasonalHeadlineKind', () => {
  it.each([
    ['沒有季節定價 → null（顯示基本價）', { departures: [{}] }, null],
    ['有季節且至少一個團次有 unitPrice → by-departure', { seasonalPricing: true, departures: [{}, { unitPrice: 1 }] }, 'by-departure'],
    ['有季節但沒有任何團次有 unitPrice（INSTANT／未載入／查詢達上限）→ contact', { seasonalPricing: true, departures: [{}] }, 'contact'],
    ['有季節但沒有團次 → contact', { seasonalPricing: true, departures: [] }, 'contact'],
  ])('%s', (_l, plan, expected) => {
    expect(seasonalHeadlineKind(plan as never)).toBe(expected);
  });
});

describe('#11 預約頁 loader 的季節單價', () => {
  beforeEach(() => { state.mode = 'FIXED_DEPARTURE'; state.priceType = 'PER_PERSON'; state.seasons = []; state.seasonCalls = []; state.seasonError = false; state.departs = ['2098-07-15', '2098-09-15']; });

  it('命中季節的團次 unitPrice＝override，未命中＝基本價；方案標 seasonalPricing；查詢綁 tenant、plan、active', async () => {
    state.seasons = [season()];
    const plan = await loadPublicBookingPlan('shop', PLAN_ID);
    expect(plan?.seasonalPricing).toBe(true);
    expect(plan?.departures.map((d) => d.unitPrice)).toEqual([3000, 1000]);
    expect(state.seasonCalls[0]).toMatchObject({ tenant_id: 't1', in_plan_id: [PLAN_ID], active: true });
  });

  it('S14：命中季節但 override 為 null → unitPrice 等於基本價，不是 0', async () => {
    state.seasons = [season({ price_override: null })];
    const plan = await loadPublicBookingPlan('shop', PLAN_ID);
    expect(plan?.departures[0].unitPrice).toBe(1000);
  });

  it('沒有季節 → 不輸出 unitPrice、不標 seasonalPricing；達 1000 列（資料不完整）→ 不輸出 unitPrice 但標 seasonalPricing', async () => {
    const none = await loadPublicBookingPlan('shop', PLAN_ID);
    expect(none).not.toHaveProperty('seasonalPricing');
    expect(none?.departures[0]).not.toHaveProperty('unitPrice');
    state.seasons = Array.from({ length: 1000 }, (_, i) => season({ id: `s${i}`, price_override: 1 }));
    const incomplete = await loadPublicBookingPlan('shop', PLAN_ID);
    expect(incomplete?.seasonalPricing).toBe(true);
    expect(incomplete?.departures[0]).not.toHaveProperty('unitPrice');
  });
});

describe('#11 X2：季節查詢失敗時降級，不讓預約頁／申請頁／送出流程失敗', () => {
  beforeEach(() => { state.mode = 'FIXED_DEPARTURE'; state.seasons = []; state.seasonCalls = []; state.seasonError = true; state.departs = ['2098-07-15']; });
  afterEach(() => { state.seasonError = false; });

  it('預約 loader：照常回傳團次（沒有 unitPrice）、seasonalPricing=true、英文固定 warn 且不含 tenant 識別', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = await loadPublicBookingPlan('shop', PLAN_ID);
    expect(plan?.departures).toHaveLength(1);
    expect(plan?.departures[0]).not.toHaveProperty('unitPrice');
    expect(plan?.seasonalPricing).toBe(true);
    expect(warn).toHaveBeenCalledWith('public plan seasons query failed; degrading to no unit prices');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('t1');
    warn.mockRestore();
  });

  it('申請 loader 同樣降級', async () => {
    state.mode = 'REQUEST';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = await loadPublicRequestPlan('shop', PLAN_ID);
    expect(plan?.departures).toHaveLength(1);
    expect(plan?.seasonalPricing).toBe(true);
    warn.mockRestore();
  });

  it('送出流程路徑（withSeasonPrices:false）完全不查季節，也不受季節錯誤影響', async () => {
    const plan = await loadPublicBookingPlan('shop', PLAN_ID, { withSeasonPrices: false });
    expect(plan?.departures).toHaveLength(1);
    expect(state.seasonCalls).toHaveLength(0);
    expect(plan).not.toHaveProperty('seasonalPricing');
    state.mode = 'REQUEST';
    expect((await loadPublicRequestPlan('shop', PLAN_ID, { withSeasonPrices: false }))?.departures).toHaveLength(1);
    expect(state.seasonCalls).toHaveLength(0);
  });

  it('送出 API／submit 都以 withSeasonPrices:false 呼叫 loader（source pin）', () => {
    for (const f of ['src/app/api/public/tour-bookings/route.ts', 'src/app/api/public/tour-requests/route.ts',
      'src/server/public-tour-booking.ts', 'src/server/public-tour-request.ts']) {
      expect(read(f)).toMatch(/\{ withSeasonPrices: false \}\);/);
    }
  });
});

describe('#11 預約頁／申請頁使用店家時區判斷今天與已開始的團次', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2098-01-02T02:00:00Z')); // 台北 1/2 10:00；洛杉磯 1/1 18:00
    state.seasons = []; state.seasonError = false; state.mode = 'FIXED_DEPARTURE'; state.priceType = 'PER_PERSON';
    state.depRows = [
      { departs_on: '2098-01-01', start_time: '17:00:00' },
      { departs_on: '2098-01-01', start_time: '19:00:00' },
      { departs_on: '2098-01-01', start_time: null },
      { departs_on: '2098-01-02', start_time: '09:00:00' },
      { departs_on: '2098-01-02', start_time: '11:00:00' },
    ];
  });
  afterEach(() => { vi.useRealTimers(); state.tz = undefined; state.depRows = undefined; state.mode = 'FIXED_DEPARTURE'; });

  const loaders = [
    ['預約頁', (o?: { withSeasonPrices?: boolean }) => loadPublicBookingPlan('shop', PLAN_ID, o), 'FIXED_DEPARTURE'],
    ['申請頁', (o?: { withSeasonPrices?: boolean }) => loadPublicRequestPlan('shop', PLAN_ID, o), 'REQUEST'],
  ] as const;

  it.each(loaders)('%s：洛杉磯晚間列出洛杉磯當天尚未開始的團次（今天＝1/1、17:00 已過排除），查詢下界為店家今天', async (_n, load, mode) => {
    state.mode = mode;
    state.tz = 'America/Los_Angeles';
    const plan = await load();
    expect(state.depFilters.gte_departs_on).toBe('2098-01-01');
    expect(plan?.departures.map((d) => d.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it.each(loaders)('%s：時區缺值或無效回退台北（今天＝1/2，09:00 已過排除）', async (_n, load, mode) => {
    state.mode = mode;
    for (const tz of [undefined, 'Mars/Phobos']) {
      state.tz = tz;
      const plan = await load();
      expect(state.depFilters.gte_departs_on).toBe('2098-01-02');
      expect(plan?.departures.map((d) => d.id)).toContain('r4');
      expect(plan?.departures.map((d) => d.id)).not.toContain('r3');
    }
  });

  it.each(loaders)('%s：送出路徑（withSeasonPrices:false）套用同一份 today 與已開始規則', async (_n, load, mode) => {
    state.mode = mode;
    state.tz = 'America/Los_Angeles';
    const plan = await load({ withSeasonPrices: false });
    expect(state.depFilters.gte_departs_on).toBe('2098-01-01');
    expect(plan?.departures.map((d) => d.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('#11 申請頁 loader（REQUEST 同樣經 create_tour_order，依出發日套用季節價）', () => {
  it('REQUEST 方案的團次帶季節 unitPrice；override 為 null 用基本價', async () => {
    state.mode = 'REQUEST';
    state.priceType = 'PER_GROUP';
    state.departs = ['2098-07-15', '2098-09-15'];
    state.seasons = [season()];
    const plan = await loadPublicRequestPlan('shop', PLAN_ID);
    expect(plan?.seasonalPricing).toBe(true);
    expect(plan?.departures.map((d) => d.unitPrice)).toEqual([3000, 1000]);
    state.seasons = [season({ price_override: null })];
    expect((await loadPublicRequestPlan('shop', PLAN_ID))?.departures[0].unitPrice).toBe(1000);
  });
});

describe('#11 表單與 client 接線 pin', () => {
  const forms = [
    'src/app/s/[shopCode]/plans/[planId]/book/BookingForm.tsx',
    'src/app/s/[shopCode]/plans/[planId]/request/RequestForm.tsx',
  ];

  it.each(forms)('%s（X1）：canSubmit 經由 canSubmitBooking（含 seasonalPricing 與 bookingTotal）', (file) => {
    const src = read(file);
    expect(src).toMatch(/const canSubmit = canSubmitBooking\(\{[\s\S]*?seasonalPricing: plan\.seasonalPricing, bookingTotal,[\s\S]*?\}\);/);
    expect(src).toMatch(/import \{[^}]*canSubmitBooking[^}]*\} from '@\/lib\/public-booking-price'/);
  });

  it.each(forms)('%s：摘要只使用 resolveBookingTotal 的結果，不直接用 pricePerPerson 計算', (file) => {
    const src = read(file);
    expect(src).toMatch(/const bookingTotal = resolveBookingTotal\(selectedDeparture, plan, partySize\);/);
    expect(src).toMatch(/bookingTotal\.total/);
    expect(src).not.toMatch(/plan\.pricePerPerson\s*\*/);
    expect(src).not.toMatch(/\*\s*plan\.pricePerPerson/);
    expect(src).toMatch(/seasonalHeadlineKind\(plan\) === 'by-departure'/);
    expect(src).toMatch(/d\.unitPrice !== undefined \? t\.form\.departurePrice\(formatCurrency\(d\.unitPrice\)/);
  });

  it('詳情 client 顯示團次 unitPrice，並以 seasonalHeadlineKind 決定標題', () => {
    const client = read('src/components/public/PublicTripDetailsClient.tsx');
    expect(client).toMatch(/departure\.unitPrice !== undefined\s*\?\s*<span[^>]*>\{t\.plans\.price\(formatCurrency\(departure\.unitPrice\)/);
    expect(client).toMatch(/seasonalHeadlineKind\(plan\) === 'by-departure' \? t\.plans\.seasonalHeadline/);
  });

  it('H3：PublicContactActions 經過 phoneContact', () => {
    expect(read('src/components/public/PublicContactActions.tsx')).toMatch(/const phone = phoneContact\(shop\);/);
  });
});
