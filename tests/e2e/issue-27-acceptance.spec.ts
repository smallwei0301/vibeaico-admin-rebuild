// tests/e2e/issue-27-acceptance.spec.ts
//
// Issue #27 唯一未勾的驗收項：「Playwright 對 Preview 站實測三條路徑並截圖存
// scripts/verify/out/」。三條路徑對應三個已併入 main 的修正：
//
//   ① src/app/tenant/ai-settings/page.tsx 改讀寫 getAiSettings()/saveAiSettings()
//      （以前讀寫 line.defaultReply，等於把 AI 提示詞逐字推播給每一位顧客）
//   ② src/app/api/bookings/[id]/route.ts 只在時間／服務人員真的變了才
//      notifyBookingStatus(..., 'MODIFIED')，改備註不推播
//   ③ src/app/api/product-orders/manual/route.ts 回 ProductOrderNotifyOutcome，
//      頁面照它顯示「真的發生過的事」，不再把勾選框標籤再 toast 一次冒充成功
//
// 斷言的是**當初壞掉的那個使用者可見行為**，不是「頁面有沒有畫出來」。
//
// -----------------------------------------------------------------------------
// 安全鎖（最重要的一段）
// -----------------------------------------------------------------------------
// 這支 spec 會寫入資料。playwright.config.ts 的 E2E_BASE_URL 讓它可以指向任何
// 部署，所以每一個 test 在做任何動作之前，都先把「目標站台實際連的是哪一個
// Supabase 專案」讀回來比對（tests/e2e-target-guard.ts 有完整的方法與實測依據），
// 不是 TEST 就硬失敗。讀不到也失敗——目標不明時一律不往下跑。
//
// -----------------------------------------------------------------------------
// 誠實標註：哪一段沒有辦法端到端斷言
// -----------------------------------------------------------------------------
// ③ 的 'LINE' / 'EMAIL' 兩個結果需要真的把訊息送到 LINE 平台／收信匣才算數，
// E2E 沒有辦法在不真的送出的前提下證明它們。所以這裡走**完全由資料庫狀態決定**
// 的 'NO_CONTACT' 分支（種子顧客既沒綁 LINE 也沒有 Email），斷言頁面顯示的是
// 那一句專屬訊息、而不是一句通用的「已通知」。這是這條路徑在不動用真實推播的
// 前提下能誠實做到的最強斷言；LINE/EMAIL 分支由 line-notify 的單元測試守。

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHOP_A } from '../fixtures';
import {
  assertTestSupabaseTarget,
  projectRefFromCookieNames,
  projectRefFromSupabaseUrl,
} from '../e2e-target-guard';

/** 驗收截圖固定放這裡（Issue #27 驗收條目指名的路徑） */
const SHOT_DIR = resolve(__dirname, '../../scripts/verify/out');
const shot = (name: string) => resolve(SHOT_DIR, `issue-27-${name}.png`);

/**
 * 瀏覽器時區固定 Asia/Taipei。
 * 編輯預約的 startAt 是頁面用 `new Date(\`${date}T${time}:00\`)`（瀏覽器本地時區）
 * 組出來的，不釘住時區的話，同一份 spec 在 UTC 機器與 +08 機器上會送出不同的時刻。
 */
test.use({ timezoneId: 'Asia/Taipei' });

function admin(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  // spec 自己這支 service-role client 繞過 app 直接寫資料庫，指錯的後果與
  // app 指錯一模一樣，所以同一把鎖也套在它身上。
  assertTestSupabaseTarget(projectRefFromSupabaseUrl(url), 'spec 的 service-role admin client');
  expect(key, 'TEST_SUPABASE_SERVICE_ROLE_KEY 未設定').toBeTruthy();
  return createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * 登入，並在回到 dashboard 後立刻確認目標資料庫。
 *
 * 登入是安全鎖唯一允許在確認之前做的動作：它只做身分驗證、不寫任何業務資料，
 * 而 `sb-<ref>-auth-token` 這個由伺服器自己種下的 cookie 正是目標專案的第一手
 * 自述（理由見 tests/e2e-target-guard.ts）。
 */
async function loginAndGuard(page: Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 15_000 });

  const cookies = await page.context().cookies();
  assertTestSupabaseTarget(
    projectRefFromCookieNames(cookies.map((c) => c.name)),
    String(test.info().project.use.baseURL ?? '(baseURL 未設定)'),
  );
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

/**
 * 每條路徑都要走完「登入 → 至少兩個頁面 → 兩三次 API 往返」，本機 `next dev`
 * 每個路由第一次進去都要即時編譯，預設的 30 秒不夠（實跑三條全部卡在頁面的
 * 「載入中...」上逾時）。Preview 是 production build，不會這麼慢，但同一份 spec
 * 兩邊都要能跑。
 */
// 這份 spec 是「對已部署的 Preview 站台」做的驗收，不是一般的本機 E2E：
// 它由 .github/workflows/issue-27-preview-acceptance.yml 派工，該 workflow 一定
// 會設 E2E_BASE_URL 指向 Preview，而 Preview 的 NEXT_PUBLIC_SUPABASE_URL 指向
// TEST 專案。
//
// 沒有 E2E_BASE_URL 時（例如 local-isolated 那條 lane，資料庫是 127.0.0.1 的
// 本機 Supabase），本 spec 沒有可驗收的目標。若照跑，tests/e2e-target-guard.ts
// 會正確地攔下——它是 allowlist，判不出專案就中止——於是這條 lane 每次都紅，
// 紅的原因卻與該 lane 要驗的東西無關。
//
// 因此這裡限定適用範圍而不是放寬安全鎖：鎖維持嚴格，spec 在沒有 Preview 目標
// 時明確標記為 skipped（不是 passed），專屬 workflow 仍照常執行它。
test.skip(
  !process.env.E2E_BASE_URL,
  '本 spec 只對已部署的 Preview 站台執行；未設 E2E_BASE_URL 時沒有可驗收的目標'
    + '（由 .github/workflows/issue-27-preview-acceptance.yml 派工）',
);

test.beforeEach(() => {
  test.setTimeout(180_000);
});

/* ========================================================================== */
/* ① AI 提示詞不會跑進 LINE 罐頭回覆，而且設定頁讀得回自己存的東西              */
/* ========================================================================== */

test('① AI 提示詞存進 AI 設定、讀得回來，且沒有污染 LINE 罐頭回覆', async ({ page }) => {
  const db = admin();
  const marker = `E2E27-AI-${Date.now()}`;
  const prompt = `僅供 Issue #27 驗收的 AI 提示詞 ${marker}`;

  const { data: before, error: readErr } = await db
    .from('tenant_settings').select('ai, line').eq('tenant_id', SHOP_A.id).maybeSingle();
  if (readErr) throw readErr;
  const originalAi = (before?.ai ?? null) as Record<string, unknown> | null;
  const originalLine = (before?.line ?? null) as Record<string, unknown> | null;
  const originalDefaultReply = String(originalLine?.defaultReply ?? '');

  try {
    await loginAndGuard(page);

    await page.goto('/tenant/ai-settings');
    const promptBox = page.locator('#aiCustomPrompt');
    await expect(promptBox).toBeAttached({ timeout: 15_000 });

    const savePut = page.waitForResponse((r) =>
      new URL(r.url()).pathname === '/api/ai-settings' && r.request().method() === 'PUT');
    await promptBox.fill(prompt);
    await page.getByRole('button', { name: '儲存設定', exact: true }).click();
    expect((await savePut).status()).toBe(200);

    // 存完立刻重整：設定頁必須讀得回自己存的東西（以前它讀的是 line.defaultReply）
    await page.reload();
    await expect(page.locator('#aiCustomPrompt')).toHaveValue(prompt, { timeout: 15_000 });
    await page.screenshot({ path: shot('1-ai-settings-readback'), fullPage: true });

    // 壞掉的行為：提示詞被寫進 LINE 罐頭回覆，於是逐字推播給顧客。
    // 從**顧客真的會收到的那個欄位**去看——LINE 設定頁的「預設回覆」。
    await page.goto('/tenant/line-settings');
    const defaultReplyBox = page.locator('#defaultReply');
    await expect(defaultReplyBox).toBeAttached({ timeout: 15_000 });
    await expect(defaultReplyBox).toHaveValue(originalDefaultReply, { timeout: 15_000 });
    expect(await defaultReplyBox.inputValue()).not.toContain(marker);
    await page.screenshot({ path: shot('1-line-default-reply-untouched'), fullPage: true });

    // 資料庫層再確認一次：ai.personaNotes 收到提示詞，line.defaultReply 一個字都沒動
    const { data: after, error: afterErr } = await db
      .from('tenant_settings').select('ai, line').eq('tenant_id', SHOP_A.id).maybeSingle();
    if (afterErr) throw afterErr;
    expect((after?.ai as Record<string, unknown>)?.personaNotes).toBe(prompt);
    expect(String((after?.line as Record<string, unknown>)?.defaultReply ?? '')).toBe(originalDefaultReply);
    expect(JSON.stringify(after?.line ?? {})).not.toContain(marker);
  } finally {
    const { error } = await db.from('tenant_settings')
      .update({ ai: originalAi, line: originalLine })
      .eq('tenant_id', SHOP_A.id);
    if (error) console.error('[issue-27] 還原 tenant_settings 失敗：', error);
  }
});

/* ========================================================================== */
/* ② 改時間／服務人員才報「已觸發通知」，只改備註不報                           */
/* ========================================================================== */

/** 挑一個遠離種子資料的未來時段，避開 x_bookings_overlap 與畫面上的其他列 */
const SLOT_DATE = '2031-03-05';
const SLOT_START = `${SLOT_DATE}T14:00:00+08:00`;
const SLOT_END = `${SLOT_DATE}T15:00:00+08:00`;

test('② 預約改時間會回報已觸發通知，只改備註則明確回報未觸發', async ({ page }) => {
  const db = admin();
  const bookingId = SHOP_A.bookingConfirmed;

  const { data: before, error: readErr } = await db.from('bookings')
    .select('start_at, end_at, note, staff_id, status').eq('id', bookingId).maybeSingle();
  if (readErr) throw readErr;
  expect(before, '種子預約 BSEED0002 不存在，TEST 資料庫可能未 seed').toBeTruthy();

  // 把這筆預約擺到一個乾淨、且落在編輯視窗時間下拉選項（09:00–21:30，每 30 分）
  // 上的時段：種子的 start_at 帶秒數，不正規化的話「只改備註」也會因為秒數被
  // 抹掉而變成時間異動，測到的就不是我們要測的東西了。
  const { error: prepErr } = await db.from('bookings').update({
    start_at: SLOT_START, end_at: SLOT_END, note: '', status: 'CONFIRMED', staff_id: SHOP_A.staffA1,
  }).eq('id', bookingId);
  if (prepErr) throw prepErr;

  try {
    await loginAndGuard(page);
    await page.goto('/tenant/bookings');

    const search = page.getByPlaceholder('搜尋顧客姓名或電話...');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill('BSEED0002');
    await search.press('Enter');

    const editButton = page.getByRole('button', { name: '編輯預約' });
    await expect(editButton).toHaveCount(1, { timeout: 15_000 });

    /* ---- (a) 只改備註 → 後端不觸發、頁面明說「未觸發」 ---- */
    await editButton.click();
    await expect(page.locator('#bookingNote')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#bookingTime')).toHaveValue('14:00');
    await page.locator('#bookingNote').fill('E2E27 只改備註，不該推播');
    const notePut = page.waitForResponse((r) =>
      new URL(r.url()).pathname === `/api/bookings/${bookingId}` && r.request().method() === 'PUT');
    await page.getByRole('button', { name: '儲存變更', exact: true }).click();
    const noteBody = await (await notePut).json();
    expect(noteBody.data.notifyTriggered).toBe(false);
    await expect(page.getByRole('status').filter({ hasText: '預約已更新；本次未觸發 LINE 通知' }))
      .toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot('2a-booking-note-only-no-notify'), fullPage: true });

    /* ---- (b) 改時間 → 後端觸發、頁面報「已觸發」 ---- */
    await expect(editButton).toHaveCount(1, { timeout: 15_000 });
    await editButton.click();
    await expect(page.locator('#bookingTime')).toBeVisible({ timeout: 15_000 });
    await page.locator('#bookingTime').selectOption('15:00');
    const timePut = page.waitForResponse((r) =>
      new URL(r.url()).pathname === `/api/bookings/${bookingId}` && r.request().method() === 'PUT');
    await page.getByRole('button', { name: '儲存變更', exact: true }).click();
    const timeBody = await (await timePut).json();
    expect(timeBody.data.notifyTriggered).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: '預約已更新，已觸發 LINE 通知流程' }))
      .toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot('2b-booking-time-change-notify'), fullPage: true });
  } finally {
    const { error } = await db.from('bookings').update({
      start_at: before!.start_at, end_at: before!.end_at,
      note: before!.note, status: before!.status, staff_id: before!.staff_id,
    }).eq('id', bookingId);
    if (error) console.error('[issue-27] 還原預約失敗：', error);
  }
});

/* ========================================================================== */
/* ③ 商品訂單的通知勾選框給出「結果專屬」訊息，不是一句通用的成功               */
/* ========================================================================== */

test('③ 手動建單勾選通知後，顯示的是後端回報的實際結果而非通用成功訊息', async ({ page }) => {
  const db = admin();
  const stamp = Date.now();
  const productName = `E2E27 驗收商品 ${stamp}`;
  let productId: string | null = null;
  let orderId: string | null = null;

  // 先掃掉上一輪殘留的測試商品：test 逾時時 Playwright 會直接中斷，finally 不會
  // 執行，殘留的商品會一路留在下拉選單裡干擾之後每一輪。
  //
  // 不能只下一句 delete products：`product_order_items.product_id` 是
  // `on delete restrict`（0004:178），上一輪若已建單才逾時，這句會被 FK 擋下。
  // 而 supabase-js 的 delete 不會 throw，錯誤只在回傳值裡 —— 不檢查就等於
  // 每一輪都靜默失敗、殘留無上限累積。所以先清依賴列，再刪商品，並且檢查錯誤。
  const { data: stale, error: staleErr } = await db.from('products')
    .select('id').eq('tenant_id', SHOP_A.id).like('name', 'E2E27 驗收商品 %');
  if (staleErr) throw new Error(`[issue-27] 讀取殘留測試商品失敗：${staleErr.message}`);
  for (const row of stale ?? []) {
    const staleId = row.id as string;
    const { data: staleItems, error: itemErr } = await db
      .from('product_order_items').select('order_id').eq('product_id', staleId);
    if (itemErr) throw new Error(`[issue-27] 讀取殘留訂單明細失敗：${itemErr.message}`);
    const staleOrderIds = [...new Set((staleItems ?? []).map((i) => i.order_id as string))];
    if (staleOrderIds.length) {
      await db.from('product_order_items').delete().in('order_id', staleOrderIds);
      await db.from('product_orders').delete().in('id', staleOrderIds);
    }
    await db.from('inventory_logs').delete().eq('product_id', staleId);
    const { error } = await db.from('products').delete().eq('id', staleId);
    if (error) {
      throw new Error(`[issue-27] 無法清除上一輪殘留的測試商品 ${staleId}：${error.message}`);
    }
  }

  // products 有 (tenant_id, sort_order) / (tenant_id, line_sort_order) 唯一索引，
  // 取一個不會和既有資料撞號的區段。
  const sortOrder = 900_000 + (stamp % 90_000);
  const { data: created, error: pErr } = await db.from('products').insert({
    tenant_id: SHOP_A.id, name: productName, price: 100, stock: 50, active: true,
    sort_order: sortOrder, line_sort_order: sortOrder,
  }).select('id').single();
  if (pErr) throw pErr;
  productId = created.id as string;

  try {
    await loginAndGuard(page);
    await page.goto('/tenant/product-orders');

    await page.getByRole('button', { name: '新增訂單', exact: true }).first().click();

    // 顧客 A1 是種子顧客：沒有 line_user_id、也沒有 email ——
    // 這正是 'NO_CONTACT' 分支，完全由資料庫狀態決定，不需要任何真實推播。
    await page.getByPlaceholder('搜尋姓名/電話...').fill('0911000001');
    await page.getByRole('button', { name: '搜尋', exact: true }).click();
    const customerSelect = page.getByLabel('請先搜尋顧客');
    await expect(customerSelect).toHaveValue(SHOP_A.customerA1, { timeout: 15_000 });

    // 用 option value（商品 id）挑，不用顯示字串：顯示字串經過 formatCurrency，
    // 實測是「NT$100」而非「NT$ 100」，用字串比對只會測到格式而不是行為。
    const productSelect = page.getByLabel('請選擇商品');
    await productSelect.selectOption(productId);
    await page.getByRole('button', { name: '加入', exact: true }).click();

    await page.locator('label', {
      hasText: 'LINE 通知顧客消費明細（未綁 LINE 自動改寄 Email；每則扣 1 推播額度）',
    }).locator('input[type="checkbox"]').check();

    const manualPost = page.waitForResponse((r) =>
      new URL(r.url()).pathname === '/api/product-orders/manual' && r.request().method() === 'POST');
    await page.getByRole('button', { name: '建立訂單', exact: true }).click();
    const body = await (await manualPost).json();
    expect(body.success).toBe(true);
    orderId = body.data.id as string;
    // 後端誠實回報結果，而不是「有沒有勾」而已
    expect(body.data.notify).toBe('NO_CONTACT');

    // 使用者可見行為：顯示的是這個結果專屬的句子，而不是一句通用成功、
    // 更不是把勾選框標籤原句再 toast 一次（那正是當初的 bug）。
    const outcomeToast = page.getByRole('status')
      .filter({ hasText: '顧客未綁定 LINE 也沒有 Email，消費明細未送出' });
    await expect(outcomeToast).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('status').filter({ hasText: '每則扣 1 推播額度' })).toHaveCount(0);
    await page.screenshot({ path: shot('3-product-order-notify-outcome'), fullPage: true });
  } finally {
    if (orderId) {
      await db.from('product_order_items').delete().eq('order_id', orderId);
      await db.from('product_orders').delete().eq('id', orderId);
    }
    if (productId) {
      await db.from('inventory_logs').delete().eq('product_id', productId);
      const { error } = await db.from('products').delete().eq('id', productId);
      if (error) console.error('[issue-27] 清理測試商品失敗：', error);
    }
  }
});
