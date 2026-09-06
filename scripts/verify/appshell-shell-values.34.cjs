#!/usr/bin/env node
// scripts/verify/appshell-shell-values.34.cjs
//
// Issue #34 acceptance box 9/9 — 「Preview 站實測」。
//
// 用真實帳號登入一個跑在真實 Next.js production build（NEXT_PUBLIC_USE_MOCK=false）
// 上的環境，讀出畫面上 AppShell/Sidebar/Topbar 顯示的三個「外框值」：
//   - 側邊欄「待確認預約」badge（config key: pendingBookingBadge，nav.ts key: bookings）
//   - Topbar 開店進度（setupPercent）
//   - Topbar 使用者名稱（userName）
// 並各自用 service-role 對 TEST Supabase 直查一份「畫面之外」算出的期望值，
// 逐一比對、印出 [PASS]/[FAIL]/[SKIP]。
//
// 選用 LOCAL_SHOP 租戶（tests/fixtures.ts 的 SHOP_A / tenant-a）而非先前
// 誤用的 GUIDE 租戶 —— 見 docs/AGENT-PLAYBOOK.md PB-011：GUIDE 業態的側邊欄
// 沒有「待確認預約」入口，該租戶無法用來驗收這顆 badge。
//
// 用法：
//   VERIFY_BASE_URL=http://localhost:3100 node scripts/verify/appshell-shell-values.34.cjs
// 預設 VERIFY_BASE_URL=http://localhost:3100（同 playwright.config.ts 的 webServer PORT）。
//
// 前置：
//   - 目標站台必須是真的用 TEST Supabase 起的 build（NEXT_PUBLIC_USE_MOCK=false，
//     NEXT_PUBLIC_SUPABASE_URL/ANON_KEY 指向 TEST 專案）—— 本腳本不負責啟動它。
//   - .env.test 存在（或等效環境變數已注入）：TEST_SUPABASE_URL、
//     TEST_SUPABASE_SERVICE_ROLE_KEY。
//
// 安全：本腳本只對 TEST 專案做唯讀查詢（service role client 只呼叫 select）。
// 絕不印出任何金鑰或密碼值。

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.resolve(__dirname, 'out');
const PRODUCTION_SUPABASE_HOSTNAME = 'egehnijjpgijmccagxac.supabase.co';

const BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:3100';

// SHOP_A / tenant-a（見 tests/fixtures.ts）— LOCAL_SHOP 業態，側邊欄有「預約列表」
// （config key pendingBookingBadge）入口。
const SHOP_A = {
  id: 'a1000000-0000-4000-8000-000000000001',
  shopCode: 'tenant-a',
  owner: {
    email: process.env.VERIFY_OWNER_EMAIL || 'owner-a@test.local',
    password: process.env.VERIFY_OWNER_PASSWORD || 'Passw0rd!a',
  },
};

const results = [];
function record(status, label, detail) {
  const line = `[${status}] ${label}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ status, label, detail });
}

/** 同 scripts/test/_supabase-admin.mjs 的安全鎖：載入 .env.test（若尚未注入）
 * 並拒絕任何指向正式專案的設定。 */
function loadTestEnv() {
  if (process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) return;
  const envTestPath = path.resolve(REPO_ROOT, '.env.test');
  if (!fs.existsSync(envTestPath)) {
    console.error(
      `[verify-34] 找不到 .env.test（預期路徑：${envTestPath}），且環境變數也未注入 ` +
        'TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY。',
    );
    process.exit(1);
  }
  process.loadEnvFile(envTestPath);
}

function assertSafeTestUrl() {
  const rawUrl = process.env.TEST_SUPABASE_URL;
  if (!rawUrl) {
    console.error('[verify-34] 安全鎖：TEST_SUPABASE_URL 未設定，拒絕執行。');
    process.exit(1);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(`[verify-34] 安全鎖：TEST_SUPABASE_URL 不是合法 URL（"${rawUrl}"）。`);
    process.exit(1);
  }
  if (parsed.hostname === PRODUCTION_SUPABASE_HOSTNAME) {
    console.error('[verify-34] 安全鎖：TEST_SUPABASE_URL 指向正式專案，拒絕執行。');
    process.exit(1);
  }
  return rawUrl;
}

function createTestAdminClient() {
  const url = process.env.TEST_SUPABASE_URL;
  const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('[verify-34] 安全鎖：TEST_SUPABASE_SERVICE_ROLE_KEY 未設定，拒絕執行。');
    process.exit(1);
  }
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function main() {
  loadTestEnv();
  const testUrl = assertSafeTestUrl();
  const admin = createTestAdminClient();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[verify-34] 目標站台：${BASE_URL}`);
  console.log(`[verify-34] TEST Supabase host：${new URL(testUrl).hostname}`);
  console.log(`[verify-34] 受測租戶：${SHOP_A.shopCode}（${SHOP_A.id}）owner=${SHOP_A.owner.email}`);

  // ---- 1) service-role 直查 DB 期望值（與畫面完全獨立的計算路徑） --------
  const [{ count: pendingBookingCount, error: bErr }, { data: tenantRow, error: tErr }] =
    await Promise.all([
      admin.from('bookings').select('id', { count: 'exact', head: true })
        .eq('tenant_id', SHOP_A.id).eq('status', 'PENDING'),
      admin.from('tenants').select('id, business_type, shop_code').eq('id', SHOP_A.id).maybeSingle(),
    ]);
  if (bErr) throw bErr;
  if (tErr) throw tErr;
  if (!tenantRow) {
    record('FAIL', 'DB 直查：租戶存在', `找不到 tenants.id=${SHOP_A.id}`);
    process.exitCode = 1;
    return finish();
  }
  record('PASS', 'DB 直查：租戶存在', `business_type=${tenantRow.business_type}`);

  if (tenantRow.business_type !== 'LOCAL_SHOP') {
    record(
      'SKIP',
      '受測租戶 business_type 為 LOCAL_SHOP',
      `實際為 ${tenantRow.business_type}，此腳本鎖定 LOCAL_SHOP 側邊欄才有「待確認預約」入口（PB-011）`,
    );
  } else {
    record('PASS', '受測租戶 business_type 為 LOCAL_SHOP', '側邊欄應含「待確認預約」入口');
  }

  record('PASS', 'DB 直查：pending bookings 筆數', String(pendingBookingCount ?? 0));

  // ---- 2) 用真實登入端點取得瀏覽器 session，讀取 /tenant/dashboard 畫面 ----
  // 同 playwright.config.ts：環境預裝 chromium 於 PLAYWRIGHT_BROWSERS_PATH，
  // 禁止 `playwright install`，用 executablePath 指到預裝的完整 build
  // （非 headless_shell —— 該 build 的版本與本專案 pin 的 @playwright/test 不同）。
  const launchOptions = {};
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath && fs.existsSync(path.join(browsersPath, 'chromium'))) {
    launchOptions.executablePath = path.join(browsersPath, 'chromium');
  }
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // ---- 追蹤 AppShell 外框值依賴的 5 個真實端點是否已經回應 -----------------
  // 見 docs/AGENT-PLAYBOOK.md（#34 教訓）：畫面上的 3 個外框值（badge/setup/
  // userName）各自來自 src/services/shell.ts 的 sidebarCounts()/currentUserName()
  // 與既有的 getSetupStatus()，三者互相獨立地打真實 TEST Supabase，對一個異地
  // 資料庫的認證＋查詢來回可能要 2~4 秒。用固定 sleep 猜這個時間必然不穩：
  // 太短會誤判「畫面還沒吃到真資料」為「畫面錯」，太長又拖慢每次跑分。
  // 正確作法：用 page.on('response') 記錄這幾個端點「第一次」200 回應的時間，
  // 下面用 waitForApiSettled() 對這份紀錄做輪詢等待（deterministic），而不是
  // 對著時鐘瞎猜。
  const apiFirstSeenAt = new Map();
  const API_MARKERS = {
    bookingBadge: (u) => u.includes('/api/bookings?') && u.includes('status=PENDING'),
    productOrderBadge: (u) => u.includes('/api/product-orders/pending/count'),
    chatBadge: (u) => u.includes('/api/chat/conversations') && !u.includes('since='),
    setupStatus: (u) => u.includes('/api/settings/setup-status'),
    authMe: (u) => u.includes('/api/auth/me'),
  };
  page.on('response', (res) => {
    if (res.status() !== 200) return;
    const u = res.url();
    for (const [key, match] of Object.entries(API_MARKERS)) {
      if (match(u) && !apiFirstSeenAt.has(key)) apiFirstSeenAt.set(key, Date.now());
    }
  });

  /**
   * 等到指定的 marker 都至少收到過一次 200 回應（或逾時）。回傳仍缺的 marker
   * 清單（空陣列＝全部到齊）——呼叫端可以據此判斷是「畫面還在等真資料」
   * （腳本該多等）還是「端點真的沒回應」（產品或後端有問題，不該再等）。
   */
  async function waitForApiSettled(keys, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const missing = keys.filter((k) => !apiFirstSeenAt.has(k));
      if (missing.length === 0) return [];
      await page.waitForTimeout(100);
    }
    return keys.filter((k) => !apiFirstSeenAt.has(k));
  }

  try {
    await page.goto(`${BASE_URL}/tenant/login`, { waitUntil: 'networkidle' });
    await page.fill('#username', SHOP_A.owner.email);
    await page.fill('#password', SHOP_A.owner.password);
    await Promise.all([
      page.waitForURL('**/tenant/dashboard**', { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);
    record('PASS', '真實登入端點回登入成功並導向 /tenant/dashboard', '');
  } catch (e) {
    record('FAIL', '真實登入端點回登入成功並導向 /tenant/dashboard', String(e && e.message ? e.message : e));
    await page.screenshot({ path: path.join(OUT_DIR, '34-login-failure.png'), fullPage: true }).catch(() => {});
    await browser.close();
    process.exitCode = 1;
    return finish();
  }

  // AppShell 掛載、Sidebar/Topbar 資料進場後再讀值 —— 用「5 個端點都至少回過
  // 一次 200」這個 deterministic 條件，取代原本瞎猜的固定 500ms sleep
  // （2026-09-06 實測：對 TEST Supabase 的認證＋查詢來回常態要 2~4 秒，見
  // docs/AGENT-PLAYBOOK.md #34 教訓；固定 500ms 在畫面完全正確、只是「還在
  // 誠實顯示 loading 佔位」時就把它判成 FAIL，是腳本本身太天真，不是產品錯）。
  await page.waitForSelector('#sidebar', { timeout: 15_000 });
  const stillMissing = await waitForApiSettled(Object.keys(API_MARKERS), 15_000);
  if (stillMissing.length > 0) {
    record(
      'FAIL',
      '外框值依賴的真實端點在 15 秒內全部回應',
      `逾時仍缺：${stillMissing.join(', ')} —— 這是後端/網路真的沒回應，不是等待策略的問題`,
    );
  }
  // API 回應之後，React state 更新＋重新渲染還需要一個 tick；給一個很小的緩衝
  // （不是用來「賭」真資料何時到，到齊與否已經由上面的 deterministic 等待決定）。
  await page.waitForTimeout(200);

  const loginScreenshot = path.join(OUT_DIR, '34-dashboard-localshop.png');
  await page.screenshot({ path: loginScreenshot, fullPage: true });
  console.log(`[verify-34] 截圖：${loginScreenshot}`);

  // ---- 3) 讀「待確認預約」badge（nav key: bookings，config badge key:
  //         pendingBookingBadge）。該項目在「預約管理」群組收合選單內，
  //         群組按鈕本身也會疊加同一個數字（groupCount），先展開群組。
  // 限定在 #sidebar 內找，避免 dashboard 主內容區也有「今日預約」/「查看全部」
  // 等指到同一個 href 的其他連結，觸發 Playwright strict-mode 多重命中。
  const bookingsLink = page.locator('#sidebar a[href="/tenant/bookings"]');
  let screenBookingBadge = null;
  try {
    if (!(await bookingsLink.isVisible().catch(() => false))) {
      // 群組收合中，點開「預約管理」群組按鈕（第一個 sidebar 群組按鈕）。
      const groupButton = page.locator('#sidebar button[aria-expanded]').first();
      await groupButton.click();
      await page.waitForTimeout(200);
    }
    await bookingsLink.waitFor({ state: 'visible', timeout: 5000 });
    const badgeLocator = bookingsLink.locator('.badge-count');
    if (await badgeLocator.count()) {
      screenBookingBadge = parseInt((await badgeLocator.first().textContent()).trim(), 10);
    } else {
      screenBookingBadge = 0; // CountBadge count=0 時不渲染 DOM 節點
    }
  } catch (e) {
    record('FAIL', '畫面讀取「待確認預約」badge（預約列表 / pendingBookingBadge）', String(e && e.message ? e.message : e));
  }

  if (screenBookingBadge !== null) {
    const dbCount = pendingBookingCount ?? 0;
    const status = screenBookingBadge === dbCount ? 'PASS' : 'FAIL';
    record(
      status,
      '待確認預約：畫面數字與 DB 直查筆數相符',
      `畫面 ${screenBookingBadge} vs DB 直查 ${dbCount}`,
    );
    // 硬鎖：不得是先前寫死的 mock 常數 3（LOCAL_SHOP mock 的 pendingBookingBadge），
    // 除非 DB 真的算出 3。
    if (screenBookingBadge === 3 && dbCount !== 3) {
      record(
        'FAIL',
        '待確認預約 badge 不是寫死的 mock 常數 3',
        `畫面顯示 3，但 DB 直查為 ${dbCount}，判定為 mock 殘留值`,
      );
    } else {
      record('PASS', '待確認預約 badge 不是寫死的 mock 常數 3（或恰巧與 DB 相符）', `畫面 ${screenBookingBadge}`);
    }
    if (status !== 'PASS') process.exitCode = 1;
  }

  // ---- 4) setupPercent：畫面上的開店進度（如果 <100% 才會渲染） ----
  let screenSetupPercent = null;
  try {
    const setupLocator = page.locator('a[href="/tenant/settings"] span.tabular-nums');
    if (await setupLocator.count()) {
      const raw = (await setupLocator.first().textContent()).trim();
      screenSetupPercent = parseInt(raw.replace('%', ''), 10);
    } else {
      screenSetupPercent = 100; // 元件規則：setupPercent === 100 時整塊不渲染
    }
  } catch (e) {
    record('FAIL', '畫面讀取開店進度（setupPercent）', String(e && e.message ? e.message : e));
  }

  const { data: settingsRow } = await admin
    .from('tenant_settings')
    .select('basic, business, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .maybeSingle();
  const { count: staffCount } = await admin.from('staff').select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_A.id);
  const { count: serviceCount } = await admin.from('services').select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_A.id);
  const basic = (settingsRow && settingsRow.basic) || {};
  const business = (settingsRow && settingsRow.business) || {};
  const steps = [
    Boolean(basic.tenantPhone || basic.tenantAddress),
    (staffCount ?? 0) > 0,
    (serviceCount ?? 0) > 0,
    Object.keys(business).length > 0,
    Boolean(settingsRow && settingsRow.line_channel_access_token_enc),
  ];
  const done = steps.filter(Boolean).length;
  const dbSetupPercent = Math.round((done / 5) * 100);

  if (screenSetupPercent !== null) {
    const status = screenSetupPercent === dbSetupPercent ? 'PASS' : 'FAIL';
    record(status, '開店進度：畫面數字與 GET /api/settings/setup-status 計算值相符', `畫面 ${screenSetupPercent}% vs DB 計算 ${dbSetupPercent}%`);
    if (status !== 'PASS') process.exitCode = 1;

    if ([60, 80, 100].includes(screenSetupPercent) && screenSetupPercent !== dbSetupPercent) {
      record('FAIL', '開店進度不是寫死的 mock 常數（60/80/100 其一）', `畫面 ${screenSetupPercent}% 疑似 mock 殘留（DB 計算為 ${dbSetupPercent}%）`);
    } else {
      record('PASS', '開店進度不是寫死的 mock 常數（60/80/100 其一），或恰巧與 DB 相符', `畫面 ${screenSetupPercent}%`);
    }
  }

  // ---- 5) userName：Topbar 使用者名稱，應為真實登入 email，不是 MOCK_USER.name ----
  let screenUserName = null;
  try {
    const userNameLocator = page.locator('.topbar-right span.hidden.sm\\:inline').last();
    screenUserName = (await userNameLocator.textContent()).trim();
  } catch (e) {
    record('FAIL', '畫面讀取使用者名稱（userName）', String(e && e.message ? e.message : e));
  }

  if (screenUserName !== null) {
    const isRealEmail = screenUserName === SHOP_A.owner.email;
    const isMockName = screenUserName === '小威';
    record(
      isRealEmail ? 'PASS' : 'FAIL',
      '使用者名稱是真實登入 email，不是 MOCK_USER.name',
      `畫面「${screenUserName}」${isMockName ? '（= 寫死的 mock 常數「小威」）' : ''}`,
    );
    if (!isRealEmail) process.exitCode = 1;
  }

  await browser.close();
  return finish();

  function finish() {
    const fail = results.filter((r) => r.status === 'FAIL').length;
    const pass = results.filter((r) => r.status === 'PASS').length;
    const skip = results.filter((r) => r.status === 'SKIP').length;
    console.log(`\n[verify-34] 總結：PASS=${pass} FAIL=${fail} SKIP=${skip}`);
    if (fail > 0) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[verify-34] 未預期錯誤：', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
