/**
 * 營運頁接線實測 — issue #7（乙）前半六頁的兩個 DoD 指定項目
 * -----------------------------------------------------------------------------
 * ① block-times：新增 → **重新整理仍在** → 刪除 → 重新整理不見
 *    （「重新整理仍在」是這一頁接線前做不到的事：接線前整頁是頁內假資料，
 *     新增只改 React state，F5 就蒸發。）
 *    每一步都用 service role 直查 `block_times` 交叉比對，不是只看畫面。
 * ② points 儲值：送出後**必須顯示後端 501 的客服文案，而不是成功**
 *    （09 分冊 §4：MVP 不接金流，`POST /api/points/topup/pay` 一律回
 *     501「請聯絡平台客服儲值」。這是規格內的誠實行為，頁面照實呈現才對。）
 *    同時斷言：modal 沒有關閉、畫面上沒有出現任何成功字樣、
 *    `tenant_point_transactions` 沒有多出 TOPUP 列。
 *
 * ── 憑證（絕不寫進本檔，15 分冊 §3 禁令 5）────────────────────────────────
 *   BASE_URL                    受測站台
 *   TEST_EMAIL / TEST_PASSWORD  測試帳號
 *   SUPABASE_URL                受測站台**同一個**專案的 URL
 *   SUPABASE_SERVICE_ROLE_KEY   直查用
 *
 * ── 執行 ──────────────────────────────────────────────────────────────────
 *   受測站台必須以 real 模式跑（NEXT_PUBLIC_USE_MOCK=false 是建置期變數）。
 *   ⚠️ 若用本地 `next dev`：**不要**與整合測試同時跑（兩個 dev server 共用
 *      `.next` 開發快取會把 vendor chunk 寫壞，見 15 分冊「實測腳本的兩條慣例」），
 *      而且收尾要 `rm -rf .next`。
 *
 *     NODE_USE_ENV_PROXY=1 BASE_URL=http://localhost:3200 TEST_EMAIL=… \
 *       TEST_PASSWORD=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *       node scripts/verify/ops-pages-wiring.07.cjs
 *   截圖輸出到 scripts/verify/out/（gitignore 涵蓋）。
 */
const path = require('node:path');
const fs = require('node:fs');

// CLAUDE.md：Playwright 裝在全域，不在本專案 node_modules，必須 require 絕對路徑
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3200';
const EMAIL = required('TEST_EMAIL');
const PASSWORD = required('TEST_PASSWORD');
const SB_URL = required('SUPABASE_URL').replace(/\/$/, '');
const SB_KEY = required('SUPABASE_SERVICE_ROLE_KEY');

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

async function sbSelect(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${table} 查詢失敗 ${res.status}：${await res.text()}`);
  return res.json();
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

/** 未來很遠的一個日期，避開種子資料與其他測試 */
function farFutureDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  console.log(`受測站台：${BASE}\n資料庫：${SB_URL}\n`);

  /* ---------------------------------------------------------------- 登入 */
  await page.goto(`${BASE}/tenant/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/tenant\/(dashboard|$)/, { timeout: 90000 });
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    return r.json();
  });
  const tenantId = me?.data?.tenantId;
  if (!tenantId) throw new Error(`/api/auth/me 沒有回 tenantId：${JSON.stringify(me)}`);
  check('登入成功', true, `${me.data.tenantName}（${tenantId}）`);

  /* ============================================================ ① block-times */
  console.log('\n① 封鎖時段：新增 → 重整仍在 → 刪除');

  const title = `實測封鎖-${Date.now().toString(36)}`;
  const date = farFutureDate(430);

  await page.goto(`${BASE}/tenant/block-times`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新增封鎖' }).first().click();
  await page.fill('#btTitle', title);
  await page.fill('#btDate', date);
  await page.check('#btFullDay'); // 整天封鎖：不受營業時間檢查影響
  await shot(page, 'ops07-blocktime-01-form');
  await page.getByRole('button', { name: '儲存', exact: true }).click();

  // 成功訊息（toast）要真的出現
  const createdToast = await page.getByText('封鎖時段已新增').first()
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  check('新增後出現「封鎖時段已新增」', createdToast);

  // 直查資料庫：這一筆真的進去了嗎
  let rows = await sbSelect('block_times', `select=id,reason,start_at,end_at&tenant_id=eq.${tenantId}&reason=eq.${encodeURIComponent(title)}`);
  check('service role 直查 block_times 有這一筆（不是只有畫面）', rows.length === 1,
    `筆數=${rows.length}${rows[0] ? ` id=${rows[0].id}` : ''}`);
  const blockId = rows[0] && rows[0].id;

  // 重新整理後仍在（接線前這一步必然失敗）
  await page.reload({ waitUntil: 'domcontentloaded' });
  const stillThere = await page.getByText(title).first()
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  check('重新整理後列表仍有這一筆', stillThere);
  await shot(page, 'ops07-blocktime-02-after-reload');

  // 刪除
  const row = page.locator('tr', { hasText: title }).first();
  await row.getByRole('button', { name: '刪除' }).first().click();
  await page.locator('.modal, [role="dialog"]').getByRole('button', { name: '刪除' }).last().click();
  const deletedToast = await page.getByText('已刪除').first()
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  check('刪除後出現「已刪除」', deletedToast);

  rows = await sbSelect('block_times', `select=id&id=eq.${blockId}`);
  check('service role 直查：那一列真的不見了', rows.length === 0, `筆數=${rows.length}`);
  await shot(page, 'ops07-blocktime-03-after-delete');

  /* ================================================================ ② points */
  console.log('\n② 點數儲值：必須如實呈現 501 客服文案，不是成功');

  const before = await sbSelect(
    'tenant_point_transactions',
    `select=id&tenant_id=eq.${tenantId}&type=eq.TOPUP`,
  );

  await page.goto(`${BASE}/tenant/points`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '申請儲值' }).first().click();
  await page.selectOption('#topupAmount', '1000');
  await shot(page, 'ops07-points-01-form');
  await page.getByRole('button', { name: '送出儲值申請' }).click();

  const honest = await page.getByText('請聯絡平台客服儲值').first()
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  check('畫面顯示後端 501 的原文「請聯絡平台客服儲值」', honest);

  // modal 沒有關掉（關掉＝看起來像送出成功了）
  const modalOpen = await page.locator('#topupAmount').isVisible().catch(() => false);
  check('儲值 modal 沒有關閉（沒有做成「送出成功」的樣子）', modalOpen);

  // 畫面上不得有任何成功字樣
  const body = await page.locator('body').innerText();
  const hasSuccessWord = /已送出|申請成功|儲值成功|已受理/.test(body);
  check('畫面沒有任何「已送出／成功／已受理」之類的成功字樣', !hasSuccessWord);

  const after = await sbSelect(
    'tenant_point_transactions',
    `select=id&tenant_id=eq.${tenantId}&type=eq.TOPUP`,
  );
  check('沒有任何 TOPUP 交易被寫進資料庫', after.length === before.length,
    `before=${before.length} after=${after.length}`);
  await shot(page, 'ops07-points-02-honest-501');

  await browser.close();

  /* ------------------------------------------------------------------ 結論 */
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 通過`);
  if (failed.length) {
    for (const f of failed) console.log(`  [FAIL] ${f.label}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
