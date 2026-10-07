/**
 * #806：詳情頁 loadPlanDepartureWindow 只發「一次」有上限的 `.range(0, 599)` 查詢（單一快照，無 offset 分頁漂移）。
 * 語意：列出視窗填滿且候選 settled 後檢查快照剩下的所有列；mayBeTruncated = 有未列出可售 || 快照達 600 列。
 * 以下皆以明確預期值斷言（不再與舊多頁演算法逐位比對）。
 */
import { describe, expect, it } from 'vitest';
import { loadPlanDepartureWindow } from '@/server/public-shop';

type Dep = { id: string; departs_on: string; start_time: string | null; capacity: number; seats_booked: number };
const NOW = { today: '2098-01-01', hm: '12:00' };
const PLAN = { id: 'p1', minParty: 1, salesMode: 'REQUEST', pricePerPerson: 100 } as never;

const open = (n: number): Array<[number, number]> => Array.from({ length: n }, () => [5, 0]);
const full = (n: number): Array<[number, number]> => Array.from({ length: n }, () => [5, 5]);
const build = (...groups: Array<Array<[number, number]>>): Dep[] =>
  groups.flat().map(([capacity, seats_booked], i) => ({
    id: `d-${String(i).padStart(4, '0')}`, departs_on: '2098-06-01', start_time: null, capacity, seats_booked,
  }));

// maxRows 模擬 PostgREST max_rows；count 預設為真實總列數（exact count），可用 null 模擬 count 不可得。
function makeAdmin(all: Dep[], opts: { error?: boolean; maxRows?: number; count?: number | null } = {}) {
  const calls: Array<[number, number] | null> = [];
  const selectOpts: unknown[] = [];
  const admin = {
    from(table: string) {
      expect(table).toBe('trip_departures');
      let range: [number, number] | null = null;
      let wantsCount = false;
      const orders: string[] = [];
      const run = async () => {
        calls.push(range);
        if (opts.error) return { data: null, error: { message: 'boom' } };
        const [a, b] = range ?? [0, all.length];
        const end = Math.min(b + 1, a + (opts.maxRows ?? Infinity));
        const count = 'count' in opts ? opts.count : all.length;
        return { data: all.slice(a, end), count: wantsCount ? count : null, error: null };
      };
      const chain: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { selectOpts.push(o); wantsCount = o?.count === 'exact'; return chain; }, eq: () => chain, gte: () => chain,
        order: (c: string) => { orders.push(c); return chain; },
        range: (a: number, b: number) => { range = [a, b]; return chain; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  };
  return { admin: admin as never, calls, selectOpts };
}

const run = async (all: Dep[], opts: Parameters<typeof makeAdmin>[1] = {}) => {
  const { admin, calls, selectOpts } = makeAdmin(all, opts);
  const w = await loadPlanDepartureWindow(admin, { tenantId: 't1', tripId: 'trip1', plan: PLAN, now: NOW });
  return { w, calls, selectOpts };
};

describe('#806 loadPlanDepartureWindow 單一有上限查詢', () => {
  it('只發一次 trip_departures 查詢，range 為 0..599（不再 offset 分頁／lookahead 第二次查詢）', async () => {
    for (const all of [build(open(3)), build(open(300)), build(full(130), open(10)), build(open(200), full(0))]) {
      const { calls } = await run(all);
      expect(calls).toEqual([[0, 599]]);
    }
  });

  it('查詢失敗仍 throw QUERY_FAILED:trip_departures', async () => {
    const { admin } = makeAdmin([], { error: true });
    await expect(loadPlanDepartureWindow(admin, { tenantId: 't', tripId: 'x', plan: PLAN, now: NOW }))
      .rejects.toThrow(/QUERY_FAILED:trip_departures/);
  });

  const ids = (w: Awaited<ReturnType<typeof run>>['w']) => w.departures.map((d) => d.id);
  const seq = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `d-${String(from + i).padStart(4, '0')}`);

  it('不足 6 筆：全列出，不截斷、無客滿省略', async () => {
    const { w } = await run(build(open(3)));
    expect(ids(w)).toEqual(seq(0, 3));
    expect(w).toMatchObject({ mayBeTruncated: false, soldOutOmitted: false, bookableDepartureAvailable: true });
  });

  it('空集合', async () => {
    const { w } = await run(build());
    expect(w).toMatchObject({ departures: [], mayBeTruncated: false, soldOutOmitted: false, bookableDepartureAvailable: false });
  });

  it('剛好 6 筆可售：不截斷', async () => {
    const { w } = await run(build(open(6)));
    expect(ids(w)).toEqual(seq(0, 6));
    expect(w).toMatchObject({ mayBeTruncated: false, soldOutOmitted: false, bookableDepartureAvailable: true });
  });

  it('超過 6 筆可售：只列前 6，第 7 列為未列出可售 → mayBeTruncated', async () => {
    const { w } = await run(build(open(7)));
    expect(ids(w)).toEqual(seq(0, 6));
    expect(w).toMatchObject({ mayBeTruncated: true, soldOutOmitted: false, bookableDepartureAvailable: true });
  });

  it('客滿省略：前 8 客滿（只列 6 個客滿）、再 6 可售 → 列出 12 筆、soldOutOmitted、不截斷', async () => {
    const { w } = await run(build(full(8), open(6)));
    expect(ids(w)).toEqual([...seq(0, 6), ...seq(8, 14)]);
    expect(w.departures.filter((d) => d.soldOut)).toHaveLength(6);
    expect(w).toMatchObject({ mayBeTruncated: false, soldOutOmitted: true, bookableDepartureAvailable: true });
  });

  it('客滿超過客滿上限（20 客滿後 10 可售）：只列 6 客滿＋6 可售，soldOutOmitted，仍有未列出可售 → mayBeTruncated', async () => {
    const { w } = await run(build(full(20), open(10)));
    expect(w.departures.filter((d) => d.soldOut)).toHaveLength(6);
    expect(w.departures.filter((d) => !d.soldOut)).toHaveLength(6);
    expect(w).toMatchObject({ mayBeTruncated: true, soldOutOmitted: true, bookableDepartureAvailable: true });
  });

  it('候選在第 130 列才可訂（130 客滿後可售）→ bookableDepartureAvailable', async () => {
    const { w } = await run(build(full(130), open(20)));
    expect(w.bookableDepartureAvailable).toBe(true);
    expect(w.departures.filter((d) => !d.soldOut)).toHaveLength(6);
    expect(w.mayBeTruncated).toBe(true);
  });

  it('候選在第 250 列才可訂 → bookableDepartureAvailable', async () => {
    const { w } = await run(build(full(250), open(3)));
    expect(w.bookableDepartureAvailable).toBe(true);
    expect(w.departures.filter((d) => !d.soldOut)).toHaveLength(3);
    expect(w.mayBeTruncated).toBe(false);
  });

  it('視窗填滿後第 300 列才有可售 → mayBeTruncated（檢查整個快照，舊 120 列區段會漏看）', async () => {
    const { w } = await run(build(open(6), full(293), open(2)));
    expect(ids(w)).toEqual(seq(0, 6));
    expect(w).toMatchObject({ mayBeTruncated: true, soldOutOmitted: true, bookableDepartureAvailable: true });
  });

  it('快照 < 600 列且視窗填滿後全客滿 → mayBeTruncated=false、soldOutOmitted=true', async () => {
    const { w } = await run(build(open(6), full(300)));
    expect(ids(w)).toEqual(seq(0, 6));
    expect(w).toMatchObject({ mayBeTruncated: false, soldOutOmitted: true, bookableDepartureAvailable: true });
  });

  it('快照 600 列但 count 顯示還有更多（視窗填滿後全客滿）→ 未讀到底，mayBeTruncated=true', async () => {
    const { w } = await run(build(open(6), full(594)), { count: 601 });
    expect(w).toMatchObject({ mayBeTruncated: true, soldOutOmitted: true });
  });

  it('已開始團次略過：不列出、不計入可售', async () => {
    const all: Dep[] = [
      { id: 'd-0000', departs_on: NOW.today, start_time: '00:00', capacity: 5, seats_booked: 0 },
      ...build(open(8)).slice(1),
    ];
    const { w } = await run(all);
    expect(ids(w)).toEqual(seq(1, 7));
    expect(w.mayBeTruncated).toBe(true);
  });

  it('視窗填滿後僅剩已開始團次 → 不算未列出可售', async () => {
    const all: Dep[] = [
      ...build(open(6)),
      { id: 'd-9000', departs_on: NOW.today, start_time: '00:00', capacity: 5, seats_booked: 0 },
    ];
    const { w } = await run(all);
    expect(w).toMatchObject({ mayBeTruncated: false, soldOutOmitted: false });
  });

  it('客滿團次標示 soldOut、seatsLeft 0，且不占 6 筆可售名額', async () => {
    const { w } = await run(build(full(2), open(6)));
    expect(w.departures).toHaveLength(8);
    expect(w.departures.filter((d) => d.soldOut).map((d) => d.seatsLeft)).toEqual([0, 0]);
    expect(w.mayBeTruncated).toBe(false);
  });

  it('掃描上限：600 列全客滿且 count > 600 → mayBeTruncated=true；599 列全客滿 → 不截斷且 soldOutOmitted', async () => {
    const atCap = (await run(build(full(600)), { count: 700 })).w;
    expect(atCap.mayBeTruncated).toBe(true);
    const underCap = (await run(build(full(599)))).w;
    expect(underCap.mayBeTruncated).toBe(false);
    expect(underCap.soldOutOmitted).toBe(true);
  });

  it('600 列全客滿 → 無可訂候選；第 601 列的可售不會被讀到，也不發第二次查詢', async () => {
    const { w, calls } = await run(build(full(600), open(5)), { count: 605 });
    expect(w.bookableDepartureAvailable).toBe(false);
    expect(w.departures.filter((d) => !d.soldOut)).toEqual([]);
    expect(w.mayBeTruncated).toBe(true);
    expect(calls).toEqual([[0, 599]]);
  });

  it('查詢帶 { count: \'exact\' }（用 count 判定是否讀到底）', async () => {
    const { selectOpts } = await run(build(open(3)));
    expect(selectOpts).toEqual([{ count: 'exact' }]);
  });

  it('max_rows 模擬為 500：回 500 列、count 700，可售只在第 501-600 列 → mayBeTruncated=true、不誤判為已讀到底', async () => {
    const all = build(full(500), open(100), full(100));
    const { w, calls } = await run(all, { maxRows: 500 });
    expect(calls).toEqual([[0, 599]]);
    expect(w.mayBeTruncated).toBe(true);
    // 看不到的可售不會被當成候選：入口不由截斷旗標改變（bookingCtaState 只看已列出／候選），旅客看到的是截斷提示而非「無團次」。
    expect(w.bookableDepartureAvailable).toBe(false);
    expect(w.departures.filter((d) => !d.soldOut)).toEqual([]);
  });

  it('恰 600 列且 count = 600（已讀到底）：全客滿 → mayBeTruncated=false；有未列出可售仍為 true', async () => {
    const a = await run(build(full(600)), { count: 600 });
    expect(a.w.mayBeTruncated).toBe(false);
    expect(a.w.soldOutOmitted).toBe(true);
    const b = await run(build(open(6), full(593), open(1)));
    expect(b.w.mayBeTruncated).toBe(true);
  });

  it('count 不可得（null）→ fail-closed，mayBeTruncated=true（含空集合）', async () => {
    expect((await run(build(open(3)), { count: null })).w.mayBeTruncated).toBe(true);
    expect((await run(build(), { count: null })).w.mayBeTruncated).toBe(true);
  });
});
