/**
 * issue #3（修復-1）驗收 3：Preview 站的 Playwright 自主實測。
 *
 * 驗的是「誠實化真的到了使用者眼前」：逐頁走訪 issue #3 誠實化過的頁面，斷言
 *   ① 頁頂有「尚未建置／尚未開通」性質的告示（Alert，不是只寫在程式註解裡）；
 *   ② 做不到的動作真的被停用（disabled），而不是按下去給一句假成功；
 *   ③ 查不到的數字顯示未知態（--），不是看起來合理的假數字；
 *   ④ 仍然可用的真功能沒有被誠實化波及（rich-menu 的「發布到 LINE」）。
 *
 * 本腳本**只讀不寫**：唯三會按下去的按鈕（payment-methods 停用／clinic-queue
 * 看完診／donate 前往贊助／rich-menu 快速套用範本）都是 issue #3 認定「後端不
 * 存在、只改畫面」的動作，正是要驗證它們現在吐的是「尚未生效」而非成功訊息。
 * 因此不會對 Preview 站的資料造成任何變更，也不需要還原步驟。
 *
 * ── 憑證（絕不寫進本檔，15 分冊 §3 禁令 5）────────────────────────────────
 *   PREVIEW_URL   Preview 站網址（預設見 DEFAULT_PREVIEW_URL）
 *   TEST_EMAIL    測試帳號（15 分冊 §4）
 *   TEST_PASSWORD 測試帳號密碼（15 分冊 §4）
 *
 * ── 執行（sandbox 專屬參數見 15 分冊 §5）──────────────────────────────────
 *   NODE_USE_ENV_PROXY=1 TEST_EMAIL=... TEST_PASSWORD=... \
 *     node scripts/verify/issue3-honest-pages.cjs
 *   截圖輸出到 scripts/verify/out/（每頁一張，檔名見 shot() 呼叫）。
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

const results = [];
let currentShot = '';
function check(label, passed, detail) {
  results.push({ label, passed, detail, shot: currentShot });
  console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  const file = `${name}.png`;
  currentShot = file;
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
  console.log(`  截圖 → scripts/verify/out/${file}`);
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
 * 整個頁面 subtree 重新掛載、所有頁面 state 被清空。互動必須等網路靜止後再開始。
 */
async function gotoStable(page, url) {
  page.setDefaultNavigationTimeout(90_000);
  await gotoWithRetry(page, url);
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function login(page) {
  page.setDefaultNavigationTimeout(90_000);
  await gotoWithRetry(page, `${BASE}/tenant/login`);
  await page.locator('#username').waitFor({ state: 'visible', timeout: 45_000 });
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#username').fill(EMAIL);
    await page.locator('#password').fill(PASSWORD);
    if ((await page.locator('#username').inputValue()) === EMAIL) break;
    await page.waitForTimeout(1000);
  }
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await page.waitForURL(/\/tenant\/dashboard/, { timeout: 60_000 });
}

/** main 區塊的純文字（告示、未知態都在這裡面） */
async function mainText(page) {
  return page.locator('main').innerText();
}

/** 按鈕是否 disabled；找不到按鈕也算失敗（比對得出「按鈕還在但沒停用」與「按鈕不見了」） */
async function buttonState(page, name) {
  const btn = page.getByRole('button', { name, exact: true }).first();
  if (!(await btn.count())) return { found: false, disabled: false };
  return { found: true, disabled: await btn.isDisabled() };
}

/** 讀出目前畫面上的 toast 文字（Toast.tsx：role="status"，3.5 秒後消失） */
async function readToast(page) {
  const toast = page.locator('[role="status"]');
  await toast.first().waitFor({ state: 'visible', timeout: 15_000 });
  return (await toast.allInnerTexts()).join(' | ');
}

/** ConfirmModal 有淡入動畫，剛開啟就點會被底層攔截 → 等穩定再點 */
async function clickModalButton(page, name) {
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(600);
  await dialog.getByRole('button', { name, exact: true }).first().click({ timeout: 15_000 });
}

/* ══════════════════════════════════════════════════════ 逐頁斷言 */

async function checkPaymentMethods(page) {
  console.log('\n① /tenant/payment-methods');
  await gotoStable(page, `${BASE}/tenant/payment-methods`);
  const text = await mainText(page);
  await shot(page, 'i3-01-payment-methods');

  check(
    '頁頂有「尚未建置」告示',
    text.includes('金流／收款方式後端尚未建置，本頁設定尚未生效'),
    '告示標題原文比對',
  );
  const testCharge = await buttonState(page, '金流實刷驗證');
  check(
    '「金流實刷驗證」按鈕為 disabled',
    testCharge.found && testCharge.disabled,
    testCharge.found ? `disabled=${testCharge.disabled}` : '找不到該按鈕',
  );

  // 啟停只改畫面 → 必須是「尚未生效」的警告，不是「已停用」之類的成功訊息
  await page.getByRole('button', { name: '停用', exact: true }).first().click();
  const toast = await readToast(page);
  check(
    '按「停用」後顯示「尚未生效」而非成功訊息',
    toast.includes('尚未生效') && !/已停用|已啟用|已儲存/.test(toast),
    `toast 原文：「${toast}」`,
  );
  await shot(page, 'i3-02-payment-methods-toggle-toast');
}

async function checkClinicQueue(page) {
  console.log('\n② /tenant/clinic-queue');
  await gotoStable(page, `${BASE}/tenant/clinic-queue`);
  const text = await mainText(page);
  await shot(page, 'i3-03-clinic-queue');

  check(
    '頁頂有「尚未建置」告示',
    text.includes('看診號碼掛號後端尚未建置，本頁操作尚未生效'),
    '告示標題原文比對',
  );
  check(
    '告示明言不會發送任何 LINE／Email／簡訊給病患',
    text.includes('本頁不會發送任何 LINE、Email 或簡訊給病患'),
    '告示內文原文比對',
  );

  // 「已通知病患」是既成事實的謊；「會通知病患」只有在前面接「不」時才誠實
  const claimedDone = (text.match(/已通知病患/g) || []).length;
  const willNotify = (text.match(/會通知病患/g) || []).length;
  const willNotNotify = (text.match(/不會通知病患/g) || []).length;
  check(
    '頁面文字不含「已通知病患」措辭',
    claimedDone === 0,
    `出現次數：${claimedDone}`,
  );
  check(
    '頁面文字不含未被否定的「會通知病患」措辭',
    willNotify === willNotNotify,
    `「會通知病患」${willNotify} 次，其中「不會通知病患」${willNotNotify} 次`,
  );

  // 逐號看板的「看完✓」只改畫面 → 必須誠實
  const done = page.getByRole('button', { name: '看完✓', exact: true }).first();
  if (await done.count()) {
    await done.click();
    // 「看完✓」先開 ConfirmModal，確認鈕文案是 t.board.complete（'完成看診'）
    await clickModalButton(page, '完成看診');
    const toast = await readToast(page);
    check(
      '按「看完✓」後顯示「尚未生效」而非成功訊息',
      toast.includes('尚未生效') && !/已通知|通知病患完成|已儲存/.test(toast),
      `toast 原文：「${toast}」`,
    );
    await shot(page, 'i3-04-clinic-queue-toast');
  } else {
    check('按「看完✓」後顯示「尚未生效」而非成功訊息', false, '畫面上找不到「看完✓」按鈕');
  }
}

async function checkDonate(page) {
  console.log('\n③ /tenant/donate');
  await gotoStable(page, `${BASE}/tenant/donate`);
  const text = await mainText(page);
  await shot(page, 'i3-05-donate');

  check(
    '頁頂有「尚未建置」告示',
    text.includes('贊助金流後端尚未建置，本頁無法完成任何付款'),
    '告示標題原文比對',
  );
  check(
    '「全平台累積贊助」顯示未知態 --（不是具體數字）',
    /全平台累積贊助\s*\n\s*--/.test(text) && !/全平台累積贊助\s*\n\s*(NT\$)?[\d,]+/.test(text),
    '以「全平台累積贊助」下一行是否為 -- 判定',
  );
  check(
    '「你的累計贊助金額」同樣是未知態',
    text.includes('你的累計贊助金額：--'),
    '原文比對',
  );

  // 前往贊助：確認視窗 → 確定 → 必須是「未送出贊助」，不是「感謝贊助」
  await page.getByRole('button', { name: '100', exact: true }).click();
  await page.getByRole('button', { name: '前往贊助', exact: true }).first().click();
  // ConfirmModal 的 confirmText 是 t.form.submit（'前往贊助'），不是共用的「確定」
  await clickModalButton(page, '前往贊助');
  const toast = await readToast(page);
  check(
    '按「前往贊助」後顯示未送出，而非成功訊息',
    toast.includes('未送出贊助') && !/感謝|已送出|贊助成功/.test(toast),
    `toast 原文：「${toast}」`,
  );
  await shot(page, 'i3-06-donate-toast');
}

async function checkReferrals(page) {
  console.log('\n④ /tenant/referrals');
  await gotoStable(page, `${BASE}/tenant/referrals`);
  const text = await mainText(page);
  await shot(page, 'i3-07-referrals');

  check('頁頂有「尚未開通」告示', text.includes('推薦碼功能尚未開通'), '告示標題原文比對');

  for (const label of ['總推薦數', '已完成', '待完成', '累計獲得點數']) {
    check(
      `統計卡「${label}」顯示 --`,
      new RegExp(`${label}\\s*\\n\\s*--`).test(text),
      '以標籤下一行是否為 -- 判定',
    );
  }

  const code = page.getByLabel('您的推薦碼');
  check(
    '推薦碼欄位顯示「尚未開通」',
    (await code.inputValue()) === '尚未開通',
    `實際值：「${await code.inputValue()}」`,
  );
  const link = await page.locator('#referralLink').inputValue();
  check('推薦連結欄位同樣未開通', link.startsWith('尚未開通'), `實際值：「${link}」`);

  for (const name of ['複製推薦碼', '複製', 'LINE 分享']) {
    const st = await buttonState(page, name);
    check(
      `「${name}」按鈕為 disabled`,
      st.found && st.disabled,
      st.found ? `disabled=${st.disabled}` : '找不到該按鈕',
    );
  }
}

/** calendar-sync 頁與 settings 的「行事曆同步」分頁共用同一組誠實化控制項 */
async function assertIcsBlock(page, where) {
  const url = await page.locator('#calIcsUrl').inputValue();
  check(`${where}：ICS 網址欄位顯示「尚未開通」`, url === '尚未開通', `實際值：「${url}」`);
  check(
    `${where}：ICS 網址欄位為 disabled`,
    await page.locator('#calIcsUrl').isDisabled(),
    '欄位 disabled 屬性',
  );
  for (const name of ['複製訂閱網址', '加入 Google Calendar', '重新產生網址']) {
    const st = await buttonState(page, name);
    check(
      `${where}：「${name}」按鈕為 disabled`,
      st.found && st.disabled,
      st.found ? `disabled=${st.disabled}` : '找不到該按鈕',
    );
  }
}

async function checkCalendarSync(page) {
  console.log('\n⑤ /tenant/calendar-sync');
  await gotoStable(page, `${BASE}/tenant/calendar-sync`);
  const text = await mainText(page);
  await shot(page, 'i3-08-calendar-sync');

  check(
    '頁頂有「尚未建置」告示',
    text.includes('行事曆同步後端尚未建置，本頁的訂閱網址與外部行事曆都不會生效'),
    '告示標題原文比對',
  );
  await assertIcsBlock(page, 'calendar-sync');
}

async function checkSettingsIcs(page) {
  console.log('\n⑥ /tenant/settings（行事曆同步分頁）');
  await gotoStable(page, `${BASE}/tenant/settings#calendar-sync`);
  // 網址的 #calendar-sync 已經會把分頁切過去；只有沒切到時才需要點分頁鈕
  const icsUrlField = page.locator('#calIcsUrl');
  if (!(await icsUrlField.isVisible().catch(() => false))) {
    await page
      .getByRole('button', { name: '行事曆同步', exact: true })
      .first()
      .click({ timeout: 60_000 });
  }
  await icsUrlField.waitFor({ state: 'visible', timeout: 60_000 });
  const text = await mainText(page);
  await shot(page, 'i3-09-settings-ics');

  check(
    'ICS 分頁有「尚未建置」告示',
    text.includes('ICS 訂閱端點尚未建置，此處無法提供可用的訂閱網址'),
    '告示標題原文比對',
  );
  await assertIcsBlock(page, 'settings ICS 分頁');
}

async function checkQrDownloads(page) {
  console.log('\n⑦ QR 下載按鈕（promote / line-settings）');
  await gotoStable(page, `${BASE}/tenant/promote`);
  await shot(page, 'i3-10-promote');
  const promoteBtn = await buttonState(page, '下載 QR（印門口 / 名片）');
  check(
    'promote：「下載 QR（印門口 / 名片）」為 disabled',
    promoteBtn.found && promoteBtn.disabled,
    promoteBtn.found ? `disabled=${promoteBtn.disabled}` : '找不到該按鈕',
  );

  await gotoStable(page, `${BASE}/tenant/line-settings`);
  await shot(page, 'i3-11-line-settings');
  const lineBtn = await buttonState(page, '下載 QR Code');
  check(
    'line-settings：「下載 QR Code」為 disabled',
    lineBtn.found && lineBtn.disabled,
    lineBtn.found ? `disabled=${lineBtn.disabled}` : '找不到該按鈕',
  );
  // 停用理由寫在按鈕的 title 提示（滑鼠移上去才看得到）
  const lineTitle =
    (await page.getByRole('button', { name: '下載 QR Code', exact: true }).first().getAttribute('title')) ?? '';
  check(
    'line-settings：停用鈕的 title 說明 QR 下載尚未建置',
    lineTitle.includes('QR Code 下載尚未建置'),
    `title 原文：「${lineTitle}」`,
  );
  // 畫面上讀得到的說明在「如何讓顧客加入？」第 1 項
  check(
    'line-settings：畫面可見文字說明 QR 下載尚未建置',
    (await mainText(page)).includes('本站的 QR 下載尚未建置'),
    '「如何讓顧客加入？」第 1 項原文比對',
  );
}

async function checkRichMenuDesign(page) {
  console.log('\n⑧ /tenant/rich-menu-design');
  await gotoStable(page, `${BASE}/tenant/rich-menu-design`);
  await shot(page, 'i3-12-rich-menu-design');

  // 真功能不該被誠實化波及：發布走 POST /api/settings/line/rich-menu/create
  const publish = page.getByRole('button', { name: '發布到 LINE', exact: true });
  const publishCount = await publish.count();
  let anyDisabled = false;
  for (let i = 0; i < publishCount; i += 1) {
    if (await publish.nth(i).isDisabled()) anyDisabled = true;
  }
  check(
    'Rich Menu 分頁的「發布到 LINE」仍可用（未被誠實化波及）',
    publishCount > 0 && !anyDisabled,
    `按鈕數：${publishCount}，是否有被 disabled：${anyDisabled}`,
  );

  // 快速套用範本：展開卡片 → 點任一張範本 → 必須是「尚未生效」而非成功
  const quickCard = page.locator('.card', { hasText: '快速套用範本（選一個開始，再微調）' }).first();
  await quickCard.getByRole('button', { name: '展開 / 收合', exact: true }).click();
  const notBuiltAlert = quickCard.getByText('範本套用尚未建置', { exact: false });
  await notBuiltAlert.waitFor({ state: 'visible', timeout: 20_000 });
  check('快速套用範本區有「尚未建置」告示', true, '原文比對');

  const firstTemplate = quickCard.locator('button.rounded-lg').first();
  await firstTemplate.click();
  const toast = await readToast(page);
  check(
    '點範本卡顯示「未套用…尚未建置」而非成功訊息',
    toast.includes('未套用') && toast.includes('尚未建置') && !/已套用|已上線|已暫存/.test(toast),
    `toast 原文：「${toast}」`,
  );
  await shot(page, 'i3-13-rich-menu-quick-template-toast');
}

/* ══════════════════════════════════════════════════════════ main */

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
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page);
    console.log(`登入成功：${page.url()}`);

    const steps = [
      checkPaymentMethods,
      checkClinicQueue,
      checkDonate,
      checkReferrals,
      checkCalendarSync,
      checkSettingsIcs,
      checkQrDownloads,
      checkRichMenuDesign,
    ];
    for (const step of steps) {
      // 單一頁面出錯不該掩蓋其他頁的結果：記成 FAIL 後繼續
      try {
        await step(page);
      } catch (e) {
        check(`${step.name} 執行中斷`, false, String(e && e.message).slice(0, 300));
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }

  console.log('\n===== 結果彙總（頁面 → 斷言 → 結果 → 截圖）=====');
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.label}${r.shot ? `  [${r.shot}]` : ''}`);
  }
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 通過`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n[腳本異常中止]', e);
  process.exit(1);
});
