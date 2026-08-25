/**
 * scripts/verify/qr-download.cjs
 * -----------------------------------------------------------------------------
 * issue #16（補齊-1）Playwright 實測：promote／line-settings 兩頁「下載 QR
 * Code」按鈕真的觸發瀏覽器下載，且下載到的 PNG 用獨立解碼器（jsqr）讀回的
 * 字串，逐字等於畫面上顯示的那個網址。
 *
 * ⚠️ 不打 Preview 站：Preview 是從 `claude/deploy-vercel-project-nnno59`
 * 分支自動部署的，issue #16 依派工範圍**不 push**，所以 Preview 站現在跑的
 * 仍是本輪改動前的舊程式碼——對它斷言只會測到與本輪無關的舊按鈕（disabled）。
 * 這與 flex-menu-page.cjs（同一輪、同一個理由）採同一個做法：本地起
 * `next dev`，用**骨架模式（NEXT_PUBLIC_USE_MOCK=true，本專案預設值）**測試，
 * 因為 QR 只讀畫面上已有的網址（getTenantSettings() 的 shopCode / 表單裡的
 * LINE Basic ID），完全不需要真的 Supabase 後端，也不需要登入——
 * middleware.ts 在 USE_MOCK 為真時整段放行 /tenant/**（見該檔案）。
 *
 * 用法：node scripts/verify/qr-download.cjs
 * 輸出：scripts/verify/out/qr-promote.png、scripts/verify/out/qr-line-settings.png
 *       下載到的兩個 PNG 存在 scripts/verify/out/downloads/ 供人工複查。
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// CLAUDE.md：Playwright 裝在全域，不在本專案 node_modules，必須 require 絕對路徑
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
// jsqr / pngjs 是本專案 devDependencies（tests/unit/qr-lib.test.ts 同一套解碼路徑）
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 3300;
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = path.join(__dirname, 'out');
const DOWNLOAD_DIR = path.join(OUT_DIR, 'downloads');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed, detail });
  console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function decodePngFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

function startServer() {
  return spawn(path.resolve(ROOT, 'node_modules/.bin/next'), ['dev', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: 'inherit',
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NEXT_PUBLIC_USE_MOCK: 'true', // 骨架模式：本專案預設，見 CLAUDE.md
      NEXT_PUBLIC_APP_URL: BASE,
    },
  });
}

async function waitReady() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE)).status > 0) return; } catch { /* 尚未起來 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('next dev 逾時未就緒');
}

async function main() {
  const server = startServer();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });

  let promoteDecoded = null;
  let promoteUrl = null;
  let lineDecoded = null;
  let lineUrl = null;

  try {
    await waitReady();
    const page = await browser.newPage();

    /*
     * ⚠️ 環境限制（已用最小重現排除是本輪程式碼的問題，見任務回報說明）：
     * 這個 sandbox 的無頭 Chromium build 對含中文字元的 `download` 屬性值，
     * 無論走 data: 還是 blob: URL，下載管理器一律回報 suggestedFilename()
     * = 'download'（純 ASCII 檔名不受影響）。用一支獨立於 next dev / 本頁
     * 程式碼之外的最小 HTML 重現同樣現象，確認是這個瀏覽器 build 的
     * 檔名編碼限制，不是 triggerDataUrlDownload() 的邏輯錯誤。
     * 為了仍能自動化證明「程式碼真的把正確檔名寫進 <a download>」，這裡
     * hook 住 HTMLAnchorElement.prototype.click，在真正呼叫瀏覽器原生
     * click 之前，把該次呼叫當下 `this.download` 的值記下來——量的是
     * 程式碼設定了什麼，不是這個 build 的下載管理器事後怎麼處理它。
     */
    await page.addInitScript(() => {
      window.__qrDownloadAttempts = [];
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function patchedClick() {
        if (this.download) {
          window.__qrDownloadAttempts.push({
            download: this.download,
            hrefPrefix: this.href.slice(0, 24),
          });
        }
        return origClick.call(this);
      };
    });

    /* ============================================== 1. promote 頁 */
    console.log('\n== /tenant/promote ==');
    await page.goto(`${BASE}/tenant/promote`, { waitUntil: 'networkidle' });

    // 「你的線上預約頁」卡片裡那個 readOnly input，就是畫面上顯示給店家的公開網址
    const urlInput = page.locator('input[readonly]').first();
    await urlInput.waitFor({ state: 'visible', timeout: 15_000 });
    // 等到不再是「載入中...」
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[readonly]');
        return !!el && el.value && !el.value.includes('載入中');
      },
      { timeout: 15_000 },
    );
    promoteUrl = await urlInput.inputValue();
    check('promote 頁公開預約網址已載入', !!promoteUrl && promoteUrl.startsWith('http'), promoteUrl);

    // 等 QR 圖片真的畫出來（不是 lucide 佔位圖示）—— alt 文字對應 promotePage.qr.alt
    const promoteQrImg = page.locator('img[alt="預約頁 QR Code"]');
    await promoteQrImg.waitFor({ state: 'visible', timeout: 15_000 });
    const promoteImgSrc = await promoteQrImg.getAttribute('src');
    check('promote 頁 QR 圖是真的 <img src="data:image/png...">，不是裝飾圖示',
      !!promoteImgSrc && promoteImgSrc.startsWith('data:image/png;base64,'));

    await page.screenshot({ path: path.join(OUT_DIR, 'qr-promote.png'), fullPage: true });

    const downloadBtn = page.getByRole('button', { name: /下載 QR/ });
    await downloadBtn.waitFor({ state: 'visible' });
    const isDisabled = await downloadBtn.isDisabled();
    check('promote 頁下載按鈕已啟用（不再是 issue #3 誠實化時的硬停用）', !isDisabled);

    const [download1] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      downloadBtn.click(),
    ]);
    const suggested1 = download1.suggestedFilename();
    check('promote 頁按下下載鈕觸發了真的 download 事件', true, `suggestedFilename=${suggested1}`);
    const attempts1 = await page.evaluate(() => window.__qrDownloadAttempts);
    const attempt1 = attempts1[attempts1.length - 1];
    check(
      'promote 頁真正呼叫 <a>.click() 那一刻，download 屬性＝原站規格的「預約QRcode.png」'
      + '（suggestedFilename() 回報的是這個 sandbox 無頭 Chromium 對中文檔名的已知限制，見上方註解）',
      attempt1?.download === '預約QRcode.png', JSON.stringify(attempt1),
    );
    const file1 = path.join(DOWNLOAD_DIR, 'promote.png');
    await download1.saveAs(file1);

    promoteDecoded = decodePngFile(file1);
    check('promote 下載到的 PNG 用獨立解碼器（jsqr）解出內容',
      promoteDecoded !== null, promoteDecoded ?? '(解不出來)');
    check('promote 解碼字串與畫面上顯示的公開預約網址逐字相符',
      promoteDecoded === promoteUrl, `decoded=${promoteDecoded} / screen=${promoteUrl}`);

    /* ============================================== 2. line-settings 頁 */
    console.log('\n== /tenant/line-settings ==');
    await page.goto(`${BASE}/tenant/line-settings`, { waitUntil: 'networkidle' });

    const basicIdInput = page.locator('#lineBasicId');
    await basicIdInput.waitFor({ state: 'visible', timeout: 15_000 });
    await basicIdInput.fill('');
    await basicIdInput.fill('@qr-verify-test');
    // React 受控輸入觸發 addFriendUrl 重新計算是同步的，但 QR 產生是非同步 effect，
    // 用「加入好友」連結的 href 真的變成新值來確認 —— 這正是「畫面上顯示的那個網址」
    await page.waitForFunction(
      () => {
        const a = Array.from(document.querySelectorAll('a')).find((el) =>
          el.textContent?.includes('加入好友'));
        return !!a && a.getAttribute('href')?.includes('qr-verify-test');
      },
      { timeout: 10_000 },
    );

    const addFriendLink = page.locator('a', { hasText: '加入好友' });
    lineUrl = await addFriendLink.getAttribute('href');
    check('line-settings 頁加好友連結（畫面上顯示的那個網址）已更新',
      !!lineUrl && lineUrl.includes('qr-verify-test'), lineUrl);

    // 等 QR 圖片真的重繪成新內容
    await page.waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.some((img) => img.getAttribute('src')?.startsWith('data:image/png;base64,'));
      },
      { timeout: 15_000 },
    );

    await page.screenshot({ path: path.join(OUT_DIR, 'qr-line-settings.png'), fullPage: true });

    const lineDownloadBtn = page.getByRole('button', { name: '下載 QR Code' });
    await lineDownloadBtn.waitFor({ state: 'visible' });
    const lineDisabled = await lineDownloadBtn.isDisabled();
    check('line-settings 頁下載按鈕已啟用（不再是 issue #3 誠實化時的硬停用）', !lineDisabled);

    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      lineDownloadBtn.click(),
    ]);
    const suggested2 = download2.suggestedFilename();
    check('line-settings 頁按下下載鈕觸發了真的 download 事件', true, `suggestedFilename=${suggested2}`);
    const attempts2 = await page.evaluate(() => window.__qrDownloadAttempts);
    const attempt2 = attempts2[attempts2.length - 1];
    check(
      'line-settings 頁真正呼叫 <a>.click() 那一刻，download 屬性非空、且與 promote 頁不同'
      + '（不是同一份檔名蓋過去）',
      !!attempt2?.download && attempt2.download !== attempt1?.download,
      JSON.stringify(attempt2),
    );
    const file2 = path.join(DOWNLOAD_DIR, 'line-settings.png');
    await download2.saveAs(file2);

    lineDecoded = decodePngFile(file2);
    check('line-settings 下載到的 PNG 用獨立解碼器（jsqr）解出內容',
      lineDecoded !== null, lineDecoded ?? '(解不出來)');
    check('line-settings 解碼字串與畫面上顯示的加好友連結逐字相符',
      lineDecoded === lineUrl, `decoded=${lineDecoded} / screen=${lineUrl}`);

    /* ============================================== 3. 兩處內容不同 */
    check('兩處 QR 內容不同（不是同一個網址貼兩次還都顯示成功）',
      promoteDecoded !== null && lineDecoded !== null && promoteDecoded !== lineDecoded,
      `promote=${promoteDecoded} / line=${lineDecoded}`);
    check('promote 頁內容不是 LINE 加好友格式（沒有把兩頁接反）',
      !!promoteDecoded && !promoteDecoded.startsWith('https://line.me/'));
    check('line-settings 頁內容是 LINE 加好友格式（沒有把兩頁接反）',
      !!lineDecoded && lineDecoded.startsWith('https://line.me/R/ti/p/'));
  } finally {
    await browser.close();
    try { process.kill(-server.pid); } catch { /* 已結束就略過 */ }
  }

  console.log('\n== 結果彙總 ==');
  const failed = results.filter((r) => !r.passed);
  for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.label}`);
  console.log(`\n${results.length - failed.length}/${results.length} 項通過`);
  if (failed.length > 0) {
    console.error(`\n共 ${failed.length} 項失敗：`);
    failed.forEach((r) => console.error(`  - ${r.label}${r.detail ? `（${r.detail}）` : ''}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('腳本執行失敗：', e);
  process.exit(1);
});
