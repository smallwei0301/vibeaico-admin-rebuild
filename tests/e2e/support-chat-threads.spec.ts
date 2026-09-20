/**
 * 客服對話串端到端旅程（issue #25 B 段）
 * -----------------------------------------------------------------------------
 * 規格：`docs/decisions/2026-09-11-support-chat-human-escalation.md`。
 *
 * ⚠️ 誠實聲明：本檔已撰寫完整，但**尚未在本 agent worktree 執行**——這裡沒有
 * `TEST_SUPABASE_URL`／`TEST_SUPABASE_SERVICE_ROLE_KEY`，`npm run dev` 起不了
 * 一個能登入種子帳號的後端，Playwright 連第一步登入都會卡住。需要
 * `docs/AGENT-EXECUTION.md`／isolated-test-orchestration 描述的 shared TEST
 * holder 資格，或本機隔離 Supabase（`supabase start` + 種子）才能真的跑起來。
 * 在那之前，這是「已撰寫、未驗證」的狀態，不宣稱已通過。
 *
 * 涵蓋的端到端資料流（PageObject 選擇器對照 `SupportChatWidget.tsx`／
 * `common.ts` 的 `supportChat`／`supportChatEscalation`）：
 *   店家在 widget 按「轉真人客服」→ 填主旨／內容送出
 *   → 頁面立刻顯示這則對話（含通知狀態文案）
 *   → 重新整理頁面、再次打開 widget → 歷史清單看得到剛剛那則、點進去看得到內容
 *   （證明資料真的落地在 DB，不是本地 React state 的假成功）。
 */
import { test, expect, type Page } from '@playwright/test';
import { SHOP_A } from '../fixtures';

const LOGIN_PATH = '/tenant/login';
const DASHBOARD_PATH = '/tenant/dashboard';

async function login(page: Page): Promise<void> {
  await page.goto(LOGIN_PATH);
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(DASHBOARD_PATH.replace(/\//g, '\\/')), { timeout: 15_000 });
}

test.describe('客服對話串（issue #25 B 段）', () => {
  test('轉人工送出後立刻看到內容，重新整理後在歷史紀錄裡仍讀得到', async ({ page }) => {
    await login(page);

    const subject = `E2E25B-${Date.now()}`;
    const body = `這是 issue #25 B 段的端到端驗收留言 ${subject}`;

    // 開啟小幫手 → 轉人工
    await page.getByRole('button', { name: '後台小幫手' }).click();
    await page.getByRole('button', { name: '轉真人客服' }).click();

    await page.getByLabel('主旨').fill(subject);
    await page.getByLabel('內容').fill(body);
    await page.getByRole('button', { name: '送出給客服' }).click();

    // React textarea 的內容也會被 getByText(body) 命中；先等成功後的詳情畫面
    // 取代表單，避免 API 尚未完成就開始計算通知文案的等待時間。
    await expect(page.getByLabel('內容')).toBeHidden({ timeout: 10_000 });

    // 送出後立刻切到詳情畫面，看得到自己剛送出的那則留言與誠實的通知狀態文案。
    await expect(page.getByText(body)).toBeVisible({ timeout: 10_000 });
    const notifyBanner = page.locator('text=/已送出|已保存/');
    await expect(notifyBanner).toBeVisible();

    // 重新整理整個頁面，模擬「店家關掉分頁改天再回來看」。
    await page.reload();
    await expect(page).toHaveURL(new RegExp(DASHBOARD_PATH.replace(/\//g, '\\/')), { timeout: 15_000 });

    await page.getByRole('button', { name: '後台小幫手' }).click();
    await page.getByRole('button', { name: '轉真人客服' }).click();
    await page.getByRole('button', { name: '歷史紀錄' }).click();

    // 歷史清單裡找得到剛剛那則（用主旨的隨機標記比對，避免撞到其他測試留下的資料）。
    const row = page.getByRole('button', { name: new RegExp(subject) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // 點進去看得到完整內容——證明資料真的落地在 DB，不是本地 state 的假成功。
    await expect(page.getByText(body)).toBeVisible({ timeout: 10_000 });
  });

  test('未填主旨／內容不能送出，且有明確錯誤訊息（不是靜默失敗）', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: '後台小幫手' }).click();
    await page.getByRole('button', { name: '轉真人客服' }).click();
    await page.getByRole('button', { name: '送出給客服' }).click();

    await expect(page.getByText('請輸入主旨')).toBeVisible();
  });
});
