/**
 * #766 項目 2：預約頁／申請頁團次查詢必須有上限（.range 分頁＋掃描上限），且候選集合與無上限讀取一致。
 * 項目 3：季節分頁查詢的 order('plan_id')、order('id') 與多 plan_id 截斷點。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';

type Dep = { capacity: number; seats_booked: number; departs_on?: string; start_time?: string | null };

const st = vi.hoisted(() => ({
  mode: 'FIXED_DEPARTURE' as string,
  deps: [] as Array<{ capacity: number; seats_booked: number; departs_on?: string; start_time?: string | null }>,
  depCalls: [] as Array<{ range: [number, number] | null; orders: string[] }>,
  depError: false,
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      let range: [number, number] | null = null;
      const orders: string[] = [];
      const run = async () => {
        if (table === 'tenants') return { data: { id: 't1', tenant_settings: { basic: { tenantName: 'S' } } }, error: null };
        if (table === 'trip_plans') {
          return { data: { id: PLAN_ID, trip_id: 'trip1', name: 'P', description: '', price_per_person: 1000, price_type: 'PER_PERSON', min_party: 1, max_party: 6, sales_mode: st.mode, active: true, request_hold_hours: 12 }, error: null };
        }
        if (table === 'trips') return { data: { id: 'trip1', title: 'T', status: 'PUBLISHED', refund_policy_type: 'STANDARD' }, error: null };
        if (table === 'trip_departures') {
          st.depCalls.push({ range, orders: [...orders] });
          if (st.depError) return { data: null, error: { message: 'boom' } };
          const all = st.deps.map((d, i) => ({ id: `d-${i}`, departs_on: '2098-06-01', start_time: null, ...d }));
          const [a, b] = range ?? [0, all.length];
          return { data: all.slice(a, b + 1), error: null };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, gte: () => chain, in: () => chain,
        order: (c: string) => { orders.push(c); return chain; },
        range: (a: number, b: number) => { range = [a, b]; return chain; },
        maybeSingle: () => run(),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));

import { loadPublicBookingPlan } from '@/server/public-tour-booking';
import { loadPublicRequestPlan } from '@/server/public-tour-request';
import { MAX_BOOKING_CANDIDATE_DEPARTURES } from '@/lib/public-departure-candidates';

const open = (n: number): Dep[] => Array.from({ length: n }, () => ({ capacity: 5, seats_booked: 0 }));
const full = (n: number): Dep[] => Array.from({ length: n }, () => ({ capacity: 5, seats_booked: 5 }));

const loaders = [
  ['booking', 'FIXED_DEPARTURE', () => loadPublicBookingPlan('shop', PLAN_ID, { withSeasonPrices: false })],
  ['request', 'REQUEST', () => loadPublicRequestPlan('shop', PLAN_ID, { withSeasonPrices: false })],
] as const;

describe.each(loaders)('#766 %s 團次查詢上限', (_name, mode, load) => {
  beforeEach(() => { st.mode = mode; st.deps = []; st.depCalls = []; st.depError = false; });

  it('每次查詢都帶 .range，首頁範圍為 [0,119]，並保留三段排序', async () => {
    st.deps = open(3);
    const plan = await load();
    expect(plan!.departures).toHaveLength(3);
    expect(st.depCalls).toHaveLength(1);
    expect(st.depCalls[0].range).toEqual([0, 119]);
    expect(st.depCalls[0].orders).toEqual(['departs_on', 'start_time', 'id']);
  });

  it('候選湊滿 12 個就停止，不再讀下一頁', async () => {
    st.deps = open(500);
    const plan = await load();
    expect(plan!.departures).toHaveLength(MAX_BOOKING_CANDIDATE_DEPARTURES);
    expect(plan!.departures.map((d) => d.id)).toEqual(Array.from({ length: 12 }, (_, i) => `d-${i}`));
    expect(st.depCalls).toHaveLength(1);
  });

  it('前面大量客滿團次：跨頁讀取，仍挑出同一批候選（客滿略過但計入掃描）', async () => {
    st.deps = [...full(130), ...open(20)];
    const plan = await load();
    expect(plan!.departures.map((d) => d.id)).toEqual(Array.from({ length: 12 }, (_, i) => `d-${130 + i}`));
    expect(st.depCalls.map((c) => c.range)).toEqual([[0, 119], [120, 239]]);
  });

  it('掃描上限 600 列：全是客滿團次時最多 5 頁、不會無限讀', async () => {
    st.deps = full(2000);
    const plan = await load();
    expect(plan!.departures).toEqual([]);
    expect(st.depCalls.map((c) => c.range)).toEqual([[0, 119], [120, 239], [240, 359], [360, 479], [480, 599]]);
  });

  it('不滿頁即視為讀完，不多發查詢', async () => {
    st.deps = [...full(5), ...open(2)];
    const plan = await load();
    expect(plan!.departures).toHaveLength(2);
    expect(st.depCalls).toHaveLength(1);
  });

  it('查詢失敗仍 throw QUERY_FAILED（行為不變）', async () => {
    st.depError = true;
    await expect(load()).rejects.toThrow(/QUERY_FAILED:trip_departures/);
  });
});
