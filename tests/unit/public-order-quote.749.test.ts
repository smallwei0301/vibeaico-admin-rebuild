/**
 * #749：公開下單金額鎖定。
 * - 有 expectedTotal → 呼叫 create_tour_order_quoted（含 p_expected_total）；沒有 → 舊 create_tour_order。
 * - RPC 回 PRICE_CHANGED（details JSON）→ 丟帶 quote 的錯誤。
 * - quoted RPC 不存在（PGRST202）→ 非原子預檢 fallback 的三個分支。
 * - route：PRICE_CHANGED → 409 + ERR.PRICE_CHANGED + data.quote。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcImpl: (() => ({ data: 'order-1', error: null })) as (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown },
  seasons: [] as Array<Record<string, unknown>>,
  seasonsError: false,
  planPrice: 1000,
  salesMode: 'FIXED_DEPARTURE',
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const TENANT = 'tenant-1';
const PLAN = '11111111-1111-1111-1111-111111111111';
const DEPARTURE = '22222222-2222-2222-2222-222222222222';

vi.mock('@/server/tour-order-no', () => ({ nextTourOrderNo: async () => 'ORD-749' }));
vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      fx.rpcCalls.push({ name, args });
      return fx.rpcImpl(name, args);
    },
    from(table: string) {
      let single = false;
      const result = () => {
        if (table === 'tenants') return { data: { id: TENANT, tenant_settings: null }, error: null };
        if (table === 'trip_plans') {
          const row = { id: PLAN, trip_id: 't1', name: 'p', description: '', price_per_person: fx.planPrice, price_type: 'PER_PERSON', min_party: 1, max_party: 8, sales_mode: fx.salesMode, request_hold_hours: 12, active: true };
          return { data: single ? row : [row], error: null };
        }
        if (table === 'trips') return { data: { id: 't1', title: 't', status: 'PUBLISHED', refund_policy_type: 'STANDARD' }, error: null };
        if (table === 'trip_departures') {
          return { data: [{ id: DEPARTURE, departs_on: '2098-07-15', start_time: null, capacity: 8, seats_booked: 0 }], error: null };
        }
        if (table === 'trip_plan_seasons') {
          return fx.seasonsError ? { data: null, error: { message: 'boom' } } : { data: fx.seasons, error: null };
        }
        return { data: null, error: null };
      };
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'gte', 'order', 'range']) b[m] = () => b;
      b.maybeSingle = async () => { single = true; return result(); };
      b.single = async () => { single = true; return result(); };
      b.then = (resolve: (v: unknown) => unknown) => resolve(result());
      return b;
    },
  }),
}));

import {
  PublicTourBookingError, submitPublicTourBooking, submitPublicTourBookingSchema,
  type SubmitPublicTourBookingInput,
} from '@/server/public-tour-booking';
import { PublicTourRequestError, submitPublicTourRequest, submitPublicTourRequestSchema } from '@/server/public-tour-request';
import { parsePriceChangedQuote, isMissingFunctionError } from '@/server/public-order-quote';

const baseBooking = (extra: Record<string, unknown> = {}): SubmitPublicTourBookingInput => submitPublicTourBookingSchema.parse({
  shopCode: 'demo-shop', planId: PLAN, departureId: DEPARTURE, partySize: 2,
  contactName: '王小明', contactPhone: '0912345678', ...extra,
});
const baseRequest = (extra: Record<string, unknown> = {}) => submitPublicTourRequestSchema.parse({
  shopCode: 'demo-shop', planId: PLAN, departureId: DEPARTURE, partySize: 2,
  contactName: '王小明', contactPhone: '0912345678', ...extra,
});

const priceChanged = { code: 'P0004', message: 'PRICE_CHANGED', details: JSON.stringify({ unitPrice: 1200, total: 2400 }) };
const missingFn = { code: 'PGRST202', message: 'Could not find the function public.create_tour_order_quoted' };

beforeEach(() => {
  fx.rpcCalls.length = 0;
  fx.seasons = [];
  fx.seasonsError = false;
  fx.planPrice = 1000;
  fx.salesMode = 'FIXED_DEPARTURE';
  fx.rpcImpl = () => ({ data: 'order-1', error: null });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('schema', () => {
  it('expectedTotal 選填、可為 0、不可為負', () => {
    expect(baseBooking().expectedTotal).toBeUndefined();
    expect(baseBooking({ expectedTotal: '2000' }).expectedTotal).toBe(2000);
    expect(baseBooking({ expectedTotal: 0 }).expectedTotal).toBe(0);
    expect(submitPublicTourBookingSchema.safeParse({ shopCode: 's', planId: PLAN, departureId: DEPARTURE, partySize: 1, contactName: 'a', contactPhone: '1', expectedTotal: -1 }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('parsePriceChangedQuote：解析 details，失敗回 undefined', () => {
    expect(parsePriceChangedQuote(priceChanged)).toEqual({ unitPrice: 1200, total: 2400 });
    expect(parsePriceChangedQuote({ message: 'PRICE_CHANGED', details: 'not json' })).toBeUndefined();
    expect(parsePriceChangedQuote({ message: 'PRICE_CHANGED', details: '{}' })).toBeUndefined();
    expect(parsePriceChangedQuote({ message: 'PRICE_CHANGED' })).toBeUndefined();
  });
  it('isMissingFunctionError：PGRST202／42883／訊息', () => {
    expect(isMissingFunctionError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunctionError({ code: '42883' })).toBe(true);
    expect(isMissingFunctionError({ message: 'Could not find the function x' })).toBe(true);
    expect(isMissingFunctionError({ code: 'P0004', message: 'PRICE_CHANGED' })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});

describe.each([
  ['booking', 'FIXED_DEPARTURE', (extra: Record<string, unknown>) => submitPublicTourBooking(baseBooking(extra)), PublicTourBookingError],
  ['request', 'REQUEST', (extra: Record<string, unknown>) => submitPublicTourRequest(baseRequest(extra)), PublicTourRequestError],
] as const)('submit (%s)', (_name, mode, submit, ErrorClass) => {
  beforeEach(() => { fx.salesMode = mode; });

  it('沒有 expectedTotal：沿用 create_tour_order', async () => {
    await expect(submit({})).resolves.toEqual({ orderId: 'order-1', orderNo: 'ORD-749' });
    expect(fx.rpcCalls.map((c) => c.name)).toEqual(['create_tour_order']);
    expect(fx.rpcCalls[0].args).not.toHaveProperty('p_expected_total');
  });

  it('有 expectedTotal：呼叫 create_tour_order_quoted 並帶 p_expected_total', async () => {
    await expect(submit({ expectedTotal: 2000 })).resolves.toEqual({ orderId: 'order-1', orderNo: 'ORD-749' });
    expect(fx.rpcCalls.map((c) => c.name)).toEqual(['create_tour_order_quoted']);
    expect(fx.rpcCalls[0].args).toMatchObject({ p_expected_total: 2000, p_departure: DEPARTURE, p_party_size: 2 });
  });

  it('RPC 回 PRICE_CHANGED：丟帶 quote 的錯誤', async () => {
    fx.rpcImpl = () => ({ data: null, error: priceChanged });
    const err = await submit({ expectedTotal: 2000 }).catch((e) => e);
    expect(err).toBeInstanceOf(ErrorClass);
    expect(err.code).toBe('PRICE_CHANGED');
    expect(err.quote).toEqual({ unitPrice: 1200, total: 2400 });
  });

  it('PRICE_CHANGED 的 details 解析失敗：不帶 quote', async () => {
    fx.rpcImpl = () => ({ data: null, error: { code: 'P0004', message: 'PRICE_CHANGED', details: 'x' } });
    const err = await submit({ expectedTotal: 2000 }).catch((e) => e);
    expect(err.code).toBe('PRICE_CHANGED');
    expect(err.quote).toBeUndefined();
  });

  describe('quoted RPC 不存在（0137 尚未套用）的非原子 fallback', () => {
    beforeEach(() => {
      fx.rpcImpl = (name) => (name === 'create_tour_order_quoted'
        ? { data: null, error: missingFn }
        : { data: 'order-legacy', error: null });
    });

    it('預檢金額相符 → 改呼叫舊 create_tour_order', async () => {
      await expect(submit({ expectedTotal: 2000 })).resolves.toEqual({ orderId: 'order-legacy', orderNo: 'ORD-749' });
      expect(fx.rpcCalls.map((c) => c.name)).toEqual(['create_tour_order_quoted', 'create_tour_order']);
      expect(console.warn).toHaveBeenCalledWith('create_tour_order_quoted unavailable; using non-atomic price precheck');
    });

    it('預檢金額不符 → PRICE_CHANGED 帶現價，且不呼叫舊 RPC', async () => {
      fx.planPrice = 1200;
      const err = await submit({ expectedTotal: 2000 }).catch((e) => e);
      expect(err.code).toBe('PRICE_CHANGED');
      expect(err.quote).toEqual({ unitPrice: 1200, total: 2400 });
      expect(fx.rpcCalls.map((c) => c.name)).toEqual(['create_tour_order_quoted']);
    });

    it('季節價生效時以季節單價預檢', async () => {
      fx.seasons = [{ id: 's1', plan_id: PLAN, start_month: 7, start_day: 1, end_month: 7, end_day: 31, price_override: 1500, sort_order: 0 }];
      const err = await submit({ expectedTotal: 2000 }).catch((e) => e);
      expect(err.code).toBe('PRICE_CHANGED');
      expect(err.quote).toEqual({ unitPrice: 1500, total: 3000 });
      await expect(submit({ expectedTotal: 3000 })).resolves.toMatchObject({ orderId: 'order-legacy' });
    });

    it('季節資料不完整 → PRICE_UNVERIFIABLE，不建單', async () => {
      fx.seasonsError = true;
      const err = await submit({ expectedTotal: 2000 }).catch((e) => e);
      expect(err).toBeInstanceOf(ErrorClass);
      expect(err.code).toBe('PRICE_UNVERIFIABLE');
      expect(fx.rpcCalls.map((c) => c.name)).toEqual(['create_tour_order_quoted']);
    });
  });
});

describe('routes', () => {
  beforeEach(() => { vi.resetModules(); });

  it.each([
    ['tour-bookings', '@/server/public-tour-booking', 'PublicTourBookingError', 'submitPublicTourBooking', 'loadPublicBookingPlan'],
    ['tour-requests', '@/server/public-tour-request', 'PublicTourRequestError', 'submitPublicTourRequest', 'loadPublicRequestPlan'],
  ])('%s：PRICE_CHANGED → 409 + TOUR_003 + data.quote；PRICE_UNVERIFIABLE → 409 + TOUR_004', async (dir, mod, errName, submitName, loadName) => {
    const state = { error: null as unknown };
    vi.doMock(mod, async (importOriginal) => {
      const actual = await importOriginal<Record<string, unknown>>();
      return {
        ...actual,
        [loadName]: async () => ({ tenantId: TENANT }),
        [submitName]: async () => { throw state.error; },
      };
    });
    vi.doMock('@/server/features', () => ({ isFeatureActive: async () => true }));
    const actual = await import(mod);
    const Err = actual[errName] as new (code: string, message: string, quote?: unknown) => Error;
    const { POST } = await import(`@/app/api/public/${dir}/route`);
    const call = () => POST(new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ shopCode: 'demo-shop', planId: PLAN, departureId: DEPARTURE, partySize: 2, contactName: 'a', contactPhone: '1', expectedTotal: 2000 }),
    }));

    state.error = new Err('PRICE_CHANGED', '價格已更新', { unitPrice: 1200, total: 2400 });
    let res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false, message: '價格已更新', code: 'TOUR_003', data: { quote: { unitPrice: 1200, total: 2400 } },
    });

    state.error = new Err('PRICE_CHANGED', '價格已更新');
    res = await call();
    const noQuote = await res.json();
    expect(res.status).toBe(409);
    expect(noQuote.code).toBe('TOUR_003');
    expect(noQuote).not.toHaveProperty('data');

    state.error = new Err('PRICE_UNVERIFIABLE', '無法確認');
    res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('TOUR_004');
  });
});
