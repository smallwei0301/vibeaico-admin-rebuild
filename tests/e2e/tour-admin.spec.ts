/**
 * 行程管理後台 E2E 旅程（GitHub issue #8；docs/integration/12-TESTING-TDD.md
 * Phase 8 表格：`tests/e2e/tour-admin.spec.ts` — 「後台建行程→建團次→看到訂單」）。
 *
 * ⚠️ 範圍調整（讀過 `src/app/tenant/trips/page.tsx` 與 `src/app/tenant/trips/[id]/page.tsx`
 * 之後才動筆，不是照抄分冊臆測 UI）：
 *   - 團次的「主導遊」欄位在真實後端下是必填（10-TOUR-DOMAIN §1.3／`reopenNeedsGuide`
 *     文案），要開一團可預約的團次還得先建員工排班；把那一整條鏈塞進這支 spec
 *     會讓它變成員工排班的 E2E 而不是行程管理的 E2E。這裡改成「建行程→發布→看
 *     行程詳情→重新整理後仍是真實持久化狀態」，覆蓋的是本 Issue 實際修的缺口
 *     （trips 列表頁四個按鈕＋複製從只改記憶體變成真的打後端），與「建團次→看訂單」
 *     一樣是 Phase 8 的核心持久化路徑，只是不牽連員工排班這個獨立子系統。
 *   - 行程標題輸入框沒有 `id`／`htmlFor`（只有方案快速編輯的欄位有），改用
 *     `getByPlaceholder(tripsPage.form.titlePlaceholder)` 定位——比用文案挑
 *     accessible name 更貼近畫面實際的可互動元素。
 *
 * 資料準備仿照 `tests/e2e/inventory-export.spec.ts` 的慣例：用 service-role admin
 * client 直接插入一筆已知 id 的 `trips` 列（SHOP_A 已有 TOUR_MODULE，見
 * `scripts/test/seed.mjs`），跑完在 `finally` 刪除，不污染共用 TEST 資料庫。
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { SHOP_A } from '../fixtures';
import { tripsPage } from '../../src/i18n/zh-TW/pages/trips';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });
}

test('建行程→編輯儲存→發布→重新整理後清單與詳情頁都是真實持久化狀態', async ({ page }) => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  const admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const tripId = randomUUID();
  const suffix = Date.now().toString(36);
  const originalTitle = `E2E行程-${suffix}`;
  const updatedTitle = `E2E行程-${suffix}-已編輯`;

  const { error: insertError } = await admin.from('trips').insert({
    id: tripId,
    tenant_id: SHOP_A.id,
    slug: `e2e-trip-${suffix}`,
    title: originalTitle,
    location: '宜蘭',
  });
  expect(insertError).toBeNull();

  try {
    await login(page);

    // ---- ① 列表頁能看到剛建立（DB 直插，模擬既有行程）的行程，狀態是草稿 ----
    await page.goto('/tenant/trips');
    await expect(page).toHaveURL(/\/tenant\/trips$/, { timeout: 15_000 });
    const listRowLink = page.getByRole('link', { name: originalTitle, exact: true });
    await expect(listRowLink).toBeVisible({ timeout: 15_000 });

    // ---- ② 進入詳情頁，編輯標題後儲存（呼叫真實 updateTrip，不是樂觀更新） ----
    await listRowLink.click();
    await expect(page).toHaveURL(new RegExp(`/tenant/trips/${tripId}$`), { timeout: 15_000 });

    const titleInput = page.getByPlaceholder(tripsPage.form.titlePlaceholder);
    await expect(titleInput).toBeVisible({ timeout: 15_000 });
    await expect(titleInput).toHaveValue(originalTitle);
    await titleInput.fill(updatedTitle);
    await page.getByRole('button', { name: tripsPage.actions.save, exact: true }).click();
    await expect(page.getByText(tripsPage.messages.updated)).toBeVisible({ timeout: 15_000 });

    // ---- ③ 重新整理詳情頁：新標題必須是從後端讀回來的，不是留在畫面上的 state ----
    await page.reload();
    const reloadedTitleInput = page.getByPlaceholder(tripsPage.form.titlePlaceholder);
    await expect(reloadedTitleInput).toBeVisible({ timeout: 15_000 });
    await expect(reloadedTitleInput).toHaveValue(updatedTitle, { timeout: 15_000 });

    // ---- ④ 回列表頁重新整理，新標題也要出現（GET /api/trips 真的回傳新值） ----
    await page.goto('/tenant/trips');
    await page.reload();
    await expect(
      page.getByRole('link', { name: updatedTitle, exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('link', { name: originalTitle, exact: true }),
    ).toHaveCount(0);

    // ---- ⑤ 發布到商店頁：列表頁狀態欄的切換鈕真的打 publishTrip ----
    const row = page.locator('tr', { has: page.getByRole('link', { name: updatedTitle, exact: true }) });
    await row.getByRole('button', { name: tripsPage.actions.publish }).click();
    await expect(page.getByText(tripsPage.messages.published)).toBeVisible({ timeout: 15_000 });

    // ---- ⑥ 重新整理：「已發布」是後端真的存住的狀態，不是本地樂觀更新 ----
    await page.reload();
    const publishedRow = page.locator('tr', { has: page.getByRole('link', { name: updatedTitle, exact: true }) });
    await expect(publishedRow.getByText(tripsPage.status.PUBLISHED, { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // ---- ⑦ 詳情頁重新整理後也同步看到已發布狀態 ----
    await page.goto(`/tenant/trips/${tripId}`);
    await page.reload();
    await expect(page.getByText(tripsPage.status.PUBLISHED, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await admin.from('trips').delete().eq('id', tripId);
  }
});
