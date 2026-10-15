/**
 * #1026 Opus 審查補強：
 * M1：LINE 目錄查詢 A／B 的排序與公開頁 loadBookingCandidateRows 對齊（departs_on → start_time nullsFirst → id），
 *     查詢端 limit 截斷後的子集必須是公開頁候選序列的前綴。
 * L2：tripPlansScope='LISTED_DEPARTURES' 的 trip_plans 以 .in('id', …) 查詢；replyDepartures 載入方案失敗時 fail closed。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ tourActive: true, lineReplies: [] as Array<{ text: string }[]> }));

vi.mock('@/server/features', () => ({
  isFeatureActive: async () => fx.tourActive,
  featureActiveStatus: async () => 'active',
}));
vi.mock('@/server/line', () => ({
  lineReply: async (_t: string, _r: string, msgs: Array<{ text: string }>) => { fx.lineReplies.push(msgs); },
  lineProfile: async () => null,
}));

import { replyDepartures } from '@/server/line-events';
import { loadListableDepartures, selectBookableDepartures } from '@/server/line-catalog';
import { selectBookingCandidates } from '@/lib/public-departure-candidates';
import { resolvePublicTimeZone, tenantNowParts } from '@/lib/public-time-zone';

const now = tenantNowParts(resolvePublicTimeZone('Asia/Taipei'), Date.now());
const dayFromNow = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const DAY = dayFromNow(5);
const PLAN = { id: 'pf', name: '方案pf', sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 1, price_per_person: 1000, price_type: 'PER_PERSON' };

type Order = { col: string; ascending: boolean; nullsFirst?: boolean };
type Opts = { departuresOrders?: Order[][]; inLog?: Array<[string, unknown[]]>; tripPlansError?: boolean };

/** 會依 order() 實際呼叫的欄位排序並套 limit 的 mock（未呼叫的排序欄位維持插入順序，等同 DB 不保證順序）。 */
function makeAdmin(deps: any[], opts: Opts = {}) {
  const build = (table: string) => {
    let noPlan = false;
    let limit = 1000;
    const orders: Order[] = [];
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, lte: () => q, neq: () => q, range: () => q,
      in: (col: string, vals: unknown[]) => { opts.inLog?.push([`${table}.${col}`, vals]); return q; },
      order: (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col, ascending: o.ascending !== false, nullsFirst: o.nullsFirst });
        return q;
      },
      limit: (n: number) => { limit = n; return q; },
      is: () => { noPlan = true; return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: any) => {
        if (table === 'trips') return resolve({ data: [{ id: 'tr', title: '行程' }], error: null });
        if (table === 'trip_plans') {
          return resolve(opts.tripPlansError ? { data: null, error: { message: 'boom' } } : { data: [PLAN], error: null });
        }
        if (table === 'trip_departures') {
          opts.departuresOrders?.push(orders);
          let rows = noPlan
            ? deps.filter((d) => d.plan_id == null)
            : deps.filter((d) => d.plan_id != null).map((d) => ({ ...d, trip_plans: PLAN }));
          rows = [...rows].sort((a, b) => {
            for (const o of orders) {
              const av = a[o.col] ?? null; const bv = b[o.col] ?? null;
              if (av === bv) continue;
              if (av === null) return (o.nullsFirst ?? !o.ascending) ? -1 : 1;
              if (bv === null) return (o.nullsFirst ?? !o.ascending) ? 1 : -1;
              const c = String(av) < String(bv) ? -1 : 1;
              return o.ascending ? c : -c;
            }
            return 0;
          });
          return resolve({ data: rows.slice(0, limit), error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { from: (t: string) => build(t) };
}

const dep = (id: string, startTime: string | null, over: Record<string, unknown> = {}) => ({
  id, trip_id: 'tr', plan_id: 'pf', departs_on: DAY, start_time: startTime, capacity: 5, seats_booked: 1, ...over,
});

// 同一天 16 班，刻意讓插入順序與 start_time／id 順序不同（含 null 與重複時間）。
const sameDay = () => [
  dep('d15', '15:00:00'), dep('d03', '09:00:00'), dep('d11', null), dep('d07', '09:00:00'),
  dep('d02', '08:00:00'), dep('d14', '14:00:00'), dep('d01', null), dep('d09', '12:00:00'),
  dep('d16', '16:00:00'), dep('d05', '09:00:00'), dep('d13', '13:00:00'), dep('d04', '08:00:00'),
  dep('d10', '12:00:00'), dep('d08', '10:00:00'), dep('d12', '13:00:00'), dep('d06', '11:00:00'),
];

describe('M1：LINE 目錄排序與公開頁候選序列對齊', () => {
  it('查詢 A／B 都帶 departs_on → start_time(nullsFirst) → id 排序', async () => {
    const departuresOrders: Order[][] = [];
    const r = await loadListableDepartures(makeAdmin(sameDay(), { departuresOrders }), 'ten', 'test', 13, { timeZone: 'Asia/Taipei' });
    expect(r.ok).toBe(true);
    expect(departuresOrders).toHaveLength(2);
    for (const orders of departuresOrders) {
      expect(orders).toEqual([
        { col: 'departs_on', ascending: true, nullsFirst: undefined },
        { col: 'start_time', ascending: true, nullsFirst: true },
        { col: 'id', ascending: true, nullsFirst: undefined },
      ]);
    }
  });

  it('同日 ≥13 班、limit=13：LINE 子集是公開頁候選序列的前綴，第 13 班之後不顯示 NORMAL 名額', async () => {
    const deps = sameDay();
    // 公開頁序列：全部團次依 departs_on、start_time（null 在前）、id 排序後取候選。
    const publicSeq = [...deps]
      .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id.localeCompare(b.id))
      .map((d) => d.id);
    const r = await loadListableDepartures(makeAdmin(deps), 'ten', 'test', 13, { timeZone: 'Asia/Taipei' });
    if (!r.ok) throw new Error('expected ok');
    const lineIds = r.departures.map((d) => d.id);
    expect(lineIds).toEqual(publicSeq.slice(0, 13));
    expect(r.truncated).toBe(true);

    // 公開頁最多 12 個候選：LINE 的 NORMAL 恰為這 12 個；第 13 班起不得是 NORMAL。
    const publicCandidates = selectBookingCandidates([...deps].sort((a, b) =>
      (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id.localeCompare(b.id)), now).map((c) => c.row.id);
    const out = selectBookableDepartures(r);
    const normalIds = out.filter((b) => b.display === 'NORMAL').map((b) => b.departure.id);
    expect(normalIds).toEqual(publicCandidates);
    expect(normalIds).toHaveLength(12);
    expect(out.find((b) => b.departure.id === publicSeq[12])?.display).toBe('CONTACT_SHOP');
  });
});

describe('L2：trip_plans 範圍與失敗處理', () => {
  beforeEach(() => { fx.tourActive = true; fx.lineReplies.length = 0; });

  it("tripPlansScope='LISTED_DEPARTURES'：trip_plans 以 .in('id', 可列團次所屬方案) 查詢，而非 trip_id", async () => {
    const inLog: Array<[string, unknown[]]> = [];
    const deps = [dep('a', null), dep('b', '09:00:00', { plan_id: 'pf' })];
    const r = await loadListableDepartures(makeAdmin(deps, { inLog }), 'ten', 'test', 10, {
      timeZone: 'Asia/Taipei', includeTripPlans: true, tripPlansScope: 'LISTED_DEPARTURES',
    });
    expect(r.ok).toBe(true);
    const planIn = inLog.filter(([k]) => k.startsWith('trip_plans.'));
    expect(planIn).toEqual([['trip_plans.id', ['pf']]]);
  });

  it('replyDepartures：trip_plans 查詢回 error → 回 false 且不送出任何訊息（不當成沒有團次）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handled = await replyDepartures({
      admin: makeAdmin([dep('d1', '09:00:00')], { tripPlansError: true }), token: 'k', replyToken: 'r', userId: 'u', lineConfig: {},
      tenant: { id: 'ten', shop_code: 'demo', name: 'D', business_type: 'GUIDE' },
    } as any);
    err.mockRestore();
    expect(handled).toBe(false);
    expect(fx.lineReplies).toHaveLength(0);
  });
});
