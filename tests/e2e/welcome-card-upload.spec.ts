import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { SHOP_A } from '../fixtures';
import { assertTestSupabaseTarget, projectRefFromCookieNames, projectRefFromSupabaseUrl } from '../e2e-target-guard';

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

test('歡迎卡片圖片上傳後會保存，重整仍存在，移除也會保存', async ({ page, context }, testInfo) => {
  // multi-step real TEST flow; default 30s too tight on shared canonical TEST, see runs 36962463305 / 36965230556
  test.setTimeout(120_000);
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  assertTestSupabaseTarget(projectRefFromSupabaseUrl(process.env.TEST_SUPABASE_URL), 'welcome fixture admin');
  const admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    }) },
  });
  const tenantId = randomUUID();
  const shopCode = `welcome-${tenantId}`;
  let fixtureStarted = false;
  const uploadState = { path: null as string | null };
  let uploadedUrl = '';
  let primaryFailure: unknown;
  const flights: Array<{ request: import('@playwright/test').Request; settled: Promise<void> }> = [];
  page.on('request', (request) => {
    if (!['/api/upload', '/api/settings'].includes(new URL(request.url()).pathname) || !['POST', 'PUT', 'DELETE'].includes(request.method())) return;
    const settled = request.response().then(async (response) => {
      if (!response) throw new Error(`mutation transport failed; server commit unknown: ${request.method()} ${new URL(request.url()).pathname}`);
      const failure = await response.finished();
      if (failure) throw failure;
    });
    // Keep rejection observed until cleanup aggregates it; timeout is never assumed rollback.
    void settled.catch(() => undefined);
    flights.push({ request, settled });
  });
  const journal: Array<{ stage: string; persisted?: boolean; cleanupPending?: boolean }> = [];
  async function apiData(response: import('@playwright/test').APIResponse) {
    const body = await response.json();
    expect(response.status(), 'authenticated API status').toBe(200);
    expect(body.success, 'authenticated API envelope').toBe(true);
    return body.data;
  }
  async function rawNotify() {
    const row = await admin.from('tenant_settings').select('notify').eq('tenant_id', tenantId).single();
    expect(row.error, 'owned settings readback').toBeNull();
    return row.data!.notify as Record<string, unknown>;
  }
  async function ownedPaths() {
    const paths: string[] = [];
    // Pagination also covers a server upload whose browser response was lost.
    for (let offset = 0; ; offset += 100) {
      const result = await admin.storage.from(BUCKET).list(tenantId, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (result.error) throw result.error;
      for (const item of result.data ?? []) {
        if (!item.id || item.name.includes('/')) throw new Error('unexpected owned storage entry');
        paths.push(`${tenantId}/${item.name}`);
      }
      if ((result.data?.length ?? 0) < 100) return paths;
    }
  }
  const urlInput = page.locator('#welcomeCardImageUrl');
  const uploadButton = page.getByRole('button', { name: '上傳圖片', exact: true });
  try {
    await test.step('登入並核對瀏覽器／admin 的 TEST target', async () => {
      await login(page);
      assertTestSupabaseTarget(projectRefFromCookieNames((await context.cookies()).map((c) => c.name)), 'welcome browser');
      const me = await apiData(await context.request.get('/api/auth/me', { timeout: 10_000 }));
      expect(me).toMatchObject({ email: SHOP_A.owner.email, tenantId: SHOP_A.id, role: 'OWNER' });
    });
    await test.step('建立 disposable tenant，以合法 membership switch 並讀回身份', async () => {
      const membership = await admin.from('tenant_users').select('user_id').eq('tenant_id', SHOP_A.id).eq('role', 'OWNER').single();
      expect(membership.error).toBeNull();
      const existing = await admin.auth.admin.getUserById(membership.data!.user_id);
      expect(existing.error).toBeNull();
      expect(existing.data.user?.email).toBe(SHOP_A.owner.email);
      fixtureStarted = true; // record attempted IDs before any insert, including partial failure
      expect((await admin.from('tenants').insert({ id: tenantId, shop_code: shopCode, name: 'owned welcome E2E' })).error).toBeNull();
      // Canonical 0003 default OWNER; this is a new owned membership, not a forged session/seed role.
      expect((await admin.from('tenant_users').insert({ tenant_id: tenantId, user_id: membership.data!.user_id })).error).toBeNull();
      expect((await admin.from('tenant_settings').insert({ tenant_id: tenantId })).error).toBeNull();
      const tenants = await apiData(await context.request.get('/api/auth/my-tenants', { timeout: 10_000 }));
      expect(tenants.find((row: { id: string }) => row.id === tenantId)).toMatchObject({ role: 'OWNER' });
      expect(await apiData(await context.request.post('/api/auth/switch-tenant', { data: { tenantId }, timeout: 10_000 }))).toEqual({ switched: true });
      expect(await apiData(await context.request.get('/api/auth/me', { timeout: 10_000 }))).toMatchObject({ tenantId, shopCode, role: 'OWNER' });
      await page.goto('/tenant/settings#notification');
      await expect(page.locator('#welcomeCardImageFile')).toBeAttached();
      await expect(urlInput).toHaveValue('');
      expect((await rawNotify()).welcomeCardImageUrl ?? '').toBe('');
    });
    await test.step('真 upload 回應立即記錄 path，settings PUT 與 raw Storage 證實保存', async () => {
      const uploadResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/upload' && r.request().method() === 'POST');
      const settingsResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/settings' && r.request().method() === 'PUT');
      await page.locator('#welcomeCardImageFile').setInputFiles({ name: 'welcome.png', mimeType: 'image/png', buffer: PNG_1X1 });
      const uploaded = await uploadResponse;
      const uploadBody = await uploaded.json();
      // Capture before awaiting PUT/UI assertions. Unknown/lost responses are covered by ownedPaths.
      uploadedUrl = uploadBody.data?.url ?? '';
      if (uploadedUrl) uploadState.path = storagePath(uploadedUrl);
      expect(uploaded.status()).toBe(200);
      expect(uploadBody.success).toBe(true);
      expect(uploadState.path).toMatch(new RegExp(`^${tenantId}/[^/]+\\.png$`));
      const saved = await settingsResponse;
      const payload = await saved.json();
      journal.push({ stage: 'upload settings PUT', persisted: saved.status() === 200 && payload.success === true, cleanupPending: payload.data?.welcomeCardImageCleanupPending === true });
      expect(saved.status()).toBe(200);
      expect(payload.success).toBe(true);
      await expect(urlInput).toHaveValue(uploadedUrl);
      await expect(uploadButton).toBeEnabled(); // client cleanup/retry and busy finalizer completed
      expect((await rawNotify()).welcomeCardImageUrl).toBe(uploadedUrl);
      const blob = await admin.storage.from(BUCKET).download(uploadState.path!);
      expect(blob.error).toBeNull();
      expect(Buffer.from(await blob.data!.arrayBuffer())).toEqual(PNG_1X1);
    });
    await test.step('重整仍讀到 owned 保存圖片及正確 active tenant', async () => {
      await page.reload();
      await expect(urlInput).toHaveValue(uploadedUrl);
      expect(await apiData(await context.request.get('/api/auth/me', { timeout: 10_000 }))).toMatchObject({ tenantId });
    });
    await test.step('真移除 PUT／client DELETE 完成，raw settings 與 Storage 已清空', async () => {
      const removed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/settings' && r.request().method() === 'PUT');
      const assetRemoved = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/upload' && r.request().method() === 'DELETE');
      await page.getByRole('button', { name: '移除圖片', exact: true }).click();
      const result = await removed;
      const body = await result.json();
      journal.push({ stage: 'remove settings PUT', persisted: result.status() === 200 && body.success === true, cleanupPending: body.data?.welcomeCardImageCleanupPending === true });
      expect(result.status()).toBe(200);
      expect(body.success).toBe(true);
      expect((await assetRemoved).status()).toBe(200);
      await expect(urlInput).toHaveValue('');
      await expect(uploadButton).toBeEnabled();
      expect((await rawNotify()).welcomeCardImageUrl).toBe('');
      expect(await ownedPaths()).toEqual([]);
      const retired = await admin.from('welcome_card_image_retirements').select('image_url').eq('tenant_id', tenantId);
      expect(retired.error).toBeNull();
      expect(retired.data).toContainEqual({ image_url: uploadedUrl }); // guard remains intact
    });
    await test.step('重整後移除仍持久', async () => {
      await page.reload();
      await expect(urlInput).toHaveValue('');
      expect((await rawNotify()).welcomeCardImageUrl).toBe('');
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const failures: unknown[] = [];
    if (fixtureStarted) {
      // Wait for real response completion before teardown. An aborted/unknown request makes
      // cleanup fail closed even if its subsequent readback is empty: late commits remain unknown.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            let observed = 0;
            while (observed < flights.length) {
              const batch = flights.slice(observed); observed = flights.length;
              const settled = await Promise.allSettled(batch.map((flight) => flight.settled));
              for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
            }
          })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('mutation settlement deadline; late server commit unknown')), 10_000); }),
        ]);
      } catch (error) { failures.push(error); }
      finally { if (timer) clearTimeout(timer); }
      const settledCount = flights.length;
      try { await page.close(); } catch (error) { failures.push(error); }
      if (flights.length !== settledCount || flights.some((flight) => flight.request.failure())) {
        failures.push(new Error('mutation started/failed during browser close; late server commit unknown'));
      }
      try {
        const paths = await ownedPaths();
        if (uploadState.path?.startsWith(`${tenantId}/`) && !paths.includes(uploadState.path)) paths.push(uploadState.path);
        if (paths.length) {
          const result = await admin.storage.from(BUCKET).remove(paths);
          if (result.error) throw result.error;
        }
        expect(await ownedPaths(), 'owned Storage zero after cleanup').toEqual([]);
      } catch (error) { failures.push(error); }
      // Never restore a retired URL or modify SHOP_A.notify. Remove only disposable rows.
      for (const table of ['tenant_settings', 'welcome_card_image_retirements', 'tenant_users', 'tenants']) {
        const column = table === 'tenants' ? 'id' : 'tenant_id';
        try {
          const removed = await admin.from(table).delete().eq(column, tenantId);
          if (removed.error) throw removed.error;
          const readback = await admin.from(table).select(column).eq(column, tenantId);
          if (readback.error) throw readback.error;
          expect(readback.data, `${table} owned cleanup zero`).toEqual([]);
        } catch (error) { failures.push(error); }
      }
      try { expect(await ownedPaths(), 'final owned Storage zero').toEqual([]); } catch (error) { failures.push(error); }
    }
    try {
      await testInfo.attach('welcome-lifecycle-stages', { body: JSON.stringify(journal), contentType: 'application/json' });
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(primaryFailure === undefined ? failures : [primaryFailure, ...failures], 'welcome lifecycle / owned fixture cleanup failed');
  }
});
