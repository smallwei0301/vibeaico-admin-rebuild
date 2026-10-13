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
const compiled = ts.transpileModule(page, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} as { default: (p: unknown) => Promise<React.ReactElement> } };
const imports: Record<string, unknown> = {
  'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
  'next/link': { default: (props: React.ComponentProps<'a'>) => React.createElement('a', props) },
  '@/server/public-tour-request': { loadPublicTourRequestStatus: loader },
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

describe('#917 固定團次確認／取消文案不使用申請制說法', () => {
  const banned = ['申請', '婉拒', '導遊已確認'];
  const cases: Array<Partial<TourOrder>> = [
    { status: 'CONFIRMED', paymentStatus: 'UNPAID', holdExpiresAt: null },
    { status: 'CONFIRMED', paymentStatus: 'PAID' },
    { status: 'CANCELLED', paymentStatus: 'UNPAID' },
  ];
  for (const salesMode of ['FIXED_DEPARTURE', 'INSTANT'] as const) {
    it.each(cases)(`${salesMode} %j`, async (c) => {
      const html = await render({ ...c, salesMode });
      for (const w of banned) {
        // 頁面其他區塊（欄位標籤等）可能含「申請」；只檢查狀態卡片 h1 與其說明段落。
        const card = html.slice(html.indexOf('<h1'), html.indexOf('</section>', html.indexOf('<h1')));
        expect(card).not.toContain(w);
      }
    });
  }
  it('REQUEST 與 salesMode 未知維持原文案', async () => {
    for (const salesMode of ['REQUEST', undefined] as const) {
      const confirmed = await render({ status: 'CONFIRMED', paymentStatus: 'UNPAID', holdExpiresAt: null, salesMode });
      expect(confirmed).toContain(t.status.confirmedTitle);
      expect(confirmed).toContain(t.status.confirmedNoDeadlineDescription);
      const paid = await render({ status: 'CONFIRMED', paymentStatus: 'PAID', salesMode });
      expect(paid).toContain(t.status.confirmedPaymentDescription);
      const cancelled = await render({ status: 'CANCELLED', paymentStatus: 'UNPAID', salesMode });
      expect(cancelled).toContain(t.status.cancelledDescription);
    }
  });
  it('固定團次改用專用文案', async () => {
    const html = await render({ status: 'CANCELLED', paymentStatus: 'UNPAID', salesMode: 'FIXED_DEPARTURE' });
    expect(html).toContain(t.status.cancelledLockedDescription);
  });
});
