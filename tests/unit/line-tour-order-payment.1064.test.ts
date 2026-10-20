/**
 * issue #1064 — GUIDE「我的訂單」每筆附付款狀態；部分付款附已付／待付尾款（口徑同 #988）。
 * 用假 admin client 直接呼叫 `replyTourOrders()`，從 LINE reply body 取回文字驗證。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replyTourOrders } from '@/server/line-events';

function setup(rows: Array<Record<string, unknown>>) {
  const selects: string[] = [];
  const admin = {
    from(table: string) {
      if (table === 'line_users') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { customer_id: 'c1' }, error: null }) }) }) }) };
      }
      if (table === 'tour_orders') {
        return {
          select: (cols: string) => {
            selects.push(cols);
            return { eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
  const ctx = { admin, tenant: { id: 't1', shop_code: 's', name: 'n', business_type: 'GUIDE' }, token: 'tk', replyToken: 'rt', userId: 'U1', lineConfig: {} } as any;
  return { ctx, selects };
}

const base = { party_size: 2, trips: { title: '山行' }, trip_departures: { departs_on: '2026-11-01' } };

async function run(rows: Array<Record<string, unknown>>) {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }));
  vi.stubGlobal('fetch', fetchSpy);
  const { ctx, selects } = setup(rows);
  expect(await replyTourOrders(ctx)).toBe(true);
  const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  return { text: JSON.parse(String(init.body)).messages[0].text as string, selects };
}

afterEach(() => vi.unstubAllGlobals());

describe('replyTourOrders() 付款狀態（issue #1064）', () => {
  it('select 包含 payment_status 與 paid_amount', async () => {
    const { selects } = await run([{ ...base, order_no: 'T1', total_amount: 5000, status: 'CONFIRMED', payment_status: 'UNPAID', paid_amount: 0 }]);
    expect(selects[0]).toContain('payment_status');
    expect(selects[0]).toContain('paid_amount');
  });

  it('UNPAID → 已確認／未付款', async () => {
    const { text } = await run([{ ...base, order_no: 'T1', total_amount: 5000, status: 'CONFIRMED', payment_status: 'UNPAID', paid_amount: 0 }]);
    expect(text).toContain('｜已確認／未付款');
    expect(text).not.toContain('待付');
  });

  it('PARTIAL → 部分付款（已付／待付）', async () => {
    const { text } = await run([{ ...base, order_no: 'T2', total_amount: 12000, status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 3000 }]);
    expect(text).toContain('｜已確認／部分付款（已付 NT$3,000／待付 NT$9,000）');
  });

  it('PARTIAL 但 paid >= total（不可靠）→ 不顯示負數待付', async () => {
    const { text } = await run([{ ...base, order_no: 'T2', total_amount: 3000, status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 4000 }]);
    expect(text).toContain('／部分付款');
    expect(text).not.toContain('待付');
    expect(text).not.toMatch(/NT\$-/);
  });

  it('PAID → 已付款', async () => {
    const { text } = await run([{ ...base, order_no: 'T3', total_amount: 5000, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 5000 }]);
    expect(text).toContain('｜已完成／已付款');
  });

  it('CANCELLED + PARTIAL → 只列已付，不列待付', async () => {
    const { text } = await run([{ ...base, order_no: 'T4', total_amount: 12000, status: 'CANCELLED', payment_status: 'PARTIAL', paid_amount: 3000 }]);
    expect(text).toContain('｜已取消／部分付款（已付 NT$3,000）');
    expect(text).not.toContain('待付');
  });
});
