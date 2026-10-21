/**
 * tests/unit/public-shop-standard-refund-summary.1076.test.ts — issue #1076
 *
 * 店家公開頁的 STANDARD 退款單行摘要原本只寫「出發前 7 天可全額退款」，
 * 漏掉申請／預約表單與後台都有的「3 天內不退款」截止規則，旅客看到不一致的政策。
 */
import { describe, expect, it } from 'vitest';
import { publicShopPage } from '@/i18n/zh-TW/pages/public-shop';
import { publicTourRequestPage } from '@/i18n/zh-TW/pages/public-tour-request';
import { publicTourBookingPage } from '@/i18n/zh-TW/pages/public-tour-booking';

const shop = publicShopPage.trips.cancellationPolicy;
const request = publicTourRequestPage.form.cancellationPolicy;
const booking = publicTourBookingPage.form.cancellationPolicy;

describe('標準退款政策摘要一致 (#1076)', () => {
  it('店家公開頁 STANDARD 同時提到 7 天與 3 天', () => {
    expect(shop.STANDARD).toContain('7 天');
    expect(shop.STANDARD).toContain('3 天');
  });

  it('申請與預約表單 STANDARD 也提到 3 天', () => {
    expect(request.STANDARD).toContain('3 天');
    expect(booking.STANDARD).toContain('3 天');
  });

  it('FLEXIBLE／STRICT 摘要語意不變', () => {
    expect(shop.FLEXIBLE).toContain('24 小時');
    expect(shop.STRICT).toContain('恕不接受退款');
  });
});
