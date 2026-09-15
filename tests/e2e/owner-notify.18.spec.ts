/**
 * tests/e2e/owner-notify.18.spec.ts — Issue #18 老闆通知 owner-notify 驗收流程
 * -----------------------------------------------------------------------------
 * 驗收流程（Issue #18 本文逐字）：
 *   加入第一位接收者 → 加入第二位 → 切換一個事件開關 → 移除主要 → 確認遞補
 *   → 全部移除 → 確認之後不再發送
 *
 * 資料準備仿照 `tests/e2e/tour-admin.spec.ts` 的慣例：用 service-role admin
 * client 直接種資料（SHOP_A 的 tenant_settings LINE 憑證＋兩筆 line_users），
 * 跑完在 `finally` 清除，不污染共用 TEST 資料庫。
 *
 * LINE API 呼叫全部導向 `tests/helpers/line-mock.ts` 的本地假伺服器（同
 * `tests/integration/api/line-webhook.06.test.ts` 的 `LINE_API_BASE=
 * http://localhost:4123` 慣例）——不打真 LINE 平台，也因此能斷言「N 位接收者
 * 觸發 N 次 multicast 收件人」與「移除全部後不再有任何推播」。
 *
 * 「本人在 LINE 上確認」用畫面上的「模擬本人已確認（Demo）」按鈕代替：這個
 * repo 沒有可在 E2E 中重放的真 LINE webhook 環境（Issue #18 本文「Explicitly
 * OUT of scope」也點名了這件事），該按鈕呼叫的
 * `POST /api/settings/line/owner-notify/recipients` 與 webhook postback 走同一段
 * `confirmOwnerNotifyBind()` 商業邏輯，不是另一套假邏輯（見該 route 檔頭說明）。
 *
 * ⚠️ 執行揭露（本次 PR 誠實聲明）：本 spec 需要 canonical TEST Supabase 憑證
 * （`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`）與
 * `SETTINGS_ENCRYPTION_KEY`，這個 agent worktree 沒有這些憑證，**沒有實際執行
 * 過這支 spec**，只完成撰寫。依 B+ 規則，實跑需先宣告 `TEST_VALIDATION` lane
 * 並取得唯一 shared TEST holder 資格。
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { SHOP_A } from '../fixtures';
import { LineMockServer } from '../helpers/line-mock';

async function login(page: Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });
}

function adminClient(): SupabaseClient {
  expect(process.env.TEST_SUPABASE_URL, 'TEST_SUPABASE_URL 未設定').toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, 'TEST_SUPABASE_SERVICE_ROLE_KEY 未設定').toBeTruthy();
  return createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

test('老闆通知：加入兩位→切換開關→移除主要遞補→全部移除→之後不再發送', async ({ page }) => {
  test.setTimeout(180_000);

  const admin = adminClient();
  // 動態 import：避免這支 server-only 模組在其他不需要它的 spec 也被解析。
  const { encryptSecret } = await import('../../src/server/crypto');

  const suffix = Date.now().toString(36);
  const lineUserA = `e2e_on_${suffix}_a`;
  const lineUserB = `e2e_on_${suffix}_b`;

  const mockLine = new LineMockServer();
  await mockLine.start();

  // 保留既有的 tenant_settings 列（若有），只覆蓋 LINE 憑證欄位，跑完還原。
  const { data: existingSettings } = await admin
    .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).maybeSingle();
  const originalLineJsonb = existingSettings?.line ?? null;

  try {
    await admin.from('tenant_settings').upsert({
      tenant_id: SHOP_A.id,
      line: { ...(originalLineJsonb ?? {}), channelId: `e2e-owner-notify-${suffix}` },
      line_channel_secret_enc: encryptSecret('e2e-secret'),
      line_channel_access_token_enc: encryptSecret('e2e-token'),
    }, { onConflict: 'tenant_id' });

    const { error: seedErr } = await admin.from('line_users').insert([
      { tenant_id: SHOP_A.id, line_user_id: lineUserA, display_name: 'E2E 好友 A', followed: true },
      { tenant_id: SHOP_A.id, line_user_id: lineUserB, display_name: 'E2E 好友 B', followed: true },
    ]);
    expect(seedErr, `seed line_users 失敗：${seedErr?.message}`).toBeFalsy();

    await login(page);
    await page.goto('/tenant/line-settings');
    const section = page.getByTestId('owner-notify-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    const candidateSelect = section.getByTestId('owner-notify-candidate-select');

    /* ---------------------------------------------------- ① 加入第一位（主要） */
    await candidateSelect.selectOption({ label: 'E2E 好友 A' });
    await section.getByRole('button', { name: '發送確認邀請' }).click();
    await expect(page.getByText('已送出確認邀請，請對方在 LINE 上確認')).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText('邀請中，等待本人在 LINE 上確認')).toBeVisible();

    await section.getByRole('button', { name: '模擬本人已確認（Demo）' }).click();
    await expect(page.getByText('已加入通知名單')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    const recipientA = section.getByTestId(`owner-notify-recipient-${lineUserA}`);
    await expect(recipientA).toBeVisible({ timeout: 15_000 });
    await expect(recipientA.getByText('主要', { exact: true })).toBeVisible();

    /* ------------------------------------------------------------ ② 加入第二位 */
    await candidateSelect.selectOption({ label: 'E2E 好友 B' });
    await section.getByRole('button', { name: '發送確認邀請' }).click();
    await expect(page.getByText('已送出確認邀請，請對方在 LINE 上確認')).toBeVisible({ timeout: 15_000 });
    await section.getByRole('button', { name: '模擬本人已確認（Demo）' }).click();
    await expect(page.getByText('已加入通知名單')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    const recipientB = section.getByTestId(`owner-notify-recipient-${lineUserB}`);
    await expect(recipientB).toBeVisible({ timeout: 15_000 });

    // 兩次邀請＝兩則確認訊息（各消耗 1 則額度），此處只斷言至少各發過一次。
    const inviteCalls = mockLine.requests.filter((r) => r.path === '/v2/bot/message/multicast');
    expect(inviteCalls.length).toBeGreaterThanOrEqual(2);
    mockLine.requests.length = 0; // 清空，後面只看「新預約」事件觸發的推播

    /* ------------------------------------------------- ③ 觸發新預約：兩位都推 */
    const bookingRes1 = await page.request.post('/api/bookings', {
      data: {
        customerId: SHOP_A.customerA1,
        serviceId: SHOP_A.serviceA1,
        startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      },
    });
    expect(bookingRes1.ok(), await bookingRes1.text()).toBeTruthy();

    await expect.poll(
      () => mockLine.requests.filter((r) => r.path === '/v2/bot/message/multicast').length,
      { timeout: 15_000 },
    ).toBeGreaterThanOrEqual(1);
    const newBookingCall = mockLine.requests.find((r) => r.path === '/v2/bot/message/multicast');
    expect(new Set(newBookingCall?.body?.to ?? [])).toEqual(new Set([lineUserA, lineUserB]));
    mockLine.requests.length = 0;

    /* -------------------------------------------------- ④ 切換好友 B 的新預約開關 */
    await section.getByTestId(`owner-notify-toggle-newBooking-${lineUserB}`).getByRole('switch').click();
    await expect(page.getByText('已更新通知設定')).toBeVisible({ timeout: 15_000 });

    const bookingRes2 = await page.request.post('/api/bookings', {
      data: {
        customerId: SHOP_A.customerA1,
        serviceId: SHOP_A.serviceA1,
        startAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      },
    });
    expect(bookingRes2.ok(), await bookingRes2.text()).toBeTruthy();
    await expect.poll(
      () => mockLine.requests.filter((r) => r.path === '/v2/bot/message/multicast').length,
      { timeout: 15_000 },
    ).toBeGreaterThanOrEqual(1);
    const afterToggleCall = mockLine.requests.find((r) => r.path === '/v2/bot/message/multicast');
    // 好友 B 關掉新預約開關後，這次只推給好友 A 一人。
    expect(afterToggleCall?.body?.to).toEqual([lineUserA]);
    mockLine.requests.length = 0;

    /* --------------------------------------------------------- ⑤ 移除主要，遞補 */
    await section.getByTestId(`owner-notify-recipient-${lineUserA}`).getByRole('button', { name: '移除' }).click();
    await expect(page.getByText('已移除該接收者')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    // 好友 A 移除後，好友 B（僅存的一位）自動遞補為主要。
    await expect(
      section.getByTestId(`owner-notify-recipient-${lineUserB}`).getByText('主要', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    /* ----------------------------------------------------------- ⑥ 全部移除 */
    await section.getByRole('button', { name: '全部移除' }).click();
    await page.getByRole('button', { name: '確定' }).click();
    await expect(page.getByText('已清空通知名單')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(section.getByText('尚未設定任何接收者')).toBeVisible({ timeout: 15_000 });

    /* ------------------------------------------------- ⑦ 之後新預約不再發送 */
    const bookingRes3 = await page.request.post('/api/bookings', {
      data: {
        customerId: SHOP_A.customerA1,
        serviceId: SHOP_A.serviceA1,
        startAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      },
    });
    expect(bookingRes3.ok(), await bookingRes3.text()).toBeTruthy();
    // 給 fire-and-forget 的老闆通知足夠時間執行——如果它會推播，這段等待期內就會出現。
    await page.waitForTimeout(3000);
    expect(mockLine.requests.filter((r) => r.path === '/v2/bot/message/multicast')).toHaveLength(0);
  } finally {
    await admin.from('owner_notify_recipients').delete().eq('tenant_id', SHOP_A.id);
    await admin.from('owner_notify_bind_requests').delete().eq('tenant_id', SHOP_A.id);
    await admin.from('line_users').delete().in('line_user_id', [lineUserA, lineUserB]).eq('tenant_id', SHOP_A.id);
    await admin.from('tenant_settings').upsert({
      tenant_id: SHOP_A.id,
      line: originalLineJsonb ?? {},
      line_channel_secret_enc: '',
      line_channel_access_token_enc: '',
    }, { onConflict: 'tenant_id' });
    await mockLine.stop();
  }
});
