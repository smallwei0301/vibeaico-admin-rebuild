#!/usr/bin/env node
// scripts/verify/page-local-fields.35.cjs
//
// Issue #35 acceptance box「Authenticated Preview values vs. TEST service-role
// DB verification」— 最後一顆勾選框。
//
// PR #93 把三個頁面（membership-levels / coupons / customers）原本寫死在頁面
// 檔內、依 business mode 分流的假 EXTRAS 常數，換成真的欄位鏈路
// （membership_levels.description/active/is_default、coupons.min_order_amount/
// max_discount_amount/gift_item/limit_per_customer/private_mode、
// customers 未指定等級時解析為租戶啟用中的預設等級 —— Y.5 contract）。
// tests/integration/api/page-local-fields.35.test.ts 已經對「HTTP API 回傳值
// 是否等於 DB 值」做了完整覆蓋；本腳本要補的是最後一段沒人測過的鏈路：
// 「真的登入一個跑在真實 build（NEXT_PUBLIC_USE_MOCK=false）上的環境後，
// 畫面上實際渲染出來的字」是否等於「service-role 對 TEST DB 的獨立查詢」，
// 而不是等於我們送出去的 payload（送出去的 payload 只證明 API 誠實，不證明
// 頁面渲染誠實 —— 兩者是不同的鏈路，見 PR #93 diff：頁面 toRow() 讀 API 回傳值
// 渲染，這條路徑在整合測試裡完全沒被摸到）。
//
// 沿用 #34（scripts/verify/appshell-shell-values.34.cjs）證明有效的技法：
// 真實登入、page.on('response') 記錄依賴端點「第一次」200 回應時間、對這份
// 紀錄做輪詢等待（deterministic，不對時鐘瞎猜）、[PASS]/[FAIL]/[SKIP] 逐項印出、
// 任何 FAIL 都讓 process 以非 0 結束。
//
// 與 #34 的一個關鍵差異：#34 的腳本純讀（唯讀 service-role 查詢）。本腳本的
// 「顧客未指定等級時解析為 active default」與「反核銷後回退到較舊已核銷代碼」
// 兩項驗收，沒有既有 DB 狀態可以直接讀（seed.mjs 完全不建立 membership_levels /
// coupons 資料列，tests/fixtures.ts 裡也沒有這兩張表的固定 id）——要驗這兩條
// 行為，必須先有「已知的 before 狀態」。因此本腳本仿照
// tests/integration/api/page-local-fields.35.test.ts 已經審過、合併過的作法：
// 用真實登入 session 呼叫真實的寫入端點，建立幾筆帶執行期唯一 tag 的 fixture
// 資料列（等級／票券／票券實例／顧客），操作完在 finally 區塊全部刪除。
//
// ⚠️ 安全注意（寫入 side effect）：新增一個 active + isDefault 的會員等級會
// 觸發 /api/membership-levels 既有的 recalcMemberships()，把該租戶「目前沒有
// 門檻命中」的顧客（含既有真實顧客）暫時重新指向這個新等級；等腳本在 finally
// 刪除這個等級列時，membership_level_id 的 FK 是 `on delete set null`
// （見 supabase/migrations/0004_core_business_tables.sql），會自動把這些顧客
// 打回 null —— 淨效果等於沒發生過，與 tests/integration/api/page-local-fields.35.test.ts
// 既有案例（thresholdSpent: 999999）採用的是同一個已審過的模式。仍然要求本腳本
// 只能在「本租戶目前沒有其他人在寫」的序列化 TEST 時段執行（同 CLAUDE.md
// 「integration/E2E 共用一個 TEST，不得併發」的既有規則），不得與其他 TEST
// 佔用者同時跑。
//
// 用法：
//   VERIFY_BASE_URL=http://localhost:3100 node scripts/verify/page-local-fields.35.cjs
//
// 前置：
//   - 目標站台是真的用 TEST Supabase 起的 build（NEXT_PUBLIC_USE_MOCK=false）。
//   - .env.test 存在：TEST_SUPABASE_URL、TEST_SUPABASE_SERVICE_ROLE_KEY。
//
// 安全：對 TEST 專案的寫入僅限本腳本自建、跑完即刪的 fixture 資料列（皆帶
// RUN_TAG，唯一識別，不覆蓋任何既有列）；絕不印出金鑰或密碼值；拒絕對正式
// 專案主機名稱執行任何動作。

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.resolve(__dirname, 'out');
const PRODUCTION_SUPABASE_HOSTNAME = 'egehnijjpgijmccagxac.supabase.co';

const BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:3100';

// SHOP_A / tenant-a（tests/fixtures.ts）— LOCAL_SHOP，owner-a 有 OWNER 角色，
// 滿足 membership-levels / coupons 端點要求的 MANAGER 權限下限。
const SHOP_A = {
  id: 'a1000000-0000-4000-8000-000000000001',
  shopCode: 'tenant-a',
  customerA1: 'a1000000-0000-4000-8000-000000000031',
  owner: {
    email: process.env.VERIFY_OWNER_EMAIL || 'owner-a@test.local',
    password: process.env.VERIFY_OWNER_PASSWORD || 'Passw0rd!a',
  },
};

// 執行期唯一 tag：避免與其他跑過的資料衝突，也讓 DOM locator 可以用「這串文字
// 只會出現在這次跑出來的列」精準命中，不必依賴不存在的 data-testid。
const RUN_TAG = `v35-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

// PR #93 拿掉的「頁面本地假 EXTRAS 常數」（LOCAL_SHOP 分支——SHOP_A 就是
// LOCAL_SHOP，見 git diff origin/main...HEAD src/app/tenant/membership-levels/page.tsx
// 與 src/app/tenant/coupons/page.tsx 裡刪掉的 LEVEL_EXTRAS_LOCAL_SHOP /
// COUPON_EXTRAS_LOCAL_SHOP）。硬鎖：畫面不得再吐出這些值，除非 DB 剛好也是
// 這個值（不可能——我們送進去的都是帶 RUN_TAG 的唯一字串）。
const REMOVED_MOCK_LEVEL_DESCRIPTIONS = [
  '所有新顧客的預設等級',
  '生日當月贈送護髮體驗一次',
  '專屬設計師優先排程、免費造型諮詢',
];
const REMOVED_MOCK_COUPON_CODES = ['NEW8FOLD', 'CARE200', 'BDAYFRINGE'];
const REMOVED_MOCK_GIFT_ITEM = '免費瀏海修剪';

const results = [];
function record(status, label, detail) {
  const line = `[${status}] ${label}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ status, label, detail });
  if (status === 'FAIL') process.exitCode = 1;
}

function loadTestEnv() {
  if (process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) return;
  const envTestPath = path.resolve(REPO_ROOT, '.env.test');
  if (!fs.existsSync(envTestPath)) {
    console.error(
      `[verify-35] 找不到 .env.test（預期路徑：${envTestPath}），且環境變數也未注入 ` +
        'TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY。',
    );
    process.exit(1);
  }
  process.loadEnvFile(envTestPath);
}

function assertSafeTestUrl() {
  const rawUrl = process.env.TEST_SUPABASE_URL;
  if (!rawUrl) {
    console.error('[verify-35] 安全鎖：TEST_SUPABASE_URL 未設定，拒絕執行。');
    process.exit(1);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(`[verify-35] 安全鎖：TEST_SUPABASE_URL 不是合法 URL（"${rawUrl}"）。`);
    process.exit(1);
  }
  if (parsed.hostname === PRODUCTION_SUPABASE_HOSTNAME) {
    console.error('[verify-35] 安全鎖：TEST_SUPABASE_URL 指向正式專案，拒絕執行。');
    process.exit(1);
  }
  return rawUrl;
}

function createTestAdminClient() {
  const url = process.env.TEST_SUPABASE_URL;
  const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('[verify-35] 安全鎖：TEST_SUPABASE_SERVICE_ROLE_KEY 未設定，拒絕執行。');
    process.exit(1);
  }
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

const fmtCurrency = (n) => `NT$${Math.round(n).toLocaleString('zh-TW')}`;
const fmtNumber = (n) => n.toLocaleString('zh-TW');

async function main() {
  loadTestEnv();
  const testUrl = assertSafeTestUrl();
  const admin = createTestAdminClient();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[verify-35] 目標站台：${BASE_URL}`);
  console.log(`[verify-35] TEST Supabase host：${new URL(testUrl).hostname}`);
  console.log(`[verify-35] 受測租戶：${SHOP_A.shopCode}（${SHOP_A.id}）owner=${SHOP_A.owner.email}`);
  console.log(`[verify-35] RUN_TAG：${RUN_TAG}`);

  const launchOptions = {};
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath && fs.existsSync(path.join(browsersPath, 'chromium'))) {
    launchOptions.executablePath = path.join(browsersPath, 'chromium');
  }
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });

  // ---- 追蹤各頁依賴的端點是否已回應（deterministic 等待，同 #34 教訓：不用
  // 固定 sleep 猜對 TEST Supabase 的認證＋查詢來回要多久）。
  const apiSeenCounts = new Map(); // key -> array of {t, status, url}
  page.on('response', (res) => {
    const u = res.url();
    const method = res.request().method();
    const rec = { t: Date.now(), status: res.status(), url: u, method };
    for (const key of Object.keys(API_MARKERS)) {
      if (API_MARKERS[key](u, method)) {
        const list = apiSeenCounts.get(key) ?? [];
        list.push(rec);
        apiSeenCounts.set(key, list);
      }
    }
  });
  // 只認頁面自己觸發的 GET（排除本腳本自己用 page.request.post() 打的寫入
  // 端點，否則設定階段的 POST 回應會提前把計數灌滿，讓後面針對「頁面導航後
  // 真的重新 fetch 過一次」的等待失去意義）。
  const API_MARKERS = {
    membershipLevelsGet: (u, m) => m === 'GET' && u.includes('/api/membership-levels') && !/\/api\/membership-levels\/[^/?]+/.test(u),
    couponsGet: (u, m) => m === 'GET' && (u.endsWith('/api/coupons') || u.includes('/api/coupons?')),
    customersGet: (u, m) => m === 'GET' && (u.includes('/api/customers?') || u.endsWith('/api/customers')),
  };

  /** 目前已看過的「200」回應數（給呼叫端在觸發動作前先拍一個 baseline）。 */
  function countOf(key) {
    return (apiSeenCounts.get(key) ?? []).filter((r) => r.status === 200).length;
  }

  /** 等到 key 至少有 count 筆「200」回應（或逾時）。回傳是否達成。
   * ⚠️ count 必須是絕對數字，不是「多幾筆」——同一個 key 在腳本裡可能被
   * 多次頁面導航重複觸發（例如 coupons 頁被造訪兩次），呼叫端在第二次導航前
   * 要用 countOf() 先拍 baseline，再等 baseline + N，不能重新從 1 開始等，
   * 否則會被前一次導航留下的計數騙過，變成沒有真的等到「這一次」的回應。 */
  async function waitForResponseCount(key, count, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const list = (apiSeenCounts.get(key) ?? []).filter((r) => r.status === 200);
      if (list.length >= count) return true;
      await page.waitForTimeout(100);
    }
    return false;
  }

  // 追蹤跨頁重複使用的 fixture id，讓最外層 finally 一定能清乾淨。
  const created = {
    levelIds: [],
    couponIds: [],
    couponInstanceIds: [],
    customerIds: [],
  };
  // 若租戶原本就有一個 active default 等級，我們的新 default 會透過既有 trigger
  // 把它擠掉（見 0015 migration 的 set_membership_level_default）；跑完要還原。
  let preexistingDefaultLevelId = null;

  try {
    // ================================================================
    // 0) 真實登入
    // ================================================================
    await page.goto(`${BASE_URL}/tenant/login`, { waitUntil: 'networkidle' });
    await page.fill('#username', SHOP_A.owner.email);
    await page.fill('#password', SHOP_A.owner.password);
    try {
      await Promise.all([
        page.waitForURL('**/tenant/dashboard**', { timeout: 15_000 }),
        page.click('button[type="submit"]'),
      ]);
      record('PASS', '真實登入端點回登入成功並導向 /tenant/dashboard', '');
    } catch (e) {
      record('FAIL', '真實登入端點回登入成功並導向 /tenant/dashboard', String(e?.message ?? e));
      await page.screenshot({ path: path.join(OUT_DIR, '35-login-failure.png'), fullPage: true }).catch(() => {});
      return; // finally 仍會跑；沒有 fixture 需要清
    }

    // 共用：用登入後的瀏覽器 session（cookie 已在 context 內）直接打真實
    // 寫入端點，等同「已登入使用者用這個 UI 會打的同一組後端」，不是繞過應用層
    // 直查 DB。回傳值只用來取得 id；「畫面顯示的值」永遠另外從 DOM 讀、
    // 「期望值」永遠另外從 service-role 查，三條路徑互相獨立。
    const api = {
      post: (p, body) => page.request.post(`${BASE_URL}${p}`, {
        data: body, headers: { 'Content-Type': 'application/json' },
      }),
    };

    // ================================================================
    // 1) 前置：snapshot 既有 active default 等級（若存在），跑完要還原
    // ================================================================
    {
      const { data, error } = await admin
        .from('membership_levels')
        .select('id')
        .eq('tenant_id', SHOP_A.id).eq('active', true).eq('is_default', true)
        .maybeSingle();
      if (error) throw error;
      preexistingDefaultLevelId = data?.id ?? null;
      record(
        'PASS',
        'DB 直查：記錄跑腳本前既有的 active default 等級（跑完要還原）',
        preexistingDefaultLevelId ? `id=${preexistingDefaultLevelId}` : '目前沒有',
      );
    }

    // ================================================================
    // 2) 建立 3 個 membership-levels fixture（門檻都設得極高，避免影響其他
    //    顧客的門檻命中；只有 default fallback 邏輯會生效，且與既有整合測試
    //    採同一個已審過的門檻值 999999 同一量級）。
    // ================================================================
    // ⚠️ 命名刻意避開「預設／非預設／啟用／停用」這幾個字：下面畫面比對會用
    // 這些字當「徽章有沒有出現」的判斷依據，如果連 fixture 的名字本身都含有
    // 這些字，會把「名字裡本來就有這幾個字」誤判成「有徽章」（例如
    // 「非預設」這個名字本身就包含「預設」兩字的子字串）。徽章判斷另外還會
    // 用 CSS class 精準定位，這裡只是雙重保險，不依賴其中一種手段。
    const levelDefault = {
      name: `#35Lvl-A-${RUN_TAG}`, description: `desc-active-default-${RUN_TAG}`,
      thresholdSpent: 999999, active: true, isDefault: true,
    };
    const levelOther = {
      name: `#35Lvl-B-${RUN_TAG}`, description: `desc-active-other-${RUN_TAG}`,
      thresholdSpent: 999999001, active: true, isDefault: false,
    };
    const levelInactive = {
      name: `#35Lvl-C-${RUN_TAG}`, description: `desc-inactive-${RUN_TAG}`,
      thresholdSpent: 999999002, active: false, isDefault: false,
    };
    const levelSpecs = [levelDefault, levelOther, levelInactive];
    const levelIdByTag = {};
    for (const spec of levelSpecs) {
      const res = await api.post('/api/membership-levels', spec);
      if (res.status() !== 200) {
        record('FAIL', `建立會員等級 fixture「${spec.name}」`, `HTTP ${res.status()}：${await res.text()}`);
        continue;
      }
      const body = await res.json();
      if (!body?.success || !body?.data?.id) {
        record('FAIL', `建立會員等級 fixture「${spec.name}」`, `回應不含 id：${JSON.stringify(body)}`);
        continue;
      }
      levelIdByTag[spec.name] = body.data.id;
      created.levelIds.push(body.data.id);
    }
    if (created.levelIds.length === levelSpecs.length) {
      record('PASS', '建立 3 個會員等級 fixture（啟用預設／啟用非預設／停用）', created.levelIds.join(', '));
    }

    // ================================================================
    // 3) 顧客未指定等級 → 解析為 active default（issue #35 Y.5 contract）
    // ================================================================
    let fallbackCustomerId = null;
    if (levelIdByTag[levelDefault.name]) {
      const custPayload = { name: `#35驗證顧客-${RUN_TAG}`, phone: `09${RUN_TAG.slice(-8).replace(/\D/g, '1')}` };
      const res = await api.post('/api/customers', custPayload);
      if (res.status() === 200) {
        const body = await res.json();
        fallbackCustomerId = body?.data?.id ?? null;
        if (fallbackCustomerId) created.customerIds.push(fallbackCustomerId);
      }
      if (!fallbackCustomerId) {
        record('FAIL', '建立「未指定等級」顧客 fixture', `HTTP ${res.status()}：${await res.text().catch(() => '')}`);
      } else {
        // 獨立查詢：DB 實際指派的等級
        const { data: custRow, error: custErr } = await admin
          .from('customers').select('membership_level_id').eq('id', fallbackCustomerId).single();
        if (custErr) throw custErr;
        const dbResolvedLevelId = custRow?.membership_level_id ?? null;
        const expectedDefaultId = levelIdByTag[levelDefault.name];
        record(
          dbResolvedLevelId === expectedDefaultId ? 'PASS' : 'FAIL',
          'DB 直查：未指定等級的新顧客被解析為租戶 active default（POST /api/customers 契約）',
          `顧客 membership_level_id=${dbResolvedLevelId} vs 預期的 active default=${expectedDefaultId}`,
        );

        // 畫面：/tenant/customers 搜尋這位顧客，讀取等級徽章文字，與 DB 的
        // 等級名稱（獨立查詢，不是我們送出去的 payload）比對。
        await page.goto(`${BASE_URL}/tenant/customers`, { waitUntil: 'networkidle' });
        const gotCustomers = await waitForResponseCount('customersGet', 1, 15_000);
        if (!gotCustomers) {
          record('FAIL', '/tenant/customers 依賴的 GET /api/customers 在 15 秒內回應', '逾時 —— 後端/網路沒回應');
        }
        // customers 頁搜尋框沒有 type=search（那是 coupons 頁才有），用固定的
        // placeholder 文案（src/i18n/zh-TW/pages/customers.ts search.placeholder）定位。
        const inputLocator = page.getByPlaceholder('輸入姓名或電話搜尋...');
        await inputLocator.fill(custPayload.name);
        await inputLocator.press('Enter');
        await waitForResponseCount('customersGet', 2, 15_000);
        await page.waitForTimeout(200);

        const custRowLocator = page.locator('table.data-table tbody tr', { hasText: custPayload.name });
        let screenLevelName = null;
        try {
          await custRowLocator.first().waitFor({ state: 'visible', timeout: 5000 });
          const badge = custRowLocator.first().locator('.badge-purple');
          screenLevelName = (await badge.count()) ? (await badge.first().textContent())?.trim() : null;
        } catch (e) {
          record('FAIL', '畫面讀取顧客列表中的會員等級徽章', String(e?.message ?? e));
        }

        const { data: levelRow, error: levelErr } = await admin
          .from('membership_levels').select('name').eq('id', expectedDefaultId).single();
        if (levelErr) throw levelErr;
        const dbLevelName = levelRow?.name ?? null;

        if (screenLevelName === null) {
          record('FAIL', '顧客列表畫面顯示的會員等級名稱與 DB 解析出的 active default 名稱相符', '畫面沒有渲染任何等級徽章');
        } else {
          record(
            screenLevelName === dbLevelName ? 'PASS' : 'FAIL',
            '顧客列表畫面顯示的會員等級名稱與 DB 解析出的 active default 名稱相符',
            `畫面「${screenLevelName}」 vs DB「${dbLevelName}」`,
          );
        }
      }
    } else {
      record('SKIP', '顧客未指定等級解析為 active default', '前一步驟未能建立 active default 等級 fixture，缺少可驗證的 before 狀態');
    }

    // ================================================================
    // 4) membership-levels 頁：畫面渲染的每一列與 DB 獨立查詢逐欄相符
    // ================================================================
    await page.goto(`${BASE_URL}/tenant/membership-levels`, { waitUntil: 'networkidle' });
    const gotLevels = await waitForResponseCount('membershipLevelsGet', 1, 15_000);
    if (!gotLevels) {
      record('FAIL', '/tenant/membership-levels 依賴的 GET /api/membership-levels 在 15 秒內回應', '逾時 —— 後端/網路沒回應');
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, '35-membership-levels.png'), fullPage: true }).catch(() => {});

    if (created.levelIds.length > 0) {
      const { data: dbLevels, error: dbLevelsErr } = await admin
        .from('membership_levels')
        .select('id, name, description, active, is_default, threshold_spent')
        .in('id', created.levelIds);
      if (dbLevelsErr) throw dbLevelsErr;
      const dbById = new Map((dbLevels ?? []).map((r) => [r.id, r]));

      for (const [name, id] of Object.entries(levelIdByTag)) {
        const dbRow = dbById.get(id);
        if (!dbRow) {
          record('FAIL', `DB 直查：等級「${name}」存在`, `找不到 id=${id}`);
          continue;
        }
        const rowLocator = page.locator('table.data-table tbody tr', { hasText: name });
        let rowText = null;
        try {
          await rowLocator.first().waitFor({ state: 'visible', timeout: 5000 });
          rowText = (await rowLocator.first().textContent()) ?? '';
        } catch (e) {
          record('FAIL', `畫面讀取等級列「${name}」`, String(e?.message ?? e));
          continue;
        }

        const descOk = dbRow.description ? rowText.includes(dbRow.description) : true;
        record(
          descOk ? 'PASS' : 'FAIL',
          `等級「${name}」：畫面說明文字與 DB description 相符`,
          `DB description="${dbRow.description}"，畫面是否含有此字串=${descOk}`,
        );

        const thresholdText = fmtCurrency(Number(dbRow.threshold_spent));
        const thresholdOk = rowText.includes(thresholdText);
        record(
          thresholdOk ? 'PASS' : 'FAIL',
          `等級「${name}」：畫面門檻金額與 DB threshold_spent 相符`,
          `DB=${thresholdText}，畫面是否含有此字串=${thresholdOk}`,
        );

        // 用 Badge 的 CSS class 精準定位（tone=success/neutral/primary），不
        // 用整列文字子字串比對 —— fixture 名字本身可能剛好含有「啟用」「停用」
        // 「預設」這幾個字（即使上面已經刻意避開了，這裡仍用精準定位當雙重
        // 保險，不依賴命名紀律）。
        const activeBadgeCount = await rowLocator.first().locator('.badge-success').count();
        const inactiveBadgeCount = await rowLocator.first().locator('.badge-neutral').count();
        const activeOk = dbRow.active ? activeBadgeCount > 0 : inactiveBadgeCount > 0;
        record(
          activeOk ? 'PASS' : 'FAIL',
          `等級「${name}」：畫面啟用/停用徽章與 DB active 相符`,
          `DB active=${dbRow.active}，畫面啟用徽章數=${activeBadgeCount}，停用徽章數=${inactiveBadgeCount}`,
        );

        const defaultBadgeCount = await rowLocator.first().locator('.badge-primary').count();
        const hasDefaultBadge = defaultBadgeCount > 0;
        const defaultOk = hasDefaultBadge === Boolean(dbRow.is_default);
        record(
          defaultOk ? 'PASS' : 'FAIL',
          `等級「${name}」：畫面是否顯示「預設」徽章與 DB is_default 相符`,
          `DB is_default=${dbRow.is_default}，畫面預設徽章數=${defaultBadgeCount}`,
        );

        // 硬鎖：不得是 PR #93 刪掉的 LOCAL_SHOP 頁面本地假說明文字（除非 DB
        // 剛好也是這個值 —— 不可能，因為我們送進去的說明文字都帶 RUN_TAG）。
        const leaked = REMOVED_MOCK_LEVEL_DESCRIPTIONS.find((s) => rowText.includes(s) && dbRow.description !== s);
        record(
          leaked ? 'FAIL' : 'PASS',
          `等級「${name}」：畫面說明文字不是刪掉的 mock 常數（LOCAL_SHOP EXTRAS）`,
          leaked ? `畫面含有已刪除的假常數「${leaked}」，但 DB description 是「${dbRow.description}」` : '未偵測到殘留',
        );
      }

      // 專項：is_default=true AND active=true 的那一列，必須恰好是 levelDefault，
      // 且畫面上只有它顯示「預設」徽章。
      const activeDefaultId = [...dbById.values()].find((r) => r.is_default && r.active)?.id ?? null;
      record(
        activeDefaultId === levelIdByTag[levelDefault.name] ? 'PASS' : 'FAIL',
        'DB 直查：is_default=true AND active=true 的那一列就是本次建立的「啟用預設」等級',
        `DB 算出的 active default id=${activeDefaultId} vs 預期=${levelIdByTag[levelDefault.name]}`,
      );
    } else {
      record('SKIP', 'membership-levels 頁畫面逐列比對 DB', '前一步驟未能建立任何等級 fixture，沒有已知列可比對');
    }

    // ================================================================
    // 5) coupons 頁：畫面渲染欄位 vs DB（min_order_amount / max_discount_amount
    //    / gift_item / limit_per_customer / private_mode）
    // ================================================================
    const couponAmount = {
      name: `#35驗證券-金額-${RUN_TAG}`, discountType: 'AMOUNT', discountValue: 100,
      minOrderAmount: 1500, maxDiscountAmount: null, giftItem: '', limitPerCustomer: 2, privateMode: true,
    };
    const couponPercent = {
      name: `#35驗證券-百分比-${RUN_TAG}`, discountType: 'PERCENT', discountValue: 10,
      minOrderAmount: null, maxDiscountAmount: 800, giftItem: '', limitPerCustomer: null, privateMode: false,
    };
    const couponGift = {
      name: `#35驗證券-贈品-${RUN_TAG}`, discountType: 'GIFT', discountValue: 0,
      minOrderAmount: null, maxDiscountAmount: null, giftItem: `限量手作胸章-${RUN_TAG}`,
      limitPerCustomer: null, privateMode: false,
    };
    const couponIdByName = {};
    for (const spec of [couponAmount, couponPercent, couponGift]) {
      const res = await api.post('/api/coupons', spec);
      if (res.status() !== 200) {
        record('FAIL', `建立票券 fixture「${spec.name}」`, `HTTP ${res.status()}：${await res.text()}`);
        continue;
      }
      const body = await res.json();
      if (!body?.success || !body?.data?.id) {
        record('FAIL', `建立票券 fixture「${spec.name}」`, `回應不含 id：${JSON.stringify(body)}`);
        continue;
      }
      couponIdByName[spec.name] = body.data.id;
      created.couponIds.push(body.data.id);
    }
    if (created.couponIds.length === 3) {
      record('PASS', '建立 3 個票券 fixture（金額券／百分比券／贈品券）', created.couponIds.join(', '));
    }

    await page.goto(`${BASE_URL}/tenant/coupons`, { waitUntil: 'networkidle' });
    const gotCoupons1 = await waitForResponseCount('couponsGet', 1, 15_000);
    if (!gotCoupons1) {
      record('FAIL', '/tenant/coupons 依賴的 GET /api/coupons 在 15 秒內回應', '逾時 —— 後端/網路沒回應');
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, '35-coupons.png'), fullPage: true }).catch(() => {});

    if (created.couponIds.length > 0) {
      const { data: dbCoupons, error: dbCouponsErr } = await admin
        .from('coupons')
        .select('id, name, min_order_amount, max_discount_amount, gift_item, limit_per_customer, private_mode')
        .in('id', created.couponIds);
      if (dbCouponsErr) throw dbCouponsErr;
      const dbCouponById = new Map((dbCoupons ?? []).map((r) => [r.id, r]));

      const searchInput = page.locator('input[type="search"]').first();

      async function openDetail(name) {
        await searchInput.fill(name);
        await searchInput.press('Enter');
        await page.waitForTimeout(150); // client-side filter，非網路等待
        const row = page.locator('table.data-table tbody tr', { hasText: name });
        await row.first().waitFor({ state: 'visible', timeout: 5000 });
        await row.first().locator('button[aria-label="票券詳情"]').click();
        await page.locator('[role="dialog"] .modal-title', { hasText: '票券詳情' }).waitFor({ timeout: 5000 });
        // CouponDetailModal 有一個固定 280ms 的元件內建 loading 計時器（見
        // src/app/tenant/coupons/page.tsx CouponDetailModal），不是網路等待，
        // 等它結束是已知的元件行為，不是對時鐘瞎猜。
        await page.waitForTimeout(400);
        const rowText = (await row.first().textContent()) ?? '';
        // 用 Badge 的 CSS class（tone=purple）精準定位私密徽章，不用整列文字
        // 子字串比對——避免票券名字本身若含「私密」兩字造成誤判。
        const privateBadgeCount = await row.first().locator('.badge-purple').count();
        const modalText = (await page.locator('[role="dialog"] .modal-body').textContent()) ?? '';
        await page.locator('[role="dialog"] button', { hasText: '關閉' }).click().catch(async () => {
          await page.keyboard.press('Escape');
        });
        await searchInput.fill('');
        await searchInput.press('Enter');
        await page.waitForTimeout(100);
        return { rowText, modalText, privateBadgeCount };
      }

      // -- 金額券：min_order_amount / limit_per_customer / private_mode --
      if (couponIdByName[couponAmount.name]) {
        const id = couponIdByName[couponAmount.name];
        const dbRow = dbCouponById.get(id);
        const { modalText, privateBadgeCount } = await openDetail(couponAmount.name);

        const privateOk = (privateBadgeCount > 0) === Boolean(dbRow.private_mode);
        record(privateOk ? 'PASS' : 'FAIL', '金額券：列表私密徽章與 DB private_mode 相符',
          `DB private_mode=${dbRow.private_mode}，畫面私密徽章數=${privateBadgeCount}`);

        const minOk = dbRow.min_order_amount == null
          ? true
          : modalText.includes(fmtCurrency(Number(dbRow.min_order_amount)));
        record(minOk ? 'PASS' : 'FAIL', '金額券：詳情彈窗最低消費門檻與 DB min_order_amount 相符',
          `DB=${dbRow.min_order_amount}，畫面是否含有格式化金額=${minOk}`);

        const limitOk = dbRow.limit_per_customer == null
          ? true
          : modalText.includes(fmtNumber(Number(dbRow.limit_per_customer)));
        record(limitOk ? 'PASS' : 'FAIL', '金額券：詳情彈窗每人限領數量與 DB limit_per_customer 相符',
          `DB=${dbRow.limit_per_customer}，畫面是否含有此數字=${limitOk}`);
      } else {
        record('SKIP', '金額券欄位比對', '未能建立金額券 fixture');
      }

      // -- 百分比券：max_discount_amount --
      if (couponIdByName[couponPercent.name]) {
        const id = couponIdByName[couponPercent.name];
        const dbRow = dbCouponById.get(id);
        const { modalText } = await openDetail(couponPercent.name);
        const maxOk = dbRow.max_discount_amount == null
          ? true
          : modalText.includes(fmtCurrency(Number(dbRow.max_discount_amount)));
        record(maxOk ? 'PASS' : 'FAIL', '百分比券：詳情彈窗最高折抵金額與 DB max_discount_amount 相符',
          `DB=${dbRow.max_discount_amount}，畫面是否含有格式化金額=${maxOk}`);
      } else {
        record('SKIP', '百分比券欄位比對', '未能建立百分比券 fixture');
      }

      // -- 贈品券：gift_item，以及硬鎖：不是刪掉的 mock giftItem 常數 --
      if (couponIdByName[couponGift.name]) {
        const id = couponIdByName[couponGift.name];
        const dbRow = dbCouponById.get(id);
        const { modalText } = await openDetail(couponGift.name);
        const giftOk = modalText.includes(dbRow.gift_item);
        record(giftOk ? 'PASS' : 'FAIL', '贈品券：詳情彈窗贈品項目與 DB gift_item 相符',
          `DB gift_item="${dbRow.gift_item}"，畫面是否含有此字串=${giftOk}`);

        const leakedGift = modalText.includes(REMOVED_MOCK_GIFT_ITEM) && dbRow.gift_item !== REMOVED_MOCK_GIFT_ITEM;
        record(leakedGift ? 'FAIL' : 'PASS', '贈品券：畫面贈品項目不是刪掉的 mock 常數「免費瀏海修剪」',
          leakedGift ? '畫面含有已刪除的假常數' : '未偵測到殘留');
      } else {
        record('SKIP', '贈品券欄位比對', '未能建立贈品券 fixture');
      }

      // -- 硬鎖：畫面（含 name/description 區塊）不得出現已刪除的票券代碼常數 --
      const anyRowsText = (await page.locator('table.data-table tbody').textContent().catch(() => '')) ?? '';
      const leakedCode = REMOVED_MOCK_COUPON_CODES.find((c) => anyRowsText.includes(c));
      record(leakedCode ? 'FAIL' : 'PASS', '票券列表不含已刪除的 mock 代碼常數（NEW8FOLD/CARE200/BDAYFRINGE）',
        leakedCode ? `偵測到「${leakedCode}」` : '未偵測到殘留');
    } else {
      record('SKIP', 'coupons 頁欄位逐列比對 DB', '未能建立任何票券 fixture');
    }

    // ================================================================
    // 6) 反核銷：還原最新已核銷實例後，下一個候選變成較舊已核銷代碼
    //    （PR #93 修的那個 bug）。
    // ================================================================
    const undoCouponName = `#35驗證券-反核銷-${RUN_TAG}`;
    const undoCouponId = crypto.randomUUID();
    const olderInstanceId = crypto.randomUUID();
    const newerInstanceId = crypto.randomUUID();
    const codeSuffix = RUN_TAG.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, '0');
    const olderCode = `O35${codeSuffix}`;
    const newerCode = `N35${codeSuffix}`;

    {
      const { error: e1 } = await admin.from('coupons').insert({
        id: undoCouponId, tenant_id: SHOP_A.id, name: undoCouponName,
        discount_type: 'AMOUNT', discount_value: 50, total_quantity: 0, status: 'PUBLISHED',
      });
      const { error: e2 } = e1 ? { error: e1 } : await admin.from('coupon_instances').insert([
        {
          id: olderInstanceId, tenant_id: SHOP_A.id, coupon_id: undoCouponId,
          customer_id: SHOP_A.customerA1, code: olderCode, redeemed_at: '2026-08-31T10:00:00.000Z',
        },
        {
          id: newerInstanceId, tenant_id: SHOP_A.id, coupon_id: undoCouponId,
          customer_id: SHOP_A.customerA1, code: newerCode, redeemed_at: '2026-08-31T11:00:00.000Z',
        },
      ]);
      if (!e1) created.couponIds.push(undoCouponId);
      if (!e2) created.couponInstanceIds.push(olderInstanceId, newerInstanceId);

      if (e1 || e2) {
        record('FAIL', '建立反核銷驗收用的票券＋兩筆已核銷實例（before 狀態）', String((e1 || e2)?.message));
      } else {
        record('PASS', '建立反核銷驗收用的票券＋兩筆已核銷實例（before 狀態）', `coupon=${undoCouponId}`);

        // coupons 頁在步驟 5 已經被造訪過一次：couponsGet 計數不是從 0 開始，
        // 先拍 baseline，等「這一次」導航新增的那一筆，不是隨便等到 >=1。
        const couponsGetBaseline = countOf('couponsGet');
        await page.goto(`${BASE_URL}/tenant/coupons`, { waitUntil: 'networkidle' });
        const gotCouponsForUndo = await waitForResponseCount('couponsGet', couponsGetBaseline + 1, 15_000);
        if (!gotCouponsForUndo) {
          record('FAIL', '反核銷驗收：導航到 /tenant/coupons 後 GET /api/coupons 在 15 秒內回應', '逾時 —— 後端/網路沒回應');
        }
        await page.waitForTimeout(200);

        const searchInput = page.locator('input[type="search"]').first();
        await searchInput.fill(undoCouponName);
        await searchInput.press('Enter');
        await page.waitForTimeout(150);
        const row = page.locator('table.data-table tbody tr', { hasText: undoCouponName });
        await row.first().waitFor({ state: 'visible', timeout: 5000 });

        // ⚠️ 教訓（第一次實跑抓到）：反核銷後 GET /api/coupons 的網路回應算
        // 「到齊」了，不代表 React 已經把新的 rows state 渲染進 DOM——兩者中間
        // 還有一個 React commit tick。固定 200ms 在多數情況下夠、但不保證，
        // 兩次相同程式碼的實跑就曾經一次 present=true 一次 present=false。
        // 改成對按鈕的「有/無」本身做有界限的輪詢（Playwright locator 的
        // waitFor 是真的輪詢 DOM，不是猜一個固定數字），逾時才判定為「真的
        // 沒有」，不是猜完一個時間就直接讀一次定生死。
        async function readUndoLeadCode(buttonTimeoutMs = 2000) {
          const btn = row.first().locator('button[aria-label="還原票券（反核銷）"]');
          try {
            await btn.first().waitFor({ state: 'visible', timeout: buttonTimeoutMs });
          } catch {
            return { present: false, code: null };
          }
          await btn.click();
          await page.locator('[role="dialog"] .modal-title', { hasText: '還原票券（反核銷）' })
            .waitFor({ timeout: 5000 });
          const leadText = (await page.locator('[role="dialog"] .modal-body p').first().textContent()) ?? '';
          const m = leadText.match(/代碼\s*([A-Za-z0-9]+)）/);
          return { present: true, code: m ? m[1] : null, leadText };
        }

        // -- before：GET /api/coupons 算出的 lastRedeemedCode 應該是較新的 newerCode --
        const before = await readUndoLeadCode();
        record(
          before.present && before.code === newerCode ? 'PASS' : 'FAIL',
          '反核銷彈窗（還原前）顯示的代碼是較新的已核銷實例代碼',
          `畫面「${before.code}」 vs 預期 ${newerCode}（present=${before.present}）`,
        );

        if (before.present) {
          await page.fill('#redeemUndoReason', `#35 驗收腳本 ${RUN_TAG}`);
          const undoResPromise = page.waitForResponse(
            (r) => r.url().includes('/unredeem') && r.request().method() === 'POST',
            { timeout: 10_000 },
          ).catch(() => null);
          await page.locator('[role="dialog"] button', { hasText: '確認還原' }).click();
          const undoRes = await undoResPromise;
          if (!undoRes || undoRes.status() !== 200) {
            record('FAIL', 'POST /api/coupons/instances/:id/unredeem 回 200', undoRes ? `HTTP ${undoRes.status()}` : '逾時未收到回應');
          } else {
            record('PASS', 'POST /api/coupons/instances/:id/unredeem 回 200', '');
          }

          // onUndone 會重新 load() 整份 GET /api/coupons；等這次導航之後的第
          // 2 筆（baseline 是這次導航自己觸發的那 1 筆，見上方 couponsGetBaseline）。
          const refreshed = await waitForResponseCount('couponsGet', couponsGetBaseline + 2, 15_000);
          if (!refreshed) {
            record('FAIL', '反核銷後 GET /api/coupons 重新整理在 15 秒內回應', '逾時 —— 後端/網路沒回應');
          }
          await page.waitForTimeout(200);

          // 獨立查詢：DB 現在算出的「最新已核銷實例」應該變成 olderCode，
          // 且 newerInstance.redeemed_at 應該已被清空。
          const { data: instRows, error: instErr } = await admin
            .from('coupon_instances').select('id, code, redeemed_at')
            .in('id', [olderInstanceId, newerInstanceId]);
          if (instErr) throw instErr;
          const newerRow = instRows.find((r) => r.id === newerInstanceId);
          const olderRow = instRows.find((r) => r.id === olderInstanceId);
          record(
            newerRow && newerRow.redeemed_at === null ? 'PASS' : 'FAIL',
            'DB 直查：反核銷後較新那筆實例 redeemed_at 已清空',
            `newer.redeemed_at=${newerRow?.redeemed_at}`,
          );
          record(
            olderRow && olderRow.redeemed_at !== null ? 'PASS' : 'FAIL',
            'DB 直查：較舊那筆實例仍是已核銷狀態',
            `older.redeemed_at=${olderRow?.redeemed_at}`,
          );

          await page.screenshot({ path: path.join(OUT_DIR, '35-coupons-after-undo.png'), fullPage: true }).catch(() => {});

          // 用有界輪詢等按鈕出現（見 readUndoLeadCode 內的說明），不是固定
          // sleep 完就讀一次定生死。
          const after = await readUndoLeadCode(8000);
          record(
            after.present && after.code === olderCode ? 'PASS' : 'FAIL',
            '反核銷彈窗（還原後）顯示的代碼變成較舊的已核銷實例代碼（PR #93 修的 bug）',
            `畫面「${after.code}」 vs 預期 ${olderCode}（present=${after.present}）`,
          );
          if (after.present) {
            await page.locator('[role="dialog"] button', { hasText: '取消' }).click().catch(async () => {
              await page.keyboard.press('Escape');
            });
          }
        } else {
          record('FAIL', '反核銷後的畫面代碼比對', '還原前彈窗未能開啟，缺少可比對的 before 值');
        }
      }
    }
  } catch (err) {
    record('FAIL', '腳本執行未預期中斷', String(err?.stack ?? err));
  } finally {
    // ================================================================
    // 清理：全部刪除，讓 TEST 回到跑腳本之前的狀態。
    // ================================================================
    const cleanupErrors = [];
    try {
      if (created.couponInstanceIds.length > 0) {
        const { error } = await admin.from('coupon_instances').delete().in('id', created.couponInstanceIds);
        if (error) cleanupErrors.push(`coupon_instances(by id): ${error.message}`);
      }
      if (created.couponIds.length > 0) {
        // 先清乾淨可能殘留的 instances（例如反核銷步驟以外的路徑失敗時）；
        // coupons→coupon_instances 本身也是 on delete cascade，這裡是雙重保險。
        const { error: e1 } = await admin.from('coupon_instances').delete().in('coupon_id', created.couponIds);
        if (e1) cleanupErrors.push(`coupon_instances(by coupon_id): ${e1.message}`);
        const { error: e2 } = await admin.from('coupons').delete().in('id', created.couponIds);
        if (e2) cleanupErrors.push(`coupons: ${e2.message}`);
      }
      if (created.customerIds.length > 0) {
        const { error } = await admin.from('customers').delete().in('id', created.customerIds);
        if (error) cleanupErrors.push(`customers: ${error.message}`);
      }
      if (created.levelIds.length > 0) {
        // ON DELETE SET NULL：任何暫時被 recalcMemberships 指到這些 fixture
        // 等級的既有顧客，刪除後自動變回 null（回到跑腳本前的狀態）。
        const { error } = await admin.from('membership_levels').delete().in('id', created.levelIds);
        if (error) cleanupErrors.push(`membership_levels: ${error.message}`);
      }
      if (preexistingDefaultLevelId) {
        const { error } = await admin.from('membership_levels')
          .update({ is_default: true }).eq('id', preexistingDefaultLevelId);
        if (error) cleanupErrors.push(`restore preexisting default: ${error.message}`);
      }
      if (cleanupErrors.length > 0) {
        record('FAIL', '清理：刪除本次 fixture 資料列', cleanupErrors.join(' | '));
      } else {
        record('PASS', '清理：已刪除本次跑腳本建立的所有 fixture 資料列', '');
      }
    } catch (cleanupErr) {
      record('FAIL', '清理：刪除本次 fixture 資料列', String(cleanupErr?.message ?? cleanupErr));
    }

    await browser.close();
    const fail = results.filter((r) => r.status === 'FAIL').length;
    const pass = results.filter((r) => r.status === 'PASS').length;
    const skip = results.filter((r) => r.status === 'SKIP').length;
    console.log(`\n[verify-35] 總結：PASS=${pass} FAIL=${fail} SKIP=${skip}`);
    if (fail > 0) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[verify-35] 未預期錯誤：', err?.stack ?? err);
  process.exitCode = 1;
});
