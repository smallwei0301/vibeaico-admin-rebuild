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
 * 「本人在 LINE 上確認」用畫面上的「模擬本人已確認（Demo，僅測試環境）」按鈕代替：Final
 * Risk 覆核（PR #519）指出該按鈕與其對應端點若在正式環境無條件存在，任何
 * OWNER 都能繞過 Issue #18 Owner 裁示的「本人在 LINE 確認」步驟，因此已比照
 * `LINE_WEBHOOK_DRAIN_ENABLED` 的閘門寫法收進
 * `NEXT_PUBLIC_OWNER_NOTIFY_TEST_CONFIRM_ENABLED`（client）／
 * `OWNER_NOTIFY_TEST_CONFIRM_ENABLED`（server）兩個非 production flag——
 * **執行本 spec 前必須在測試環境同時設定這兩個變數為 `'true'`**，否則按鈕不會
 * 渲染、端點回 404。該按鈕呼叫的 `POST /api/settings/line/owner-notify/recipients`
 * 與 webhook postback 走同一段 `confirmOwnerNotifyBind()` 商業邏輯，不是另一套
 * 假邏輯（見該 route 檔頭說明）。
 *
 * ⚠️ 執行紀錄（PR #519 CI 紅燈後的實跑修復）：CI 的 historical-compatibility-
 * candidate 在本 spec 連續紅燈 3/3，訊息是「找不到 owner-notify-section」，跟
 * 上面 test-confirm flag 那次修正是不同根因。用
 * `scripts/agents/fresh-install-baseline.mjs` 建出一份包含
 * `0116_issue_18_owner_notify.sql` 的乾淨本地 Supabase 實跑後，實際看到的是：
 *   1. 根因：下面種資料時給的 `channelId` 不是純數字（曾經是
 *      `e2e-owner-notify-${suffix}`），而 `src/config/tenant-settings.ts` 的
 *      zod schema 要求 `channelId` 符合 `^\d*$`。GET LINE 設定 API 用同一份
 *      schema 解析 DB 值，解析失敗讓整頁 `line-settings/page.tsx` 的
 *      `settings` state 永遠停在 null——該頁在 `if (loading || !settings)` 提早
 *      return 一個 loading skeleton，連帶讓不條件渲染的 `OwnerNotifySection`
 *      （含它的 `data-testid="owner-notify-section"` 根節點）整個進不了 DOM。
 *      跟 `OwnerNotifySection` 元件本身、跟它的 `confirmOwnerNotifyBind()` 商業
 *      邏輯完全無關。修法：channelId 改用純數字的 `String(Date.now())`。
 *   2. 修完①之後浮出的第二個、獨立的既有 spec 錯誤：`oT.pendingBadge`
 *      （「邀請中，等待本人在 LINE 上確認」）同時出現在候選 `<select>` 的
 *      `<option>` 標籤與待確認列的 `<span>` 裡，`section.getByText(...)` 因此
 *      比對到兩個節點，觸發 Playwright strict mode violation。改用待確認列的
 *      `border-dashed` 容器 class 縮小定位範圍後即可穩定通過。
 * 兩個修正都完成後，本 spec 在本地隔離 Supabase 上完整跑過一次：
 * `1 passed (54.2s)`。
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
      // channelId 受 src/config/tenant-settings.ts 的 zod schema 限制為純數字
      // （`^\d*$`，訊息「請輸入純數字的 Channel ID」）——GET LINE 設定 API 用同一份
      // schema 解析 DB 值，解析失敗會讓整頁的 `settings` state 永遠停在 null，
      // 連帶讓不條件渲染的 OwnerNotifySection 也卡在頁面自己的 loading 閘門後面
      // 出不來（page.tsx 的 `if (loading || !settings) return …` 早退）。之前這裡
      // 塞的是 `e2e-owner-notify-${suffix}`（suffix 是 Date.now().toString(36)，
      // 含字母與連字號），觸發的正是這個驗證失敗，而不是 OwnerNotifySection 本身
      // 的問題——實測見 CI「找不到 owner-notify-section」的根因。改用純數字的
      // Date.now() 字串既滿足 schema，也保留跨次執行的唯一性。
      line: { ...(originalLineJsonb ?? {}), channelId: String(Date.now()) },
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
    // 這段文案（`oT.pendingBadge`）同時出現在候選下拉的 <option> 標籤裡（見
    // OwnerNotifySection.tsx 的候選 <select>）與下方待確認列的 <span> 裡——單純用
    // `section.getByText(...)` 會同時比對到這兩個節點，觸發 Playwright strict
    // mode violation（跟 owner-notify-section 那個根因是兩回事：那個是整頁的
    // settings 卡在 loading 沒渲染，這個是 locator 本身模糊）。用待確認列固定的
    // `border-dashed` 容器 class 縮小範圍，只比對真正的待確認列。
    await expect(
      section.locator('div.border-dashed', { hasText: '邀請中，等待本人在 LINE 上確認' }),
    ).toBeVisible();

    await section.getByRole('button', { name: '模擬本人已確認（Demo，僅測試環境）' }).click();
    await expect(page.getByText('已加入通知名單')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    const recipientA = section.getByTestId(`owner-notify-recipient-${lineUserA}`);
    await expect(recipientA).toBeVisible({ timeout: 15_000 });
    await expect(recipientA.getByText('主要', { exact: true })).toBeVisible();

    /* ------------------------------------------------------------ ② 加入第二位 */
    await candidateSelect.selectOption({ label: 'E2E 好友 B' });
    await section.getByRole('button', { name: '發送確認邀請' }).click();
    await expect(page.getByText('已送出確認邀請，請對方在 LINE 上確認')).toBeVisible({ timeout: 15_000 });
    await section.getByRole('button', { name: '模擬本人已確認（Demo，僅測試環境）' }).click();
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
