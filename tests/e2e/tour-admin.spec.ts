/**
 * Issue #8 — 後台行程管理端到端旅程。
 *
 * 這支測試刻意只有一條 serial 旅程，並使用唯一標題／旅客姓名前綴：
 * 登入 → 建行程 → 建方案 → 建團次 → 手動建單 → 確認收款 → 取消。
 * 每個寫入步驟後都 reload，再從畫面確認資料不是只留在 React state。
 * 名額則直接從 TEST Supabase 查證：建單後增加，取消後釋放回原值。
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../fixtures';

const PRODUCTION_SUPABASE_HOSTNAME = 'egehnijjpgijmccagxac.supabase.co';
const PREFIX = `e2e-issue8-${randomUUID()}`;
const TRIP_TITLE = `${PREFIX} 行程`;
const PLAN_NAME = `${PREFIX} 方案`;
const CUSTOMER_NAME = `${PREFIX} 旅客`;
const CUSTOMER_PHONE = '0912345678';

function adminClient(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('E2E cleanup requires TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('E2E safety lock: TEST_SUPABASE_URL is not a valid URL');
  }
  if (parsed.hostname === PRODUCTION_SUPABASE_HOSTNAME) {
    throw new Error('E2E safety lock: TEST_SUPABASE_URL points to the production project');
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL === url) {
    throw new Error('E2E safety lock: TEST_SUPABASE_URL equals NEXT_PUBLIC_SUPABASE_URL');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });
}

async function dialog(page: Page) {
  const value = page.getByRole('dialog').last();
  await expect(value).toBeVisible();
  return value;
}

async function deleteRows(admin: SupabaseClient, table: string, column: string, values: string[]) {
  if (values.length === 0) return;
  const { error } = await admin.from(table).delete().eq('tenant_id', SHOP_A.id).in(column, values);
  if (error) throw new Error(`cleanup ${table}: ${error.message}`);
}

test.describe('Issue #8 行程管理端到端旅程', () => {
  test.describe.configure({ mode: 'serial' });
  // next dev 冷啟動會逐頁編譯；本旅程跨三頁且每個寫入後都 reload。
  test.setTimeout(180_000);

  test.afterAll(async () => {
    const admin = adminClient();
    const { data: trips, error: tripError } = await admin
      .from('trips').select('id').eq('tenant_id', SHOP_A.id).like('title', `${PREFIX}%`);
    if (tripError) throw new Error(`cleanup trips lookup: ${tripError.message}`);
    const tripIds = (trips ?? []).map((row) => row.id as string);

    const { data: orders, error: orderLookupError } = tripIds.length
      ? await admin.from('tour_orders').select('id').eq('tenant_id', SHOP_A.id).in('trip_id', tripIds)
      : { data: [], error: null };
    if (orderLookupError) throw new Error(`cleanup orders lookup: ${orderLookupError.message}`);
    await deleteRows(admin, 'tour_orders', 'id', (orders ?? []).map((row) => row.id as string));

    for (const table of ['trip_addons', 'trip_departures', 'trip_plans']) {
      await deleteRows(admin, table, 'trip_id', tripIds);
    }
    await deleteRows(admin, 'trips', 'id', tripIds);

    const { count: tripCount, error: tripResidualError } = await admin
      .from('trips').select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).like('title', `${PREFIX}%`);
    if (tripResidualError) throw new Error(`cleanup trips residual lookup: ${tripResidualError.message}`);
    const { count: orderCount, error: orderResidualError } = await admin
      .from('tour_orders').select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).like('customer_name', `${PREFIX}%`);
    if (orderResidualError) throw new Error(`cleanup orders residual lookup: ${orderResidualError.message}`);
    expect(tripCount ?? 0, 'trip cleanup residual').toBe(0);
    expect(orderCount ?? 0, 'order cleanup residual').toBe(0);
  });

  test('建行程→建方案→建團次→手動建單→確認收款→取消，重整後資料與名額皆正確', async ({ page }) => {
    const admin = adminClient();
    await login(page);

    // 建行程。
    await page.goto('/tenant/trips');
    // 空清單時 PageHeader 與 EmptyState 都有同名按鈕；固定點 PageHeader 那一顆。
    await page.getByRole('button', { name: '新增行程', exact: true }).first().click();
    const create = await dialog(page);
    await create.locator('input').first().fill(TRIP_TITLE);
    await create.getByRole('button', { name: '建立行程', exact: true }).click();
    await expect(page).toHaveURL(/\/tenant\/trips\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByText(TRIP_TITLE, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(TRIP_TITLE, { exact: true })).toBeVisible();

    // 建方案。
    await page.getByRole('tab', { name: '方案與定價', exact: true }).click();
    await page.getByRole('button', { name: '新增方案', exact: true }).first().click();
    const plan = await dialog(page);
    const planGroup = plan.getByText('方案名稱', { exact: true }).locator('..');
    await planGroup.locator('input').fill(PLAN_NAME);
    const basePriceGroup = plan.getByText('售價', { exact: true }).locator('..');
    await basePriceGroup.locator('input').fill('2000');
    await plan.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(plan).toBeHidden();
    await page.reload();
    // tab 只存在 React state，reload 後會回基本資料；重新進 tab 才能驗證持久化結果。
    await page.getByRole('tab', { name: '方案與定價', exact: true }).click();
    await expect(page.getByText(PLAN_NAME, { exact: true })).toBeVisible();

    // 建團次：使用遠期日期，避免與既有 seed 或其他測試撞唯一鍵。
    await page.getByRole('tab', { name: '團次與名額', exact: true }).click();
    await page.getByRole('button', { name: '新增團次', exact: true }).first().click();
    const departure = await dialog(page);
    await departure.locator('input[type="date"]').fill('2099-12-30');
    await departure.locator('input[type="number"]').fill('2');
    await departure.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(departure).toBeHidden();
    await page.reload();
    await page.getByRole('tab', { name: '團次與名額', exact: true }).click();
    await expect(page.getByText('2099-12-30', { exact: true })).toBeVisible();

    const { data: trip, error: tripLookupError } = await admin
      .from('trips').select('id').eq('tenant_id', SHOP_A.id).like('title', `${PREFIX}%`).single();
    if (tripLookupError || !trip) throw new Error(`created trip lookup failed: ${tripLookupError?.message ?? 'missing'}`);
    const { data: departureRow, error: departureLookupError } = await admin
      .from('trip_departures').select('id, seats_booked')
      .eq('tenant_id', SHOP_A.id).eq('trip_id', trip.id).single();
    if (departureLookupError || !departureRow) throw new Error(`created departure lookup failed: ${departureLookupError?.message ?? 'missing'}`);
    expect(departureRow.seats_booked).toBe(0);

    // 手動建單。
    await page.goto('/tenant/tour-orders');
    await page.getByRole('button', { name: '手動建立訂單', exact: true }).click();
    const order = await dialog(page);
    const selects = order.locator('select');
    await selects.nth(0).selectOption({ label: TRIP_TITLE });
    await selects.nth(1).selectOption({ label: PLAN_NAME });
    const departureOption = selects.nth(2).locator('option').filter({ hasText: '2099-12-30' });
    await expect(departureOption).toHaveCount(1);
    const departureValue = await departureOption.getAttribute('value');
    expect(departureValue).toBeTruthy();
    await selects.nth(2).selectOption(departureValue!);
    await order.locator('input').nth(0).fill(CUSTOMER_NAME);
    await order.locator('input').nth(1).fill(CUSTOMER_PHONE);
    await order.locator('input[type="number"]').fill('2');
    await order.getByRole('button', { name: '建立訂單', exact: true }).click();
    await expect(order).toBeHidden();
    await page.reload();
    await expect(page.getByText(CUSTOMER_NAME, { exact: true })).toBeVisible();

    const { data: createdOrder, error: orderLookupError } = await admin
      .from('tour_orders').select('id, status, payment_status')
      .eq('tenant_id', SHOP_A.id).eq('customer_name', CUSTOMER_NAME).single();
    if (orderLookupError || !createdOrder) throw new Error(`created order lookup failed: ${orderLookupError?.message ?? 'missing'}`);
    expect(createdOrder.status).toBe('PENDING');
    expect(createdOrder.payment_status).toBe('UNPAID');
    const { data: occupied, error: occupiedError } = await admin
      .from('trip_departures').select('seats_booked')
      .eq('tenant_id', SHOP_A.id).eq('id', departureRow.id).single();
    if (occupiedError || !occupied) throw new Error(`occupied departure lookup failed: ${occupiedError?.message ?? 'missing'}`);
    expect(occupied.seats_booked).toBe(2);

    // 確認收款，並以 reload 後的資料列觸發下一個真實 UI 動作。
    const row = page.locator('tr').filter({ hasText: CUSTOMER_NAME });
    await row.getByRole('button', { name: '確認收款' }).click();
    const confirm = await dialog(page);
    await confirm.getByRole('button', { name: '確認收款', exact: true }).click();
    await expect(confirm).toBeHidden();
    await page.reload();
    await expect(page.locator('tr').filter({ hasText: CUSTOMER_NAME }).getByText('已付款', { exact: true })).toBeVisible();
    await expect(page.locator('tr').filter({ hasText: CUSTOMER_NAME }).getByText('已確認', { exact: true })).toBeVisible();

    // 取消並釋放名額；cleanup 仍會以 service-role 查詢並刪除資料，不能靠 UI 封存冒充清理。
    await page.locator('tr').filter({ hasText: CUSTOMER_NAME }).getByRole('button', { name: '取消訂單' }).click();
    const cancel = await dialog(page);
    await cancel.getByRole('button', { name: '取消訂單', exact: true }).click();
    await expect(cancel).toBeHidden();
    await page.reload();
    await expect(page.locator('tr').filter({ hasText: CUSTOMER_NAME }).getByText('已取消', { exact: true })).toBeVisible();
    const { data: released, error: releasedError } = await admin
      .from('trip_departures').select('seats_booked')
      .eq('tenant_id', SHOP_A.id).eq('id', departureRow.id).single();
    if (releasedError || !released) throw new Error(`released departure lookup failed: ${releasedError?.message ?? 'missing'}`);
    expect(released.seats_booked).toBe(0);
  });
});
