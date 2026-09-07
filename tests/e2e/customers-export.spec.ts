import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { test, expect } from '@playwright/test';
import { SHOP_A } from '../fixtures';

const LOGIN_PATH = '/tenant/login';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(LOGIN_PATH);
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
}

// issue #246：本案先前斷言下載到的是 .csv——按鈕寫「匯出 Excel」卻下載 CSV，
// 測試把那個缺陷鎖成了正確行為。端點改產真正的 xlsx 之後，斷言一併更正，
// 並改用 exceljs 讀回內容，而不是把 zip 當文字讀。
test('顧客頁匯出會下載含真實資料的 Excel', async ({ page }) => {
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
  expect(download.suggestedFilename()).toMatch(/^customers-\d{4}-\d{2}-\d{2}\.xlsx$/);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const bytes = await readFile(filePath!);
  // xlsx 是 zip 容器；若又退回 CSV，這裡會是 EF BB BF。
  expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const sheet = workbook.worksheets[0];
  expect(sheet.name).toBe('顧客名單');
  const header = sheet.getRow(1).values as unknown[];
  expect(header.slice(1)).toEqual([
    '姓名', 'LINE 顯示名稱', '電話', 'Email', '會員等級', '預約次數', '累計消費', '狀態',
  ]);

  const names: string[] = [];
  sheet.eachRow((row, index) => {
    if (index > 1) names.push(String(row.getCell(1).value ?? ''));
  });
  expect(names).toContain('顧客 A1（測試）');
});
