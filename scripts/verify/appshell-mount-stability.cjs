/**
 * AppShell 頁面掛載穩定性 — 自主實測腳本
 * -----------------------------------------------------------------------------
 * 驗的 bug：`<main>` 的 key 是 `current.id`（切換店家要重新掛載頁面，這是刻意的），
 * 但第一次 render 時 `/api/auth/my-tenants` 還沒回來、`current.id` 是空字串；
 * 清單一回來 id 變成真的 tenant id → key 改變 → 整個頁面 subtree 重新掛載 →
 * 使用者填到一半的表單、開著的確認視窗全部被清空。
 *
 * 慢網路才踩得到，所以本腳本用 Playwright 的 route 攔截把 my-tenants 的回應
 * **延後 6 秒**（只延後這一支 API，不改站台程式），把真人使用者在慢網路下的
 * 時間差穩定重現出來。三項檢查：
 *   ① 店家身分定案（my-tenants 回來）之前，頁面內容不得先掛載 —— 沒有過渡，
 *      就沒有「假切換」。修復前這裡會 FAIL（頁面先掛了）。
 *   ② 使用者填好的表單與開著的確認視窗，不因 my-tenants 回應而消失。
 *      修復前這裡會 FAIL（確認視窗當場不見、三個密碼欄位被清空）。
 *   ③ 真正切換店家（含切到「同業態的示範店家」）時，頁面仍會重新掛載、
 *      重新載入該店資料 —— key 原本的用意必須完好。
 *
 * ⚠️ 安全性：腳本會填密碼欄位、按下「更改密碼」把確認視窗叫出來，但**絕不會**
 *    按下視窗裡的確認鈕，因此不會真的改密碼；填的也是固定的探針字串。
 *    切換到示範店家是純前端行為（不打 switch-tenant），結束前會切回原本的店家。
 *
 * ── 憑證（絕不寫進本檔，15 分冊 §3 禁令 5）────────────────────────────────
 *   BASE_URL       受測站台（預設 http://localhost:3100，需以 real 模式啟動：
 *                  NODE_USE_ENV_PROXY=1 NEXT_PUBLIC_USE_MOCK=false npx next dev -p 3100）
 *   TEST_EMAIL     測試帳號（15 分冊 §4）
 *   TEST_PASSWORD  測試帳號密碼（15 分冊 §4）
 *
 * ── 執行（sandbox 專屬參數見 15 分冊 §5）──────────────────────────────────
 *   NODE_USE_ENV_PROXY=1 TEST_EMAIL=... TEST_PASSWORD=... \
 *     node scripts/verify/appshell-mount-stability.cjs
 *   截圖輸出到 scripts/verify/out/。
 */
const path = require('node:path');
const fs = require('node:fs');

// CLAUDE.md：Playwright 裝在全域，不在本專案 node_modules，必須 require 絕對路徑
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const EMAIL = required('TEST_EMAIL');
const PASSWORD = required('TEST_PASSWORD');
/** my-tenants 的延遲毫秒數 —— 模擬慢網路，真人打字的時間差 */
const DELAY_MS = Number(process.env.MY_TENANTS_DELAY_MS || 15000);
const PROBE = 'Probe-Never-Submitted-1';

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[缺少環境變數] ${name} —— 見 15 分冊 §4。`);
    process.exit(2);
  }
  return v;
}

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed });
  console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

async function main() {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    ...(isLocal ? {} : { proxy: { server: process.env.HTTPS_PROXY } }),
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors-spki-list=gBdItbWylHhTkoJDRwIiMuweY/qX4F0bJmLNs5wosUQ=,KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=,PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0=',
      '--ssl-version-max=tls1.2',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`受測站台：${BASE}（my-tenants 延遲 ${DELAY_MS}ms）\n`);

  /* ---------------------------------------------------------------- 登入 */
  await page.goto(`${BASE}/tenant/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/tenant\/(dashboard|$)/, { timeout: 30000 });
  check('登入成功', true, page.url());

  /* --------------------------------------------------------------- 暖機 */
  // dev server 第一次進某個路由要即時編譯（數秒），會蓋掉我們要量的時間差；
  // 先跑一趟把 /tenant/settings 編譯好、資料也熱好，再開始計時。
  await page.goto(`${BASE}/tenant/settings`, { waitUntil: 'domcontentloaded' });
  await page.locator('#tenantName').waitFor({ state: 'visible', timeout: 120000 });

  /* ------------------------------------ 攔截：把 my-tenants 延後 DELAY_MS */
  // 時間點取「瀏覽器真的收到回應」的 response 事件，不是 route handler 睡醒的那一刻
  // ——後者還沒放行請求，離 React 收到清單還差一整趟伺服器往返，用它會誤判成
  // 「等過了，沒事」。只記第一次（dev 的 React StrictMode 會重跑一次 effect）。
  let myTenantsRespondedAt = 0;
  page.on('response', (r) => {
    if (r.url().includes('/api/auth/my-tenants') && myTenantsRespondedAt === 0) {
      myTenantsRespondedAt = Date.now();
    }
  });
  await page.route('**/api/auth/my-tenants', async (route) => {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    await route.continue();
  });

  /* ------------------------------- ①② 慢網路下開設定頁，填表 → 開確認視窗 */
  const t0 = Date.now();
  await page.goto(`${BASE}/tenant/settings`, { waitUntil: 'domcontentloaded' });

  // 判定「頁面真的掛上去了」要用**只有 React 掛載後才會出現**的東西：
  // 分頁列在 SSR 的 HTML 裡就有，hydration 之前就看得到，不能當依據；
  // #tenantName 是頁面自己抓完資料後才 render 的欄位。
  await page.locator('#tenantName').waitFor({ state: 'visible', timeout: 120000 });
  const pageMountedAt = Date.now();

  const respondedFirst = myTenantsRespondedAt > 0 && myTenantsRespondedAt <= pageMountedAt;
  const stamp = (at) => (at ? `+${at - t0}ms` : '（當下尚未回應）');
  check(
    '① 店家身分定案（my-tenants 回應）之前，頁面內容不得先掛載',
    respondedFirst,
    `my-tenants 回應於 ${stamp(myTenantsRespondedAt)}、頁面可互動於 ${stamp(pageMountedAt)}`,
  );
  await shot(page, 'appshell-01-settings-mounted');

  await page.locator('[role="tab"]', { hasText: '帳號安全' }).click();
  await page.fill('#currentPassword', PROBE);
  await page.fill('#newPassword', `${PROBE}-new`);
  await page.fill('#confirmPassword', `${PROBE}-new`);
  await page.locator('button', { hasText: '更改密碼' }).last().click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 10000 });
  const filledAt = Date.now();
  const crossedBoundary = myTenantsRespondedAt === 0 || myTenantsRespondedAt > filledAt;
  console.log(`  （已填三個密碼欄位並開啟確認視窗於 +${filledAt - t0}ms，絕不按下確認）`);

  // 等 my-tenants 真的回來，再多等 2.5 秒讓 React 完成所有 re-render
  while (myTenantsRespondedAt === 0) await page.waitForTimeout(200);
  await page.waitForTimeout(2500);

  const dialogCount = await page.locator('[role="dialog"]').count();
  const kept = await page.inputValue('#currentPassword').catch(() => '');
  check(
    '② my-tenants 回應後，確認視窗與已填欄位不得被清空',
    dialogCount === 1 && kept === PROBE,
    `dialog 數量=${dialogCount}、目前密碼欄位=${JSON.stringify(kept)}；`
      + `填表 ${stamp(filledAt)} ${crossedBoundary ? '早於' : '晚於'} my-tenants 回應 `
      + `${stamp(myTenantsRespondedAt)}`
      + (crossedBoundary
        ? '（真的跨越了載入邊界）'
        : '（未跨越載入邊界——修好之後頁面本來就等到定案才掛載，'
          + '「不存在過渡」由檢查①負責證明）'),
  );
  await shot(page, 'appshell-02-after-my-tenants');

  /* --------------------------- ③ 切換店家（同業態示範店家）仍會重新掛載 */
  await page.keyboard.press('Escape');
  await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  const beforeName = await page.locator('.topbar-right button').first().innerText();

  await page.locator('.topbar-right button').first().click();
  await page.locator('button', { hasText: '祕島嚮導工作室' }).click(); // 同為 GUIDE 業態的示範店家

  // 設定頁把目前分頁寫進網址 hash，重新掛載後會回到「帳號安全」——
  // 因此「欄位還在」不代表沒重掛載，要看**欄位裡的值**有沒有跟著歸零。
  await page.locator('#currentPassword').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1000);

  const afterName = await page.locator('.topbar-right button').first().innerText();
  const probeValue = await page.inputValue('#currentPassword');
  check(
    '③ 切到同業態的示範店家：頁面重新掛載（表單狀態歸零）',
    probeValue === '',
    `切換前填入=${JSON.stringify(PROBE)}、切換後目前密碼欄位=${JSON.stringify(probeValue)}`,
  );

  await page.locator('[role="tab"]', { hasText: '基本資訊' }).click();
  const shopNameField = await page.inputValue('#tenantName');
  check(
    '③ 切到同業態的示範店家：重新載入該店資料',
    afterName.trim() !== beforeName.trim() && shopNameField.includes('祕島嚮導工作室'),
    `切換前店名=${beforeName.trim()}、切換後店名=${afterName.trim()}、店家名稱欄位=${shopNameField}`,
  );
  await shot(page, 'appshell-03-after-switch-to-demo');

  /* ------------------- ④ 停在示範店家時重新整理：不必等 my-tenants 就能用 */
  // 示範店家的身分存在 localStorage、不靠網路決定，所以掛載頁面不需要等清單回來。
  // 這一項守的是修法本身別矯枉過正（把每個人都卡在載入中）。
  let reloadRespondedAt = 0;
  const onReloadResponse = (r) => {
    if (r.url().includes('/api/auth/my-tenants') && reloadRespondedAt === 0) {
      reloadRespondedAt = Date.now();
    }
  };
  page.on('response', onReloadResponse);
  const t1 = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tenantName').waitFor({ state: 'visible', timeout: 120000 });
  const reloadMountedAt = Date.now();
  const demoName = await page.inputValue('#tenantName');
  check(
    '④ 停在示範店家時重新整理：頁面照樣掛載，不必等 my-tenants',
    demoName.includes('祕島嚮導工作室') && (reloadRespondedAt === 0 || reloadMountedAt < reloadRespondedAt),
    `頁面可互動於 +${reloadMountedAt - t1}ms、my-tenants 回應於 `
      + `${reloadRespondedAt ? `+${reloadRespondedAt - t1}ms` : '（當下尚未回應）'}`
      + `、店家名稱欄位=${demoName}`,
  );
  page.off('response', onReloadResponse);
  await shot(page, 'appshell-04-demo-reload');

  /* ------------------------------------------------------------ 還原現場 */
  // 還原不是斷言：失敗不該蓋掉上面的檢查結果。示範店家只記在這個瀏覽器 context 的
  // localStorage（context 隨腳本結束銷毀），清掉它就會回到真實店家。
  try {
    await page.evaluate((k) => localStorage.removeItem(k), 'vibeai.demoTenant.id');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#tenantName').waitFor({ state: 'visible', timeout: 120000 });
    const restored = await page.locator('.topbar-right button').first().innerText();
    console.log(`  （已還原回原本的店家：${restored.trim()}）`);
  } catch (e) {
    console.log(`  （還原原本店家失敗，不影響檢查結果：${e.message.split('\n')[0]}）`);
  }

  await browser.close();

  const failed = results.filter((r) => !r.passed);
  console.log(`\n總計 ${results.length} 項，失敗 ${failed.length} 項。`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
