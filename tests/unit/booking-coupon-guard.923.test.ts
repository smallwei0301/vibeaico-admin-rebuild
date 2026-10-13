/**
 * issue #923：已結案預約不可核銷票券或改價、核銷寫回失敗時還原票券、zod 錯誤訊息中文化。
 * 以假的 supabase 鏈式 client 驅動真實 route handler（行為層，非原始碼文字比對）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  sb: null as any,
}));

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ tenantId: 't1', supabase: state.sb }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));

import { POST as applyCoupon } from '../../src/app/api/bookings/[id]/apply-coupon/route';
import { POST as adjustPrice } from '../../src/app/api/bookings/[id]/adjust-price/route';
import { POST as addAddon } from '../../src/app/api/bookings/[id]/addons/route';
import { PUT as putBooking } from '../../src/app/api/bookings/[id]/route';

/** 記錄每次 update 與其 filter 的最小假 client。 */
function makeSb(opts: {
  booking?: Row | null;
  bookingUpdate?: { data: Row | null; error: any };
  couponUpdateCalls?: any[];
  revertError?: any;
  inst?: Row;
}) {
  const log: { table: string; op: string; patch?: Row; filters: [string, string, any][] }[] = [];
  const sb = {
    log,
    from(table: string) {
      const entry: any = { table, op: 'select', filters: [] };
      log.push(entry);
      const q: any = {
        select() { return q; },
        update(patch: Row) { entry.op = 'update'; entry.patch = patch; return q; },
        eq(c: string, v: any) { entry.filters.push(['eq', c, v]); return q; },
        is(c: string, v: any) { entry.filters.push(['is', c, v]); return q; },
        not(c: string, op: string, v: any) { entry.filters.push(['not:' + op, c, v]); return q; },
        maybeSingle() { return Promise.resolve(resolve()); },
        then(res: any, rej: any) { return Promise.resolve(resolve()).then(res, rej); },
      };
      function resolve() {
        if (table === 'bookings') {
          if (entry.op === 'select') return { data: opts.booking ?? null, error: null };
          return opts.bookingUpdate ?? { data: { id: 'b1' }, error: null };
        }
        if (table === 'product_orders') {
          if (entry.op === 'select') return { data: { id: 'o1', customer_id: 'c1', total_amount: 1000 }, error: null };
          return opts.bookingUpdate ?? { data: { id: 'o1' }, error: null };
        }
        if (table === 'coupon_instances') {
          if (entry.op === 'select') return { data: opts.inst, error: null };
          if (entry.patch?.redeemed_at === null) return { data: null, error: opts.revertError ?? null };
          return { data: { id: 'ci1' }, error: null };
        }
        return { data: null, error: null };
      }
      return q;
    },
  };
  return sb;
}

const inst = {
  id: 'ci1', customer_id: 'c1', redeemed_at: null,
  coupons: { discount_type: 'AMOUNT', discount_value: 100, start_at: null, end_at: null },
};
const booking = (status: string) => ({
  id: 'b1', status, customer_id: 'c1', final_price: 1000, custom_fields: {},
});
const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: 'b1' }) };
const redeemWrites = (sb: any) => sb.log.filter((e: any) =>
  e.table === 'coupon_instances' && e.op === 'update' && e.patch?.redeemed_at);
const reverts = (sb: any) => sb.log.filter((e: any) =>
  e.table === 'coupon_instances' && e.op === 'update' && e.patch?.redeemed_at === null);

beforeEach(() => { vi.restoreAllMocks(); });

describe('#923 票券核銷狀態守門', () => {
  for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) {
    it(`${status} 回 409 且完全不呼叫核銷`, async () => {
      state.sb = makeSb({ booking: booking(status), inst });
      const res = await applyCoupon(req({ code: 'X' }), ctx);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.message).toContain('無法核銷票券');
      expect(state.sb.log.some((e: any) => e.table === 'coupon_instances')).toBe(false);
    });
  }

  for (const status of ['PENDING', 'CONFIRMED']) {
    it(`${status} 可核銷`, async () => {
      state.sb = makeSb({ booking: booking(status), inst });
      const res = await applyCoupon(req({ code: 'X' }), ctx);
      expect(res.status).toBe(200);
      expect(reverts(state.sb)).toHaveLength(0);
    });
  }
});

describe('#923 核銷後寫回失敗（不做應用層補償，見 #925）', () => {
  it('bookings 寫回出錯：回 500，且不呼叫任何還原 redeemed_at 的 update', async () => {
    state.sb = makeSb({
      booking: booking('CONFIRMED'), inst,
      bookingUpdate: { data: null, error: { message: 'db down' } },
    });
    const res = await applyCoupon(req({ code: 'X' }), ctx);
    expect(res.status).toBe(500);
    expect(redeemWrites(state.sb)).toHaveLength(1);
    expect(reverts(state.sb)).toHaveLength(0);
  });
});

describe('#923 手動調價狀態守門', () => {
  for (const status of ['CANCELLED', 'NO_SHOW']) {
    it(`${status} 回 409 且不更新`, async () => {
      state.sb = makeSb({ booking: { id: 'b1', status } });
      const res = await adjustPrice(req({ finalPrice: 500 }), ctx);
      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain('無法調整金額');
      expect(state.sb.log.some((e: any) => e.op === 'update')).toBe(false);
    });
  }

  it('COMPLETED 仍可調，且更新帶 not in 條件', async () => {
    state.sb = makeSb({ booking: { id: 'b1', status: 'COMPLETED' } });
    const res = await adjustPrice(req({ finalPrice: 500 }), ctx);
    expect(res.status).toBe(200);
    const upd = state.sb.log.find((e: any) => e.op === 'update');
    expect(upd.filters).toContainEqual(['not:in', 'status', '(CANCELLED,NO_SHOW)']);
  });

  it('找不到預約仍是 404', async () => {
    state.sb = makeSb({ booking: null });
    const res = await adjustPrice(req({ finalPrice: 500 }), ctx);
    expect(res.status).toBe(404);
  });

  it('更新時狀態已被改成取消（影響 0 筆）回 409', async () => {
    state.sb = makeSb({ booking: { id: 'b1', status: 'CONFIRMED' }, bookingUpdate: { data: null, error: null } });
    const res = await adjustPrice(req({ finalPrice: 500 }), ctx);
    expect(res.status).toBe(409);
  });
});

describe('#923 zod 訊息中文', () => {
  const base = {
    name: '加購', price: 1, quantity: 1, durationMinutes: 0,
    performanceMode: 'INHERIT', idempotencyKey: 'k',
  };
  const hasLatin = (s: string) => /Invalid|enum|uuid/i.test(s);

  it('performanceMode 非法值', async () => {
    state.sb = makeSb({});
    const res = await addAddon(req({ ...base, performanceMode: 'BAD' }), ctx);
    expect(res.status).toBe(400);
    const m = (await res.json()).message;
    expect(m).toBe('業績歸戶方式不正確');
    expect(hasLatin(m)).toBe(false);
  });

  for (const field of ['serviceId', 'staffId', 'performanceStaffId']) {
    it(`${field} 非 uuid`, async () => {
      state.sb = makeSb({});
      const res = await addAddon(req({ ...base, [field]: 'nope' }), ctx);
      expect(res.status).toBe(400);
      const m = (await res.json()).message;
      expect(m).toMatch(/格式不正確/);
      expect(hasLatin(m)).toBe(false);
    });
  }

  it('PUT bookings staffId 非 uuid', async () => {
    state.sb = makeSb({});
    const res = await putBooking(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ staffId: 'nope' }) }), ctx);
    expect(res.status).toBe(400);
    const m = (await res.json()).message;
    expect(m).toBe('員工 ID 格式不正確');
  });
});
