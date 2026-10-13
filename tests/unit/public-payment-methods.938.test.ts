import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { shouldShowPaymentMethods } from '@/lib/public-payment-methods';

type Row = Record<string, unknown>;
const calls: { table: string; filters: Record<string, unknown>; orders: string[]; select?: string }[] = [];
let methodRows: Row[] = [];

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const call = { table, filters: {} as Record<string, unknown>, orders: [] as string[], select: undefined as string | undefined };
      calls.push(call);
      const q: Record<string, unknown> = {};
      q.select = (s: string) => { call.select = s; return q; };
      q.eq = (k: string, v: unknown) => { call.filters[k] = v; return q; };
      q.order = (k: string) => { call.orders.push(k); return q; };
      q.maybeSingle = async () => ({ data: table === 'tenants' ? { id: 'T1' } : null, error: null });
      // 模擬 DB：依 tenant_id / active 過濾後依 sort_order, created_at 排序
      q.then = (res: (v: unknown) => unknown) => {
        const rows = methodRows
          .filter((r) => r.tenant_id === call.filters.tenant_id && r.active === call.filters.active)
          .sort((a, b) => (a.sort_order as number) - (b.sort_order as number) || String(a.created_at).localeCompare(String(b.created_at)));
        return Promise.resolve({ data: rows, error: null }).then(res);
      };
      return q;
    },
  }),
}));

import { loadPublicPaymentMethods } from '@/server/public-payment-methods';

describe('#938 loadPublicPaymentMethods', () => {
  it('只回 active、依 sort_order/created_at 排序、只輸出白名單欄位', async () => {
    methodRows = [
      { id: 'b', tenant_id: 'T1', active: true, sort_order: 2, created_at: '2026-01-01', method_type: 'LINE_PAY', display_name: 'LP', qr_image_url: 'https://x/qr.png', config: { secretKey: 'LEAK', instructions: '掃碼' } },
      { id: 'a', tenant_id: 'T1', active: true, sort_order: 1, created_at: '2026-01-02', method_type: 'BANK_TRANSFER', display_name: '國泰', qr_image_url: '', config: { bankName: '國泰世華', bankCode: '013', accountNumber: '123', accountHolderName: '王', hashKey: 'LEAK' } },
      { id: 'c', tenant_id: 'T1', active: false, sort_order: 0, created_at: '2026-01-01', method_type: 'CASH', display_name: '現金', qr_image_url: '', config: {} },
      { id: 'd', tenant_id: 'OTHER', active: true, sort_order: 0, created_at: '2026-01-01', method_type: 'CASH', display_name: '別店', qr_image_url: '', config: {} },
    ];
    const out = await loadPublicPaymentMethods('demo-shop');
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
    expect(Object.keys(out[0]).sort()).toEqual(
      ['accountHolderName', 'accountNumber', 'bankCode', 'bankName', 'displayName', 'id', 'instructions', 'methodType', 'qrImageUrl'],
    );
    expect(JSON.stringify(out)).not.toContain('LEAK');
    expect(out[0]).toMatchObject({ bankName: '國泰世華', bankCode: '013', accountNumber: '123', accountHolderName: '王' });
    const q = calls.filter((c) => c.table === 'tenant_payment_methods').at(-1)!;
    expect(q.orders).toEqual(['sort_order', 'created_at']);
    expect(q.select).not.toContain('*');
  });

  it('shopCode 格式不合法回空陣列', async () => {
    expect(await loadPublicPaymentMethods('../x')).toEqual([]);
  });
});

describe('#938 shouldShowPaymentMethods', () => {
  it.each([
    ['PENDING', 'UNPAID', true], ['CONFIRMED', 'UNPAID', true],
    ['CANCELLED', 'UNPAID', false], ['COMPLETED', 'UNPAID', false],
    ['CONFIRMED', 'PARTIAL', false], ['CONFIRMED', 'PAID', false],
    ['CONFIRMED', 'REFUND_PENDING', false], ['CONFIRMED', 'REFUNDED', false],
  ] as const)('%s / %s => %s', (status, paymentStatus, expected) => {
    expect(shouldShowPaymentMethods({ status, paymentStatus })).toBe(expected);
  });
});

describe('#938 狀態頁 source', () => {
  const src = readFileSync('src/app/s/[shopCode]/requests/[orderId]/page.tsx', 'utf8');
  it('有付款方式區塊、受條件控制、使用 i18n 與 img alt', () => {
    expect(src).toContain('loadPublicPaymentMethods');
    expect(src).toContain('shouldShowPaymentMethods(order)');
    expect(src).toContain('t.status.paymentMethods');
    expect(src).toMatch(/<img[^>]*alt=\{pm\.qrAlt/);
    expect(src.indexOf('if (!order) notFound()')).toBeLessThan(src.indexOf('loadPublicPaymentMethods(shopCode)'));
  });
  it('i18n 文案齊全', () => {
    expect(t.status.paymentMethods.empty).toContain('聯絡店家');
    expect(Object.keys(t.status.paymentMethods.types)).toHaveLength(6);
  });
});
