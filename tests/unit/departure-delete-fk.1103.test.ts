import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const DEP = '66666666-6666-4666-8666-666666666666';

const state = vi.hoisted(() => ({
  seatsBooked: 0, orderCount: 0 as number | null, countError: null as unknown,
  deleteError: null as { code: string } | null, deleteCalls: 0, countArgs: [] as unknown[],
}));

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tenant', () => ({
  requireTenantManager: async () => ({ tenantId: TENANT, supabase: fakeDb }),
}));

const fakeDb = {
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let mode: 'select' | 'delete' = 'select';
    let head = false;
    const query: Record<string, unknown> = {
      select: (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; if (head) state.countArgs.push(table); return query; },
      delete: () => { mode = 'delete'; state.deleteCalls++; return query; },
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      maybeSingle: async () => {
        if (mode === 'delete') {
          return state.deleteError ? { data: null, error: state.deleteError } : { data: { id: DEP }, error: null };
        }
        return { data: { id: DEP, seats_booked: state.seatsBooked }, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => resolve(
        head && table === 'tour_orders'
          ? { count: state.orderCount, data: null, error: state.countError }
          : { data: null, error: null },
      ),
    };
    return query;
  },
};

const call = async () => {
  const { DELETE } = await import('@/app/api/trip-departures/[id]/route');
  const res = await DELETE(new Request(`http://x/api/trip-departures/${DEP}`, { method: 'DELETE' }), { params: Promise.resolve({ id: DEP }) });
  return { status: res.status, body: await res.json() };
};

describe('DELETE /api/trip-departures/:id 訂單 FK 保護 (#1103)', () => {
  beforeEach(() => {
    Object.assign(state, { seatsBooked: 0, orderCount: 0, countError: null, deleteError: null, deleteCalls: 0, countArgs: [] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('有訂單紀錄（含已取消）→ 409 且未呼叫 delete', async () => {
    state.orderCount = 2;
    const r = await call();
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('請改為取消團次');
    expect(state.deleteCalls).toBe(0);
  });

  it('無訂單引用 → 正常刪除', async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(state.deleteCalls).toBe(1);
  });

  it('count 查詢錯誤 → 500 且不刪', async () => {
    state.countError = new Error('count failed');
    const r = await call();
    expect(r.status).toBe(500);
    expect(state.deleteCalls).toBe(0);
  });

  it('delete 撞 23503（並發建單）→ 409', async () => {
    state.deleteError = { code: '23503' };
    const r = await call();
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('請改為取消團次');
  });

  it('delete 其他錯誤 → 500', async () => {
    state.deleteError = { code: '42501' };
    expect((await call()).status).toBe(500);
  });

  it('seats_booked > 0 仍回原 409 且不查訂單', async () => {
    state.seatsBooked = 3;
    const r = await call();
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('已有 3 人報名');
    expect(state.countArgs).toHaveLength(0);
    expect(state.deleteCalls).toBe(0);
  });
});
