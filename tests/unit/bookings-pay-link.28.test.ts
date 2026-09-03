import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/bookings/page.tsx');
const copy = read('src/i18n/zh-TW/pages/bookings.ts');

describe('booking #28②: do not advertise a missing payment page', () => {
  it('removes the fake /pay link and keeps the real offline-payment action', () => {
    expect(page).not.toContain('payLinkOf');
    expect(page).not.toContain('copyPayLink');
    expect(page).not.toContain("'/pay/'");
    expect(page).toContain('markBookingPaidOffline');

    const detailStart = page.indexOf('function BookingDetailModal');
    const detail = page.slice(detailStart);
    expect(detail).toContain('disabled');
    expect(detail).toContain('t.rowActions.payLinkUnavailable');
    expect(detail).toContain('t.detailModal.payLinkUnavailable');
  });

  it('uses explicit unavailable copy instead of a success claim', () => {
    expect(copy).toContain("payLinkUnavailable: '付款頁尚未建置'");
    expect(copy).toContain("payLinkUnavailable: '付款頁尚未建置（#32）；目前請使用線下收款或您的金流後台。'");
    expect(copy).not.toContain('payLinkCopied');
    expect(copy).not.toContain('複製付款連結');
    expect(copy).not.toContain('複製此付款連結傳給顧客');
  });
});
