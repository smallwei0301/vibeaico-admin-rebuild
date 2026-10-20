/**
 * issue #1066 — LINE「票券」回覆：折數、兌換券、有效期、查詢失敗
 * 假 admin client 會真的套用 eq / or 篩選，才能驗到有效期半開區間 [start_at, end_at)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replyCoupons } from '@/server/line-events';

type Row = Record<string, unknown>;
const NOW = Date.parse('2026-10-20T00:00:00.000Z');

/** 解析 `col.is.null,col.lte.ISO` / `col.is.null,col.gt.ISO` 兩種 or 字串 */
function matchesOr(row: Row, expr: string): boolean {
  return expr.split(',').some((part) => {
    const [col, op, ...rest] = part.split('.');
    const val = rest.join('.');
    const v = row[col] as string | null;
    if (op === 'is') return v === null;
    if (v === null) return false;
    if (op === 'lte') return Date.parse(v) <= Date.parse(val);
    if (op === 'gt') return Date.parse(v) > Date.parse(val);
    throw new Error(`fake 不認得 or 運算 ${op}`);
  });
}

function fakeAdmin(rows: Row[] | null, error: { message: string } | null = null) {
  return {
    from(table: string) {
      if (table !== 'coupons') throw new Error(`沒預期查表「${table}」`);
      let list = rows ?? [];
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => { list = list.filter((r) => r[col] === v); return q; },
        or: (expr: string) => { list = list.filter((r) => matchesOr(r, expr)); return q; },
        order: () => q,
        limit: async (n: number) => (error ? { data: null, error } : { data: list.slice(0, n), error: null }),
      };
      return q;
    },
  } as any;
}

const base = { tenant_id: 't1', status: 'PUBLISHED', start_at: null, end_at: null, gift_item: null, description: null };
const coupon = (o: Row): Row => ({ name: 'C', discount_type: 'AMOUNT', discount_value: 100, ...base, ...o });

async function run(rows: Row[] | null, error: { message: string } | null = null) {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
    sent.push(JSON.parse(init.body).messages[0].text);
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  }));
  const ctx = { admin: fakeAdmin(rows, error), tenant: { id: 't1', shop_code: 's', name: 'S', business_type: 'LOCAL_SHOP' }, token: 'tk', replyToken: 'rt', userId: 'U', lineConfig: {} } as any;
  const result = await replyCoupons(ctx);
  return { result, text: sent[0] };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('replyCoupons（issue #1066）', () => {
  it('PERCENT 10 → 9 折；15 → 8.5 折（不再寫成「10 折」）', async () => {
    const { text } = await run([
      coupon({ name: 'A', discount_type: 'PERCENT', discount_value: 10 }),
      coupon({ name: 'B', discount_type: 'PERCENT', discount_value: 15 }),
    ]);
    expect(text).toContain('・A｜9 折');
    expect(text).toContain('・B｜8.5 折');
    expect(text).not.toContain('10 折');
  });

  it('PERCENT 邊界：>=100 → 免費；<=0 不顯示折扣字樣', async () => {
    const { text } = await run([
      coupon({ name: 'F', discount_type: 'PERCENT', discount_value: 100 }),
      coupon({ name: 'Z', discount_type: 'PERCENT', discount_value: 0 }),
    ]);
    expect(text).toContain('・F｜免費');
    expect(text).toContain('・Z\n');
  });

  it('GIFT 顯示「兌換：{gift_item}」；gift_item 空 → 中性文案，絕不是折抵 NT$0', async () => {
    const { text } = await run([
      coupon({ name: 'G1', discount_type: 'GIFT', discount_value: 0, gift_item: '手作咖啡' }),
      coupon({ name: 'G2', discount_type: 'GIFT', discount_value: 0, gift_item: '  ' }),
    ]);
    expect(text).toContain('・G1｜兌換：手作咖啡');
    expect(text).toContain('・G2｜兌換贈品');
    expect(text).not.toContain('NT$0');
  });

  it('AMOUNT 維持「折抵 NT$」千分位', async () => {
    const { text } = await run([coupon({ name: 'M', discount_value: 1500 })]);
    expect(text).toContain('・M｜折抵 NT$1,500');
  });

  it('只列目前有效：過期／未開始排除；null 不限；start=now 可用、end=now 已過期', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = (ms: number) => new Date(ms).toISOString();
    const { text } = await run([
      coupon({ name: 'expired', end_at: iso(NOW - 1) }),
      coupon({ name: 'endNow', end_at: iso(NOW) }),
      coupon({ name: 'future', start_at: iso(NOW + 1) }),
      coupon({ name: 'startNow', start_at: iso(NOW) }),
      coupon({ name: 'open' }),
      coupon({ name: 'inWindow', start_at: iso(NOW - 1000), end_at: iso(NOW + 1000) }),
    ]);
    expect(text).toContain('startNow');
    expect(text).toContain('open');
    expect(text).toContain('inWindow');
    expect(text).not.toContain('・expired');
    expect(text).not.toContain('・endNow');
    expect(text).not.toContain('・future');
  });

  it('全部都失效 → 才回「沒有票券」', async () => {
    const { result, text } = await run([coupon({ end_at: '2000-01-01T00:00:00.000Z' })]);
    expect(result).toBe(true);
    expect(text).toContain('目前沒有開放領取的優惠票券');
  });

  it('查詢失敗 → 回 false、留 log、不回覆「沒有票券」', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, text } = await run(null, { message: 'boom' });
    expect(result).toBe(false);
    expect(text).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('[line] replyCoupons 查詢 coupons 失敗', expect.objectContaining({ message: 'boom' }));
  });
});
