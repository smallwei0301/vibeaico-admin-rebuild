/**
 * Issue #26 第一段驗收清單第 3 項（playbook §5）：
 *   「Playwright 實測：登入頁點兩顆按鈕，斷言不發生導頁、不出現 404；
 *    證據＝腳本路徑＋輸出原文關鍵行」
 *
 * PR #200（已合併，4ab880f）已經把 /tenant/login、/tenant/register 的 LINE／
 * Google 按鈕做成 `<button disabled data-testid="oauth-line-disabled">` /
 * `data-testid="oauth-google-disabled"`（見 src/app/tenant/login/page.tsx、
 * src/app/tenant/register/page.tsx），並且只顯示平台 OAuth 憑證是否已設定的
 * 誠實文案（src/i18n/zh-TW/pages/login.ts、register.ts 的 t.oauth.checking /
 * notConfigured / buildingFlow 三選一），從不連到 authorize 端點。這支 spec
 * 是把上述「已經做對了」的狀態，補成可重跑、可引用輸出行的 Playwright 證據。
 *
 * 兩頁皆為公開頁面，不需要登入（同 auth.spec.ts 的 SHOP_A 種子帳號機制在此
 * 用不到，故不 import ../fixtures）。
 *
 * 元素定位：兩個第三方按鈕都用 `[data-testid="oauth-line-disabled"]` /
 * `[data-testid="oauth-google-disabled"]`（登入頁、註冊頁共用同一組
 * testid），比用按鈕文案（「用 LINE 登入」vs.「用 LINE 快速註冊」，兩頁文案
 * 不同）更穩定。
 *
 * 點擊手法：Playwright 對 `disabled` 元素預設會直接判定「不可操作」而拒絕
 * 點擊（不會真的 dispatch click 事件）。這裡刻意用 `.click({ force: true })`
 * 讓瀏覽器真的送出 click，藉此證明「就算硬點，這顆按鈕在 DOM 上也沒有
 * onClick handler、沒有 <a href>、沒有任何 JS 會導航」——這比「反正
 * disabled 點不到」更強的斷言，也是任務指示明確要求的驗法。
 */
import { test, expect, type Page } from '@playwright/test';

const LOGIN_PATH = '/tenant/login';
const REGISTER_PATH = '/tenant/register';

/** t.oauth.checking / notConfigured / buildingFlow 三選一（login.ts 與
 * register.ts 逐字相同，見兩份檔案內的 notConfigured 註解）。誠實文案只可能
 * 是這三種之一，斷言用這份清單而非硬猜其中一種，避免測試綁死在某個
 * TEST 環境當下有沒有設定 OAuth 憑證這件事。 */
const HONEST_OAUTH_NOTES = ['設定狀態確認中…', '平台尚未設定第三方登入', '已設定憑證，登入流程建置中'];

const OAUTH_TESTIDS = ['oauth-line-disabled', 'oauth-google-disabled'] as const;

/** 收集本頁生命週期內任何打向 /api/auth/oauth/ 的 request URL，供斷言用。 */
function trackOAuthRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/auth/oauth/')) seen.push(url);
  });
  return seen;
}

for (const [pageName, path] of [
  ['登入頁', LOGIN_PATH],
  ['註冊頁', REGISTER_PATH],
] as const) {
  test.describe(`${pageName}（${path}）第三方登入／註冊按鈕（#26 第一段）`, () => {
    test(`${pageName}：兩顆第三方按鈕存在且為 disabled`, async ({ page }) => {
      await page.goto(path);
      for (const testid of OAUTH_TESTIDS) {
        const el = page.locator(`[data-testid="${testid}"]`);
        await expect(el).toBeVisible();
        await expect(el).toBeDisabled();
        expect(await el.evaluate((node) => node.tagName)).toBe('BUTTON');
        // 不是 <a>，DOM 上沒有 href 可以導航
        expect(await el.evaluate((node) => node.getAttribute('href'))).toBeNull();
      }
    });

    test(`${pageName}：強制點擊兩顆按鈕 → 不發生導頁、不呼叫 authorize`, async ({ page }) => {
      const oauthRequests = trackOAuthRequests(page);
      await page.goto(path);
      await expect(page.locator('[data-testid="oauth-line-disabled"]')).toBeVisible();

      const urlBefore = page.url();

      for (const testid of OAUTH_TESTIDS) {
        await page.locator(`[data-testid="${testid}"]`).click({ force: true });
      }

      // 給任何可能的導航/請求一點時間發生，再斷言什麼都沒發生。
      await page.waitForTimeout(500);

      expect(page.url()).toBe(urlBefore);
      const authorizeCalls = oauthRequests.filter((u) => u.includes('authorize'));
      expect(authorizeCalls).toEqual([]);
    });

    test(`${pageName}：強制點擊後頁面仍是原頁面，未落在任何錯誤/404 路由`, async ({ page }) => {
      await page.goto(path);
      for (const testid of OAUTH_TESTIDS) {
        await page.locator(`[data-testid="${testid}"]`).click({ force: true });
      }
      await page.waitForTimeout(500);

      // 頁面主體（表單標題/卡片）仍在，代表沒有被導去 Next.js 404 頁或任何
      // 其他路由——404 頁面不會渲染這兩顆 data-testid 按鈕。
      await expect(page.locator('[data-testid="oauth-line-disabled"]')).toBeVisible();
      await expect(page.locator('[data-testid="oauth-google-disabled"]')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
    });

    test(`${pageName}：誠實文案是三選一之一，不是假裝可登入的文字`, async ({ page }) => {
      await page.goto(path);
      const lineNote = await page
        .locator('[data-testid="oauth-line-disabled"]')
        .locator('xpath=following-sibling::p[1]')
        .textContent();
      const googleNote = await page
        .locator('[data-testid="oauth-google-disabled"]')
        .locator('xpath=following-sibling::p[1]')
        .textContent();

      expect(lineNote?.trim()).not.toBeNull();
      expect(googleNote?.trim()).not.toBeNull();
      expect(HONEST_OAUTH_NOTES).toContain(lineNote?.trim());
      expect(HONEST_OAUTH_NOTES).toContain(googleNote?.trim());
    });
  });
}

/**
 * 獨立測試案例（不依附在上面的 for 迴圈裡），輸出行本身就是可引用的證據：
 * 直接呼叫 authorize 端點證明它「根本不存在」（真 404），同時 UI 從未連過去
 * ——這是誠實現況的完整陳述，而不是只驗 UI 沒有連結就結案。
 */
test.describe('#26 第一段：authorize 端點誠實現況（獨立佐證）', () => {
  test('GET /api/auth/oauth/line/authorize 回真實 404（端點尚未建置，UI 也從未連過去）', async ({ page }) => {
    const res = await page.request.get('/api/auth/oauth/line/authorize');
    expect(res.status()).toBe(404);
  });

  test('GET /api/auth/oauth/google/authorize 回真實 404（端點尚未建置，UI 也從未連過去）', async ({ page }) => {
    const res = await page.request.get('/api/auth/oauth/google/authorize');
    expect(res.status()).toBe(404);
  });
});

/**
 * GET /api/auth/oauth/status —— 公開端點，回傳兩個 provider 是否已設定憑證，
 * 且絕不外洩 client id / secret 本身（見 src/app/api/auth/oauth/status/route.ts
 * 的註解與 src/lib/types.ts 的 OAuthStatus 型別）。
 */
test.describe('#26 第一段：GET /api/auth/oauth/status', () => {
  test('回 200，內容是 {success:true,data:{google:{configured},line:{configured}}}，不含憑證本身', async ({ page }) => {
    const res = await page.request.get('/api/auth/oauth/status');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.google.configured).toBe('boolean');
    expect(typeof body.data.line.configured).toBe('boolean');

    const bodyText = JSON.stringify(body);
    // 不得出現任何看起來像 client id / secret 的欄位名稱或值。
    expect(bodyText).not.toMatch(/CLIENT_ID/i);
    expect(bodyText).not.toMatch(/SECRET/i);
    expect(bodyText).not.toMatch(/client_id/);
    expect(bodyText).not.toMatch(/channel_secret/i);
  });
});
