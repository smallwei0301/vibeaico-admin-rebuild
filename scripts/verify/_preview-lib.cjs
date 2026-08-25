/**
 * Preview 站頁面層實測的共用工具（sandbox 專屬參數見 15 分冊 §5）。
 *
 * 為什麼要有這一層：CLAUDE.md 記著的結構性盲點——單元測試不涵蓋頁面、整合測試
 * 刻意不測 UI、e2e 只在矩陣點名處跑，於是「頁面接線」不屬於任何一層。這組腳本
 * 就是補那一層：對**已部署的 Preview 站**用真實瀏覽器操作，判準一律是
 * 「重新整理後還在嗎」或「直查資料庫對得上嗎」，**不以 toast 為證據**。
 *
 * ── 憑證（絕不寫進檔案，15 分冊 §3 禁令 5）─────────────────────────────────
 *   PREVIEW_URL   Preview 站網址（預設見 DEFAULT_PREVIEW_URL）
 *   TEST_EMAIL / TEST_PASSWORD   測試帳號（15 分冊 §4）
 *   SUPABASE_ACCESS_TOKEN        直查資料庫用（Management API，sbp_…）
 */
const path = require('node:path');
const fs = require('node:fs');

// CLAUDE.md：Playwright 裝在全域，不在本專案 node_modules，必須 require 絕對路徑
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const DEFAULT_PREVIEW_URL =
  'https://vibeaico-admin-rebuild-git-claude-70df20-smallwei0301s-projects.vercel.app';

/** 正式 Supabase 專案（Vercel production + preview 都接這個，見 CLAUDE.md） */
const PROD_REF = 'egehnijjpgijmccagxac';

const BASE = process.env.PREVIEW_URL || DEFAULT_PREVIEW_URL;
/** BASE 是不是本機（決定要不要帶出口 proxy，見 launch()） */
const LOCAL_BASE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE);
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `[缺少環境變數] ${name} —— 請先自 Google Drive 文件「#Supabase#midao」／.env.local 取值後 export。`,
    );
    process.exit(2);
  }
  return v;
}

/* ────────────────────────────────────────────────────────── 結果紀錄 */

const results = [];
let currentShot = '';

function check(label, passed, detail) {
  results.push({ label, passed, detail, shot: currentShot });
  console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
  return passed;
}

/** 測不到就說測不到：既不算通過也不算失敗，報告要看得出差別 */
function blocked(label, detail) {
  results.push({ label, passed: null, detail, shot: currentShot });
  console.log(`  [BLOCKED] ${label}${detail ? ` — ${detail}` : ''}`);
}

function summary() {
  const pass = results.filter((r) => r.passed === true).length;
  const fail = results.filter((r) => r.passed === false).length;
  const skip = results.filter((r) => r.passed === null).length;
  console.log(`\n═══ 合計 ${results.length} 條：PASS ${pass} / FAIL ${fail} / BLOCKED ${skip} ═══`);
  for (const r of results.filter((x) => x.passed !== true)) {
    console.log(`  ${r.passed === false ? 'FAIL' : 'BLOCKED'}: ${r.label} — ${r.detail || ''} (${r.shot})`);
  }
  return { pass, fail, skip };
}

async function shot(page, name) {
  const file = `${name}.png`;
  currentShot = file;
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
  console.log(`  截圖 → scripts/verify/out/${file}`);
  return file;
}

/* ──────────────────────────────────────────────────────── 瀏覽器操作 */

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
 * AppShell 的 `<main key={current.id || businessType}>` 會在 /api/auth/my-tenants
 * 回來、current.id 由空字串換成真 tenant id 的瞬間換 key，整個 subtree 重新掛載、
 * 頁面 state 全被清空。互動一律等網路靜止後再開始。
 */
async function gotoStable(page, url) {
  page.setDefaultNavigationTimeout(90_000);
  await gotoWithRetry(page, url);
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function launch() {
  return chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    /*
     * 出口 proxy 只在打**遠端** Preview 站時需要（埠號每個 session 不同，讀環境變數）。
     * BASE 指向本機 dev server（PREVIEW_URL=http://localhost:PORT）時**整個不要帶
     * proxy**：帶了瀏覽器會把 localhost 也送去 proxy，症狀是頁面永遠載不出來、
     * 登入頁的 #username 等到逾時（2026-08-25 實測踩過；先試 `proxy.bypass` 仍然
     * 連不上，所以是整段拿掉而不是加白名單）。
     */
    ...(LOCAL_BASE ? {} : { proxy: { server: process.env.HTTPS_PROXY } }),
    args: [
      '--no-sandbox',
      // 出口 proxy 的攔截 CA（三組 SPKI，缺一可能握手失敗）
      '--ignore-certificate-errors-spki-list=gBdItbWylHhTkoJDRwIiMuweY/qX4F0bJmLNs5wosUQ=,KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=,PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0=',
      '--ssl-version-max=tls1.2', // proxy 不支援 Chromium 的 TLS1.3 ClientHello
    ],
  });
}

/**
 * 登入。React 尚未 hydrate 前 fill 進去的值不會進 controlled state，送出會變空字串，
 * 所以 fill 後回讀確認值真的有進去，最多重試三次。
 */
async function login(page, email, password) {
  page.setDefaultNavigationTimeout(90_000);
  await gotoWithRetry(page, `${BASE}/tenant/login`);
  await page.locator('#username').waitFor({ state: 'visible', timeout: 45_000 });
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#username').fill(email);
    await page.locator('#password').fill(password);
    if ((await page.locator('#username').inputValue()) === email) break;
    await page.waitForTimeout(1000);
  }
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await page.waitForURL(/\/tenant\/dashboard/, { timeout: 60_000 });
}

/** 讀出目前畫面上的 toast 文字（Toast.tsx：role="status"，數秒後消失） */
async function readToast(page, timeout = 15_000) {
  const toast = page.locator('[role="status"]');
  await toast.first().waitFor({ state: 'visible', timeout });
  await page.waitForTimeout(300);
  return (await toast.allInnerTexts()).join(' | ');
}

/** 等 toast 消失，避免上一則被誤讀成下一個動作的結果 */
async function waitToastGone(page) {
  await page.locator('[role="status"]').first()
    .waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * 點「最上層那個 modal 的 footer 按鈕」。
 *
 * 兩個細節都被踩過：
 * ① Modal 有淡入動畫，剛開啟就點會被底層攔截 → 等穩定再點。
 * ② Modal 用 createPortal 掛到 document.body，後開的在 DOM 後面，所以取 `.last()`；
 *    而且只找 `.modal-footer`——不然 ConfirmModal 的「刪除」會跟底下那層清單裡
 *    aria-label="刪除" 的每一顆列按鈕搶同一個名字。
 */
async function clickModalButton(page, name) {
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(600);
  await dialog.locator('.modal-footer').getByRole('button', { name, exact: true })
    .first().click({ timeout: 15_000 });
}

/* ─────────────────────────────────────────────────── 資料庫直查 */

/**
 * 直查正式 Supabase 專案（Preview 站接的就是它）。
 * sandbox 只通 HTTPS，psql / supabase db push 連不上，一律走 Management API。
 */
async function sql(query, ref = PROD_REF) {
  const token = required('SUPABASE_ACCESS_TOKEN');
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${text}`);
  return JSON.parse(text);
}

module.exports = {
  BASE, PROD_REF, OUT_DIR,
  required, check, blocked, summary, shot,
  gotoWithRetry, gotoStable, launch, login,
  readToast, waitToastGone, clickModalButton, sql,
};
