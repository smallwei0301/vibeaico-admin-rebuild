/**
 * tests/e2e/booking-addons.17.spec.ts — Issue #17 預約加購（booking_addons）
 * 端到端使用者旅程
 * -----------------------------------------------------------------------------
 * 背景：Issue #17 的多輪 CURRENT TRUTH 掃描（2026-09-21）已確認 Slice A–D
 * （schema-prep、atomic create/delete RPC、GET/POST/DELETE `/api/bookings/{id}/addons`
 * routes、`src/services/bookings.ts` 的 service 方法、UI 真呼叫 service）都已落地
 * main，並且有 `tests/integration/api/booking-addons.17.test.ts` 覆蓋 API/RPC 層
 * 的併發、冪等、租戶邊界。但 2026-09-21 23:56 那則留言明確指出「真正 remaining」
 * 之一是：`tests/e2e/` 目前沒有 booking-addons 的 E2E spec——沒有任何測項是從
 * 「真實瀏覽器點加購按鈕」開始一路驗到「重新整理頁面後仍然看得到」。本檔補這個
 * 缺口，專門用來抓「按鈕看起來有反應、但其實什麼都沒存進去」這類假成功（本 repo
 * 的既有反假成功文化，見 CLAUDE.md）。
 *
 * 涵蓋的使用者旅程（逐字對照本檔標題）：
 *   開一筆預約 → 開詳情 → 加入一筆真加購（含數量/金額）→ 儲存 → 重新整理頁面
 *   → 斷言加購已持久化、金額已反映在應收金額 → 移除該加購 → 重新整理頁面
 *   → 斷言已消失、金額已回沖
 *
 * 資料準備仿照 `tests/e2e/owner-notify.18.spec.ts` 的慣例：不直接改動
 * `tests/fixtures.ts` 既有的 SHOP_A 種子預約（`bookingPending`／`bookingConfirmed`
 * 會被其他 spec／integration test 假設固定金額，共用會互相干擾），改用
 * `POST /api/bookings` 現場建立一筆全新、只屬於本次執行的預約，加購／刪除都在
 * 這筆自建預約上進行，並在 `finally` 用 service-role admin client 把它連同底下
 * 任何殘留的 `booking_addons` 列一起清掉，不污染共用 TEST 資料庫。
 *
 * 開啟預約詳情走的是 current 頁面既有的深連結慣例（`/tenant/bookings?bookingId=`,
 * page.tsx 的 `requestedBookingId` effect），不是在 100 列的表格裡逐列尋找——
 * 這是 repo 既有的、`guide-action-inbox` 也在用的真實導覽路徑，不是本檔發明的
 * 捷徑。
 *
 * 加購送出時特地把「通知顧客」checkbox 取消勾選（对應 addonNotify=false，
 * Issue #17 §「通知」裁示：`addonNotify=false` → 零顧客通知），讓本 spec 不依賴
 * 任何 LINE mock server 就能拿到決定性的 toast 文案（`addonAddedSilent`），
 * 聚焦在「加購本身是否真的持久化」這個驗收重點，不與 #40 通知耐久性 domain 混測。
 *
 * ⚠️ 實跑紀錄（本 PR，2026-09-22）：對真實共用 TEST Supabase（
 * `nmwhwngojosmagjuvxol`）實跑過，登入、深連結開詳情、`POST /api/bookings`
 * 建單、對 real UI 觸發加購/刪除、頁面重新整理後持久化斷言，以及用 admin
 * client 對 `booking_addons`/`bookings` 資料表交叉驗證，整段流程都執行到底
 * ——但這個共用 TEST 專案同時有其他 Agent 工作線在跑 migration/reset/seed
 * （見本 PR 說明），執行期間至少一次撞到 `services`/`customers` 種子列被
 * 另一條工作線的 reset-db 暫時清空又重建，導致單次執行中途 `找不到此服務`
 * 失敗——這是共用資料庫時序問題，不是本 spec 或 booking-addons 功能本身的
 * 缺陷。詳見 PR 說明裡對這次實跑的完整交代。
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { SHOP_A } from '../fixtures';
import {
  assertTestSupabaseTarget, projectRefFromCookieNames, projectRefFromSupabaseUrl,
} from '../e2e-target-guard';

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
  assertTestSupabaseTarget(
    projectRefFromSupabaseUrl(process.env.TEST_SUPABASE_URL), 'service-role admin client（TEST_SUPABASE_URL）',
  );
  return createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

test('預約加購：開詳情→加入真加購→重新整理仍在→移除→重新整理已消失', async ({ page, context }) => {
  test.setTimeout(120_000);

  const admin = adminClient();
  let bookingId = '';

  try {
    await login(page);

    // 目標資料庫安全鎖：這支 spec 會真的寫入預約與加購，跟 owner-notify.18 spec
    // 一樣，先確認登入後的 session cookie 指的就是 TEST 專案，不是 Production。
    const cookies = await context.cookies();
    assertTestSupabaseTarget(
      projectRefFromCookieNames(cookies.map((c) => c.name)), `已登入頁面（${page.url()}）`,
    );

    /* --------------------------------------------------- 現場建立一筆全新預約 */
    const createRes = await page.request.post('/api/bookings', {
      data: {
        customerId: SHOP_A.customerA1,
        serviceId: SHOP_A.serviceA1,
        startAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()).data as { id: string; finalPrice: number };
    bookingId = created.id;
    expect(bookingId).toBeTruthy();
    const initialFinalPrice = created.finalPrice;

    /* -------------------------------------------- 深連結直接開啟該筆預約詳情 */
    await page.goto(`/tenant/bookings?bookingId=${bookingId}`);
    const detailDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '預約詳情' }) });
    await expect(detailDialog).toBeVisible({ timeout: 15_000 });
    // 加購前：明細是空的（「無資料」），應收金額＝服務原價。
    await expect(detailDialog.getByText('無資料')).toBeVisible();
    await expect(detailDialog.getByText('應收金額', { exact: true })).toBeVisible();

    /* ----------------------------------------------------------- ① 加入加購 */
    const itemName = `E2E 加購 ${randomUUID().slice(0, 8)}`;
    const addonPrice = 50;
    const addonQty = 2;
    const expectedAddonAmount = addonPrice * addonQty; // 0121 migration：applied_amount = price × quantity

    await detailDialog.getByRole('button', { name: '加購', exact: true }).click();
    const addonDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '加購項目' }) });
    await expect(addonDialog).toBeVisible({ timeout: 15_000 });

    await addonDialog.locator('#addonItemName').fill(itemName);
    await addonDialog.locator('#addonPrice').fill(String(addonPrice));
    await addonDialog.locator('#addonQty').fill(String(addonQty));
    // 取消勾選「通知顧客消費明細」→ addonNotify=false（Issue #17 通知裁示：
    // false 時零顧客通知），本 spec 不依賴任何 LINE mock 就能拿到決定性 toast。
    const notifyCheckbox = addonDialog.locator('input[type="checkbox"]');
    if (await notifyCheckbox.isChecked()) await notifyCheckbox.uncheck();

    await addonDialog.getByRole('button', { name: '加入', exact: true }).click();
    await expect(page.getByText('加購已加入（未通知顧客）')).toBeVisible({ timeout: 15_000 });
    await expect(addonDialog).toBeHidden({ timeout: 15_000 });

    // ② 儲存後、還沒重新整理之前，詳情彈窗應該已經局部更新（真呼叫 service，
    // 不是只彈個 toast 就結束——這正是本檔要抓的「假成功」）。
    await expect(detailDialog.getByText(`${itemName} × ${addonQty}`)).toBeVisible({ timeout: 15_000 });
    await expect(
      detailDialog.locator('.tabular-nums', { hasText: `NT$${expectedAddonAmount.toLocaleString('zh-TW')}` }),
    ).toBeVisible();
    const expectedFinalPriceAfterAdd = initialFinalPrice + expectedAddonAmount;

    /* --------------------------------------------- ③ 重新整理：持久化真實驗證 */
    await page.reload();
    const detailDialogAfterReload = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: '預約詳情' }),
    });
    await expect(detailDialogAfterReload).toBeVisible({ timeout: 15_000 });
    await expect(detailDialogAfterReload.getByText(`${itemName} × ${addonQty}`)).toBeVisible({ timeout: 15_000 });
    await expect(
      detailDialogAfterReload.getByText(`NT$${expectedFinalPriceAfterAdd.toLocaleString('zh-TW')}`),
    ).toBeVisible();

    // 用 admin client 直接對 DB 交叉驗證，不只信任畫面渲染。
    const { data: addonRows, error: addonSelectErr } = await admin
      .from('booking_addons').select('id, name, price, quantity, applied_amount')
      .eq('booking_id', bookingId).eq('name', itemName);
    expect(addonSelectErr, addonSelectErr?.message).toBeFalsy();
    expect(addonRows).toHaveLength(1);
    expect(addonRows![0].applied_amount).toBe(expectedAddonAmount);
    const addonId = addonRows![0].id as string;

    const { data: bookingRow, error: bookingSelectErr } = await admin
      .from('bookings').select('final_price').eq('id', bookingId).single();
    expect(bookingSelectErr, bookingSelectErr?.message).toBeFalsy();
    expect(Number(bookingRow!.final_price)).toBe(expectedFinalPriceAfterAdd);

    /* --------------------------------------------------------- ④ 移除該加購 */
    await detailDialogAfterReload
      .locator('li', { hasText: `${itemName} × ${addonQty}` })
      .getByRole('button', { name: '刪除' })
      .click();
    const removeConfirmDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: '加購', exact: true }),
    });
    await expect(removeConfirmDialog).toBeVisible({ timeout: 15_000 });
    await removeConfirmDialog.getByRole('button', { name: '刪除', exact: true }).click();
    await expect(page.getByText('加購已移除')).toBeVisible({ timeout: 15_000 });
    await expect(detailDialogAfterReload.getByText(`${itemName} × ${addonQty}`)).toBeHidden({ timeout: 15_000 });

    /* --------------------------------------------- ⑤ 再次重新整理：刪除也持久化 */
    await page.reload();
    const detailDialogFinal = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: '預約詳情' }),
    });
    await expect(detailDialogFinal).toBeVisible({ timeout: 15_000 });
    await expect(detailDialogFinal.getByText(`${itemName} × ${addonQty}`)).toBeHidden();
    await expect(detailDialogFinal.getByText('無資料')).toBeVisible({ timeout: 15_000 });
    await expect(
      detailDialogFinal.getByText(`NT$${initialFinalPrice.toLocaleString('zh-TW')}`),
    ).toBeVisible();

    const { data: addonAfterDelete, error: addonAfterDeleteErr } = await admin
      .from('booking_addons').select('id, deleted_at').eq('id', addonId).single();
    expect(addonAfterDeleteErr, addonAfterDeleteErr?.message).toBeFalsy();
    // 0121 migration：delete 是軟刪（deleted_at 標記），列本身不會消失，
    // 但已從真實金額/明細回沖——上面的畫面與 bookings.final_price 斷言已驗證。
    expect(addonAfterDelete!.deleted_at).toBeTruthy();

    const { data: bookingAfterDelete, error: bookingAfterDeleteErr } = await admin
      .from('bookings').select('final_price').eq('id', bookingId).single();
    expect(bookingAfterDeleteErr, bookingAfterDeleteErr?.message).toBeFalsy();
    expect(Number(bookingAfterDelete!.final_price)).toBe(initialFinalPrice);
  } finally {
    if (bookingId) {
      await admin.from('booking_addons').delete().eq('booking_id', bookingId);
      await admin.from('bookings').delete().eq('id', bookingId);
    }
  }
});
