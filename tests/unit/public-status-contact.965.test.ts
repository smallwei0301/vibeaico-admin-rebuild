import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicContactActions } from '@/components/public/PublicContactActions';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { common } from '@/i18n/zh-TW/common';
import * as publicOrderFormat from '@/lib/public-order-format';
import * as publicPaymentMethodsLib from '@/lib/public-payment-methods';
import * as utils from '@/lib/utils';
import type { PublicShop } from '@/server/public-shop';
import type { TourOrder } from '@/lib/types';

const PAGE = 'src/app/s/[shopCode]/requests/[orderId]/page.tsx';
const source = readFileSync(PAGE, 'utf8');

const orderLoader = vi.fn();
const contactLoader = vi.fn();
const notFound = vi.fn(() => { throw new Error('NOT_FOUND'); });
const imports: Record<string, unknown> = {
  'next/navigation': { notFound },
  'next/link': { default: (props: React.ComponentProps<'a'>) => React.createElement('a', props) },
  '@/server/public-tour-request': { loadPublicTourRequestStatus: orderLoader, loadPublicShopTimeZone: async () => 'Asia/Taipei' },
  '@/server/public-shop': { loadPublicShopContact: contactLoader },
  '@/components/public/PublicContactActions': { PublicContactActions },
  '@/server/public-payment-methods': { loadPublicPaymentMethods: async () => [] },
  '@/components/public/PaymentMethodsSection': { PaymentMethodsSection: () => null },
  '@/components/public/SaveStatusLink': { SaveStatusLink: () => null },
  '@/lib/public-payment-methods': publicPaymentMethodsLib,
  '@/i18n/zh-TW/pages/public-tour-request': { publicTourRequestPage: t },
  '@/i18n/zh-TW/common': { common },
  '@/lib/public-order-format': publicOrderFormat,
  '@/lib/utils': utils,
};
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} as { default: (p: unknown) => Promise<React.ReactElement> } };
new Function('require', 'exports', 'React', compiled)((id: string) => {
  if (!(id in imports)) throw new Error(`Unexpected page import: ${id}`);
  return imports[id];
}, mod.exports, React);

const order = {
  id: 'o1', orderNo: 'T001', tripId: 't1', tripTitle: '行程', planName: '方案',
  departsOn: '2026-12-01', startTime: '', customerName: '旅客', customerPhone: '',
  partySize: 2, unitPrice: 1000, totalAmount: 2000, depositAmount: 0,
  status: 'CANCELLED', paymentStatus: 'UNPAID', paymentMethodLabel: '', paymentRef: '',
  source: 'VIBEAI_SHOP', holdExpiresAt: null, note: '', createdAt: '2026-10-01T12:00:00Z',
} as TourOrder;

const shop: PublicShop = {
  shopCode: 'demo', name: '店', description: '', phone: '0912345678', phoneHref: '0912345678',
  email: '', address: '', lineBasicId: '@abc1234x', businessType: 'GUIDE',
};

async function render(contact: string | undefined = 'x') {
  return renderToStaticMarkup(await mod.exports.default({
    params: Promise.resolve({ shopCode: 'demo', orderId: 'o1' }),
    searchParams: Promise.resolve({ contact }),
  }));
}

describe('#965 旅客訂單狀態頁的店家聯絡按鈕', () => {
  beforeEach(() => { orderLoader.mockReset(); contactLoader.mockReset(); notFound.mockClear(); orderLoader.mockResolvedValue(order); });

  it('店家有 LINE／電話時渲染聯絡區塊與按鈕', async () => {
    contactLoader.mockResolvedValue(shop);
    const html = await render();
    expect(contactLoader).toHaveBeenCalledWith('demo');
    expect(html).toContain(`>${t.status.contact.title}</h2>`);
    expect(html).toContain(t.status.contact.viaLine);
    expect(html).toContain('https://line.me/R/ti/p/%40abc1234x');
    expect(html).toContain('href="tel:0912345678"');
    expect(html).not.toContain('mailto:');
  });

  it('店家完全沒填聯絡方式，或讀不到店家時不渲染區塊（無死按鈕）', async () => {
    for (const value of [{ ...shop, lineBasicId: '', phone: '', phoneHref: '', email: '' }, null]) {
      contactLoader.mockResolvedValue(value);
      const html = await render();
      expect(html).not.toContain(`>${t.status.contact.title}</h2>`);
      expect(html).not.toContain('line.me');
      expect(html).not.toContain('tel:');
    }
  });

  it('驗證失敗（無 contact 或訂單比對不到）時不載入店家聯絡資訊', async () => {
    await expect(render('')).rejects.toThrow('NOT_FOUND');
    orderLoader.mockResolvedValue(null);
    await expect(render('x')).rejects.toThrow('NOT_FOUND');
    expect(contactLoader).not.toHaveBeenCalled();
  });
});

describe('#965 原始碼接線', () => {
  it('聯絡資料與元件都在存取檢查（notFound）之後才載入／渲染', () => {
    const guard = source.indexOf('if (!order) notFound();');
    expect(guard).toBeGreaterThan(0);
    expect(source.indexOf('loadPublicShopContact(shopCode)')).toBeGreaterThan(guard);
    expect(source.indexOf('<PublicContactActions')).toBeGreaterThan(guard);
  });
  it('只傳店家公開物件，不傳訂單或旅客聯絡方式；文案走 i18n', () => {
    const tag = source.match(/<PublicContactActions[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('shop={contactShop}');
    expect(tag).not.toMatch(/order|contact=/);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
    expect(code).not.toMatch(/\p{Script=Han}/u);
  });
  it('loader 只重用店家核心與詳情頁輸出邊界，不查行程資料', () => {
    const loader = readFileSync('src/server/public-shop.ts', 'utf8');
    const body = loader.slice(loader.indexOf('async function loadPublicShopContactUncached'));
    const fn = body.slice(0, body.indexOf('export const loadPublicShopContact'));
    expect(fn).toContain('loadPublicShopCore(');
    expect(fn).toContain('limitPublicShopText(');
    expect(fn).not.toMatch(/\.from\(/);
  });
});
