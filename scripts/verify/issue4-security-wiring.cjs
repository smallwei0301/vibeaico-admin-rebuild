/**
 * issue #4（修復-2）驗收 4：Preview 站的 Playwright 自主實測。
 *
 * 驗的是「頁面按鈕真的把副作用做出來了」，三件各跑一輪並**還原原狀**：
 *   ① 變更密碼：改成臨時密碼 → 用舊密碼登入應失敗、新密碼應成功 → 改回原密碼。
 *   ② 登出：點 Topbar 的登出鈕 → 應被導回登入頁 → 再訪 /tenant/dashboard 應被
 *      middleware 擋回登入頁（session 真的失效了，不是只有換頁）。
 *   ③ LINE 解除連接：以 Midao 憑證重新綁定 → 解除連接 → 連線狀態顯示「未設定」
 *      且「完整檢查」五項訊息都是「尚未設定」→ 重新綁回（測完恢復原狀）。
 *
 * ⚠️ 執行時機：Preview 站部署的是 push 之後的版本。本次任務只 commit 不 push，
 * 所以撰寫當下 Preview 站還是「改動前」的舊版，跑起來 ①②③ 都會紅（那正是
 * issue #4 要修的假成功）。**請在調度者 push 並確認 Preview deployment READY
 * 之後再執行**，並把輸出貼回 issue #4 驗收 4。
 *
 * ── 憑證（絕不寫進本檔，15 分冊 §3 禁令 5）────────────────────────────────
 * 全部從環境變數讀，值請自 Google Drive 文件「#Supabase#midao」取得：
 *   PREVIEW_URL            Preview 站網址（預設見下方 DEFAULT_PREVIEW_URL）
 *   TEST_EMAIL             測試帳號（15 分冊 §4：sulawei0301@gmail.com）
 *   TEST_PASSWORD          測試帳號密碼（15 分冊 §4：跑完必須是這一組）
 *   LINE_CHANNEL_ID        Midao 頻道 Channel ID
 *   LINE_CHANNEL_SECRET    Midao 頻道 Channel Secret
 *   LINE_ACCESS_TOKEN      Midao 頻道長期 Access Token
 *
 * ── 執行（sandbox 專屬參數見 15 分冊 §5）──────────────────────────────────
 *   NODE_USE_ENV_PROXY=1 node scripts/verify/issue4-security-wiring.cjs
 *   截圖輸出到 scripts/verify/out/（每一步一張，檔名見 shot() 呼叫）。
 */
const path = require('node:path');
const fs = require('node:fs');

// CLAUDE.md：Playwright 裝在全域，不在本專案 node_modules，必須 require 絕對路徑
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const DEFAULT_PREVIEW_URL =
  'https://vibeaico-admin-rebuild-git-claude-70df20-smallwei0301s-projects.vercel.app';

const BASE = process.env.PREVIEW_URL || DEFAULT_PREVIEW_URL;
const EMAIL = required('TEST_EMAIL');
const PASSWORD = required('TEST_PASSWORD');
const LINE_CHANNEL_ID = required('LINE_CHANNEL_ID');
const LINE_CHANNEL_SECRET = required('LINE_CHANNEL_SECRET');
const LINE_ACCESS_TOKEN = required('LINE_ACCESS_TOKEN');

/** 暫時用的密碼；跑完一定改回 TEST_PASSWORD（15 分冊 §4：擁有者只記那一組） */
const TEMP_PASSWORD = `Tmp!${Date.now().toString(36)}Aa1`;

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `[缺少環境變數] ${name} —— 請先自 Google Drive 文件「#Supabase#midao」取值後 export。`,
    );
    process.exit(2);
  }
  return v;
}

let step = 0;
async function shot(page, name) {
  step += 1;
  const file = path.join(OUT_DIR, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  截圖 → ${file}`);
}

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed, detail });
  console.log(`${passed ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
}


/** sandbox 走出口 proxy，冷啟動時偶爾單次 goto 逾時；重試兩次再放棄 */
async function gotoWithRetry(page, url) {
  let last;
  for (let i = 0; i < 3; i += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      return;
    } catch (e) {
      last = e;
      await page.waitForTimeout(2000);
    }
  }
  throw last;
}

/**
 * 導頁後等到頁面「不會再被重掛載」為止。
 * AppShell 的 `<main key={current.id || businessType}>`（src/components/layout/AppShell.tsx:149）
 * 會在 /api/auth/my-tenants 回來、current.id 由空字串變成真正 tenant id 的瞬間換 key，
 * 整個頁面 subtree 重新掛載、所有頁面 state（含已填欄位與已開啟的 ConfirmModal）被清空。
 * 因此所有互動都必須等網路靜止之後再開始。
 */
async function gotoStable(page, url) {
  page.setDefaultNavigationTimeout(90_000);
  await gotoWithRetry(page, url);
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function login(page, password) {
  page.setDefaultNavigationTimeout(90_000);
  await gotoWithRetry(page, `${BASE}/tenant/login`);
  // React 尚未 hydrate 前 fill 進去的值不會進 state，送出會變空字串 → 必須等欄位
  // 真的可見、且填完後回讀確認值有進去，否則重填一次。
  await page.locator('#username').waitFor({ state: 'visible', timeout: 45_000 });
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#username').fill(EMAIL);
    await page.locator('#password').fill(password);
    if ((await page.locator('#username').inputValue()) === EMAIL) break;
    await page.waitForTimeout(1000);
  }
  await page.getByRole('button', { name: '登入', exact: true }).click();
}

/** 回傳登入是否成功（成功＝被帶進 /tenant/dashboard） */
async function loginSucceeds(page, password) {
  await login(page, password);
  try {
    await page.waitForURL(/\/tenant\/dashboard/, { timeout: 45_000 });
    return true;
  } catch {
    return false;
  }
}

/** ConfirmModal 的確認鈕（頁面上常有同名主按鈕，必須限定在 dialog 內） */
function modalButton(page, name) {
  return page.locator('[role="dialog"]').getByRole('button', { name, exact: true });
}

/**
 * 點 ConfirmModal 的確認鈕。modal 有淡入動畫，剛開啟的瞬間點下去會被底層
 * card-body 攔截 pointer events，Playwright 重試時 modal 已重繪 → 元素 detached，
 * 於是整串 30s 逾時。等 dialog 穩定後再點，並容忍一次重試。
 */
async function clickModalButton(page, name) {
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(600);
  const btn = modalButton(page, name);
  try {
    await btn.click({ timeout: 10_000 });
  } catch {
    if (await dialog.count()) await btn.click({ timeout: 10_000, force: true });
  }
}

async function changePassword(page, currentPassword, newPassword) {
  await gotoStable(page, `${BASE}/tenant/settings#security`);
  await page.locator('#currentPassword').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#currentPassword').fill(currentPassword);
  await page.locator('#newPassword').fill(newPassword);
  await page.locator('#confirmPassword').fill(newPassword);
  await page.getByRole('button', { name: '更改密碼', exact: true }).first().click();
  await clickModalButton(page, '更改密碼');
  // 成功 toast 只會在 POST /api/auth/change-password 真的 200 之後出現
  await page.getByText('密碼已更改', { exact: false }).waitFor({ timeout: 20_000 });
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    proxy: { server: process.env.HTTPS_PROXY },   // 埠號每個 session 不同，讀環境變數
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors-spki-list=gBdItbWylHhTkoJDRwIiMuweY/qX4F0bJmLNs5wosUQ=,KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=,PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0=',
      '--ssl-version-max=tls1.2',
    ],
  });

  try {
    /* ================================================= ① 變更密碼 */
    console.log('\n① 變更密碼（settings 頁 → POST /api/auth/change-password）');
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      check('原密碼可登入（前提）', await loginSucceeds(page, PASSWORD));
      await changePassword(page, PASSWORD, TEMP_PASSWORD);
      await shot(page, 'change-password-toast');
      await ctx.close();
    }
    {
      // 舊密碼必須失效——舊版的 480ms 假延遲就是敗在這一條
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const ok = await loginSucceeds(page, PASSWORD);
      check('改密碼後：舊密碼登不進去', !ok, ok ? '仍然登入成功＝密碼根本沒改' : '停在登入頁');
      await shot(page, 'old-password-rejected');
      await ctx.close();
    }
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      check('改密碼後：新密碼登得進去', await loginSucceeds(page, TEMP_PASSWORD));
      // 還原：改回擁有者記得的那一組
      await changePassword(page, TEMP_PASSWORD, PASSWORD);
      await shot(page, 'password-restored');
      await ctx.close();
    }
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      check('還原完成：原密碼可再次登入', await loginSucceeds(page, PASSWORD), '密碼已回到原值');
      await ctx.close();
    }

    /* ================================================= ② 登出 */
    console.log('\n② 登出（Topbar → POST /api/auth/logout）');
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      check('登入成功（前提）', await loginSucceeds(page, PASSWORD));

      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
      // .topbar-right 底下第二個 .relative 觸發鈕＝使用者選單（第一個是店家切換）
      await page.locator('.topbar-right > .relative > button').nth(1).click();
      await page.getByRole('button', { name: '登出', exact: true }).click();
      await page.waitForURL(/\/tenant\/login/, { timeout: 20_000 });
      check('點登出後被導回登入頁', /\/tenant\/login/.test(page.url()), page.url());
      await shot(page, 'after-logout');

      await gotoWithRetry(page, `${BASE}/tenant/dashboard`);
      await page.waitForURL(/\/tenant\/login/, { timeout: 20_000 }).catch(() => {});
      const blocked = /\/tenant\/login/.test(page.url());
      check('登出後再訪 dashboard 被 middleware 擋回登入頁', blocked, page.url());
      await shot(page, 'dashboard-blocked');
      await ctx.close();
    }

    /* ================================================= ③ LINE 解除連接 */
    console.log('\n③ LINE 解除連接（line-settings → POST /api/settings/line/disconnect）');
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      check('登入成功（前提）', await loginSucceeds(page, PASSWORD));

      await bindLine(page);
      await shot(page, 'line-bound');

      // 解除連接
      await page.getByRole('button', { name: '解除綁定', exact: true }).first().click();
      await clickModalButton(page, '解除綁定');
      await page.getByText('LINE 帳號已解除綁定', { exact: false }).waitFor({ timeout: 20_000 });
      await shot(page, 'line-disconnected-toast');

      // 重新整理後仍必須是未設定（舊版送空字串＝不變更，重整後 token 又回來了）
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
      await page.locator('#channelId').waitFor({ state: 'visible', timeout: 20_000 });
      const channelIdAfter = await page.locator('#channelId').inputValue();
      check('重整後 Channel ID 欄位為空', channelIdAfter === '', `實際值：「${channelIdAfter}」`);
      const notConfigured = await page.getByText('未設定', { exact: true }).count();
      check('連線狀態顯示「未設定」', notConfigured > 0, `符合的節點數：${notConfigured}`);
      await shot(page, 'line-after-reload');

      // 完整檢查五項應全是「尚未設定」
      await page.getByRole('button', { name: '完整檢查', exact: true }).click();
      const report = page.locator('[role="dialog"]');
      await report.waitFor({ state: 'visible', timeout: 30_000 });
      const reportText = await report.innerText();
      const notSetCount = (reportText.match(/尚未設定/g) || []).length;
      check('檢查報告五項都回「尚未設定」', notSetCount >= 5, `出現次數：${notSetCount}`);
      await shot(page, 'verify-report-not-configured');
      await page.getByRole('button', { name: '關閉', exact: true }).first().click();

      // 還原：把 Midao 憑證綁回去（15 分冊 §6：測完恢復原狀）
      await bindLine(page);
      await shot(page, 'line-rebound');
      check('已重新綁回 Midao 憑證（還原原狀）', true, '見上方截圖');
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log('\n===== 結果彙總 =====');
  for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.label}`);
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 通過`);
  process.exit(failed.length === 0 ? 0 : 1);
}

/** 點該欄位那一列的「重新輸入」，直到欄位真的可編輯（最多 5 次） */
async function unlockSecretField(page, inputId) {
  const input = page.locator(`#${inputId}`);
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  for (let i = 0; i < 5; i += 1) {
    if (await input.isEditable()) return;
    // Input 元件渲染成裸 <input>，其父層 flex 容器裡就是同一列的按鈕
    const btn = input.locator('..').getByRole('button', { name: '重新輸入', exact: true });
    if (await btn.count()) await btn.first().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  throw new Error(`#${inputId} 按了「重新輸入」仍不可編輯`);
}

/** 在 line-settings 頁填入 Midao 三組金鑰並儲存（密文欄位要先按「重新輸入」才可填） */
async function bindLine(page) {
  await gotoStable(page, `${BASE}/tenant/line-settings`);
  await page.locator('#channelId').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#channelId').fill(LINE_CHANNEL_ID);

  // 已存有遮罩值時兩個密文欄位是唯讀，要先按同一列的「重新輸入」才變成可編輯空欄位
  // （15 分冊 §5）。用 nth 索引一次點兩顆並不可靠：React 尚未 hydrate 完時點下去
  // 不會改 state，且點完 DOM 會重排。改為「逐欄位、確認真的變成可編輯為止」。
  await unlockSecretField(page, 'channelSecret');
  await unlockSecretField(page, 'channelAccessToken');

  await page.locator('#channelSecret').fill(LINE_CHANNEL_SECRET);
  await page.locator('#channelAccessToken').fill(LINE_ACCESS_TOKEN);

  await page.getByRole('button', { name: '儲存設定', exact: true }).first().click();
  await page.getByText('LINE 設定已儲存', { exact: false }).waitFor({ timeout: 30_000 });
}

main().catch((e) => {
  console.error('\n[腳本異常中止]', e);
  process.exit(1);
});
