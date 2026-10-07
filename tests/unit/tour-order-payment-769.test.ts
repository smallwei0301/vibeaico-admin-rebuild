/**
 * #769：已接受未付款（CONFIRMED + UNPAID + seats_reserved）的申請單可登記收款，
 * 且逾期 cron 的掃描範圍涵蓋 CONFIRMED + UNPAID。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canRegisterTourOrderPayment } from '@/server/tour-domain';

const state = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  casResult: null as Record<string, unknown> | null,
  update: null as Record<string, unknown> | null,
  eqCalls: [] as Array<[string, unknown]>,
  cronEq: [] as Array<[string, unknown]>,
  cronRows: {} as Record<string, Array<{ id: string; tenant_id: string }>>,
  rpcResults: [] as boolean[],
}));

vi.mock('@/server/http', async () => {
  const actual = await vi.importActual<typeof import('@/server/http')>('@/server/http');
  return { ...actual, handle: (fn: unknown) => fn };
});
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tour-orders', () => ({
  hydrateTourOrders: async (_s: unknown, _t: unknown, rows: unknown[]) => rows,
  TOUR_ORDER_AUTO_EXPIRE_REASON: 'auto-expire',
}));
vi.mock('@/server/tenant', () => ({
  requireTenantManager: async () => ({
    tenantId: 't1',
    supabase: {
      from: () => ({
        select: () => {
          const q: any = {
            eq: () => q,
            maybeSingle: async () => ({ data: state.current, error: null }),
          };
          return q;
        },
        update: (patch: Record<string, unknown>) => {
          state.update = patch;
          const q: any = {
            eq: (k: string, v: unknown) => { state.eqCalls.push([k, v]); return q; },
            select: () => q,
            maybeSingle: async () => ({ data: state.casResult, error: null }),
          };
          return q;
        },
      }),
    },
  }),
}));
vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from: () => {
      let status = '';
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          if (k === 'status') status = String(v); else state.cronEq.push([k, v]);
          return q;
        },
        not: () => q, lt: () => q, order: () => q,
        limit: async () => ({ data: state.cronRows[status] ?? [], error: null }),
      };
      return q;
    },
    rpc: async () => ({ data: state.rpcResults.shift() ?? false, error: null }),
  }),
}));

const ctx = { params: Promise.resolve({ id: 'o1' }) };
const req = new Request('http://x/api/tour-orders/o1/confirm-payment', { method: 'POST' });

beforeEach(() => {
  state.current = null; state.casResult = null; state.update = null;
  state.eqCalls = []; state.cronEq = []; state.cronRows = {}; state.rpcResults = [];
});

describe('canRegisterTourOrderPayment', () => {
  it('PENDING 恆可；CONFIRMED 僅限 UNPAID 且已鎖名額；其餘不可', () => {
    expect(canRegisterTourOrderPayment({ status: 'PENDING', paymentStatus: 'UNPAID', seatsReserved: false })).toBe(true);
    expect(canRegisterTourOrderPayment({ status: 'CONFIRMED', paymentStatus: 'UNPAID', seatsReserved: true })).toBe(true);
    expect(canRegisterTourOrderPayment({ status: 'CONFIRMED', paymentStatus: 'PAID', seatsReserved: true })).toBe(false);
    expect(canRegisterTourOrderPayment({ status: 'CONFIRMED', paymentStatus: 'PARTIAL', seatsReserved: true })).toBe(false);
    expect(canRegisterTourOrderPayment({ status: 'CONFIRMED', paymentStatus: 'UNPAID', seatsReserved: false })).toBe(false);
    expect(canRegisterTourOrderPayment({ status: 'CANCELLED', paymentStatus: 'UNPAID', seatsReserved: true })).toBe(false);
    expect(canRegisterTourOrderPayment({ status: 'COMPLETED', paymentStatus: 'UNPAID', seatsReserved: true })).toBe(false);
  });
});

describe('POST confirm-payment（#769）', () => {
  const load = async () => (await import('@/app/api/tour-orders/[id]/confirm-payment/route')).POST as unknown as
    (r: Request, c: typeof ctx) => Promise<Response>;

  it('PENDING 照舊：200，CAS 帶 status=PENDING 與 payment_status=UNPAID', async () => {
    state.current = { id: 'o1', status: 'PENDING', payment_status: 'UNPAID', total_amount: 500, seats_reserved: true };
    state.casResult = { id: 'o1', status: 'CONFIRMED' };
    const res = await (await load())(req, ctx);
    expect(res.status).toBe(200);
    expect(state.eqCalls).toContainEqual(['status', 'PENDING']);
    expect(state.eqCalls).toContainEqual(['payment_status', 'UNPAID']);
  });

  it('CONFIRMED + UNPAID + seats_reserved → 200，寫 PAID/paid_amount/hold null，status 仍 CONFIRMED', async () => {
    state.current = { id: 'o1', status: 'CONFIRMED', payment_status: 'UNPAID', total_amount: 1200, seats_reserved: true };
    state.casResult = { id: 'o1', status: 'CONFIRMED', payment_status: 'PAID' };
    const res = await (await load())(req, ctx);
    expect(res.status).toBe(200);
    expect(state.update).toMatchObject({
      status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 1200, hold_expires_at: null,
    });
    expect(state.eqCalls).toContainEqual(['status', 'CONFIRMED']);
    expect(state.eqCalls).toContainEqual(['payment_status', 'UNPAID']);
  });

  it('CONFIRMED + PAID → 409，不寫入', async () => {
    state.current = { id: 'o1', status: 'CONFIRMED', payment_status: 'PAID', total_amount: 1200, seats_reserved: true };
    const res = await (await load())(req, ctx);
    expect(res.status).toBe(409);
    expect(state.update).toBeNull();
  });

  it('CONFIRMED + UNPAID 但 seats_reserved=false → 409，不寫入', async () => {
    state.current = { id: 'o1', status: 'CONFIRMED', payment_status: 'UNPAID', total_amount: 1200, seats_reserved: false };
    const res = await (await load())(req, ctx);
    expect(res.status).toBe(409);
    expect(state.update).toBeNull();
  });

  it('CAS 未命中（例如 cron 已先取消）→ 409', async () => {
    state.current = { id: 'o1', status: 'CONFIRMED', payment_status: 'UNPAID', total_amount: 1200, seats_reserved: true };
    state.casResult = null;
    const res = await (await load())(req, ctx);
    expect(res.status).toBe(409);
  });
});

describe('GET cron tour-order-expiry（#769）', () => {
  const load = async () => (await import('@/app/api/cron/tour-order-expiry/route')).GET;
  const cronReq = () => new Request('http://x/api/cron/tour-order-expiry', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });

  it('CONFIRMED 查詢帶 payment_status = UNPAID；RPC 回 false 不計入 cancelled', async () => {
    process.env.CRON_SECRET = 'secret';
    state.cronRows = { PENDING: [{ id: 'a', tenant_id: 't' }], CONFIRMED: [{ id: 'b', tenant_id: 't' }] };
    state.rpcResults = [true, false];
    const res = await (await load())(cronReq());
    expect(state.cronEq).toContainEqual(['payment_status', 'UNPAID']);
    expect(await res.json()).toEqual({ scanned: 2, cancelled: 1 });
  });

  it('CONFIRMED 查詢回滿 500 筆且 RPC 全 false 時，PENDING 列仍被處理並計入 cancelled', async () => {
    process.env.CRON_SECRET = 'secret';
    state.cronRows = {
      PENDING: [{ id: 'p1', tenant_id: 't' }, { id: 'p2', tenant_id: 't' }],
      CONFIRMED: Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, tenant_id: 't' })),
    };
    state.rpcResults = [true, true]; // PENDING 先處理；其餘（CONFIRMED）預設回 false
    const res = await (await load())(cronReq());
    expect(await res.json()).toEqual({ scanned: 502, cancelled: 2 });
  });
});
