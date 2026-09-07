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

/**
 * 折抵金額要能在重新整理之後還看得到，靠的是 product_orders 的兩個真欄位。
 * 這兩欄在 TEST 與正式庫本來就存在，卻不在 repo 的 migration 帳本裡（#33 的
 * 0027 只送到資料庫、程式碼從未合併），所以從 0001 全新建起來的資料庫沒有
 * 它們。0081 把它們補進帳本；下面這組斷言把「帳本、寫入、讀出、畫面」四段
 * 綁在一起，任何一段被拿掉都會轉紅。
 */
describe('product-orders #33①: the discount survives a reload', () => {
  const migration = read('supabase/migrations/0081_reconcile_product_order_coupon_fields.sql');
  const mappers = read('src/server/mappers.ts');
  const types = read('src/lib/types.ts');

  it('0081 adds both columns idempotently, so it is a no-op on TEST/Production', () => {
    expect(migration).toContain('add column if not exists coupon_discount numeric');
    expect(migration).toContain('add column if not exists coupon_instance_id uuid');
    // 既有資料庫上必須是真 no-op：不得出現會改動既有欄位的語句
    expect(migration).not.toMatch(/alter\s+column/i);
    expect(migration).not.toMatch(/drop\s+column/i);
  });

  it('the FK is guarded so re-running cannot fail on an existing constraint', () => {
    expect(migration).toContain('product_orders_coupon_instance_id_fkey');
    expect(migration).toContain('if not exists (');
    expect(migration).toContain('from pg_constraint');
  });

  it('the endpoint writes the breakdown, not only the reduced total', () => {
    expect(productOrdersRoute).toContain('coupon_discount: redemption.discount');
    expect(productOrdersRoute).toContain('coupon_instance_id: redemption.instanceId');
  });

  it('the mapper reads it back and treats NULL as a real zero, not unknown', () => {
    expect(mappers).toContain('couponDiscount: Number(r.coupon_discount ?? 0)');
    expect(types).toContain('couponDiscount?: number');
  });

  it('DEFAULT_EXTRAS cannot clobber the persisted value back to 0', () => {
    // 這是本輪真正的缺陷：toRow 的兩個 spread 都排在 `...o` 後面。
    expect(page).toContain('o.couponDiscount === undefined ? base : { ...base, couponDiscount: o.couponDiscount }');
  });
});
