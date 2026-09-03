import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../fixtures';

const BUCKET = 'welcome-card-images';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });
}

function storagePath(url: string): string {
  const marker = `/object/public/${BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) throw new Error('歡迎卡片圖片 URL 缺少預期的 storage 路徑');
  return decodeURIComponent(url.slice(index + marker.length));
}

test('歡迎卡片圖片上傳後會保存，重整仍存在，移除也會保存', async ({ page }) => {
  const supabaseUrl = process.env.TEST_SUPABASE_URL;
  const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  expect(supabaseUrl).toBeTruthy();
  expect(serviceRoleKey).toBeTruthy();
  const admin = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: originalRow, error: originalError } = await admin
    .from('tenant_settings')
    .select('notify')
    .eq('tenant_id', SHOP_A.id)
    .maybeSingle();
  if (originalError) throw originalError;
  const originalNotify = originalRow ? ((originalRow.notify ?? {}) as Record<string, unknown>) : null;
  let uploadedPath: string | null = null;

  try {
    await login(page);
    await page.goto('/tenant/settings#notification');
    const imageInput = page.locator('#welcomeCardImageFile');
    await expect(imageInput).toBeAttached({ timeout: 15_000 });

    const uploadResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/upload'
        && response.request().method() === 'POST';
    });
    const settingsResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/settings'
        && response.request().method() === 'PUT';
    });
    await imageInput.setInputFiles({
      name: 'welcome.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    expect((await uploadResponse).status()).toBe(200);
    expect((await settingsResponse).status()).toBe(200);

    const urlInput = page.locator('#welcomeCardImageUrl');
    await expect(urlInput).toHaveValue(/\/welcome-card-images\//, { timeout: 15_000 });
    const uploadedUrl = await urlInput.inputValue();
    uploadedPath = storagePath(uploadedUrl);

    const { data: blob, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(uploadedPath);
    expect(downloadError).toBeNull();
    expect(blob).not.toBeNull();
    expect(Buffer.from(await blob!.arrayBuffer())).toEqual(PNG_1X1);

    await page.reload();
    await expect(urlInput).toHaveValue(uploadedUrl, { timeout: 15_000 });

    const removeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/settings'
        && response.request().method() === 'PUT';
    });
    await page.getByRole('button', { name: '移除圖片', exact: true }).click();
    expect((await removeResponse).status()).toBe(200);
    await expect(urlInput).toHaveValue('', { timeout: 15_000 });

    const fileName = uploadedPath.split('/').at(-1)!;
    const { data: remaining, error: listError } = await admin.storage
      .from(BUCKET)
      .list(SHOP_A.id, { search: fileName });
    expect(listError).toBeNull();
    expect(remaining?.some((entry) => entry.name === fileName)).toBe(false);

    await page.reload();
    await expect(page.locator('#welcomeCardImageUrl')).toHaveValue('', { timeout: 15_000 });
  } finally {
    if (uploadedPath) {
      const { error } = await admin.storage.from(BUCKET).remove([uploadedPath]);
      if (error) console.error('[welcome-card-upload] 清理 storage 物件失敗：', error);
    }
    if (originalNotify) {
      const { error } = await admin
        .from('tenant_settings')
        .update({ notify: originalNotify })
        .eq('tenant_id', SHOP_A.id);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from('tenant_settings')
        .delete()
        .eq('tenant_id', SHOP_A.id);
      if (error) throw error;
    }
  }
});
