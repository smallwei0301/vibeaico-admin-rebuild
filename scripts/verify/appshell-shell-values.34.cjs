/**
 * 全站外框三個值的實測 — issue #34
 * -----------------------------------------------------------------------------
 * 驗的 bug：`AppShell` 無條件把 `MOCK_SIDEBAR_COUNTS`（3 / 2 / 5）、
 * `MOCK_SETUP_STATUS.percent`（60%）、`MOCK_USER.name`（小威）送進畫面，
 * 沒有任何 USE_MOCK 分支。這三個值不需要任何互動就會顯示，而且看起來完全正常。
 *
 * 本腳本做兩件事並**互相比對**，不是「有數字就算過」：
 *   ① 讀畫面上真正渲染出來的徽章數字／開店進度／使用者名稱；
 *   ② 用 service role 直接查同一個資料庫，自己算出「應該是多少」；
 * 然後逐項比對。只斷言「不等於 3」是不夠的——那只證明它變了，沒證明它對。
 *
 * 另外驗一個時間差：把 `/api/bookings` 延後數秒，斷言**查回來之前畫面不會先顯示 0**
 *（徽章位置放的是「查詢中」占位）。0 是「沒有待處理」，是一個有意義的答案，
 * 拿它當「還不知道」會誤導。
 *
 * ── 憑證（絕不寫進本檔，15 分冊 §3 禁令 5）────────────────────────────────
 *   BASE_URL                    受測站台
 *   TEST_EMAIL / TEST_PASSWORD  測試帳號（15 分冊 §4）
 *   SUPABASE_URL                僅限 TEST `nmwhwngojosmagjuvxol.supabase.co`
 *   SUPABASE_SERVICE_ROLE_KEY   直查用（開了 VERIFY_SEED_PENDING_ORDER 才會寫）
 *
 * ── 選項 ──────────────────────────────────────────────────────────────────
 *   VERIFY_SEED_PENDING_ORDER=1 先塞一筆 PENDING 商品訂單再比對，收尾刪掉並驗證。
 *     受測租戶三個徽章的 DB 筆數若**全是 0**（Preview 站的測試租戶就是這樣），
 *     「畫面數字＝DB 筆數」那條斷言只會走 `shown === null` 那半段，等於沒被驗到。
 *     打 Preview／正式資料庫時建議帶上，讓非零那半段也真的跑一次。
 *   VERIFY_GUIDE_PENDING_BOOKING=1 只接受 GUIDE 帳號：透過登入 session 的
 *     POST /api/bookings 建一筆 PENDING 預約，再比對同一個 GET /api/bookings
 *     回應、DB 精確筆數與側邊欄徽章。若帳號沒有可用顧客／服務，會先用同一組
 *     API 建最小 fixture；全數在收尾刪除並驗證無殘留。
 *
 * ⚠️ 這個選項會寫入資料。只可指向獲授權的 TEST／非正式 Preview 環境；不得拿
 *    Production 的帳號或資料庫執行。沒有互動憑證或已部署的相同版本時，保留為
 *    未執行驗收，不可把本檔的靜態／unit 綠燈當成 Preview 證據。
 *
 * ── 執行 ──────────────────────────────────────────────────────────────────
 *   受測站台必須以 real 模式跑（NEXT_PUBLIC_USE_MOCK=false 是建置期變數，
 *   要在 build 時就設好）：
 *     NEXT_PUBLIC_USE_MOCK=false npx next build && npx next start -p 3117
 *   然後：
 *     NODE_USE_ENV_PROXY=1 BASE_URL=http://localhost:3117 TEST_EMAIL=… \
 *       TEST_PASSWORD=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *       node scripts/verify/appshell-shell-values.34.cjs
 *   截圖輸出到 scripts/verify/out/（gitignore 涵蓋）。
 */
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:3117';
const EMAIL = required('TEST_EMAIL');
const PASSWORD = required('TEST_PASSWORD');
const SB_URL = required('SUPABASE_URL').replace(/\/$/, '');
const SB_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const TEST_SUPABASE_HOST = 'nmwhwngojosmagjuvxol.supabase.co';
/** Preview 的 branch deployment；不接受沒有 `git-` 的 Production deployment。 */
const VERCEL_PREVIEW_HOST = /^vibeaico-admin-rebuild-git-[a-z0-9-]+\.vercel\.app$/;
/** 延後 /api/bookings 幾毫秒，把「還在查」的那一段拉長到看得見 */
const BADGE_DELAY_MS = Number(process.env.BADGE_DELAY_MS || 4000);
/*
 * VERIFY_SEED_PENDING_ORDER=1 時，先塞一筆 PENDING 商品訂單再比對。
 *
 * 為什麼需要這個開關（2026-08-26 對已部署的 Preview 站實跑時發現）：那個租戶三個
 * 徽章的 DB 筆數**全都是 0**，於是下面 `expected === 0 ? shown === null : …` 這行
 * 永遠只走前半段——「畫面數字等於 DB 筆數」那條斷言一次都沒有真的執行過。
 * 一個「永遠回 0」的壞實作照樣全綠。塞一筆進去才逼得出後半段。
 * 收尾一律刪掉（見 cleanupSeed），刪不掉會印出殘留的 order_no 而不是默默結束。
 */
const SEED_ORDER = process.env.VERIFY_SEED_PENDING_ORDER === '1';
const SEED_ORDER_NO = `VERIFY34${Date.now().toString(36).toUpperCase().slice(-6)}`;
const SEED_GUIDE_BOOKING = process.env.VERIFY_GUIDE_PENDING_BOOKING === '1';
const SEED_BOOKING_NOTE = `issue34-guide-badge-${Date.now().toString(36)}`;

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

/**
 * P0：這支驗收可建立／刪除受控資料，URL 必須 fail closed。守門在 require Playwright、
 * login、service-role query 與任何 seed 前執行，避免把「Preview」誤指到正式資料。
 */
function assertSafeTarget() {
  let base;
  let supabase;
  try {
    base = new URL(BASE);
    supabase = new URL(SB_URL);
  } catch {
    console.error('[安全鎖] 拒絕執行：BASE_URL 與 SUPABASE_URL 必須是完整 URL。');
    process.exit(2);
  }

  if (supabase.protocol !== 'https:'
    || supabase.hostname !== TEST_SUPABASE_HOST
    || supabase.port !== ''
    || supabase.username
    || supabase.password) {
    console.error(`[安全鎖] 拒絕執行：SUPABASE_URL 必須精確為 https://${TEST_SUPABASE_HOST}`);
    process.exit(2);
  }

  const localBase = base.protocol === 'http:'
    && (base.hostname === 'localhost' || base.hostname === '127.0.0.1');
  const previewBase = base.protocol === 'https:'
    && base.port === ''
    && !base.username
    && !base.password
    && VERCEL_PREVIEW_HOST.test(base.hostname);
  if (base.hostname.includes('midao.com.tw') || (!localBase && !previewBase)) {
    console.error('[安全鎖] 拒絕執行：BASE_URL 只允許 localhost 或 Vercel branch Preview，禁止 Production deployment。');
    process.exit(2);
  }
}

assertSafeTarget();

// CLAUDE.md：Playwright 裝在全域，不在本專案 node_modules，必須 require 絕對路徑。
// 安全鎖必須在它之前：guard regression test 不得依賴瀏覽器是否安裝。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed });
  console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------- service role 直查 */

async function sbSelect(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${table} 查詢失敗 ${res.status}：${await res.text()}`);
  return res.json();
}

/** 用 Content-Range 取精確筆數（不把資料整包拉回來） */
async function sbCount(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?select=id&${query}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!res.ok) throw new Error(`${table} 計數失敗 ${res.status}：${await res.text()}`);
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`${table} 讀不到 content-range：${range}`);
  return total;
}

/* ------------------------------------------- 測試用 PENDING 商品訂單（可選） */

let seededOrderId = null;
let seededBookingId = null;
let seededCustomerId = null;
let seededServiceId = null;

/** 塞一筆 PENDING 商品訂單，讓「畫面數字＝DB 筆數」那條斷言真的走到 */
async function seedPendingOrder(tenantId) {
  const [customer] = await sbSelect(
    'customers', `select=id,name&tenant_id=eq.${tenantId}&limit=1`,
  );
  if (!customer) {
    console.log('  [SKIP] 種子訂單：這個租戶沒有任何顧客，無法建立商品訂單');
    return;
  }
  const res = await fetch(`${SB_URL}/rest/v1/product_orders`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      order_no: SEED_ORDER_NO,
      customer_id: customer.id,
      total_amount: 0,
      status: 'PENDING',
    }),
  });
  if (!res.ok) throw new Error(`種子訂單建立失敗 ${res.status}：${await res.text()}`);
  seededOrderId = (await res.json())[0].id;
  console.log(`  種子：建立 PENDING 商品訂單 ${SEED_ORDER_NO}（顧客 ${customer.name}）`);
}

/** 以登入中的 session 呼叫真實 API；fixture 與 booking 都不繞過 route。 */
async function postApi(page, pathName, body) {
  return page.evaluate(async ({ path, payload }) => {
    const res = await fetch(path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }, { path: pathName, payload: body });
}

/**
 * GUIDE 本身不保證已有「一般預約」的顧客／服務。這兩個依賴若缺，就用後台 API
 * 補最小 fixture；真正要驗的 booking 一律走 POST /api/bookings，不能 service-role
 * 直插而略過 availability 與 route contract。
 */
async function seedGuidePendingBooking(page, tenantId) {
  const [tenant] = await sbSelect('tenants', `select=business_type&id=eq.${tenantId}`);
  const businessType = tenant?.business_type;
  if (businessType !== 'GUIDE') {
    throw new Error(`VERIFY_GUIDE_PENDING_BOOKING 需要 GUIDE 帳號，現在是 ${businessType ?? '未知'}`);
  }

  let [customer] = await sbSelect(
    'customers', `select=id&tenant_id=eq.${tenantId}&active=is.true&limit=1`,
  );
  if (!customer) {
    const created = await postApi(page, '/api/customers', {
      name: SEED_BOOKING_NOTE, note: SEED_BOOKING_NOTE,
    });
    if (created.status !== 200 || !created.body?.success || !created.body?.data?.id) {
      throw new Error(`GUIDE fixture 顧客建立失敗 HTTP ${created.status}：${JSON.stringify(created.body)}`);
    }
    seededCustomerId = created.body.data.id;
    customer = { id: seededCustomerId };
  }

  let [service] = await sbSelect(
    'services', `select=id&tenant_id=eq.${tenantId}&active=is.true&limit=1`,
  );
  if (!service) {
    const created = await postApi(page, '/api/services', {
      name: SEED_BOOKING_NOTE, description: SEED_BOOKING_NOTE,
      durationMinutes: 15, price: 0,
    });
    if (created.status !== 200 || !created.body?.success || !created.body?.data?.id) {
      throw new Error(`GUIDE fixture 服務建立失敗 HTTP ${created.status}：${JSON.stringify(created.body)}`);
    }
    seededServiceId = created.body.data.id;
    service = { id: seededServiceId };
  }

  const created = await postApi(page, '/api/bookings', {
    customerId: customer.id,
    serviceId: service.id,
    // 遠期且未指定 staff：不和現有預約／團次搶時段，仍經 route 的真實寫入鏈路。
    startAt: '2099-12-31T08:00:00.000Z',
    note: SEED_BOOKING_NOTE,
  });
  if (created.status !== 200 || !created.body?.success || !created.body?.data?.id) {
    throw new Error(`GUIDE pending booking 建立失敗 HTTP ${created.status}：${JSON.stringify(created.body)}`);
  }
  seededBookingId = created.body.data.id;

  const persisted = await sbCount(
    'bookings', `id=eq.${seededBookingId}&tenant_id=eq.${tenantId}&status=eq.PENDING`,
  );
  if (persisted !== 1) {
    throw new Error(`GUIDE pending booking 未以 PENDING 寫入資料庫（id=${seededBookingId}，筆數=${persisted}）`);
  }
  console.log(`  種子：POST /api/bookings 建立 GUIDE PENDING 預約 ${seededBookingId}`);
}

async function cleanupSeedRow(table, id, label) {
  if (!id) return;
  const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const left = await sbCount(table, `id=eq.${id}`);
  console.log(`  種子清理：${label} DELETE HTTP ${res.status}；殘留 ${left}`);
  if (!res.ok || left !== 0) throw new Error(`${label} 清理失敗（HTTP ${res.status}、殘留 ${left}）`);
}

/** 刪掉所有種子並**驗證真的沒了**（殘留就失敗，不要默默收工） */
async function cleanupSeed() {
  if (seededBookingId) {
    await cleanupSeedRow('bookings', seededBookingId, `GUIDE PENDING booking ${seededBookingId}`);
    seededBookingId = null;
  }
  if (seededServiceId) {
    await cleanupSeedRow('services', seededServiceId, `GUIDE fixture service ${seededServiceId}`);
    seededServiceId = null;
  }
  if (seededCustomerId) {
    await cleanupSeedRow('customers', seededCustomerId, `GUIDE fixture customer ${seededCustomerId}`);
    seededCustomerId = null;
  }
  if (seededOrderId) {
    await cleanupSeedRow('product_orders', seededOrderId, `PENDING 商品訂單 ${SEED_ORDER_NO}`);
  }
  seededOrderId = null;
}

/** 側邊欄未讀徽章的期望值：followed=true 的 line_user 底下、direction=IN 且未讀的訊息數 */
async function expectedUnread(tenantId) {
  const users = await sbSelect(
    'line_users',
    `select=line_user_id&tenant_id=eq.${tenantId}&followed=is.true`,
  );
  if (users.length === 0) return 0;
  const rows = await sbSelect(
    'chat_messages',
    `select=line_user_id&tenant_id=eq.${tenantId}&direction=eq.IN&read_at=is.null&limit=1000`,
  );
  const followed = new Set(users.map((u) => u.line_user_id));
  return rows.filter((r) => followed.has(r.line_user_id)).length;
}

/** 開店進度的期望值：照 /api/settings/setup-status 的五條規則自己算一次 */
async function expectedSetupPercent(tenantId) {
  const [tenant] = await sbSelect('tenants', `select=business_type&id=eq.${tenantId}`);
  const catalogTable = tenant?.business_type === 'GUIDE' ? 'trips' : 'services';
  const settingsRows = await sbSelect(
    'tenant_settings',
    `select=basic,business,line_channel_access_token_enc&tenant_id=eq.${tenantId}`,
  );
  const s = settingsRows[0] || {};
  const basic = s.basic || {};
  const business = s.business || {};
  const staffCount = await sbCount('staff', `tenant_id=eq.${tenantId}`);
  const catalogCount = await sbCount(catalogTable, `tenant_id=eq.${tenantId}`);
  const steps = [
    Boolean(basic.tenantPhone || basic.tenantAddress),
    staffCount > 0,
    catalogCount > 0,
    Object.keys(business).length > 0,
    Boolean(s.line_channel_access_token_enc),
  ];
  return {
    percent: Math.round((steps.filter(Boolean).length / 5) * 100),
    detail: `SHOP_INFO=${steps[0]} STAFF=${steps[1]}(${staffCount}) `
      + `${catalogTable.toUpperCase()}=${steps[2]}(${catalogCount}) `
      + `BUSINESS_HOURS=${steps[3]} LINE_BOT=${steps[4]}`,
  };
}

/* ------------------------------------------------------------------ 畫面讀值 */

/** 等到徽章不再是「查詢中」占位 */
async function waitBadgesResolved(page) {
  await page.locator('[role="status"]').first().waitFor({ state: 'detached', timeout: 30000 })
    .catch(() => {});
}

/**
 * 讀某個側邊欄連結上的徽章數字。
 *   回字串 → 畫面宣稱了這個數字
 *   回 null → 沒有徽章（＝畫面沒有宣稱任何數字）
 *   回 undefined → 這個業態的選單裡根本沒有這一項
 * ⚠️「查詢中」占位也帶 .badge-count（沿用同一顆膠囊的樣式），用 role=status 排除。
 */
async function readBadge(page, href) {
  const link = page.locator(`#sidebar a[href="${href}"]`).first();
  const visible = await link.waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true).catch(() => false);
  if (!visible) return undefined;
  const badge = link.locator('.badge-count:not([role="status"])');
  if (await badge.count() === 0) return null;
  return (await badge.first().innerText()).trim();
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

/* ---------------------------------------------------------------------- main */

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

  console.log(`受測站台：${BASE}\n資料庫：${SB_URL}\n`);

  /* ---------------------------------------------------------------- 登入 */
  await page.goto(`${BASE}/tenant/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/tenant\/(dashboard|$)/, { timeout: 60000 });
  check('登入成功', true, page.url());

  /* -------------------------------------------- 目前操作的店家（GET /api/auth/me） */
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    return r.json();
  });
  const tenantId = me?.data?.tenantId;
  if (!tenantId) throw new Error(`/api/auth/me 沒有回 tenantId：${JSON.stringify(me)}`);
  console.log(`  目前店家：${me.data.tenantName}（${tenantId}）\n`);

  if (SEED_ORDER) await seedPendingOrder(tenantId);
  if (SEED_GUIDE_BOOKING) await seedGuidePendingBooking(page, tenantId);

  /* ------------------------------------------------ ① 載入中不得先顯示 0 */
  await page.route('**/api/bookings**', async (route) => {
    await new Promise((r) => setTimeout(r, BADGE_DELAY_MS));
    /*
     * 延遲期間頁面可能已經導走，此時該 route 已被 Playwright 自行處理，
     * 再 continue() 會丟 "Route is already handled!" 並炸掉整支腳本。
     * 那是本腳本的競態，不是受測站台的行為——吞掉即可（斷言不受影響）。
     */
    await route.continue().catch(() => {});
  });
  await page.goto(`${BASE}/tenant/bookings`, { waitUntil: 'domcontentloaded' });
  const placeholderVisible = await page.locator('[role="status"]').first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  const numericWhileLoading = await page
    .locator('#sidebar .badge-count:not([role="status"])').count();
  check(
    '① 徽章還在查的時候放「查詢中」占位，畫面上沒有任何徽章數字',
    placeholderVisible && numericWhileLoading === 0,
    `占位可見=${placeholderVisible}、查詢期間的數字徽章數=${numericWhileLoading}`,
  );
  await shot(page, 'shell-01-badges-loading');
  await page.unroute('**/api/bookings**');

  /* ---------------------------------------------- ② 徽章數字 vs DB 實際筆數 */
  const expectedBooking = await sbCount(
    'bookings', `tenant_id=eq.${tenantId}&status=eq.PENDING`,
  );
  const expectedOrder = await sbCount(
    'product_orders', `tenant_id=eq.${tenantId}&status=eq.PENDING`,
  );
  const expectedChat = await expectedUnread(tenantId);

  /*
   * GUIDE 的 pending booking 不可沿用「DB 是 0 就不畫」那條分支，也不可因為
   * 沒資料而 SKIP。先等 AppShell 真正收到它賴以計數的 API 回應，再比 API 信封、
   * service-role DB 精確筆數與畫面上的 badge；沒有用 sleep 或猜 React 已經 render。
   */
  if (SEED_GUIDE_BOOKING) {
    const pendingBookingsResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET'
        && url.pathname === '/api/bookings'
        && url.searchParams.get('status') === 'PENDING'
        && url.searchParams.get('size') === '1'
        && response.status() === 200;
    }, { timeout: 30000 });
    await page.goto(`${BASE}/tenant/bookings`, { waitUntil: 'domcontentloaded' });
    const pendingPayload = await (await pendingBookingsResponse).json();
    const apiPendingTotal = pendingPayload?.data?.totalElements;
    if (!Number.isInteger(apiPendingTotal)) {
      throw new Error(`GET /api/bookings 的 pending totalElements 不合法：${JSON.stringify(pendingPayload)}`);
    }
    await waitBadgesResolved(page);
    const shown = await readBadge(page, '/tenant/bookings');
    check(
      '② GUIDE 受控 PENDING 預約：API totalElements、DB 精確筆數與側邊欄徽章一致',
      apiPendingTotal === expectedBooking && shown === String(apiPendingTotal),
      `API=${apiPendingTotal}、DB=${expectedBooking}、畫面=${shown ?? '（無）'}、seed=${seededBookingId}`,
    );
    await shot(page, 'shell-02-guide-pending-booking');
  }

  const targets = [
    ['待確認預約', '/tenant/bookings', expectedBooking],
    ['待處理商品訂單', '/tenant/product-orders', expectedOrder],
    ['未讀顧客訊息', '/tenant/chat', expectedChat],
  ];

  for (const [label, href, expected] of targets) {
    // 每個徽章所屬的手風琴群組只有「當前頁在裡面」時才展開，所以逐頁走一趟
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    await waitBadgesResolved(page);
    const shown = await readBadge(page, href);
    if (shown === undefined) {
      console.log(`  [SKIP] ② ${label}：這個業態的選單沒有 ${href}（DB 直查為 ${expected}）`);
      continue;
    }
    // 徽章只有 >0 才畫：DB 是 0 時畫面上不該有徽章（null 才是對的）
    const ok = expected === 0 ? shown === null : shown === String(expected);
    check(
      `② ${label}：畫面 ${shown === null ? '（無徽章）' : shown} vs DB 直查 ${expected}`,
      ok,
      expected === 0 ? 'DB 為 0 → 畫面不應出現徽章' : `href=${href}`,
    );
    await shot(page, `shell-02-${href.split('/').pop()}`);
  }

  /* ------------------------- ②b 旅遊訂單：沒有資料來源就不准出現任何數字 */
  await page.goto(`${BASE}/tenant/tour-orders`, { waitUntil: 'domcontentloaded' });
  await waitBadgesResolved(page);
  const tourBadge = await readBadge(page, '/tenant/tour-orders');
  if (tourBadge === undefined) {
    console.log('  [SKIP] ②b 這個業態的選單沒有旅遊訂單');
  } else {
    check(
      '②b 旅遊訂單徽章：tour_orders 表與端點都還不存在（Phase 8b／#8）→ 不得顯示任何數字',
      tourBadge === null,
      `畫面上的徽章＝${tourBadge === null ? '（無）' : tourBadge}；`
        + 'mock 常數在嚮導模式下是 1，若看到 1 就是又吃回假資料了',
    );
    await shot(page, 'shell-02b-tour-orders');
  }

  /* -------------------------------------------- ③ 開店進度 vs DB 自算百分比 */
  await page.goto(`${BASE}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
  await waitBadgesResolved(page);
  /*
   * 設定進度是另一支 fetch（/api/settings/setup-status），比徽章慢。
   * 還在查的時候 Topbar 顯示的是「-- 設定進度 尚未取得」（未知態，issue #34 要的
   * 就是這個），此時去讀等於量到載入中的畫面。等它離開未知態再讀——
   * **只等它從「還不知道」變成「知道了」，不等它變成某個期望值**，
   * 逾時就照樣往下斷言，讓紅燈是真的紅燈。
   */
  await page.locator('header.topbar')
    .filter({ hasNot: page.locator('text=尚未取得') })
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => {});
  const setup = await expectedSetupPercent(tenantId);
  const topbarText = (await page.locator('header.topbar').innerText()).replace(/\s+/g, ' ');
  const shownPercent = (topbarText.match(/(\d+)%/) || [])[1];
  const setupOk = setup.percent === 100
    ? shownPercent === undefined
    : shownPercent === String(setup.percent);
  check(
    `③ 開店進度：畫面 ${shownPercent ? `${shownPercent}%` : '（100% 時整塊收起）'} `
      + `vs DB 自算 ${setup.percent}%`,
    setupOk,
    setup.detail,
  );
  check(
    '③b 開店進度不再是寫死的 60%／80%／100%（除非 DB 真的算出同一個值）',
    setupOk,
    `mock 常數為 60/80/100，本次 DB 自算 ${setup.percent}%`,
  );

  /* -------------------------------------------- ④ 使用者名稱 vs /api/auth/me */
  const userMenuText = topbarText;
  check(
    '④ 使用者名稱＝登入帳號（GET /api/auth/me 的 email），不是 MOCK_USER.name「小威」',
    userMenuText.includes(EMAIL) && !userMenuText.includes('小威'),
    `topbar 文字：${topbarText.slice(0, 160)}`,
  );
  await shot(page, 'shell-03-topbar');

  /* --------------------------------------------------------------- 收尾 */
  await browser.close();
  await cleanupSeed();

  console.log('\n—— 逐項比對 ——');
  console.log(`  待確認預約   畫面 vs DB：${expectedBooking}`);
  console.log(`  商品訂單     畫面 vs DB：${expectedOrder}`);
  console.log(`  未讀訊息     畫面 vs DB：${expectedChat}`);
  console.log(`  開店進度     DB 自算：${setup.percent}%（${setup.detail}）`);

  const failed = results.filter((r) => !r.passed);
  console.log(`\n結果：${results.length - failed.length}/${results.length} 通過`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.label}`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(e);
  // 半路炸掉也要把種子訂單刪掉——它躺在店家真實的資料庫裡
  await cleanupSeed().catch((err) => console.error('  種子清理也失敗了：', err.message));
  process.exit(1);
});
