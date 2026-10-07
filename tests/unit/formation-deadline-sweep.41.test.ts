/**
 * 成團截止自動推進排程（Issue #41）：GET /api/cron/formation-deadline。
 * 假 supabase；覆蓋開關、驗證、FORMED／REVIEW_REQUIRED、不動的團次、CAS 冪等、退款不計人數、截斷、缺 schema。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const T = '11111111-1111-4111-8111-111111111111';
const st = vi.hoisted(() => ({
  deps: [] as Row[],
  orders: [] as Row[],
  updates: [] as { patch: Row; eq: [string, unknown][]; neq: [string, unknown][] }[],
  reads: 0,
  raceIds: new Set<string>(),
  schemaError: null as string | null,
  pageCap: 1e9,
}));

vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => fakeDb }));

const MAX_DEPARTURES = 500; // 與 route 的 MAX_DEPARTURES 相同（route 檔不能匯出非 route 欄位）
const NOW = Date.parse('2026-10-07T03:30:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-10-20T00:00:00.000Z';

const fakeDb = {
  from: (table: string) => {
    const eq: [string, unknown][] = [];
    const neq: [string, unknown][] = [];
    let patch: Row | null = null;
    let gt: string | null = null;
    let lte: [string, string] | null = null;
    let notNull: string | null = null;
    let lim = 1e9;
    const run = () => {
      if (st.schemaError) return { data: null, error: { code: st.schemaError } };
      const src = table === 'trip_departures' ? st.deps : st.orders;
      const match = src.filter((r) => eq.every(([k, v]) => r[k] === v) && neq.every(([k, v]) => r[k] !== v)
        && (!notNull || r[notNull] != null) && (!lte || (r[lte[0]] != null && String(r[lte[0]]) <= lte[1]))
        && (!gt || String(r.id) > gt));
      if (patch) {
        st.updates.push({ patch, eq, neq });
        const id = eq.find(([k]) => k === 'id')?.[1] as string;
        if (st.raceIds.has(id)) return { data: [], error: null };
        match.forEach((r) => Object.assign(r, patch));
        return { data: match.map((r) => ({ id: r.id })), error: null };
      }
      st.reads++;
      return { data: [...match].sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, Math.min(lim, st.pageCap)), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      eq: (k: string, v: unknown) => { eq.push([k, v]); return q; },
      neq: (k: string, v: unknown) => { neq.push([k, v]); return q; },
      not: (k: string) => { notNull = k; return q; },
      lte: (k: string, v: string) => { lte = [k, v]; return q; },
      gt: (_k: string, v: string) => { gt = v; return q; },
      order: () => q,
      limit: (n: number) => { lim = n; return q; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  },
};

import { GET } from '@/app/api/cron/formation-deadline/route';

const req = (auth: string | null = 'Bearer s3cret') =>
  new Request('http://localhost/api/cron/formation-deadline', { headers: auth ? { authorization: auth } : {} });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dep = (n: number, over: Row = {}): Row => ({
  id: id(n), tenant_id: T, status: 'OPEN', formation_status: 'COLLECTING', formation_deadline_at: PAST, min_to_depart_snapshot: 4, ...over,
});
let oc = 0;
const order = (depId: string, party: number, over: Row = {}): Row => ({
  id: `a0000000-0000-4000-8000-${String(++oc).padStart(12, '0')}`, tenant_id: T, departure_id: depId, status: 'CONFIRMED',
  party_size: party, paid_amount: 1000, refunded_amount: 0, payment_status: 'PAID', upfront_required_amount: 1000, deposit_mode_snapshot: 'FULL', ...over,
});

describe('formation-deadline sweep（Issue #41）', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cret';
    process.env.FORMATION_DEADLINE_SWEEP_ENABLED = 'true';
    st.deps = []; st.orders = []; st.updates = []; st.reads = 0; st.raceIds = new Set(); st.schemaError = null; st.pageCap = 1e9;
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.FORMATION_DEADLINE_SWEEP_ENABLED; });

  it('開關未開 → skipped disabled，不讀不寫', async () => {
    st.deps = [dep(1)];
    delete process.env.FORMATION_DEADLINE_SWEEP_ENABLED;
    const res = await GET(req());
    expect(await res.json()).toEqual({ skipped: 'disabled' });
    expect(st.reads).toBe(0); expect(st.updates).toHaveLength(0);
    process.env.FORMATION_DEADLINE_SWEEP_ENABLED = 'false';
    expect(await (await GET(req())).json()).toEqual({ skipped: 'disabled' });
    expect(st.reads).toBe(0);
  });

  it('CRON_SECRET 驗證：缺、錯、未設定一律 401', async () => {
    expect((await GET(req(null))).status).toBe(401);
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(req('Bearer undefined'))).status).toBe(401);
    expect(st.reads).toBe(0);
  });

  it('達門檻 → FORMED，SYSTEM 證據齊備', async () => {
    st.deps = [dep(1)];
    st.orders = [order(id(1), 2), order(id(1), 2)];
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ scanned: 1, formed: 1, reviewRequired: 0, skipped: 0, truncated: false });
    expect(st.deps[0]).toMatchObject({ formation_status: 'FORMED', formed_by: 'SYSTEM', formed_participants: 4, formed_at: new Date(NOW).toISOString() });
  });

  it('剛好等於門檻算成團（>=）', async () => {
    st.deps = [dep(1, { min_to_depart_snapshot: 3 })];
    st.orders = [order(id(1), 3)];
    expect((await (await GET(req())).json()).formed).toBe(1);
  });

  it('不足 → REVIEW_REQUIRED，不寫成團證據', async () => {
    st.deps = [dep(1)];
    st.orders = [order(id(1), 3)];
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ formed: 0, reviewRequired: 1 });
    expect(st.deps[0].formation_status).toBe('REVIEW_REQUIRED');
    expect(st.updates[0].patch).toEqual({ formation_status: 'REVIEW_REQUIRED' });
  });

  it('已取消、非 COLLECTING、截止未到、無截止者不動', async () => {
    st.deps = [dep(1, { status: 'CANCELLED' }), dep(2, { formation_status: 'FORMED' }), dep(3, { formation_deadline_at: FUTURE }),
      dep(4, { formation_deadline_at: null }), dep(5, { formation_status: 'REVIEW_REQUIRED' })];
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ scanned: 0, formed: 0, reviewRequired: 0 });
    expect(st.updates).toHaveLength(0);
  });

  it('CAS 帶 formation_status=COLLECTING 與 status<>CANCELLED；0 列 → 冪等跳過不報錯', async () => {
    st.deps = [dep(1), dep(2)];
    st.orders = [order(id(1), 4), order(id(2), 4)];
    st.raceIds.add(id(1));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scanned: 2, formed: 1, skipped: 1 });
    for (const u of st.updates) {
      expect(u.eq).toContainEqual(['formation_status', 'COLLECTING']);
      expect(u.eq).toContainEqual(['tenant_id', T]);
      expect(u.neq).toContainEqual(['status', 'CANCELLED']);
    }
    expect(st.deps[0].formation_status).toBe('COLLECTING');
  });

  it('退款中／已退款／已取消訂單不計人數', async () => {
    st.deps = [dep(1, { min_to_depart_snapshot: 4 })];
    st.orders = [order(id(1), 2), order(id(1), 2, { payment_status: 'REFUND_PENDING' }),
      order(id(1), 2, { payment_status: 'REFUNDED' }), order(id(1), 2, { status: 'CANCELLED' })];
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ formed: 0, reviewRequired: 1 });
  });

  it('團次數觸頂 → truncated 並 warn，剩下留給下一輪', async () => {
    st.deps = Array.from({ length: MAX_DEPARTURES + 3 }, (_, i) => dep(i + 1));
    const body = await (await GET(req())).json();
    expect(body.truncated).toBe(true);
    expect(body.scanned).toBe(MAX_DEPARTURES);
    expect(console.warn).toHaveBeenCalled();
  });

  it('PostgREST 單頁上限小於要求頁大小也不提早停（只有空頁才算掃完）', async () => {
    st.deps = Array.from({ length: 7 }, (_, i) => dep(i + 1));
    st.pageCap = 2;
    const body = await (await GET(req())).json();
    expect(body.scanned).toBe(7);
    expect(body.reviewRequired).toBe(7);
  });

  it.each(['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205'])('缺 schema（%s）→ 降級 no-op，200 + warn，不寫', async (code) => {
    st.deps = [dep(1)];
    st.schemaError = code;
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ degraded: 'schema-missing' });
    expect(st.updates).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });
});
