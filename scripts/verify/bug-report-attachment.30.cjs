/**
 * issue #30 — 「回報問題」截圖上傳的瀏覽器實測（DoD 11：真的用滑鼠走一遍）
 * -----------------------------------------------------------------------------
 * 單元測試只讀原始碼（node 環境無法 render React），整合測試打的是端點——
 * 兩者都證明不了「使用者在瀏覽器裡選了檔案、按下送出，那張圖真的進了 storage」。
 * 這支腳本補的就是這一段：
 *
 *   登入 → 開回報 modal → 填四欄 → **選一個真的檔案** → 按送出 →
 *   等成功 toast → 以 service role 查 bug_reports 最新一列 →
 *   拿 attachment_path 回頭問 Storage，物件與位元組都在。
 *
 * 用法（需要一個已經跑起來的 next dev，見 --base）：
 *   NODE_USE_ENV_PROXY=1 node scripts/verify/bug-report-attachment.30.cjs \
 *     --base http://localhost:3100 --email owner-a@test.local --password 'Passw0rd!a'
 *
 * 沙箱專屬的 chromium 啟動參數見 docs/integration/15-AGENT-PLAYBOOK.md §5
 * （proxy 埠每次 session 不同，必須讀環境變數；TLS1.3 ClientHello 不通，要降到 1.2）。
 * 副檔名用 .cjs：全域 Playwright 在 /opt，必須 require() 絕對路徑。
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { createClient } = require('/home/user/vibeaico-admin-rebuild/node_modules/@supabase/supabase-js');
const fs = require('node:fs');
const path = require('node:path');

const BUCKET = 'bug-report-attachments';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

(async () => {
  const base = arg('base', 'http://localhost:3100');
  const email = arg('email', 'owner-a@test.local');
  const password = arg('password', 'Passw0rd!a');
  const env = loadEnvFile('/home/user/vibeaico-admin-rebuild/.env.test');
  const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bugshot-'));
  const shot = path.join(tmpDir, 'screenshot.png');
  fs.writeFileSync(shot, PNG_1X1);

  const stamp = Date.now().toString(36);
  const subject = `E2E 截圖-${stamp}`;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors-spki-list=gBdItbWylHhTkoJDRwIiMuweY/qX4F0bJmLNs5wosUQ=,KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=,PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0=',
      '--ssl-version-max=tls1.2',
    ],
  });
  const page = await browser.newPage();
  const fail = async (msg) => {
    await page.screenshot({ path: `${tmpDir}/failure.png`, fullPage: true }).catch(() => {});
    console.error(`FAIL: ${msg}  (截圖：${tmpDir}/failure.png)`);
    await browser.close();
    process.exit(1);
  };

  try {
    // ---- 1. 登入 ----
    await page.goto(`${base}/tenant/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('#username', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/tenant\/(dashboard|bookings)/, { timeout: 30000 });
    console.log(`OK  登入成功：${page.url()}`);

    // ---- 2. 開回報 modal ----
    await page.click('button[aria-label="回報問題"]');
    await page.waitForSelector('#bugShot', { state: 'visible', timeout: 10000 });

    // 前提檢查：欄位不得是停用狀態（issue #28 的誠實化狀態已被 #30 取代）
    if (await page.isDisabled('#bugShot')) await fail('截圖欄位仍然 disabled');
    console.log('OK  截圖欄位已啟用（不再是「尚未建置」的停用狀態）');

    // ---- 3. 填四欄 + 選檔案 ----
    await page.selectOption('#bugCategory', 'BUG');
    await page.fill('#bugSubject', subject);
    await page.fill('#bugDesc', `E2E 詳細說明-${stamp}`);
    await page.fill('#bugEmail', `e2e-${stamp}@example.test`);
    await page.setInputFiles('#bugShot', shot);
    console.log(`OK  已選擇檔案：${shot}`);

    // ---- 4. 送出，等真正的成功 toast ----
    const uploadResp = page.waitForResponse(
      (r) => r.url().includes('/api/upload') && r.request().method() === 'POST',
      { timeout: 30000 },
    );
    const reportResp = page.waitForResponse(
      (r) => r.url().includes('/api/bug-report') && r.request().method() === 'POST',
      { timeout: 30000 },
    );
    await page.click('button:has-text("送出回報")');
    const up = await uploadResp;
    const rep = await reportResp;
    console.log(`OK  POST /api/upload → ${up.status()}`);
    console.log(`OK  POST /api/bug-report → ${rep.status()}`);
    if (up.status() !== 200 || rep.status() !== 200) await fail('端點未回 200');

    await page.waitForSelector('text=已收到您的回報，感謝協助！', { timeout: 10000 });
    console.log('OK  畫面顯示成功訊息（且它出現在兩支端點回 200 之後）');
    await page.screenshot({ path: `${tmpDir}/submitted.png`, fullPage: true });

    // ---- 5. service role 直查：欄位有值，而且指向的物件真的在 ----
    const { data: row, error } = await admin
      .from('bug_reports')
      .select('id, subject, attachment_path')
      .eq('subject', subject)
      .single();
    if (error || !row) await fail(`bug_reports 查不到 subject=${subject}：${error && error.message}`);
    console.log(`OK  bug_reports 有這一列：id=${row.id} attachment_path=${row.attachment_path}`);
    if (!row.attachment_path) await fail('attachment_path 是空的');

    const dir = row.attachment_path.slice(0, row.attachment_path.lastIndexOf('/'));
    const name = row.attachment_path.slice(row.attachment_path.lastIndexOf('/') + 1);
    const { data: list } = await admin.storage.from(BUCKET).list(dir, { search: name });
    const obj = (list || []).find((o) => o.name === name);
    if (!obj) await fail(`storage 裡找不到物件 ${row.attachment_path}`);
    console.log(`OK  storage.objects 有這個物件：${row.attachment_path}（size=${obj.metadata && obj.metadata.size}）`);

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(row.attachment_path, 60);
    const got = await fetch(signed.signedUrl);
    const bytes = Buffer.from(await got.arrayBuffer());
    console.log(`OK  簽名 URL 下載 → ${got.status}，${bytes.length} bytes（上傳的是 ${PNG_1X1.length} bytes）`);
    if (got.status !== 200 || bytes.length !== PNG_1X1.length) await fail('下載回來的位元組對不上');

    // bucket 是 private：同一個物件的 public 形式必須打不開
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(row.attachment_path).data.publicUrl;
    const pub = await fetch(publicUrl);
    console.log(`OK  public URL → ${pub.status}（private bucket，必須不是 200）`);
    if (pub.status === 200) await fail('bucket 竟然是公開的');

    // ---- 6. 清理本次實測留下的資料 ----
    await admin.from('bug_reports').delete().eq('id', row.id);
    await admin.storage.from(BUCKET).remove([row.attachment_path]);
    console.log('OK  已清理本次實測的 bug_reports 列與 storage 物件');
    console.log(`\nPASS  截圖：${tmpDir}/submitted.png`);
    await browser.close();
  } catch (e) {
    await fail(e && e.stack ? e.stack : String(e));
  }
})();
