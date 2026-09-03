import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bookingPage = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/bookings/page.tsx'),
  'utf8',
);
const bookingCopy = readFileSync(
  resolve(process.cwd(), 'src/i18n/zh-TW/pages/bookings.ts'),
  'utf8',
);

describe('#35-B truthful booking extras', () => {
  it('removes page-local coupon and points extras from booking rows', () => {
    expect(bookingPage).not.toContain('type BookingExtras');
    expect(bookingPage).not.toContain('BOOKING_EXTRAS_LOCAL_SHOP');
    expect(bookingPage).not.toContain('BOOKING_EXTRAS_GUIDE');
    expect(bookingPage).not.toContain('BOOKING_EXTRAS_CLINIC');
    expect(bookingPage).not.toContain('extrasOf(');
    expect(bookingPage).not.toContain('customerPoints');
    expect(bookingPage).not.toContain('couponDiscount');
    expect(bookingPage).not.toContain('pointsRedeemed');
  });

  it('uses the API booking amount and does not invent a points balance', () => {
    expect(bookingPage).toContain('const amount = booking?.finalPrice ?? 0;');
    expect(bookingPage).toContain('applyBookingPoints(booking.id, value)');
    expect(bookingPage).not.toContain('const balance = booking ?');
    expect(bookingPage).not.toContain('const net = (booking?.finalPrice ?? 0) -');
    expect(bookingCopy).toContain('目前沒有可追溯的票券／點數折抵明細欄位');
    expect(bookingCopy).toContain('套用後金額');
  });
});
