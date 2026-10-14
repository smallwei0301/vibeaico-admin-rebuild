import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { shouldShowPaymentMethods, type PublicPaymentMethod } from '@/lib/public-payment-methods';
import { PaymentMethodsSection } from '@/components/public/PaymentMethodsSection';

type Row = Record<string, unknown>;
const calls: { table: string; filters: Record<string, unknown>; neq: Record<string, unknown>; orders: string[]; select?: string }[] = [];
let methodRows: Row[] = [];

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const call = { table, filters: {} as Record<string, unknown>, neq: {} as Record<string, unknown>, orders: [] as string[], select: undefined as string | undefined };
      calls.push(call);
      const q: Record<string, unknown> = {};
      q.select = (s: string) => { call.select = s; return q; };
      q.eq = (k: string, v: unknown) => { call.filters[k] = v; return q; };
      q.neq = (k: string, v: unknown) => { call.neq[k] = v; return q; };
      q.order = (k: string) => { call.orders.push(k); return q; };
      q.maybeSingle = async () => ({ data: table === 'tenants' ? { id: 'T1' } : null, error: null });
      // 模擬 DB：依 tenant_id / active 過濾後依 sort_order, created_at 排序
      q.then = (res: (v: unknown) => unknown) => {
        const rows = methodRows
          .filter((r) => r.tenant_id === call.filters.tenant_id && r.active === call.filters.active)
          .filter((r) => !('method_type' in call.neq) || r.method_type !== call.neq.method_type)
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

  it('排除尚未開通的 ONLINE_PAYMENT（查詢以 .neq 過濾，結果亦不含）', async () => {
    methodRows = [
      { id: 'o', tenant_id: 'T1', active: true, sort_order: 0, created_at: '2026-01-01', method_type: 'ONLINE_PAYMENT', display_name: '線上', qr_image_url: '', config: {} },
      { id: 'k', tenant_id: 'T1', active: true, sort_order: 1, created_at: '2026-01-01', method_type: 'CASH', display_name: '現金', qr_image_url: '', config: {} },
    ];
    const out = await loadPublicPaymentMethods('demo-shop');
    expect(out.map((m) => m.id)).toEqual(['k']);
    expect(calls.filter((c) => c.table === 'tenant_payment_methods').at(-1)!.neq).toEqual({ method_type: 'ONLINE_PAYMENT' });
  });

  it('shopCode 格式不合法回空陣列', async () => {
    expect(await loadPublicPaymentMethods('../x')).toEqual([]);
  });
});

describe('#938 shouldShowPaymentMethods', () => {
  it.each([
    ['PENDING', 'UNPAID', 'REQUEST', false], ['PENDING', 'UNPAID', undefined, false],
    ['PENDING', 'UNPAID', 'INSTANT', true], ['PENDING', 'UNPAID', 'FIXED_DEPARTURE', true],
    ['PENDING', 'PAID', 'INSTANT', false],
    ['CONFIRMED', 'UNPAID', 'REQUEST', true], ['CONFIRMED', 'UNPAID', undefined, true],
    ['CANCELLED', 'UNPAID', 'INSTANT', false], ['COMPLETED', 'UNPAID', 'INSTANT', false],
    ['CONFIRMED', 'PARTIAL', 'INSTANT', false], ['CONFIRMED', 'PAID', 'INSTANT', false],
    ['CONFIRMED', 'REFUND_PENDING', 'INSTANT', false], ['CONFIRMED', 'REFUNDED', 'INSTANT', false],
  ] as const)('%s / %s / salesMode=%s => %s', (status, paymentStatus, salesMode, expected) => {
    expect(shouldShowPaymentMethods({ status, paymentStatus, salesMode })).toBe(expected);
  });
});

const pm = t.status.paymentMethods;
const base: PublicPaymentMethod = {
  id: 'm1', methodType: 'BANK_TRANSFER', displayName: '國泰', qrImageUrl: '',
  bankName: '國泰世華', bankCode: '013', accountNumber: '123456789', accountHolderName: '王小明', instructions: '備註 ABC',
};
const render = (methods: PublicPaymentMethod[]) =>
  renderToStaticMarkup(React.createElement(PaymentMethodsSection, { methods }));

describe('#938 PaymentMethodsSection 渲染', () => {
  it('BANK_TRANSFER 顯示銀行、代碼、帳號、戶名、說明與轉帳備註', () => {
    const html = render([base]);
    for (const x of [pm.title, pm.intro, pm.types.BANK_TRANSFER, pm.fields.bank, '國泰世華 013', pm.fields.accountNumber, '123456789', pm.fields.accountHolder, '王小明', '備註 ABC', pm.afterTransferNote]) {
      expect(html).toContain(x);
    }
    expect(html).not.toContain('<img');
  });
  it('https QR 才渲染 img（含 alt）；非 https／純檔名不出現 img', () => {
    const ok = render([{ ...base, qrImageUrl: 'https://x.test/qr.png' }]);
    expect(ok).toContain('src="https://x.test/qr.png"');
    expect(ok).toContain(`alt="${pm.qrAlt('國泰')}"`);
    for (const bad of ['qr.png', 'http://x.test/qr.png', 'javascript:alert(1)', '//x.test/qr.png']) {
      expect(render([{ ...base, qrImageUrl: bad }])).not.toContain('<img');
    }
  });
  it('空清單顯示聯絡店家提示，不含 intro／列表', () => {
    const html = render([]);
    expect(html).toContain(pm.empty);
    expect(html).not.toContain(pm.intro);
    expect(html).not.toContain('<li');
  });
});

describe('#938 狀態頁 source', () => {
  const src = readFileSync('src/app/s/[shopCode]/requests/[orderId]/page.tsx', 'utf8');
  const comp = readFileSync('src/components/public/PaymentMethodsSection.tsx', 'utf8');
  it('頁面引用區塊元件、受條件控制；元件用 i18n 與 img alt', () => {
    expect(src).toContain('loadPublicPaymentMethods');
    expect(src).toContain('shouldShowPaymentMethods(order)');
    expect(src).toContain('<PaymentMethodsSection');
    expect(comp).toContain('t.status.paymentMethods');
    expect(comp).toMatch(/<img[^>]*alt=\{pm\.qrAlt/);
    expect(src.indexOf('if (!order) notFound()')).toBeLessThan(src.indexOf('loadPublicPaymentMethods(shopCode)'));
  });
  it('i18n 文案齊全', () => {
    expect(t.status.paymentMethods.empty).toContain('聯絡店家');
    expect(Object.keys(t.status.paymentMethods.types)).toHaveLength(6);
  });
});
