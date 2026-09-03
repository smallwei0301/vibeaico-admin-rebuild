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

test('顧客頁匯出會下載含真實資料的 CSV', async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });

  const customersResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/customers'
      && url.searchParams.get('size') === '200'
      && url.searchParams.get('page') === '0'
      && response.request().method() === 'GET'
      && response.status() === 200;
  });
  await page.goto('/tenant/customers');
  await expect(page).toHaveURL(/\/tenant\/customers/, { timeout: 15_000 });
  await customersResponse;

  const exportButton = page.getByRole('button', { name: '匯出 Excel', exact: true });
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^customers-\d{4}-\d{2}-\d{2}\.csv$/);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const content = await readFile(filePath!, 'utf8');
  expect(content.charCodeAt(0)).toBe(0xfeff);
  expect(content).toContain('姓名,LINE 顯示名稱,電話,Email,會員等級,預約次數,累計消費,狀態');
  expect(content).toContain('顧客 A1（測試）');
});
