/**
 * #766 項目 3：readPlanSeasons 的排序呼叫（order plan_id、id）與多 plan_id 分頁截斷點。
 * mock 只依呼叫端實際下的 order() 欄位排序，所以拿掉任一個 .order 都會讓截斷判斷或呼叫斷言失敗。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SeasonRow = { id: string; plan_id: string };
const st = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; plan_id: string }>,
  calls: [] as Array<{ orders: string[]; range: [number, number] | null }>,
}));

import { readPlanSeasons } from '@/server/public-plan-seasons';

function admin() {
  return {
    from() {
      let range: [number, number] | null = null;
      const orders: string[] = [];
      const run = async () => {
        st.calls.push({ orders: [...orders], range });
        const sorted = st.rows.map((r, i) => ({ r, i })).sort((x, y) => {
          for (const col of orders) {
            const xv = (x.r as Record<string, string>)[col];
            const yv = (y.r as Record<string, string>)[col];
            if (xv < yv) return -1;
            if (xv > yv) return 1;
          }
          return x.i - y.i;
        }).map((e) => e.r).map((r) => ({
          ...r, start_month: 1, start_day: 1, end_month: 12, end_day: 31, price_override: 1, sort_order: 0,
        }));
        const [a, b] = range ?? [0, sorted.length];
        return { data: sorted.slice(a, b + 1), error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, in: () => chain,
        order: (c: string) => { orders.push(c); return chain; },
        range: (a: number, b: number) => { range = [a, b]; return chain; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  } as unknown as Parameters<typeof readPlanSeasons>[0];
}

const PA = 'aaaaaaaa-0000-4000-8000-000000000001';
const PB = 'bbbbbbbb-0000-4000-8000-000000000002';
const PC = 'cccccccc-0000-4000-8000-000000000003';
// id 前綴刻意與 plan_id 排序相反（A 的 id 最大、C 最小），拿掉 order('plan_id') 時排序結果會整個倒過來。
const ID_PREFIX: Record<string, string> = { [PA]: 'z', [PB]: 'm', [PC]: 'a' };
const mk = (plan: string, n: number, offset = 0): SeasonRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${ID_PREFIX[plan]}-${String(offset + i).padStart(5, '0')}`, plan_id: plan }));

describe('#766 readPlanSeasons 排序與截斷', () => {
  beforeEach(() => { st.rows = []; st.calls = []; });

  it('每頁查詢都先 order plan_id 再 order id，並帶 .range', async () => {
    st.rows = mk(PA, 3);
    await readPlanSeasons(admin(), 't1', [PA]);
    expect(st.calls).toHaveLength(1);
    expect(st.calls[0].orders).toEqual(['plan_id', 'id']);
    expect(st.calls[0].range).toEqual([0, 999]);
  });

  it('多 plan_id 截斷：資料故意亂序插入，仍依 plan_id 排序，只有截斷點（含）之後的方案不完整', async () => {
    // A 2490 列、B 2500 列、C 10 列，共 5000 列剛好 5 滿頁；依 plan_id 排序後最後 10 列屬於 C，截斷點 = C。
    st.rows = [...mk(PC, 10), ...mk(PB, 2500), ...mk(PA, 2490)];
    // 若拿掉 order('plan_id')，只剩 id 排序（C 的 id 最小）會讓 C 排最前面、截斷點變成 A，下列斷言會失敗。
    const reader = await readPlanSeasons(admin(), 't1', [PA, PB, PC]);
    expect(st.calls).toHaveLength(5);
    expect(st.calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999]]);
    expect(reader.isIncomplete(PA)).toBe(false);
    expect(reader.isIncomplete(PB)).toBe(false);
    expect(reader.isIncomplete(PC)).toBe(true);
    expect(reader.byPlan.get(PA)).toHaveLength(2490);
    expect(reader.byPlan.get(PB)).toHaveLength(2500);
    expect(reader.byPlan.get(PC)).toHaveLength(10);
  });

  it('多 plan_id 截斷點落在中間方案：之前完整、該方案與之後不完整（大小寫不敏感）', async () => {
    st.rows = [...mk(PB, 4000), ...mk(PA, 1000)];
    // 排序後 A 1000 列 + B 4000 列 = 5000 列滿 5 頁，最後一列是 B；C 不在資料內但排序在 B 之後。
    const reader = await readPlanSeasons(admin(), 't1', [PA, PB, PC]);
    expect(reader.isIncomplete(PA)).toBe(false);
    expect(reader.isIncomplete(PB)).toBe(true);
    expect(reader.isIncomplete(PC)).toBe(true);
    expect(reader.isIncomplete(PB.toUpperCase())).toBe(true);
    expect(reader.isIncomplete(PA.toUpperCase())).toBe(false);
  });
});
