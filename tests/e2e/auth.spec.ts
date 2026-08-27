/**
 * 登入系統 E2E 旅程 — 12 分冊 §4「Phase 2（登入）」矩陣：
 *   「未登入進 dashboard 被導去 login；登入成功進 dashboard；登出後再訪被擋」
 * 對應 docs/integration/03-AUTH.md §6.1（middleware 保護）、§6.3（登入頁接線）
 * 本冊驗收「未登入開 /tenant/dashboard（USE_MOCK=false）→ 302 到 /tenant/login」。
 *
 * ⚠️ TDD 紅燈說明：
 *   - src/middleware.ts（03 §6.1）與登入頁的 submit handler 接線（03 §6.3，改呼叫
 *     services/auth.ts 的 login()）都還沒做之前，第 1 條會過（頁面本來就沒有保護，
 *     但 middleware 沒接上時反而不會轉址——所以第 1 條也是紅），第 2/3 條必紅
 *     （登入頁目前只是 setTimeout 假裝送出，不會導去 dashboard）。誠實的
 *     「先寫測試」狀態，不得為轉綠放寬斷言（12 §2.4）。
 *   - 用 seed 帳號 owner-a@test.local / Passw0rd!a（tests/fixtures.ts SHOP_A.owner）。
 *
 * 元素定位：讀過 src/app/tenant/login/page.tsx 與 src/i18n/zh-TW/pages/login.ts ——
 * 帳號欄位 id="username"、密碼欄位 id="password"（表單雖標籤是「帳號」，送出時
 * 走 email+密碼登入，見 03 §6.3），用 id 選比用文案選穩定（文案可能之後微調）。
 * 提交鈕文字精確等於「登入」（common 沒有這個字串，是 loginPage.form.submit），
 * 用 exact match 排除「用 LINE 登入」「用 Google 登入」兩個第三方按鈕的干擾。
 */
import { test, expect } from '@playwright/test';
import { SHOP_A } from '../fixtures';

const DASHBOARD_PATH = '/tenant/dashboard';
const LOGIN_PATH = '/tenant/login';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(LOGIN_PATH);
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
}

test.describe('登入保護與旅程（12 分冊 §4 Phase 2）', () => {
  test('未登入直接開 dashboard → 被導去 login（帶 next 參數指回 dashboard）', async ({ page }) => {
    await page.goto(DASHBOARD_PATH);
    await expect(page).toHaveURL(/\/tenant\/login/, { timeout: 15_000 });

    const current = new URL(page.url());
    expect(current.pathname).toBe(LOGIN_PATH);
    expect(current.searchParams.get('next')).toBe(DASHBOARD_PATH);
  });

  test('用種子帳號登入成功 → 進入 dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(new RegExp(DASHBOARD_PATH.replace(/\//g, '\\/')), { timeout: 15_000 });
  });

  test('登出後再訪 dashboard 被擋', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(new RegExp(DASHBOARD_PATH.replace(/\//g, '\\/')), { timeout: 15_000 });

    // 透過 Topbar 實際 UI 走一次登出（見 src/components/layout/Topbar.tsx）。
    // 使用者選單觸發鈕沒有穩定的 accessible name（頭像縮寫 + userName，userName
    // 現在是 AppShell 裡的 MOCK_USER.name，03 §6.3 沒有明確規定 Phase 2 要不要把
    // 它換成真實登入者資料，換掉的話用文字定位會失準）——改用結構定位：
    // .topbar-right 底下第二個 .relative 觸發鈕（第一個是店家切換選單）。
    await page.locator('.topbar-right > .relative > button').nth(1).click();

    // 登出項目是 <button>（不是 <Link>）：它 await POST /api/auth/logout 成功
    // 讓後端把 httpOnly session cookie 失效，之後才導向登入頁。
    // ⚠️ 本測試先前在這裡補了一行「由測試自己把瀏覽器 cookie 清掉」的代打——
    // 當時 Topbar 只是一個 <Link href="/tenant/login">，換頁不會讓 session 失效，
    // 那行等於幫產品把它沒做的事做掉，測到的是被測程式以外的東西（12 §2.4
    // 「不准為了讓測試過而改測試」）。Topbar 接上端點後代打已移除：現在下面
    // 「再訪 dashboard 被擋」若紅，就是登出真的沒生效。
    await page.getByRole('button', { name: '登出', exact: true }).click();

    // 登出成功會被導回登入頁（router.replace('/tenant/login')）
    await expect(page).toHaveURL(/\/tenant\/login/, { timeout: 15_000 });

    // waitUntil:'commit' 而非預設 'load'：實測（拋棄式 debug spec）證實此導航的
    // redirect 與渲染完全正常——middleware 8 秒內已把人導到
    // /tenant/login?next=%2Ftenant%2Fdashboard 且表單齊全——卡住的只是 window
    // 'load' 事件（Next dev 串流回應在重導後偶發不關閉）。等 'load' 不是本測試
    // 要驗的行為；下面兩個斷言（URL 已導向 + 登入表單可見）才是。
    await page.goto(DASHBOARD_PATH, { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/tenant\/login/, { timeout: 15_000 });
    await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  });
});
