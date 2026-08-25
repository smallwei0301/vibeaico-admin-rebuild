/**
 * scripts/verify/booking-addons.17.cjs
 * -----------------------------------------------------------------------------
 * issue #17（補齊-2）驗收清單的頁面實測那一輪：
 *   建立預約 → 在詳情視窗加購 → **重整後加購仍在且金額正確** → 刪除加購 → 金額回沖。
 *
 * 判準一律是「重新整理後還在嗎」與「直查資料庫對得上嗎」，**不以 toast 為證據**
 * （_preview-lib.cjs 檔頭的規約）。toast 內容另外單獨斷言一次，因為 issue #17 要求
 * 「成功訊息只在真的成功後顯示」，那句話本身也是被測對象。
 *
 * ── 跑在哪裡：本機 dev server，但打的是 **Preview 站的同一個資料庫** ──────────
 * 清單原文寫「Playwright 對 Preview 站實測」。本輪**做不到字面上的那件事**，
 * 原因寫清楚而不是含糊帶過：Preview 站部署的是整合分支
 * （claude/deploy-vercel-project-nnno59），本輪的改動依派工指示**不得 push**，
 * 所以 Preview 上沒有 `/api/bookings/:id/addons` 這條路由，對它跑只會全部 404。
 *
 * 因此改成：本機 `next dev`（`NEXT_PUBLIC_USE_MOCK=false`）＋ `.env.local`——
 * 而 `.env.local` 指的正是**正式 Supabase 專案 egehnijjpgijmccagxac，也就是
 * Preview 站接的那一個**。真實登入、真實資料庫、真實 RLS 全部走到，
 * 與 Preview 那一輪的差別只剩「誰在跑這份程式碼」。合併並部署後，同一支腳本
 * 帶 `PREVIEW_URL=<branch alias>` 就能原封不動再跑一次。
 *
 * ⚠️ 兩個 dev server 共用同一份 `.next` 開發快取會把 vendor chunk 寫壞
 * （15 分冊 §5）。本檔自己起 dev server、結束時 `rm -rf .next`，
 * **不要與 `npm run test:integration` 同時跑**。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   TEST_EMAIL=… TEST_PASSWORD=… SUPABASE_ACCESS_TOKEN=sbp_… node 本檔
 *   （PREVIEW_URL 省略＝本檔自己起的 http://localhost:3210）
 *
 * ── 測試資料 ────────────────────────────────────────────────────────────
 * 自建一筆「未來 400 天」的預約（booking_no 前綴 `VERIFY17`），用完即以
 * Management API 刪除（booking_addons 以 booking_id cascade 一併清掉）。
 * 不動任何既有資料列。收尾會再查一次確認前綴 `VERIFY17` 的預約數為 0。
 *
 * 輸出：截圖一律進 scripts/verify/out/（playbook「實測腳本的兩條慣例」）。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.VERIFY_PORT || 3210);
const LOCAL_BASE = `http://localhost:${PORT}`;
// _preview-lib 讀 PREVIEW_URL 決定 BASE；沒指定就指向本檔自己起的 dev server
if (!process.env.PREVIEW_URL) process.env.PREVIEW_URL = LOCAL_BASE;

const {
  BASE, OUT_DIR, required, check, summary, launch, login, gotoStable,
  readToast, waitToastGone, clickModalButton, shot, sql,
} = require('./_preview-lib.cjs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BOOKING_NO = `VERIFY17${Date.now().toString(36).toUpperCase().slice(-6)}`;
const ADDON_NAME = `驗收加購${Date.now().toString(36).slice(-4)}`;
const ADDON_PRICE = 350;
const ADDON_QTY = 2;
const BASE_PRICE = 1000;

const sqlLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

/* ───────────────────────────────────────────── 本機 dev server */

let devProc = null;

async function startDevServer() {
  if (process.env.PREVIEW_URL !== LOCAL_BASE) return;   // 有人指定外部站台就不起
  fs.rmSync(path.join(REPO_ROOT, '.next'), { recursive: true, force: true });
  console.log(`  啟動本機 dev server（port ${PORT}，NEXT_PUBLIC_USE_MOCK=false）…`);
  devProc = spawn('node', ['node_modules/.bin/next', 'dev', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    env: { ...process.env, NEXT_PUBLIC_USE_MOCK: 'false', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  devProc.stdout.on('data', (d) => process.stdout.write(`  [next] ${d}`));
  devProc.stderr.on('data', (d) => process.stderr.write(`  [next!] ${d}`));

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${LOCAL_BASE}/tenant/login`);
      if (r.ok) { console.log('  dev server 就緒'); return; }
    } catch { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('dev server 啟動逾時');
}

function stopDevServer() {
  if (devProc) { devProc.kill('SIGTERM'); devProc = null; }
  fs.rmSync(path.join(REPO_ROOT, '.next'), { recursive: true, force: true });
}

/* ───────────────────────────────────────────── 測試資料（Management API） */

async function seedBooking(email) {
  const [{ tenant_id: tenantId } = {}] = await sql(`
    select tu.tenant_id from tenant_users tu
    join auth.users u on u.id = tu.user_id
    where lower(u.email) = lower(${sqlLiteral(email)})
    order by tu.created_at limit 1`);
  if (!tenantId) throw new Error(`找不到 ${email} 所屬的租戶`);

  const [customer] = await sql(
    `select id, name from customers where tenant_id = '${tenantId}' order by created_at limit 1`);
  const [service] = await sql(
    `select id, duration_minutes from services where tenant_id = '${tenantId}' order by created_at limit 1`);
  if (!customer || !service) throw new Error('該租戶沒有可用的顧客或服務，無法建立測試預約');

  const start = new Date(Date.now() + 400 * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const [row] = await sql(`
    insert into bookings (tenant_id, booking_no, customer_id, service_id, staff_id,
      start_at, end_at, duration_minutes, price, final_price, status, source, note)
    values ('${tenantId}', ${sqlLiteral(BOOKING_NO)}, '${customer.id}', '${service.id}', null,
      '${start.toISOString()}', '${end.toISOString()}', 60, ${BASE_PRICE}, ${BASE_PRICE},
      'CONFIRMED', 'MANUAL', 'issue #17 驗收用，腳本結束即刪')
    returning id`);
  console.log(`  建立測試預約 ${BOOKING_NO}（顧客：${customer.name}）`);
  return { tenantId, bookingId: row.id, customerName: customer.name };
}

async function readBookingRow(bookingId) {
  const [row] = await sql(
    `select final_price, duration_minutes, end_at from bookings where id = '${bookingId}'`);
  return row;
}

async function readAddonRows(bookingId) {
  return sql(`select id, name, price, quantity, applied_amount, applied_minutes, notified
              from booking_addons where booking_id = '${bookingId}' order by created_at`);
}

async function cleanup(bookingId) {
  if (bookingId) await sql(`delete from bookings where id = '${bookingId}'`);
  const left = await sql(
    `select count(*)::int as n from bookings where booking_no like 'VERIFY17%'`);
  console.log(`  清理後殘留的 VERIFY17 預約數：${left[0].n}`);
  return left[0].n;
}

/* ───────────────────────────────────────────── UI 操作 */

/** 用單號搜尋出那筆預約，開啟詳情視窗 */
async function openDetail(page) {
  await gotoStable(page, `${BASE}/tenant/bookings`);
  // 搜尋框沒有 id（見 bookings/page.tsx 的 input-group），用 placeholder 定位
  const search = page.getByPlaceholder('搜尋顧客姓名或電話...');
  await search.waitFor({ state: 'visible', timeout: 45_000 });
  await search.fill(BOOKING_NO);
  await page.waitForTimeout(1500);            // 搜尋是 debounce + 重新載入
  await page.getByRole('button', { name: '查看詳情' }).first().click({ timeout: 30_000 });
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  /*
   * 加購明細是開啟後才向 API 取的，dev 模式下一次要 1〜5 秒。
   * **不能用固定 sleep**：睡太短就會在「載入中」的狀態下斷言，睡太長是浪費。
   * 等到明細區不再是「載入中…」為止——這一句本身就是本輪實測補上的誠實狀態
   * （先前那個版本在載入期間顯示「無資料」，實測第一輪即抓到）。
   */
  await dialog.getByText('加購明細載入中…').waitFor({ state: 'detached', timeout: 45_000 })
    .catch(() => {});   // 已經載完就不會出現，等不到是正常的
  await page.waitForTimeout(300);
}

/** 詳情視窗上顯示的「應收金額」數字 */
async function readAmount(page) {
  const dialog = page.locator('[role="dialog"]').last();
  const text = await dialog.innerText();
  // formatCurrency() 產出的是 `NT$1,000`（無空白，見 src/lib/utils.ts）
  const m = text.match(/應收金額\s*NT\$\s*([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

async function main() {
  const email = required('TEST_EMAIL');
  const password = required('TEST_PASSWORD');
  required('SUPABASE_ACCESS_TOKEN');

  let bookingId = null;
  let browser = null;
  try {
    await startDevServer();
    ({ bookingId } = await seedBooking(email));

    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await login(page, email, password);

    /* ── ① 加購前 ─────────────────────────────────────────────── */
    await openDetail(page);
    await shot(page, 'addons17-1-before');
    const amountBefore = await readAmount(page);
    check('加購前：詳情顯示的應收金額 = 建立時的金額', amountBefore === BASE_PRICE,
      `畫面 ${amountBefore} / DB ${BASE_PRICE}`);
    check('加購前：資料庫沒有任何加購明細', (await readAddonRows(bookingId)).length === 0);

    /* ── ② 加購 ───────────────────────────────────────────────── */
    await clickModalButton(page, '加購');
    await page.locator('#addonItemName').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('#addonItemName').fill(ADDON_NAME);
    await page.locator('#addonPrice').fill(String(ADDON_PRICE));
    await page.locator('#addonQty').fill(String(ADDON_QTY));
    check('加購視窗的「通知顧客消費明細」勾選框是可勾的（不是停用的裝飾）',
      await page.locator('#addonNotify').isEnabled());
    // 不勾通知：本輪不對真實顧客發 LINE（額度是店家的，且顧客是真人）
    await shot(page, 'addons17-2-modal');
    await clickModalButton(page, '加入');

    const toast = await readToast(page);
    check('成功 toast 出現且不宣稱通知了顧客（未勾選通知）',
      /已新增加購/.test(toast) && !/LINE|通知/.test(toast), toast);
    await waitToastGone(page);

    const expected = BASE_PRICE + ADDON_PRICE * ADDON_QTY;
    const afterRow = await readBookingRow(bookingId);
    check('資料庫：bookings.final_price 已加上 price × quantity',
      Number(afterRow.final_price) === expected, `DB ${afterRow.final_price} / 期望 ${expected}`);
    const rows = await readAddonRows(bookingId);
    check('資料庫：booking_addons 多了一列，applied_amount 記著實際加上去的金額',
      rows.length === 1 && Number(rows[0].applied_amount) === ADDON_PRICE * ADDON_QTY,
      JSON.stringify(rows));
    check('資料庫：未勾通知 → notified = NONE',
      rows.length === 1 && rows[0].notified === 'NONE', rows[0] && rows[0].notified);

    /* ── ③ 重整後仍在（本輪最重要的判準）──────────────────────── */
    await openDetail(page);
    await shot(page, 'addons17-3-after-reload');
    const dialogText = await page.locator('[role="dialog"]').last().innerText();
    check('重整後：詳情的加購明細仍列著這筆加購', dialogText.includes(ADDON_NAME));
    check(`重整後：詳情顯示的應收金額 = ${expected}`, (await readAmount(page)) === expected,
      `畫面 ${await readAmount(page)}`);

    /* ── ④ 刪除加購 → 回沖 ────────────────────────────────────── */
    const addonId = rows[0].id;
    await page.locator('[role="dialog"]').last()
      .getByRole('button', { name: '刪除' }).first().click({ timeout: 20_000 });
    const confirmText = await page.locator('[role="dialog"]').last().innerText();
    check('刪除確認視窗寫出「將扣回多少錢」這個確定的數字',
      confirmText.includes(String(ADDON_PRICE * ADDON_QTY)), confirmText.slice(0, 160));
    await shot(page, 'addons17-4-remove-confirm');
    await clickModalButton(page, '刪除');

    const removeToast = await readToast(page);
    check('移除成功 toast 說出實際扣回的金額', /已移除加購/.test(removeToast), removeToast);
    await waitToastGone(page);

    const reverted = await readBookingRow(bookingId);
    check('資料庫：final_price 已回沖到加購前的金額',
      Number(reverted.final_price) === BASE_PRICE, `DB ${reverted.final_price}`);
    check('資料庫：該筆 booking_addons 已刪除',
      (await readAddonRows(bookingId)).every((r) => r.id !== addonId));

    await openDetail(page);
    await shot(page, 'addons17-5-after-remove');
    check('重整後：加購明細已不再顯示該項目',
      !(await page.locator('[role="dialog"]').last().innerText()).includes(ADDON_NAME));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      const left = await cleanup(bookingId);
      check('測試資料已清理（VERIFY17 前綴的預約數 = 0）', left === 0, `殘留 ${left}`);
    } catch (e) {
      check('測試資料已清理', false, String(e));
    }
    stopDevServer();
  }

  const { fail } = summary();
  console.log(`\n截圖目錄：${OUT_DIR}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); stopDevServer(); process.exit(1); });
