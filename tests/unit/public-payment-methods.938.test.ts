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

  it('preferredId 命中只回該筆；未命中（停用／他店／不存在）回退全部且不丟錯', async () => {
    methodRows = [
      { id: 'a', tenant_id: 'T1', active: true, sort_order: 1, created_at: '2026-01-01', method_type: 'CASH', display_name: '現金', qr_image_url: '', config: {} },
      { id: 'b', tenant_id: 'T1', active: true, sort_order: 2, created_at: '2026-01-01', method_type: 'LINE_PAY', display_name: 'LP', qr_image_url: '', config: {} },
      { id: 'x', tenant_id: 'T1', active: false, sort_order: 0, created_at: '2026-01-01', method_type: 'JKOPAY', display_name: '停用', qr_image_url: '', config: {} },
      { id: 'o', tenant_id: 'T1', active: true, sort_order: 0, created_at: '2026-01-01', method_type: 'ONLINE_PAYMENT', display_name: '線上', qr_image_url: '', config: {} },
    ];
    expect((await loadPublicPaymentMethods('demo-shop', { preferredId: 'b' })).map((m) => m.id)).toEqual(['b']);
    for (const id of ['x', 'o', 'nope']) {
      expect((await loadPublicPaymentMethods('demo-shop', { preferredId: id })).map((m) => m.id)).toEqual(['a', 'b']);
    }
    expect((await loadPublicPaymentMethods('demo-shop', {})).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('shopCode 格式不合法回空陣列', async () => {
    expect(await loadPublicPaymentMethods('../x')).toEqual([]);
  });
});

describe('#938 shouldShowPaymentMethods', () => {
  const NOW = new Date('2026-10-14T00:00:00.000Z');
  const mk = (o: Partial<Parameters<typeof shouldShowPaymentMethods>[0]>) =>
    ({ status: 'CONFIRMED', paymentStatus: 'UNPAID', seatsReserved: true, holdExpiresAt: null, ...o }) as Parameters<typeof shouldShowPaymentMethods>[0];
  it.each([
    // [status, paymentStatus, seatsReserved, expected]：PENDING 以訂單本身占位為準（不看方案 salesMode）
    ['PENDING', 'UNPAID', true, true], ['PENDING', 'UNPAID', false, false], ['PENDING', 'UNPAID', undefined, false],
    ['PENDING', 'PARTIAL', true, true], ['PENDING', 'PAID', true, false],
    ['CONFIRMED', 'UNPAID', false, true], ['CONFIRMED', 'UNPAID', undefined, true],
    ['CANCELLED', 'UNPAID', true, false], ['COMPLETED', 'UNPAID', true, false],
    ['CONFIRMED', 'PARTIAL', true, true], ['CONFIRMED', 'PAID', true, false],
    ['CONFIRMED', 'REFUND_PENDING', true, false], ['CONFIRMED', 'REFUNDED', true, false],
  ] as const)('%s / %s / seatsReserved=%s => %s', (status, paymentStatus, seatsReserved, expected) => {
    expect(shouldShowPaymentMethods(mk({ status, paymentStatus, seatsReserved }), NOW)).toBe(expected);
  });
  it('holdExpiresAt 已過期不顯示；未到期或 null 照常顯示', () => {
    expect(shouldShowPaymentMethods(mk({ holdExpiresAt: '2026-10-13T23:59:59.000Z' }), NOW)).toBe(false);
    expect(shouldShowPaymentMethods(mk({ holdExpiresAt: '2026-10-14T00:00:01.000Z' }), NOW)).toBe(true);
    expect(shouldShowPaymentMethods(mk({ holdExpiresAt: null }), NOW)).toBe(true);
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
    for (const bad of ['qr.png', 'http://x.test/qr.png', 'javascript:alert(1)', '//x.test/qr.png', 'https://', 'not a url', '']) {
      expect(render([{ ...base, qrImageUrl: bad }])).not.toContain('<img');
    }
  });
  it('QR 網址大小寫不敏感且 trim 後為 https 才渲染', () => {
    expect(render([{ ...base, qrImageUrl: 'HTTPS://x.test/qr.png' }])).toContain('<img');
    expect(render([{ ...base, qrImageUrl: '  https://x.test/qr.png \n' }])).toContain('src="https://x.test/qr.png"');
    expect(render([{ ...base, qrImageUrl: ' HTTP://x.test/qr.png ' }])).not.toContain('<img');
    expect(render([{ ...base, qrImageUrl: ' JavaScript:alert(1)' }])).not.toContain('<img');
  });
  it('後五碼提示只在清單含 BANK_TRANSFER 時顯示', () => {
    expect(render([base])).toContain(pm.afterTransferNote);
    expect(render([{ ...base, id: 'm2', methodType: 'CASH', displayName: '現金' }])).not.toContain(pm.afterTransferNote);
    expect(render([{ ...base, id: 'm2', methodType: 'CASH' }, base])).toContain(pm.afterTransferNote);
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
    expect(src).toContain('preferredId: order.paymentMethodId');
    expect(src).toContain('<PaymentMethodsSection');
    expect(comp).toContain('t.status.paymentMethods');
    expect(comp).toMatch(/<img[^>]*alt=\{pm\.qrAlt/);
    expect(src.indexOf('if (!order) notFound()')).toBeLessThan(src.indexOf('loadPublicPaymentMethods(shopCode, { preferredId: order.paymentMethodId })'));
  });
  it('i18n 文案齊全', () => {
    expect(t.status.paymentMethods.empty).toContain('聯絡店家');
    expect(Object.keys(t.status.paymentMethods.types)).toHaveLength(6);
  });
});
