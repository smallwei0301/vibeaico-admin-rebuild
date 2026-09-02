import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { SHOP_A } from '../fixtures';

const LOGIN_PATH = '/tenant/login';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(LOGIN_PATH);
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
}

test('預約頁匯出會下載含真實資料的 CSV', async ({ page }) => {
  page.on('pageerror', (error) => {
    console.error('[bookings-export] pageerror:', error.stack ?? error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[bookings-export] console:', message.text());
  });

  await login(page);
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });
  const bookingsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/bookings'
      && url.searchParams.get('size') === '100'
      && url.searchParams.get('page') === '0'
      && response.request().method() === 'GET'
      && response.status() === 200;
  });
  await page.goto('/tenant/bookings');
  await expect(page).toHaveURL(/\/tenant\/bookings/, { timeout: 15_000 });
  await bookingsResponse;
  const exportButton = page.getByRole('button', { name: '匯出 CSV', exact: true });
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10_000 });

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^bookings-\d{4}-\d{2}-\d{2}\.csv$/);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const content = await readFile(filePath!, 'utf8');
  expect(content.charCodeAt(0)).toBe(0xfeff);
  expect(content).toContain('預約編號,預約時間,顧客姓名');
  expect(content).toContain('BSEED0001');
});
