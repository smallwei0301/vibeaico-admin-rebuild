import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/product-orders/page.tsx');
const service = read('src/services/products.ts');
const bookingsRoute = read('src/app/api/bookings/[id]/apply-coupon/route.ts');
const productOrdersRoute = read('src/app/api/product-orders/[id]/apply-coupon/route.ts');
const sharedModule = read('src/server/coupons.ts');

describe('product-orders #33①: real coupon redemption instead of a fabricated NT$100', () => {
  it('the page no longer fabricates the discount amount', () => {
    expect(page).not.toContain('withCoupon ? 100 : 0');
  });

  it('finish() calls the apply-coupon service function, not a raw fetch', () => {
    expect(page).toContain('applyProductOrderCoupon');
    // pages never fetch (CLAUDE.md) — no direct call to the endpoint from the page
    expect(page).not.toContain("fetch('/api/product-orders");
    expect(page).not.toContain('fetch("/api/product-orders');
  });

  it('the toast only fires with the amount the backend returned', () => {
    const finishStart = page.indexOf('const finish = async (withCoupon: boolean) => {');
    const finishBody = page.slice(finishStart, finishStart + 1400);
    expect(finishBody).toContain('applyProductOrderCoupon(order.id, code.trim(), order.totalAmount)');
    expect(finishBody).toContain('applied.couponDiscount');
    expect(finishBody).toContain('t.complete.couponApplied(formatCurrency(discount))');
  });

  it('a coupon-applied-then-complete-failed run tells the user exactly that', () => {
    expect(page).toContain('t.complete.couponAppliedButFailed');
    expect(page).toContain('onCouponAppliedOnly');
  });

  it('service function talks to the real endpoint and returns the real fields', () => {
    expect(service).toContain('applyProductOrderCoupon');
    expect(service).toContain('/api/product-orders/${id}/apply-coupon');
    expect(service).toContain('totalAmount');
    expect(service).toContain('couponDiscount');
  });
});

describe('product-orders #33①: redemption logic exists in exactly one place', () => {
  it('both apply-coupon routes call the shared redeemCoupon(), neither reimplements it', () => {
    expect(bookingsRoute).toContain("from '@/server/coupons'");
    expect(bookingsRoute).toContain('redeemCoupon(');
    expect(productOrdersRoute).toContain("from '@/server/coupons'");
    expect(productOrdersRoute).toContain('redeemCoupon(');

    // the actual lookup/redeem/discount sequence lives only in the shared module
    expect(sharedModule).toContain('coupon_instances');
    expect(sharedModule).toContain("is('redeemed_at', null)");
    expect(bookingsRoute).not.toContain("from('coupon_instances')");
    expect(productOrdersRoute).not.toContain("from('coupon_instances')");
  });

  it('applyDiscount() (AMOUNT/PERCENT/GIFT) is defined once, in the shared module', () => {
    expect(sharedModule).toContain('export function applyDiscount(');
    expect(bookingsRoute).not.toContain('function applyDiscount(');
    expect(productOrdersRoute).not.toContain('function applyDiscount(');
  });

  it('product-orders route is tenant-scoped on every query', () => {
    expect(productOrdersRoute).toContain(".eq('tenant_id', t.tenantId).maybeSingle()");
    expect(productOrdersRoute).toContain(".eq('id', id).eq('tenant_id', t.tenantId)");
  });
});
