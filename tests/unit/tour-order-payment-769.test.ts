/**
 * #769：已接受未付款（CONFIRMED + UNPAID + seats_reserved）的申請單可登記收款，
 * 且逾期 cron 的掃描範圍涵蓋 CONFIRMED + UNPAID。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canRegisterDepositPayment, canRegisterFullPayment, hasPartialDeposit, isAwaitingPayment } from '@/server/tour-domain';

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
const jsonReq = (body: unknown) => new Request('http://x/api/tour-orders/o1/confirm-payment', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

beforeEach(() => {
  state.current = null; state.casResult = null; state.update = null;
  state.eqCalls = []; state.cronEq = []; state.cronRows = {}; state.rpcResults = [];
});

describe('hasPartialDeposit／canRegisterFullPayment／canRegisterDepositPayment', () => {
  it('hasPartialDeposit：0 < deposit < total 才成立', () => {
    expect(hasPartialDeposit({ depositAmount: 300, totalAmount: 1000 })).toBe(true);
    expect(hasPartialDeposit({ depositAmount: 0, totalAmount: 1000 })).toBe(false);
    expect(hasPartialDeposit({ depositAmount: 1000, totalAmount: 1000 })).toBe(false);
    expect(hasPartialDeposit({ depositAmount: 1200, totalAmount: 1000 })).toBe(false);
    expect(hasPartialDeposit({ depositAmount: null, totalAmount: 1000 })).toBe(false);
  });

  it('FULL：PENDING+UNPAID、CONFIRMED+UNPAID／PARTIAL（已鎖名額）可；其餘不可', () => {
    const f = canRegisterFullPayment;
    expect(f({ status: 'PENDING', paymentStatus: 'UNPAID', seatsReserved: false })).toBe(true);
    expect(f({ status: 'PENDING', paymentStatus: 'PAID', seatsReserved: true })).toBe(false);
    expect(f({ status: 'CONFIRMED', paymentStatus: 'UNPAID', seatsReserved: true })).toBe(true);
    expect(f({ status: 'CONFIRMED', paymentStatus: 'PARTIAL', seatsReserved: true })).toBe(true);
    expect(f({ status: 'CONFIRMED', paymentStatus: 'PAID', seatsReserved: true })).toBe(false);
    expect(f({ status: 'CONFIRMED', paymentStatus: 'UNPAID', seatsReserved: false })).toBe(false);
    expect(f({ status: 'CANCELLED', paymentStatus: 'UNPAID', seatsReserved: true })).toBe(false);
    expect(f({ status: 'COMPLETED', paymentStatus: 'UNPAID', seatsReserved: true })).toBe(false);
  });

  it('DEPOSIT：僅 CONFIRMED+UNPAID+已鎖名額且有部分訂金', () => {
    const base = { status: 'CONFIRMED' as const, paymentStatus: 'UNPAID', seatsReserved: true, depositAmount: 300, totalAmount: 1000 };
    expect(canRegisterDepositPayment(base)).toBe(true);
    expect(canRegisterDepositPayment({ ...base, depositAmount: 0 })).toBe(false);
    expect(canRegisterDepositPayment({ ...base, depositAmount: 1000 })).toBe(false);
    expect(canRegisterDepositPayment({ ...base, paymentStatus: 'PARTIAL' })).toBe(false);
    expect(canRegisterDepositPayment({ ...base, paymentStatus: 'PAID' })).toBe(false);
    expect(canRegisterDepositPayment({ ...base, status: 'PENDING' })).toBe(false);
    expect(canRegisterDepositPayment({ ...base, seatsReserved: false })).toBe(false);
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

describe('POST confirm-payment kind（#769 訂金／全額）', () => {
  const load = async () => (await import('@/app/api/tour-orders/[id]/confirm-payment/route')).POST as unknown as
    (r: Request, c: typeof ctx) => Promise<Response>;
  const row = (over: Record<string, unknown>) => ({
    id: 'o1', status: 'CONFIRMED', payment_status: 'UNPAID', total_amount: 1000, deposit_amount: 300, seats_reserved: true, ...over,
  });

  it('DEPOSIT 成功：寫 PARTIAL、paid=deposit_amount、hold null；CAS 帶 CONFIRMED+UNPAID', async () => {
    state.current = row({}); state.casResult = { id: 'o1' };
    const res = await (await load())(jsonReq({ kind: 'DEPOSIT' }), ctx);
    expect(res.status).toBe(200);
    expect(state.update).toMatchObject({
      status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 300, hold_expires_at: null,
    });
    expect(state.eqCalls).toContainEqual(['status', 'CONFIRMED']);
    expect(state.eqCalls).toContainEqual(['payment_status', 'UNPAID']);
  });

  it.each([
    ['無訂金', { deposit_amount: 0 }],
    ['訂金=total', { deposit_amount: 1000 }],
    ['已 PARTIAL', { payment_status: 'PARTIAL' }],
    ['已 PAID', { payment_status: 'PAID' }],
    ['PENDING', { status: 'PENDING' }],
  ])('DEPOSIT 對%s → 409，不寫入', async (_n, over) => {
    state.current = row(over);
    const res = await (await load())(jsonReq({ kind: 'DEPOSIT' }), ctx);
    expect(res.status).toBe(409);
    expect(state.update).toBeNull();
  });

  it('DEPOSIT 的金額取 DB 值，不信 body 帶的 amount', async () => {
    state.current = row({}); state.casResult = { id: 'o1' };
    await (await load())(jsonReq({ kind: 'DEPOSIT', amount: 999 }), ctx);
    expect(state.update).toMatchObject({ paid_amount: 300 });
  });

  it('FULL 從 CONFIRMED+PARTIAL 補尾款：PAID、paid=total，CAS 帶 payment_status=PARTIAL', async () => {
    state.current = row({ payment_status: 'PARTIAL' }); state.casResult = { id: 'o1' };
    const res = await (await load())(jsonReq({ kind: 'FULL' }), ctx);
    expect(res.status).toBe(200);
    expect(state.update).toMatchObject({ payment_status: 'PAID', paid_amount: 1000, hold_expires_at: null, status: 'CONFIRMED' });
    expect(state.eqCalls).toContainEqual(['payment_status', 'PARTIAL']);
  });

  it('FULL 從 CONFIRMED+UNPAID（有訂金方案也可一次收全額）', async () => {
    state.current = row({}); state.casResult = { id: 'o1' };
    const res = await (await load())(jsonReq({ kind: 'FULL' }), ctx);
    expect(res.status).toBe(200);
    expect(state.update).toMatchObject({ payment_status: 'PAID', paid_amount: 1000 });
    expect(state.eqCalls).toContainEqual(['payment_status', 'UNPAID']);
  });

  it('空 body 與 `{}` = FULL', async () => {
    state.current = row({ deposit_amount: 0 }); state.casResult = { id: 'o1' };
    expect((await (await load())(req, ctx)).status).toBe(200);
    expect(state.update).toMatchObject({ payment_status: 'PAID' });
    state.update = null;
    expect((await (await load())(jsonReq({}), ctx)).status).toBe(200);
    expect(state.update).toMatchObject({ payment_status: 'PAID' });
  });

  it('超大 body（content-length 與實際皆超限）→ 413，不寫入', async () => {
    state.current = row({});
    const big = JSON.stringify({ kind: 'FULL', pad: 'a'.repeat(17 * 1024) });
    await expect((await load())(jsonReq(big), ctx)).rejects.toMatchObject({ status: 413 });
    expect(state.update).toBeNull();
  });

  it('多位元組超限（字元數 < 16K、位元組 > 16K，無 content-length）→ 413', async () => {
    state.current = row({});
    const text = JSON.stringify({ kind: 'FULL', pad: '中'.repeat(6000) }); // ~6K 字元、~18K bytes
    expect(text.length).toBeLessThan(16 * 1024);
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
    const r = new Request('http://x/api/tour-orders/o1/confirm-payment', {
      method: 'POST', body, duplex: 'half',
    } as RequestInit);
    await expect((await load())(r, ctx)).rejects.toMatchObject({ status: 413 });
    expect(state.update).toBeNull();
  });

  it('kind 非法值或壞 JSON → 400，不寫入', async () => {
    state.current = row({});
    // 此檔把 handle() 換成直通，所以 zod／ApiHttpError 以 reject 呈現（真實 handle 會轉 400）。
    await expect((await load())(jsonReq({ kind: 'HALF' }), ctx)).rejects.toThrow();
    await expect((await load())(jsonReq('{bad'), ctx)).rejects.toMatchObject({ status: 400 });
    expect(state.update).toBeNull();
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

describe('isAwaitingPayment 待收款統計（#816 Codex P2）', () => {
  it('UNPAID 與 PARTIAL 計入', () => {
    expect(isAwaitingPayment({ status: 'CONFIRMED', paymentStatus: 'UNPAID' })).toBe(true);
    expect(isAwaitingPayment({ status: 'CONFIRMED', paymentStatus: 'PARTIAL' })).toBe(true);
  });
  it('PAID、已取消的 UNPAID／PARTIAL 不計入', () => {
    expect(isAwaitingPayment({ status: 'CONFIRMED', paymentStatus: 'PAID' })).toBe(false);
    expect(isAwaitingPayment({ status: 'CANCELLED', paymentStatus: 'UNPAID' })).toBe(false);
    expect(isAwaitingPayment({ status: 'CANCELLED', paymentStatus: 'PARTIAL' })).toBe(false);
  });
});
