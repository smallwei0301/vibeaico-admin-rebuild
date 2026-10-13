import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as utils from '@/lib/utils';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TourOrder } from '@/lib/types';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { pickRedirectContact } from '@/lib/public-contact';
import { mapTourOrder } from '@/server/mappers';
import { common } from '@/i18n/zh-TW/common';
import * as publicOrderFormat from '@/lib/public-order-format';

describe('#46 pickRedirectContact', () => {
  it('電話只有空白、LINE 有填 → 取 LINE（不得回空字串造成 404）', () => {
    expect(pickRedirectContact('   ', ' my-line ', '')).toBe('my-line');
  });
  it('round-trip：空白電話＋LINE 的輸出，與 loader 的 trim＋小寫比對一致', () => {
    // 鏡像 loadPublicTourRequestStatus 的比對（src/server/public-tour-request.ts）
    const stored = { phone: '', line: 'My-Line', email: undefined as string | undefined };
    const candidates = [stored.phone, stored.line, stored.email]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.trim().toLowerCase());
    const picked = pickRedirectContact('   ', ' My-Line ', '');
    expect(candidates.includes(decodeURIComponent(encodeURIComponent(picked)).trim().toLowerCase())).toBe(true);
  });
  it('優先順序：電話 > LINE > Email；全空回空字串', () => {
    expect(pickRedirectContact(' 0912 ', 'l', 'e@x.com')).toBe('0912');
    expect(pickRedirectContact('', '', ' e@x.com ')).toBe('e@x.com');
    expect(pickRedirectContact(' ', undefined, null)).toBe('');
  });
});

describe('#46 mapTourOrder 聯絡方式', () => {
  const derived = { tripTitle: 'T', planName: 'P', departsOn: '2026-12-01', startTime: '', paymentMethodLabel: '' };
  it('對應 line / email，空值為 undefined', () => {
    const o = mapTourOrder({ id: 'o', contact: { name: 'A', line: ' lid ', email: 'a@b.co' } }, derived);
    expect(o.customerLine).toBe('lid');
    expect(o.customerEmail).toBe('a@b.co');
    expect(o.customerPhone).toBe('');
    const p = mapTourOrder({ id: 'o', contact: { name: 'A', phone: '09' } }, derived);
    expect(p.customerLine).toBeUndefined();
    expect(p.customerEmail).toBeUndefined();
  });
});

const loader = vi.fn();
const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
const source = readFileSync(resolve(process.cwd(), 'src/app/s/[shopCode]/requests/[orderId]/page.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pageModule = { exports: {} as { default: (props: {
  params: Promise<{ shopCode: string; orderId: string }>;
  searchParams: Promise<{ contact?: string; created?: string }>;
}) => Promise<React.ReactElement> } };
const imports: Record<string, unknown> = {
  'next/navigation': { notFound },
  'next/link': { default: (props: React.ComponentProps<'a'>) => React.createElement('a', props) },
  '@/server/public-tour-request': { loadPublicTourRequestStatus: loader },
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
  status: 'PENDING', paymentStatus: 'UNPAID', paymentMethodLabel: '', paymentRef: '',
  source: 'VIBEAI_SHOP', holdExpiresAt: null, note: '', createdAt: '2026-10-01T12:00:00Z',
  salesMode: 'REQUEST',
};
async function render(overrides: Partial<TourOrder>, created?: string) {
  loader.mockResolvedValue({ ...order, ...overrides });
  return renderToStaticMarkup(await Page({
    params: Promise.resolve({ shopCode: 'demo', orderId: 'o1' }),
    searchParams: Promise.resolve({ contact: 'x', created }),
  }));
}

describe('#46 成功橫幅', () => {
  beforeEach(() => { loader.mockReset(); });
  it('沒有 created=1 不顯示橫幅', async () => {
    const html = await render({}, undefined);
    expect(html).not.toContain(t.status.createdRequestTitle);
    expect(html).not.toContain(t.status.createdBookingTitle);
  });
  it('REQUEST + created=1：申請已送出，不說預約成功／已鎖位', async () => {
    const html = await render({ salesMode: 'REQUEST' }, '1');
    expect(html).toContain(t.status.createdRequestTitle);
    expect(html).toContain(t.status.createdRequestDescription);
    expect(t.status.createdRequestTitle + t.status.createdRequestDescription).not.toMatch(/預約成功|已預約|已鎖定名額/);
    expect(html).not.toContain(t.status.createdBookingTitle);
  });
  it('FIXED_DEPARTURE + created=1：訂單已送出，不宣稱已付款', async () => {
    const html = await render({ salesMode: 'FIXED_DEPARTURE' }, '1');
    expect(html).toContain(t.status.createdBookingTitle);
    expect(html).not.toContain(t.status.createdRequestTitle);
    expect(t.status.createdBookingDescription).not.toMatch(/已付款|付款成功/);
  });
  it('created=1 但訂單已取消 → 不顯示橫幅', async () => {
    const html = await render({ status: 'CANCELLED' }, '1');
    expect(html).not.toContain(t.status.createdRequestTitle);
    expect(html).not.toContain(t.status.createdBookingTitle);
  });
  it('created=1 但 REQUEST 已被接受（CONFIRMED）→ 不顯示橫幅', async () => {
    const html = await render({ status: 'CONFIRMED', salesMode: 'REQUEST' }, '1');
    expect(html).not.toContain(t.status.createdRequestTitle);
    expect(html).not.toContain(t.status.createdBookingTitle);
  });
});
