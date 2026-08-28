/**
 * Issue #35：Preview/UI 對真實資料欄位的驗收。
 *
 * 這不是 mock，也不讀既有 seed 裡碰巧存在的數值。每次執行都以 TEST service-role
 * 建一組唯一 fixture，瀏覽器登入後只經由頁面所呼叫的 API 讀回，再逐一核對 UI。
 * `paid_amount` 刻意沒有 fixture 或斷言值：它尚無資料模型／業務規則；本檔只驗證
 * 已移除的「已收」與「已付訂金」文案不會被渲染，避免用假金額掩蓋這個缺口。
 */
import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../fixtures';

const TEST_SUPABASE_HOSTNAME = 'nmwhwngojosmagjuvxol.supabase.co';
const PREFIX = `issue35-e2e-${randomUUID().slice(0, 8)}`;
const FIXTURE = {
  customerId: randomUUID(),
  bookingId: randomUUID(),
  membershipLevelId: randomUUID(),
  amountCouponId: randomUUID(),
  percentCouponId: randomUUID(),
  giftCouponId: randomUUID(),
  customerName: `${PREFIX}-顧客`,
  bookingNo: `${PREFIX}-booking`,
  membershipName: `${PREFIX}-會員`,
  amountCouponName: `${PREFIX}-最低消費`,
  percentCouponName: `${PREFIX}-最高折抵`,
  giftCouponName: `${PREFIX}-兌換項目`,
  description: `${PREFIX}-停用且非預設的會員權益`,
  giftItem: `${PREFIX}-免費護髮`,
  couponDiscount: 321,
  pointsRedeemed: 45,
  customerPoints: 789,
  finalPrice: 1134,
  minOrderAmount: 1234,
  maxDiscountAmount: 567,
  limitPerCustomer: 2,
} as const;

let admin: SupabaseClient;
function adminClient(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Issue #35 E2E requires TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Issue #35 E2E safety lock: TEST_SUPABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== TEST_SUPABASE_HOSTNAME) {
    throw new Error('Issue #35 E2E safety lock: TEST_SUPABASE_URL is not the authorized TEST project');
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL === url) {
    throw new Error('Issue #35 E2E safety lock: TEST_SUPABASE_URL equals NEXT_PUBLIC_SUPABASE_URL');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 20_000 });
}

async function expectNoDbError(result: { error: { message: string } | null }, action: string): Promise<void> {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
}

async function cleanupFixtures(): Promise<void> {
  const failures: string[] = [];
  const attempt = async (
    action: string,
    work: () => PromiseLike<{ error: { message: string } | null }>,
  ) => {
    try {
      await expectNoDbError(await work(), action);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${action}: ${String(error)}`);
    }
  };

  // 外鍵方向：booking → customer，coupon_instances（若日後 route 行為有改）→ coupon。
  await attempt('cleanup booking', () => admin.from('bookings').delete()
    .eq('tenant_id', SHOP_A.id).eq('id', FIXTURE.bookingId));
  await attempt('cleanup coupons', () => admin.from('coupons').delete()
    .eq('tenant_id', SHOP_A.id)
    .in('id', [FIXTURE.amountCouponId, FIXTURE.percentCouponId, FIXTURE.giftCouponId]));
  await attempt('cleanup customer', () => admin.from('customers').delete()
    .eq('tenant_id', SHOP_A.id).eq('id', FIXTURE.customerId));
  await attempt('cleanup membership level', () => admin.from('membership_levels').delete()
    .eq('tenant_id', SHOP_A.id).eq('id', FIXTURE.membershipLevelId));

  const residualChecks = await Promise.all([
    admin.from('bookings').select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('id', FIXTURE.bookingId),
    admin.from('customers').select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('id', FIXTURE.customerId),
    admin.from('membership_levels').select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('id', FIXTURE.membershipLevelId),
    admin.from('coupons').select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id)
      .in('id', [FIXTURE.amountCouponId, FIXTURE.percentCouponId, FIXTURE.giftCouponId]),
  ]);
  for (const [index, result] of residualChecks.entries()) {
    if (result.error) failures.push(`cleanup residual check ${index}: ${result.error.message}`);
    else if ((result.count ?? 0) !== 0) failures.push(`cleanup residual check ${index}: ${(result.count ?? 0)} row(s)`);
  }
  if (failures.length > 0) throw new Error(failures.join('; '));
}

test.describe('Issue #35 三頁真實欄位 Preview 驗收', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    admin = adminClient();

    try {
      await expectNoDbError(await admin.from('membership_levels').insert({
        id: FIXTURE.membershipLevelId,
        tenant_id: SHOP_A.id,
        name: FIXTURE.membershipName,
        description: FIXTURE.description,
        active: false,
        // 不改寫既有 default：partial unique index 仍由現有租戶資料維持。
        is_default: false,
        threshold_spent: 8888,
        discount_percent: 12,
        point_rate_multiplier: 2,
        sort_order: 9876,
      }), 'create membership-level fixture');
      await expectNoDbError(await admin.from('customers').insert({
        id: FIXTURE.customerId,
        tenant_id: SHOP_A.id,
        name: FIXTURE.customerName,
        phone: '0912345678',
        points: FIXTURE.customerPoints,
      }), 'create booking customer fixture');
      await expectNoDbError(await admin.from('bookings').insert({
        id: FIXTURE.bookingId,
        tenant_id: SHOP_A.id,
        booking_no: FIXTURE.bookingNo,
        customer_id: FIXTURE.customerId,
        service_id: SHOP_A.serviceA1,
        start_at: '2099-12-29T01:00:00.000Z',
        end_at: '2099-12-29T02:00:00.000Z',
        duration_minutes: 60,
        price: 1500,
        final_price: FIXTURE.finalPrice,
        status: 'CONFIRMED',
        payment_status: 'PAID_OFFLINE',
        source: 'MANUAL',
        coupon_discount: FIXTURE.couponDiscount,
        points_redeemed: FIXTURE.pointsRedeemed,
      }), 'create booking fixture');
      await expectNoDbError(await admin.from('coupons').insert([
        {
          id: FIXTURE.amountCouponId, tenant_id: SHOP_A.id, name: FIXTURE.amountCouponName,
          discount_type: 'AMOUNT', discount_value: 200, total_quantity: 0, status: 'DRAFT',
          min_order_amount: FIXTURE.minOrderAmount, limit_per_customer: FIXTURE.limitPerCustomer,
          private_mode: true,
        },
        {
          id: FIXTURE.percentCouponId, tenant_id: SHOP_A.id, name: FIXTURE.percentCouponName,
          discount_type: 'PERCENT', discount_value: 15, total_quantity: 0, status: 'DRAFT',
          max_discount_amount: FIXTURE.maxDiscountAmount,
        },
        {
          id: FIXTURE.giftCouponId, tenant_id: SHOP_A.id, name: FIXTURE.giftCouponName,
          discount_type: 'GIFT', discount_value: 0, total_quantity: 0, status: 'DRAFT',
          gift_item: FIXTURE.giftItem,
        },
      ]), 'create coupon fixtures');
    } catch (error) {
      await cleanupFixtures();
      throw error;
    }
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  test('預約詳情逐值呈現 DB 的票券與點數折抵，且不渲染已收金額', async ({ page }) => {
    await login(page);
    await page.goto('/tenant/bookings');
    const search = page.getByPlaceholder('搜尋顧客姓名或電話...');
    await search.fill(FIXTURE.bookingNo);
    await search.press('Enter');
    const row = page.locator('tr', { hasText: FIXTURE.bookingNo });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: '查看詳情' }).click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toContainText(`NT$${FIXTURE.finalPrice.toLocaleString('en-US')}`);
    await expect(dialog).toContainText(`票券折抵 NT$${FIXTURE.couponDiscount}`);
    await expect(dialog).toContainText(`點數折抵 ${FIXTURE.pointsRedeemed} 點`);
    await expect(dialog).toContainText('已付清');
    await expect(dialog).not.toContainText('已收');
    await expect(dialog).not.toContainText('已付訂金');
  });

  test('票券詳情逐值呈現 DB 的門檻、上限、兌換項目、限領與私密旗標', async ({ page }) => {
    await login(page);
    await page.goto('/tenant/coupons');

    const verifyCoupon = async (name: string, visible: string[]) => {
      const row = page.locator('tr', { hasText: name });
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: '票券詳情' }).click();
      const dialog = page.getByRole('dialog').last();
      for (const value of visible) await expect(dialog).toContainText(value);
      // issue #35 移除的頁內假欄位：沒有 schema/API 寫入路徑就不可顯示。
      await expect(dialog).not.toContainText('適用服務：');
      await dialog.getByRole('button', { name: '關閉', exact: true }).click();
      await expect(dialog).toBeHidden();
    };

    await verifyCoupon(FIXTURE.amountCouponName, [
      `最低消費：NT$${FIXTURE.minOrderAmount.toLocaleString('en-US')}`,
      `每人限領數量${FIXTURE.limitPerCustomer}`,
      '可見性：🔒 私密票券',
    ]);
    await verifyCoupon(FIXTURE.percentCouponName, [
      `最高折抵：NT$${FIXTURE.maxDiscountAmount.toLocaleString('en-US')}`,
    ]);
    await verifyCoupon(FIXTURE.giftCouponName, [`兌換項目：${FIXTURE.giftItem}`]);
  });

  test('會員等級逐值呈現 DB 的說明、停用與非預設旗標', async ({ page }) => {
    await login(page);
    await page.goto('/tenant/membership-levels');
    const row = page.locator('tr', { hasText: FIXTURE.membershipName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(FIXTURE.description);
    await expect(row).toContainText('停用');
    await expect(row).not.toContainText('預設');
    await row.getByRole('button', { name: '編輯會員等級' }).click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog.locator('#levelDescription')).toHaveValue(FIXTURE.description);
    await expect(dialog.getByLabel('啟用此等級')).not.toBeChecked();
    await expect(dialog.getByLabel('設為預設等級（新顧客自動套用）')).not.toBeChecked();
  });
});
