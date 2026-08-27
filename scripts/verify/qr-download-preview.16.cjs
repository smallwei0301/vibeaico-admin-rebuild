/**
 * scripts/verify/qr-download-preview.16.cjs
 * -----------------------------------------------------------------------------
 * issue #16（補齊-1）驗收清單第 5 項要求的那一輪：**登入 Preview 站**之後，在
 * promote 與 line-settings 兩頁按下「下載 QR Code」，斷言 download 事件真的觸發、
 * 檔名非空，並把下載到的 PNG 用獨立解碼器（jsqr）解回字串，與**畫面上顯示的那個
 * 網址**逐字比對。
 *
 * ── 為什麼要有這一支，而不是沿用 scripts/verify/qr-download.cjs ─────────────
 * qr-download.cjs 測的是本機 `next dev` 的**骨架模式**（NEXT_PUBLIC_USE_MOCK=true）：
 * 不登入、不連 Supabase，網址來自 src/mock。它在 issue #16 施工當下是合理的選擇
 * （那一輪還沒 push，Preview 上跑的是舊程式碼），但它**不是清單寫的那件事**——
 * 清單寫的是「登入 Preview 站」。兩者的差別是真的：Preview 走真實登入、真實
 * Supabase、production build（minify 後的 client bundle），骨架模式一項都沒走到。
 * 所以這一支補做 Preview 那一輪，而不是把清單改成符合已做的事。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   PREVIEW_URL=<branch alias>  TEST_EMAIL=…  TEST_PASSWORD=…  node 本檔
 * PREVIEW_URL 省略時用 _preview-lib.cjs 的 branch alias 預設值。
 * sandbox 專屬的 Chromium 參數見 docs/integration/15-AGENT-PLAYBOOK.md §5。
 *
 * ⚠️ 本腳本**只讀不寫**：line-settings 的 LINE Basic ID 只在瀏覽器端輸入框填值
 * 讓 QR 重繪，不按儲存，不動 Preview 站接的正式 Supabase 專案任何一列資料。
 *
 * 輸出：截圖與下載檔一律進 scripts/verify/out/（playbook「實測腳本的兩條慣例」）。
 */
const path = require('node:path');
const fs = require('node:fs');

const { PNG } = require('pngjs');
const jsQR = require('jsqr');

const {
  BASE, OUT_DIR, required, check, blocked, summary, launch, login, gotoStable,
} = require('./_preview-lib.cjs');

const DOWNLOAD_DIR = path.join(OUT_DIR, 'downloads-preview');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

/** 用第三方解碼器讀回 PNG 內容——不用 qrcode 自己的中介資料，否則等於自證 */
function decodePngFile(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

/*
 * 這個 sandbox 的無頭 Chromium build 對含中文字元的 `download` 屬性值，下載管理器
 * 一律回報 suggestedFilename() = 'download'（純 ASCII 檔名不受影響）。清單要的是
 * 「suggestedFilename() 非空」，那一條照樣量得到；但為了同時證明**程式碼真的把
 * 正確檔名寫進 <a download>**，這裡另外 hook 住 anchor 的 click，記下當下的
 * download 屬性值。量的是程式設定了什麼，不是這個 build 事後怎麼處理它。
 */
const HOOK = () => {
  window.__qrDownloadAttempts = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedClick() {
    if (this.download) {
      window.__qrDownloadAttempts.push({ download: this.download, hrefPrefix: this.href.slice(0, 24) });
    }
    return origClick.call(this);
  };
};

async function main() {
  const email = required('TEST_EMAIL');
  const password = required('TEST_PASSWORD');

  console.log(`Preview 站：${BASE}`);
  const browser = await launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1200 } });
  await ctx.addInitScript(HOOK);
  const page = await ctx.newPage();

  let promoteDecoded = null;
  let promoteUrl = null;
  let lineDecoded = null;
  let lineUrl = null;
  let promoteFilename = null;

  try {
    await login(page, email, password);
    check('登入 Preview 站成功（導向 /tenant/dashboard）', /\/tenant\/dashboard/.test(page.url()), page.url());

    /* ==================================================== 1. /tenant/promote */
    console.log('\n== /tenant/promote（Preview） ==');
    await gotoStable(page, `${BASE}/tenant/promote`);

    const urlInput = page.locator('input[readonly]').first();
    await urlInput.waitFor({ state: 'visible', timeout: 45_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[readonly]');
        return !!el && el.value && !el.value.includes('載入中');
      },
      { timeout: 45_000 },
    );
    promoteUrl = await urlInput.inputValue();
    check('promote 頁公開預約網址已由真實後端載入', !!promoteUrl && promoteUrl.startsWith('http'), promoteUrl);

    const promoteQrImg = page.locator('img[alt="預約頁 QR Code"]');
    await promoteQrImg.waitFor({ state: 'visible', timeout: 30_000 });
    const promoteImgSrc = await promoteQrImg.getAttribute('src');
    check('promote 頁畫面上的 QR 是真的 data:image/png（不是裝飾用的 lucide 圖示）',
      !!promoteImgSrc && promoteImgSrc.startsWith('data:image/png;base64,'));

    await page.screenshot({ path: path.join(OUT_DIR, 'qr-preview-promote.png'), fullPage: true });

    const downloadBtn = page.getByRole('button', { name: /下載 QR/ });
    await downloadBtn.waitFor({ state: 'visible', timeout: 30_000 });
    check('promote 頁下載鈕已啟用（不再是 issue #3 誠實化時的硬停用）', !(await downloadBtn.isDisabled()));

    const [download1] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      downloadBtn.click(),
    ]);
    const suggested1 = download1.suggestedFilename();
    check('promote 頁按下下載鈕，Preview 站真的觸發 download 事件且 suggestedFilename() 非空',
      !!suggested1, `suggestedFilename=${suggested1}`);
    const a1 = (await page.evaluate(() => window.__qrDownloadAttempts)).at(-1);
    promoteFilename = a1?.download ?? null;
    check('promote 頁呼叫 <a>.click() 當下的 download 屬性＝原站規格的「預約QRcode.png」',
      a1?.download === '預約QRcode.png', JSON.stringify(a1));

    const file1 = path.join(DOWNLOAD_DIR, 'promote.png');
    await download1.saveAs(file1);
    promoteDecoded = decodePngFile(file1);
    check('promote 下載到的 PNG 可被獨立解碼器（jsqr）讀出內容',
      promoteDecoded !== null, promoteDecoded ?? '(解不出來)');
    check('promote 解碼字串與畫面上顯示的公開預約網址逐字相符',
      promoteDecoded === promoteUrl, `decoded=${promoteDecoded} / screen=${promoteUrl}`);

    /* ============================================== 2. /tenant/line-settings */
    console.log('\n== /tenant/line-settings（Preview） ==');
    await gotoStable(page, `${BASE}/tenant/line-settings`);

    const basicIdInput = page.locator('#lineBasicId');
    await basicIdInput.waitFor({ state: 'visible', timeout: 45_000 });
    const existingBasicId = (await basicIdInput.inputValue()).trim();

    /*
     * 這一頁的 QR 內容來自 LINE Basic ID。Preview 站的租戶若還沒填，畫面上就沒有
     * 加好友連結，也就不會有 QR——那是誠實的空狀態，不是失敗。此時在輸入框填一個
     * 值讓 QR 重繪（**不按儲存**，不動資料庫），仍能證明「按鈕→產生→下載→內容
     * 正確」這條鏈路在 Preview 的 production build 上成立。
     */
    const probeId = existingBasicId || '@qr-verify-preview';
    if (!existingBasicId) {
      console.log('  （Preview 租戶尚未設定 LINE Basic ID，於輸入框填入探針值讓 QR 重繪，不儲存）');
      await basicIdInput.fill(probeId);
    }
    await page.waitForFunction(
      (id) => {
        const a = Array.from(document.querySelectorAll('a')).find((el) => el.textContent?.includes('加入好友'));
        return !!a && (a.getAttribute('href') || '').includes(encodeURIComponent(id));
      },
      probeId,
      { timeout: 30_000 },
    );

    lineUrl = await page.locator('a', { hasText: '加入好友' }).getAttribute('href');
    check('line-settings 頁畫面上顯示的加好友連結已就緒', !!lineUrl && lineUrl.startsWith('https://line.me/R/ti/p/'), lineUrl);

    const lineQrImg = page.locator('img[alt]').filter({ hasNot: page.locator('nothing') });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('img')).some((i) => (i.getAttribute('src') || '').startsWith('data:image/png;base64,')),
      { timeout: 30_000 },
    );
    check('line-settings 頁畫面上的 QR 是真的 data:image/png', true, `<img> 數 ${await lineQrImg.count()}`);

    await page.screenshot({ path: path.join(OUT_DIR, 'qr-preview-line-settings.png'), fullPage: true });

    const lineDownloadBtn = page.getByRole('button', { name: '下載 QR Code' });
    await lineDownloadBtn.waitFor({ state: 'visible', timeout: 30_000 });
    check('line-settings 頁下載鈕已啟用（不再是 issue #3 誠實化時的硬停用）', !(await lineDownloadBtn.isDisabled()));

    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      lineDownloadBtn.click(),
    ]);
    const suggested2 = download2.suggestedFilename();
    check('line-settings 頁按下下載鈕，Preview 站真的觸發 download 事件且 suggestedFilename() 非空',
      !!suggested2, `suggestedFilename=${suggested2}`);
    const a2 = (await page.evaluate(() => window.__qrDownloadAttempts)).at(-1);
    check('line-settings 頁 download 屬性非空、且與 promote 頁不同（不是同一份檔名蓋過去）',
      !!a2?.download && a2.download !== promoteFilename, JSON.stringify(a2));

    const file2 = path.join(DOWNLOAD_DIR, 'line-settings.png');
    await download2.saveAs(file2);
    lineDecoded = decodePngFile(file2);
    check('line-settings 下載到的 PNG 可被獨立解碼器（jsqr）讀出內容',
      lineDecoded !== null, lineDecoded ?? '(解不出來)');
    check('line-settings 解碼字串與畫面上顯示的加好友連結逐字相符',
      lineDecoded === lineUrl, `decoded=${lineDecoded} / screen=${lineUrl}`);

    /* ======================================== 3. 兩處內容不同且各自指對地方 */
    check('兩處 QR 內容不同（不是同一個網址貼兩次還都顯示成功）',
      !!promoteDecoded && !!lineDecoded && promoteDecoded !== lineDecoded,
      `promote=${promoteDecoded} / line=${lineDecoded}`);
    check('promote 的內容不是 LINE 加好友格式（沒有把兩頁接反）',
      !!promoteDecoded && !promoteDecoded.startsWith('https://line.me/'));
    check('line-settings 的內容是 LINE 加好友格式（沒有把兩頁接反）',
      !!lineDecoded && lineDecoded.startsWith('https://line.me/R/ti/p/'));
  } catch (e) {
    blocked('腳本中途中斷', String(e && e.message ? e.message : e));
    await page.screenshot({ path: path.join(OUT_DIR, 'qr-preview-error.png'), fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }

  const { fail } = summary();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('腳本執行失敗：', e);
  process.exit(1);
});
