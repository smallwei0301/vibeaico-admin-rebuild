import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DEP = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const ADMIN = '55555555-5555-4555-8555-555555555555';
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  departures: [] as Row[],
  orders: [] as Row[],
  denied: false,
  impersonation: false,
  raceLost: false,
  updates: [] as { patch: Row; eq: [string, unknown][]; neq: [string, unknown][] }[],
  orderQueries: [] as [string, unknown][][],
  now: 0,
}));

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/mappers', () => ({ mapTripDeparture: (r: Row) => ({ id: r.id, formationStatus: r.formation_status }) }));
vi.mock('@/server/tenant', () => ({
  requireTenantManager: async () => {
    if (state.denied) {
      const { ApiHttpError } = await import('@/server/http');
      throw new ApiHttpError(403, '權限不足', 'FORBIDDEN');
    }
    // 代登入（平台管理者代入）時 requireTenant 回傳的 user 仍是管理者本人的 auth user，另帶 impersonation 欄位
    return state.impersonation
      ? { tenantId: TENANT, user: { id: ADMIN }, supabase: fakeDb, impersonation: { sessionId: 's1' } }
      : { tenantId: TENANT, user: { id: USER }, supabase: fakeDb };
  },
}));

const fakeDb = {
  from: (table: string) => {
    const eq: [string, unknown][] = [];
    const neq: [string, unknown][] = [];
    let patch: Row | null = null;
    let gt = '';
    let lim = 1e9;
    const q: Record<string, unknown> = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      eq: (k: string, v: unknown) => { eq.push([k, v]); return q; },
      neq: (k: string, v: unknown) => { neq.push([k, v]); return q; },
      gt: (_k: string, v: string) => { gt = v; return q; },
      order: () => q,
      limit: (n: number) => { lim = n; return q; },
      maybeSingle: async () => {
        if (table === 'tenant_settings') return { data: null, error: null };
        if (table !== 'trip_departures') return { data: null, error: null };
        const match = state.departures.filter((r) => eq.every(([k, v]) => r[k] === v) && neq.every(([k, v]) => r[k] !== v));
        if (patch) {
          state.updates.push({ patch, eq, neq });
          if (state.raceLost || !match[0]) return { data: null, error: null };
          Object.assign(match[0], patch);
          return { data: match[0], error: null };
        }
        return { data: match[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'tour_orders') {
          state.orderQueries.push([...eq, ...neq]);
          const rows = state.orders.filter((r) => eq.every(([k, v]) => r[k] === v) && neq.every(([k, v]) => r[k] !== v))
            .filter((r) => !gt || (r.id as string) > gt).slice(0, lim);
          return resolve({ data: rows, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return q;
  },
};

import { POST } from '@/app/api/trip-departures/[id]/formation-decision/route';

const post = (body: unknown, id = DEP) => POST(
  new Request(`http://t/api/trip-departures/${id}/formation-decision`, { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);
const dep = (o: Row = {}): Row => ({
  id: DEP, tenant_id: TENANT, status: 'OPEN', formation_status: 'REVIEW_REQUIRED', departs_on: '2026-12-20', start_time: '09:00:00',
  formation_deadline_at: '2026-12-10T00:00:00.000Z', ...o,
});
const order = (o: Row): Row => ({
  tenant_id: TENANT, departure_id: DEP, status: 'CONFIRMED', party_size: 1, paid_amount: 100, upfront_required_amount: 100,
  deposit_mode_snapshot: 'FULL', ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-12T00:00:00Z'));
  Object.assign(state, { departures: [dep()], orders: [], denied: false, impersonation: false, raceLost: false, updates: [], orderQueries: [] });
});

describe('POST /api/trip-departures/[id]/formation-decision', () => {
  it('FORM：以有效報名人數寫入，欄位符合 0107 CHECK；update 帶 tenant_id＋CAS（REVIEW_REQUIRED、非取消）', async () => {
    state.orders = [
      order({ id: 'o1', party_size: 2 }), order({ id: 'o2', party_size: 1 }),
      order({ id: 'o3', party_size: 5, paid_amount: 10 }),              // 未付足 → 不算
      order({ id: 'o4', party_size: 9, status: 'CANCELLED' }),         // 取消 → 查詢就排除
      order({ id: 'o5', party_size: 4, tenant_id: OTHER }),            // 其他租戶
      order({ id: 'o6', party_size: 7, departure_id: 'other-dep' }),   // 其他團次
    ];
    const res = await post({ decision: 'FORM' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.formationStatus).toBe('FORMED');
    expect(state.updates).toHaveLength(1);
    const u = state.updates[0];
    expect(u.patch).toEqual({
      formation_status: 'FORMED', formed_at: '2026-12-12T00:00:00.000Z', formed_by: 'GUIDE_OVERRIDE', formed_participants: 3,
      formation_decided_at: '2026-12-12T00:00:00.000Z', formation_decided_by: USER,
    });
    expect(u.eq).toEqual(expect.arrayContaining([['tenant_id', TENANT], ['id', DEP], ['formation_status', 'REVIEW_REQUIRED']]));
    expect(u.neq).toEqual([['status', 'CANCELLED']]);
    // 訂單查詢也帶 tenant_id 與團次，並排除取消
    expect(state.orderQueries[0]).toEqual(expect.arrayContaining([['tenant_id', TENANT], ['departure_id', DEP], ['status', 'CANCELLED']]));
  });

  it('FORM 但沒有任何有效報名 → 400，不寫入', async () => {
    state.orders = [order({ id: 'o1', paid_amount: 0 })];
    expect((await post({ decision: 'FORM' })).status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('EXTEND：新截止時間寫入並回 COLLECTING；update 帶 tenant_id＋CAS', async () => {
    const res = await post({ decision: 'EXTEND', newDeadline: '2026-12-15T18:00:00+08:00' });
    expect(res.status).toBe(200);
    const u = state.updates[0];
    expect(u.patch).toMatchObject({
      formation_status: 'COLLECTING', formation_deadline_at: '2026-12-15T10:00:00.000Z', formation_decided_by: USER,
    });
    expect(u.patch).not.toHaveProperty('formed_at');
    expect(u.eq).toEqual(expect.arrayContaining([['tenant_id', TENANT], ['formation_status', 'REVIEW_REQUIRED']]));
  });

  it.each([
    ['早於現在', '2026-12-11T00:00:00Z'], ['晚於出發', '2026-12-21T00:00:00+08:00'], ['沒有時區', '2026-12-15T10:00:00'],
  ])('EXTEND %s → 400，不寫入', async (_n, newDeadline) => {
    expect((await post({ decision: 'EXTEND', newDeadline })).status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it('CAS：讀完之後狀態被別人改掉（update 零列）→ 409', async () => {
    state.raceLost = true;
    expect((await post({ decision: 'EXTEND', newDeadline: '2026-12-15T18:00:00+08:00' })).status).toBe(409);
  });

  it('狀態不是 REVIEW_REQUIRED → 409；團次已取消 → 409；不寫入', async () => {
    state.departures = [dep({ formation_status: 'FORMED' })];
    expect((await post({ decision: 'FORM' })).status).toBe(409);
    state.departures = [dep({ status: 'CANCELLED' })];
    expect((await post({ decision: 'FORM' })).status).toBe(409);
    expect(state.updates).toHaveLength(0);
  });

  it('別的租戶的團次 → 404（租戶隔離）；非 uuid → 400；非法 body → 400；非 manager → 403', async () => {
    state.departures = [dep({ tenant_id: OTHER })];
    expect((await post({ decision: 'FORM' })).status).toBe(404);
    state.departures = [dep()];
    expect((await post({ decision: 'FORM' }, 'not-a-uuid')).status).toBe(400);
    expect((await post({ decision: 'CANCEL' })).status).toBe(400);
    expect((await post({ decision: 'EXTEND' })).status).toBe(400);
    state.denied = true;
    expect((await post({ decision: 'FORM' })).status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it('formation_decided_by 用 requireTenantManager 回傳的 auth user；代登入時是代入的管理者本人', async () => {
    state.orders = [order({ id: 'o1' })];
    await post({ decision: 'FORM' });
    expect(state.updates[0].patch.formation_decided_by).toBe(USER);
    Object.assign(state, { departures: [dep()], updates: [], impersonation: true });
    await post({ decision: 'EXTEND', newDeadline: '2026-12-15T18:00:00+08:00' });
    expect(state.updates[0].patch.formation_decided_by).toBe(ADMIN);
  });

  it('退款相關訂單不計入 formed_participants（淨實收、REFUND_PENDING、REFUNDED）', async () => {
    state.orders = [
      order({ id: 'a', party_size: 2 }),                                          // +2
      order({ id: 'b', party_size: 3, refunded_amount: 40 }),                     // 淨 60 < 100 → 0
      order({ id: 'c', party_size: 4, payment_status: 'REFUND_PENDING' }),        // 0
      order({ id: 'd', party_size: 5, payment_status: 'REFUNDED', refunded_amount: 100 }), // 0
    ];
    await post({ decision: 'FORM' });
    expect(state.updates[0].patch.formed_participants).toBe(2);
  });

  describe('CONTINUE（AT_RISK 繼續出團）', () => {
    const atRisk = (o: Row = {}) => dep({
      formation_status: 'AT_RISK', formed_at: '2026-11-01T00:00:00.000Z', formed_by: 'SYSTEM', formed_participants: 4, ...o,
    });

    it('AT_RISK → FORMED：只寫狀態與決策證據；原成團證據不變；update 帶 tenant_id＋CAS(AT_RISK)＋非取消；不讀不寫訂單', async () => {
      state.departures = [atRisk()];
      state.orders = [order({ id: 'o1' })];
      const res = await post({ decision: 'CONTINUE' });
      expect(res.status).toBe(200);
      const u = state.updates[0];
      expect(u.patch).toEqual({
        formation_status: 'FORMED', formation_decided_at: '2026-12-12T00:00:00.000Z', formation_decided_by: USER,
      });
      expect(u.eq).toEqual(expect.arrayContaining([['tenant_id', TENANT], ['id', DEP], ['formation_status', 'AT_RISK']]));
      expect(u.neq).toEqual([['status', 'CANCELLED']]);
      // 原成團證據沒有被覆寫（0107 CHECK：FORMED 需 formed_at／formed_by／formed_participants 齊全 → 仍齊全）
      expect(state.departures[0]).toMatchObject({
        formation_status: 'FORMED', formed_at: '2026-11-01T00:00:00.000Z', formed_by: 'SYSTEM', formed_participants: 4,
      });
      // 不重新計價：完全沒有查詢訂單
      expect(state.orderQueries).toHaveLength(0);
    });

    it('狀態不是 AT_RISK（REVIEW_REQUIRED、FORMED）→ 409；已取消 → 409；讀完後被改（零列）→ 409；不寫入', async () => {
      state.departures = [dep()]; // REVIEW_REQUIRED
      expect((await post({ decision: 'CONTINUE' })).status).toBe(409);
      state.departures = [atRisk({ formation_status: 'FORMED' })];
      expect((await post({ decision: 'CONTINUE' })).status).toBe(409);
      state.departures = [atRisk({ status: 'CANCELLED' })];
      expect((await post({ decision: 'CONTINUE' })).status).toBe(409);
      expect(state.updates).toHaveLength(0);
      state.departures = [atRisk()];
      state.raceLost = true;
      expect((await post({ decision: 'CONTINUE' })).status).toBe(409);
    });

    it('其他決策與狀態不互通：AT_RISK 不能做 FORM／EXTEND（409）', async () => {
      state.departures = [atRisk()];
      expect((await post({ decision: 'FORM' })).status).toBe(409);
      expect((await post({ decision: 'EXTEND', newDeadline: '2026-12-15T18:00:00+08:00' })).status).toBe(409);
      expect(state.updates).toHaveLength(0);
    });

    it('他租戶的團次 → 404；多帶欄位 → 400', async () => {
      state.departures = [atRisk({ tenant_id: OTHER })];
      expect((await post({ decision: 'CONTINUE' })).status).toBe(404);
      state.departures = [atRisk()];
      expect((await post({ decision: 'CONTINUE', newDeadline: 'x' })).status).toBe(400);
    });
  });
});

