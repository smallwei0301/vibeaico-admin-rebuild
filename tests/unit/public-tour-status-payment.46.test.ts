import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as utils from '@/lib/utils';
import { common } from '@/i18n/zh-TW/common';
import * as publicOrderFormat from '@/lib/public-order-format';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TourOrder, TourPaymentStatus } from '@/lib/types';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';

const loader = vi.fn();
const tzLoader = vi.fn(async () => 'Asia/Taipei');
const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
// The repo's Vitest config preserves JSX for Next. Compile the actual page to
// CommonJS here so these tests exercise server rendering without a config change.
const source = readFileSync(resolve(process.cwd(), 'src/app/s/[shopCode]/requests/[orderId]/page.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pageModule = { exports: {} as { default: (props: {
  params: Promise<{ shopCode: string; orderId: string }>;
  searchParams: Promise<{ contact?: string }>;
}) => Promise<React.ReactElement> } };
const imports: Record<string, unknown> = {
  'next/navigation': { notFound },
  'next/link': { default: (props: React.ComponentProps<'a'>) => React.createElement('a', props) },
  '@/server/public-tour-request': { loadPublicTourRequestStatus: loader, loadPublicShopTimeZone: tzLoader },
  '@/i18n/zh-TW/pages/public-tour-request': { publicTourRequestPage: t },
  '@/lib/utils': utils,
  '@/i18n/zh-TW/common': { common },
  '@/lib/public-order-format': publicOrderFormat,
};
new Function('require', 'exports', 'React', compiled)((id: string) => {
  if (!(id in imports)) throw new Error(`Unexpected page import: ${id}`);
  return imports[id];
}, pageModule.exports, React);
const Page = pageModule.exports.default;

const order: TourOrder = {
  id: 'o1', orderNo: 'T001', tripId: 't1', tripTitle: '行程', planName: '方案',
  departsOn: '2026-12-01', startTime: '', customerName: '旅客', customerPhone: '',
  partySize: 2, unitPrice: 1000, totalAmount: 2000, depositAmount: 500,
  status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMethodLabel: '', paymentRef: '',
  source: 'VIBEAI_SHOP', holdExpiresAt: '2026-11-01T12:00:00Z', note: '', createdAt: '2026-10-01T12:00:00Z',
  salesMode: 'REQUEST',
};
async function render(overrides: Partial<TourOrder> = {}, contact: string | undefined = 'traveler@example.com') {
  loader.mockResolvedValue({ ...order, ...overrides });
  return renderToStaticMarkup(await Page({
    params: Promise.resolve({ shopCode: 'demo', orderId: 'o1' }),
    searchParams: Promise.resolve({ contact }),
  }));
}

describe('#46 旅客付款狀態顯示', () => {
  beforeEach(() => { loader.mockReset(); notFound.mockClear(); });

  it.each<TourPaymentStatus>(['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED'])('CONFIRMED 顯示真實 %s，只有未付要求付款', async (paymentStatus) => {
    const html = await render({ paymentStatus });
    expect(html).toContain(t.status.paymentTitle);
    expect(html).toContain(t.status.paymentState[paymentStatus]);
    expect(html).toContain(t.status.paymentDescription[paymentStatus]);
    expect(html.includes('前完成付款')).toBe(paymentStatus === 'UNPAID');
    expect(html.includes('逾期名額將被釋放')).toBe(paymentStatus === 'UNPAID');
    if (paymentStatus === 'PARTIAL') {
      expect(html).not.toContain(t.status.paymentState.PAID);
      expect(html).not.toContain('1,500'); // depositAmount is not authoritative paidAmount.
    }
    if (paymentStatus === 'REFUND_PENDING') expect(html).not.toContain(t.status.paymentState.REFUNDED);
  });

  it.each<TourPaymentStatus>(['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED'])('PENDING 已鎖位 %s 不固定聲稱尚未付款', async (paymentStatus) => {
    const html = await render({ status: 'PENDING', salesMode: 'INSTANT', paymentStatus });
    expect(html).toContain(t.status.pendingLockedTitle);
    expect(html).toContain(t.status.paymentState[paymentStatus]);
    expect(html.includes(t.status.pendingLockedDescription)).toBe(paymentStatus === 'UNPAID');
    if (paymentStatus !== 'UNPAID') expect(html).not.toContain(t.status.paymentState.UNPAID);
  });

  it('FIXED_DEPARTURE 已付清不顯示未付款提示', async () => {
    const html = await render({ status: 'PENDING', salesMode: 'FIXED_DEPARTURE', paymentStatus: 'PAID' });
    expect(html).toContain(t.status.pendingLockedTitle);
    expect(html).toContain(t.status.paymentState.PAID);
    expect(html).not.toContain(t.status.pendingLockedDescription);
  });

  it('行程完成與退款處理中分別顯示，不冒充退款完成', async () => {
    const html = await render({ status: 'COMPLETED', paymentStatus: 'REFUND_PENDING' });
    expect(html).toContain(t.status.completedTitle);
    expect(html).toContain(t.status.paymentState.REFUND_PENDING);
    expect(html).not.toContain(t.status.paymentState.REFUNDED);
  });

  it.each(['REQUEST', undefined] as const)('REQUEST／未知販售方式不宣稱鎖位（%s）', async (salesMode) => {
    const html = await render({ status: 'PENDING', salesMode, paymentStatus: 'PAID' });
    expect(html).toContain(t.status.pendingTitle);
    expect(html).not.toContain(t.status.pendingLockedTitle);
    expect(html).toContain(t.status.paymentState.PAID);
  });

  it.each<TourPaymentStatus>(['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED'])('取消訂單 %s 保留付款事實且不邀請付款', async (paymentStatus) => {
    const html = await render({ status: 'CANCELLED', paymentStatus });
    expect(html).toContain(t.status.cancelledTitle);
    expect(html).toContain(t.status.paymentState[paymentStatus]);
    expect(html).not.toContain('前完成付款');
    expect(html).not.toContain(t.status.confirmedNoDeadlineDescription);
    expect(html).not.toContain('href="/pay');
  });

  it('無付款期限時未付款請向店家確認；已付清仍不邀請付款', async () => {
    expect(await render({ holdExpiresAt: null })).toContain(t.status.confirmedNoDeadlineDescription);
    expect(await render({ holdExpiresAt: null, paymentStatus: 'PAID' })).not.toContain(t.status.confirmedNoDeadlineDescription);
  });

  it('讀取邊界仍傳原聯絡方式，缺少聯絡方式不讀取', async () => {
    await render();
    expect(loader).toHaveBeenCalledWith('demo', 'o1', 'traveler@example.com');
    loader.mockClear();
    await expect(Page({ params: Promise.resolve({ shopCode: 'demo', orderId: 'o1' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loader).not.toHaveBeenCalled();
  });
});
