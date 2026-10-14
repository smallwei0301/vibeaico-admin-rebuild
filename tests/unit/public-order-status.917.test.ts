// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { cancelledCopyKind, formatInstantInTimeZone, formatPlainDateWithWeekday } from '@/lib/public-order-format';
import { common } from '@/i18n/zh-TW/common';
import * as utils from '@/lib/utils';
import * as publicOrderFormat from '@/lib/public-order-format';
import * as publicPaymentMethodsLib from '@/lib/public-payment-methods';
import { PaymentMethodsSection } from '@/components/public/PaymentMethodsSection';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import type { TourOrder } from '@/lib/types';

const page = readFileSync('src/app/s/[shopCode]/requests/[orderId]/page.tsx', 'utf8');

describe('#917 旅客訂單狀態頁格式化', () => {
  it('出發日期為純日期並附星期，不受時區影響', () => {
    expect(formatPlainDateWithWeekday('2026-11-02', common.weekdays)).toBe('2026/11/02（一）');
    expect(formatPlainDateWithWeekday('2026-11-01', common.weekdays)).toBe('2026/11/01（日）');
    expect(formatPlainDateWithWeekday('2026-02-30', common.weekdays)).toBeNull();
    expect(formatPlainDateWithWeekday('abc', common.weekdays)).toBeNull();
  });
  it('時間點依店家時區顯示', () => {
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z', 'Asia/Taipei')).toBe('2026/10/14 00:30');
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z')).toBe('2026/10/14 00:30');
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z', 'America/Los_Angeles')).toBe('2026/10/13 09:30');
    expect(formatInstantInTimeZone('2026-10-13T16:30:00Z', 'bad/zone')).toBe('2026/10/14 00:30');
    expect(formatInstantInTimeZone('nope')).toBeNull();
  });
  it('CANCELLED 依付款狀態分流', () => {
    expect(cancelledCopyKind('UNPAID')).toBe('UNPAID');
    expect(cancelledCopyKind(undefined)).toBe('UNPAID');
    for (const s of ['PAID', 'PARTIAL', 'REFUND_PENDING']) expect(cancelledCopyKind(s)).toBe('PAID');
    expect(cancelledCopyKind('REFUNDED')).toBe('REFUNDED');
  });
  it('頁面使用分流與格式化，不直接輸出 departsOn 原始值', () => {
    expect(page).toContain('cancelledCopyKind(order.paymentStatus)');
    expect(page).toContain('cancelledPaidDescription');
    expect(page).not.toMatch(/<dd>\{order\.departsOn\}/);
    expect(page).not.toContain('formatDateTime');
  });
  it('不以方案定金（depositAmount）冒充實付金額；僅顯示退款紀錄的已退金額', () => {
    expect(page).not.toContain('depositAmount');
    expect(page).toContain('refundedAmount');
  });
});

const loader = vi.fn();
const tzLoader = vi.fn(async () => 'Asia/Taipei');
const compiled = ts.transpileModule(page, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} as { default: (p: unknown) => Promise<React.ReactElement> } };
const imports: Record<string, unknown> = {
  'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
  'next/link': { default: (props: React.ComponentProps<'a'>) => React.createElement('a', props) },
  '@/server/public-tour-request': { loadPublicTourRequestStatus: loader, loadPublicShopTimeZone: tzLoader },
  '@/server/public-payment-methods': { loadPublicPaymentMethods: async () => [] },
  '@/components/public/PaymentMethodsSection': { PaymentMethodsSection },
  '@/lib/public-payment-methods': publicPaymentMethodsLib,
  '@/i18n/zh-TW/pages/public-tour-request': { publicTourRequestPage: t },
  '@/i18n/zh-TW/common': { common },
  '@/lib/public-order-format': publicOrderFormat,
  '@/lib/utils': utils,
};
new Function('require', 'exports', 'React', compiled)((id: string) => {
  if (!(id in imports)) throw new Error(`Unexpected page import: ${id}`);
  return imports[id];
}, mod.exports, React);

const base = {
  id: 'o1', orderNo: 'T001', tripId: 't1', tripTitle: '行程', planName: '方案',
  departsOn: '2026-12-01', startTime: '', customerName: '旅客', customerPhone: '',
  partySize: 2, unitPrice: 1000, totalAmount: 2000, depositAmount: 0,
  status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMethodLabel: '', paymentRef: '',
  source: 'VIBEAI_SHOP', holdExpiresAt: null, note: '', createdAt: '2026-10-01T12:00:00Z',
} as TourOrder;

async function render(overrides: Partial<TourOrder>) {
  loader.mockResolvedValue({ ...base, ...overrides });
  return renderToStaticMarkup(await mod.exports.default({
    params: Promise.resolve({ shopCode: 'shop', orderId: 'o1' }),
    searchParams: Promise.resolve({ contact: 'x' }),
  }));
}

const MODES = ['REQUEST', 'FIXED_DEPARTURE', 'INSTANT', undefined] as const;
const banned = ['婉拒', '重新申請', '導遊已確認', '導遊審核', '名額已釋出'];
// 只取狀態卡片（第一個 h1 到其 section 結尾），避免其他區塊干擾。
function statusCard(html: string): string {
  const start = html.indexOf('<h1');
  return html.slice(start, html.indexOf('</section>', start));
}

describe('#917 CONFIRMED／CANCELLED 文案不依（可變的）販售模式分流', () => {
  const cases: Array<Partial<TourOrder>> = [
    { status: 'CONFIRMED', paymentStatus: 'UNPAID', holdExpiresAt: null },
    { status: 'CONFIRMED', paymentStatus: 'UNPAID', holdExpiresAt: '2026-11-01T12:00:00Z' },
    { status: 'CONFIRMED', paymentStatus: 'PAID' },
    { status: 'CANCELLED', paymentStatus: 'UNPAID' },
    { status: 'CANCELLED', paymentStatus: 'PAID' },
    { status: 'CANCELLED', paymentStatus: 'REFUNDED' },
  ];
  it.each(cases)('四種 salesMode 文案完全相同 %j', async (c) => {
    const cards = new Set<string>();
    for (const salesMode of MODES) {
      const card = statusCard(await render({ ...c, salesMode }));
      for (const w of banned) expect(card).not.toContain(w);
      cards.add(card);
    }
    expect(cards.size).toBe(1);
  });
  it('使用中性文案', async () => {
    const confirmed = await render({ status: 'CONFIRMED', paymentStatus: 'UNPAID', holdExpiresAt: null, salesMode: 'FIXED_DEPARTURE' });
    expect(confirmed).toContain(t.status.confirmedTitle);
    expect(confirmed).toContain(t.status.confirmedNoDeadlineDescription);
    const paid = await render({ status: 'CONFIRMED', paymentStatus: 'PAID', salesMode: 'REQUEST' });
    expect(paid).toContain(t.status.confirmedPaymentDescription);
    const cancelled = await render({ status: 'CANCELLED', paymentStatus: 'UNPAID', salesMode: 'INSTANT' });
    expect(cancelled).toContain(t.status.cancelledTitle);
    expect(cancelled).toContain(t.status.cancelledDescription);
  });
  it('不再保留 locked 專用的確認／取消文案 key', () => {
    const keys = Object.keys(t.status);
    expect(keys.filter((k) => /^(confirmed|cancelled)Locked/.test(k))).toEqual([]);
  });
});

describe('#917 付款期限與送出時間依店家時區', () => {
  const iso = '2026-10-13T16:30:00Z';
  it('Asia/Taipei 與 America/Los_Angeles 顯示不同，且頁面確實傳入店家時區', async () => {
    tzLoader.mockResolvedValueOnce('Asia/Taipei');
    const taipei = await render({ status: 'CONFIRMED', paymentStatus: 'UNPAID', holdExpiresAt: iso, createdAt: iso });
    tzLoader.mockResolvedValueOnce('America/Los_Angeles');
    const la = await render({ status: 'CONFIRMED', paymentStatus: 'UNPAID', holdExpiresAt: iso, createdAt: iso });
    expect(tzLoader).toHaveBeenCalledWith('shop');
    expect(taipei).toContain('2026/10/14 00:30');
    expect(la).toContain('2026/10/13 09:30');
    expect(la).not.toContain('2026/10/14 00:30');
  });
});
