/** issue #990 — 金額欄不再誤標「會員價」、過去日期驗證用台北日界線 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tenantDateString } from '@/lib/bookings-query-range';
import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';

const page = readFileSync(resolve(__dirname, '../../src/app/tenant/bookings/page.tsx'), 'utf8');

describe('#990 金額欄原價註記', () => {
  it('金額欄不再使用 memberPrice，改用 originalPrice', () => {
    expect(page).not.toContain('labels.memberPrice');
    expect(page).toContain('t.labels.originalPrice(formatCurrency(b.price))');
    expect('memberPrice' in bookingsPage.labels).toBe(false);
    expect(bookingsPage.labels.originalPrice('NT$ 1,000')).toBe('原價 NT$ 1,000');
  });
});

describe('#990 過去日期用台北今日', () => {
  it('UTC 2026-10-14T17:30 在台北已是 2026-10-15', () => {
    expect(tenantDateString(new Date('2026-10-14T17:30:00Z'))).toBe('2026-10-15');
  });
  it('頁面不再用 toISOString 的 UTC 日期比較', () => {
    expect(page).not.toContain('new Date().toISOString().slice(0, 10)');
    expect(page).toContain('date < tenantDateString(new Date(), tz)');
  });
});
