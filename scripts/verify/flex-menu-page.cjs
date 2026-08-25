/**
 * scripts/verify/flex-menu-page.cjs
 * -----------------------------------------------------------------------------
 * rich-menu-design 頁「Flex 主選單」分頁的**頁面層**實測（issue #6 驗收：
 * 「頁面接線：重整後卡片仍在」）。
 *
 * 為什麼需要頁面層實測，而不是整合測試就夠：15 分冊與 `src/server/paging.ts`
 * 檔頭記過同一件事——單元測試不涵蓋頁面、整合測試直接打端點、e2e 只跑矩陣點名的
 * 頁面，於是「頁面到底有沒有呼叫那支端點」不屬於任何一層。這一輪把 FlexMenuTab
 * 從假成功改成真接線，正是最容易只改一半（端點好了、頁面沒接）的形狀。
 *
 * 這支腳本自己起一個 `next dev`（port 3200，**TEST Supabase 專案**，與整合測試
 * 同一組 .env.test 映射），用真的瀏覽器登入 → 編卡片 → 按發布 → **重新整理** →
 * 斷言卡片還在。重新整理是關鍵動作：本地 state 假成功在這一步一定會露餡。
 *
 * ⚠️ 不打 Preview 站：Preview 是從 `claude/deploy-vercel-project-nnno59` 分支
 * 自動部署的，本輪依派工**不 push**，所以那個網址上跑的仍是舊程式碼。對它斷言
 * 只會得到一個與本輪無關的結果。
 *
 * ⚠️ **跑完會刪掉 `.next`，這不是順手清東西，是必要的收尾。**
 * 本腳本的 `next dev` 與整合測試的 `next dev`（port 3100）共用同一個 repo root，
 * 因此也共用 `.next` 這個開發建置快取。兩個 dev server 先後寫同一份快取會把
 * vendor chunk 寫壞，症狀是**下一次整合測試大面積紅燈**：
 *   `Cannot find module './vendor-chunks/@supabase.js'` → 所有需要 Supabase 的
 *   路由 500 → `loginAs() 失敗：POST /api/auth/login 回 500` → 16 個測試檔一起爛。
 * 那份紅燈與程式碼完全無關，但看起來像是「這一輪改壞了整個專案」，2026-08-25
 * 實際發生過一次（本 issue 執行期間），追起來很花時間。刪掉快取讓下一次乾淨重建，
 * 代價只是一次冷編譯。
 *
 * 用法：node scripts/verify/flex-menu-page.cjs
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { existsSync, rmSync } = require('node:fs');

const ROOT = resolve(__dirname, '..', '..');
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const SHOT = resolve(ROOT, 'scripts/verify/.out-flex-menu-page.png');

const OWNER = { email: 'owner-a@test.local', password: 'Passw0rd!a' };
const CARD_TITLE = `整測卡${Date.now() % 100000}`;

/** 1×1 的合法 PNG（LINE_BOUND_BUCKETS 只收 JPEG/PNG，用它證明整條上傳路徑通） */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

if (existsSync(resolve(ROOT, '.env.test'))) process.loadEnvFile(resolve(ROOT, '.env.test'));

function startServer() {
  return spawn(resolve(ROOT, 'node_modules/.bin/next'), ['dev', '-p', String(PORT)], {
    cwd: ROOT, stdio: 'inherit', detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NEXT_PUBLIC_USE_MOCK: 'false',
      NEXT_PUBLIC_SUPABASE_URL: process.env.TEST_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.TEST_SUPABASE_ANON_KEY ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? '',
      NEXT_PUBLIC_APP_URL: BASE,
    },
  });
}

async function waitReady() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE)).status > 0) return; } catch { /* 尚未起來 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('next dev 逾時未就緒');
}

async function main() {
  const server = startServer();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'],
  });
  const fail = [];
  const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail.push(msg); };

  try {
    await waitReady();
    const page = await browser.newPage();
    // 頁面真的送出去的請求（證明按鈕接到的是端點，不是本地 state）
    const posts = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/')) posts.push(r.url().replace(BASE, ''));
    });

    await page.goto(`${BASE}/tenant/login`, { waitUntil: 'networkidle' });
    await page.fill('#username', OWNER.email);
    await page.fill('#password', OWNER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
      .catch(() => {});
    console.log(`[debug] 登入後 URL = ${page.url()}`);

    await page.goto(`${BASE}/tenant/rich-menu-design`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    console.log(`[debug] 選單設計頁 URL = ${page.url()}`);
    console.log(`[debug] tab 文字 = ${JSON.stringify(await page.locator('[role="tab"]').allInnerTexts())}`);
    await page.getByRole('tab', { name: /Flex 主選單/ }).first().click();
    await page.waitForTimeout(2500);

    // 每次跑都從乾淨狀態開始（前一次跑留下的卡片會讓斷言變得不確定）
    await page.evaluate(() => fetch('/api/settings/line/flex-menu', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flexCards: [] }),
    }));
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: /Flex 主選單/ }).first().click();
    await page.waitForTimeout(2500);

    // 新增一張卡並填標題（最後一列的第一個輸入框）
    await page.getByRole('button', { name: '新增卡片' }).click();
    await page.waitForTimeout(500);
    const lastRow = page.locator('table.data-table tbody tr').last();
    await lastRow.locator('input:not([type="file"])').first().fill(CARD_TITLE);

    /*
     * 卡片主圖上傳（issue #6 的人工介入點：決定共用既有的 `richmenu-assets`
     * bucket，不新開 bucket、不動 /api/upload/route.ts）。
     * 這一步同時驗三件事：檔案輸入真的有 onChange（不是死欄位）、
     * uploadImage() 打的是 POST /api/upload、回來的網址是可外連的 https。
     */
    posts.length = 0;
    await lastRow.locator('input[type="file"]').setInputFiles({
      name: 'flex-card.png', mimeType: 'image/png', buffer: PNG_1PX,
    });
    await page.waitForTimeout(4000);
    ok(posts.some((u) => u === '/api/upload'),
      `選檔後真的 POST /api/upload（實際送出：${JSON.stringify(posts)}）`);

    posts.length = 0;
    await page.getByRole('button', { name: /發布 Flex 主選單到 LINE/ }).click();
    await page.waitForTimeout(3000);

    ok(posts.some((u) => u === '/api/settings/line/flex-menu'),
      `按下發布後真的 POST /api/settings/line/flex-menu（實際送出：${JSON.stringify(posts)}）`);

    const toast = (await page.locator('body').innerText()).includes('主選單已儲存');
    ok(toast, '畫面出現「主選單已儲存…」（且它出現在端點回應之後）');

    // ★ 重新整理：本地 state 的假成功在這一步一定會消失
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: /Flex 主選單/ }).first().click();
    await page.waitForTimeout(3000);
    // 卡片標題在 <input value> 裡，innerText 讀不到，必須讀欄位值
    const titles = await page.locator('table.data-table tbody tr input:not([type="file"])')
      .evaluateAll((els) => els.map((e) => e.value));
    ok(titles.includes(CARD_TITLE),
      `重整後卡片「${CARD_TITLE}」仍在畫面的編輯欄位裡（實際：${JSON.stringify(titles)}）`);

    // 端點回讀的內容與畫面一致（不是畫面自己記著）
    const api = await page.evaluate(async () => {
      const r = await fetch('/api/settings', { credentials: 'include' });
      return (await r.json())?.data?.line?.flexCards ?? null;
    });
    ok(Array.isArray(api) && api.some((c) => c.title === CARD_TITLE),
      `GET /api/settings 的 line.flexCards 含這張卡（共 ${Array.isArray(api) ? api.length : 'null'} 張）`);

    const saved = (api ?? []).find((c) => c.title === CARD_TITLE);
    ok(!!saved && /^https:\/\/.*\/richmenu-assets\//.test(saved.imageUrl),
      `卡片主圖存的是 richmenu-assets 的 https 永久網址：${saved && saved.imageUrl}`);
    if (saved && saved.imageUrl) {
      const head = await fetch(saved.imageUrl, { method: 'GET' });
      ok(head.ok && (head.headers.get('content-type') ?? '').includes('image/'),
        `那個網址對外抓得到（LINE 會去抓它）：HTTP ${head.status} ${head.headers.get('content-type')}`);
    }

    await page.screenshot({ path: SHOT, fullPage: true });
    console.log(`\n截圖：${SHOT}`);
  } finally {
    await browser.close();
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* 已結束 */ }
    // 見檔頭：共用 .next 會讓下一次整合測試大面積 500，這裡一定要清掉
    await new Promise((r) => setTimeout(r, 1000));
    rmSync(resolve(ROOT, '.next'), { recursive: true, force: true });
    console.log('[cleanup] 已刪除 .next（避免污染整合測試的開發建置快取）');
  }

  console.log(`\n${fail.length === 0 ? '全部通過' : `失敗 ${fail.length} 項`}`);
  process.exit(fail.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
