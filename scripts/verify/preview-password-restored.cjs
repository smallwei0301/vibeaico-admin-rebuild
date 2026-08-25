/**
 * 收尾驗證：測試帳號的密碼仍是擁有者記得的那一組（15 分冊 §4 SOP）。
 *
 * 本輪實測**沒有**改過密碼（全程用 @Wei3362499 登入），但「沒改」不是證據——
 * 照 SOP 一律以「真的登入一次成功」作結，並留下截圖。
 *
 *   NODE_USE_ENV_PROXY=1 TEST_EMAIL=... TEST_PASSWORD=... \
 *     node scripts/verify/preview-password-restored.cjs
 */
const lib = require('./_preview-lib.cjs');

const EMAIL = lib.required('TEST_EMAIL');
const PASSWORD = lib.required('TEST_PASSWORD');

(async () => {
  const browser = await lib.launch();
  let ok = false;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await lib.login(page, EMAIL, PASSWORD);
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    await lib.shot(page, 'pv-99-password-still-works');
    ok = /\/tenant\/dashboard/.test(page.url());
    lib.check('測試帳號密碼未被本輪更動，仍可登入 Preview 站', ok, `登入後網址：${page.url()}`);
  } catch (e) {
    lib.check('測試帳號密碼未被本輪更動，仍可登入 Preview 站', false, e.message);
  } finally {
    await browser.close();
    lib.summary();
  }
  process.exit(ok ? 0 : 1);
})();
