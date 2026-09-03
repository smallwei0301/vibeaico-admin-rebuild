import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { SHOP_A } from '../fixtures';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });
}

test('庫存匯出會下載目前商品篩選下的真實 CSV', async ({ page }) => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  const admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const productId = randomUUID();
  const productName = `E2E庫存匯出-${Date.now().toString(36)}`;

  const { error: productError } = await admin.from('products').insert({
    id: productId,
    tenant_id: SHOP_A.id,
    name: productName,
    price: 100,
    stock: 4,
    safety_stock: 0,
  });
  expect(productError).toBeNull();
  const { error: logError } = await admin.from('inventory_logs').insert({
    tenant_id: SHOP_A.id,
    product_id: productId,
    delta: 4,
    stock_after: 4,
    reason: 'PURCHASE_IN:E2E進貨',
  });
  expect(logError).toBeNull();

  try {
    await login(page);
    await page.goto('/tenant/inventory');
    await expect(page).toHaveURL(/\/tenant\/inventory/, { timeout: 15_000 });
    await page.getByLabel('商品：').selectOption(productId);

    await page.getByRole('button', { name: '匯出 CSV', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: '匯出 CSV', exact: true }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^inventory-\d{4}-\d{2}-\d{2}\.csv$/);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const content = await readFile(filePath!, 'utf8');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content).toContain('時間,商品,異動類型,數量,異動前,異動後,原因,操作者');
    expect(content).toContain(productName);
    expect(content).toContain('E2E進貨');
    await expect(page.getByText(download.suggestedFilename(), { exact: false })).toBeVisible();
  } finally {
    await admin.from('inventory_logs').delete().eq('product_id', productId);
    await admin.from('products').delete().eq('id', productId);
  }
});
