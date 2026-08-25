/**
 * scripts/verify/flex-menu-preview-live.cjs
 * -----------------------------------------------------------------------------
 * issue #6 最後一條驗收的**自主實測**：
 *   Preview 站 Flex 分頁編卡 → 發布 → 對 Preview 送真實形狀的簽章 webhook「選單」
 *   → 以 Midao token 查證這條路走到哪裡 → 測後還原。
 *
 * ⚠️ 這支腳本打的是 **Preview 部署 + 正式 Supabase 專案**（egehnijjpgijmccagxac），
 * 不是 TEST。所以：
 *   - 測前先把 tenant_settings.line 整塊抓下來存檔，測後原樣寫回並再查一次比對。
 *   - webhook 事件用可辨識的假 userId（PROBE_USER_PREFIX），測後把它寫進
 *     chat_messages 的那幾列刪掉，並貼出刪除後的查詢輸出。
 *
 * ⚠️⚠️ **這支腳本驗不到「訊息真的送到顧客手機」，而且那不是可以繞過的。**
 * replyToken 是 LINE 在真實事件裡發的一次性 token，偽造不出來；LINE 文件上
 * 那兩個「測試用」token（全 0 / 全 f）本腳本實測也是 400 Invalid reply token
 * （見 PHASE 5 的輸出）。因此本檔對這一段的做法是：**量得到的逐段量、量不到的
 * 明寫量不到**，不用「LINE 回 400 invalid reply token 代表內容是對的」這種推論
 * 充當證據——PHASE 5 會實測出 LINE 是**先擋 token 再看內容**，那句推論根本不成立。
 *
 * 用法：
 *   NODE_USE_ENV_PROXY=1 node --env-file=<憑證檔> scripts/verify/flex-menu-preview-live.cjs
 * 需要的環境變數：LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET /
 *   TEST_LOGIN_EMAIL / TEST_LOGIN_PASSWORD / SUPABASE_ACCESS_TOKEN
 * （15 分冊 §3 禁令 5：一律從環境變數取，不得寫進本檔。）
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { createHmac } = require('node:crypto');
const { writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');
const OUT = resolve(ROOT, 'scripts/verify/out');
mkdirSync(OUT, { recursive: true });

const PREVIEW = 'https://vibeaico-admin-rebuild-git-claude-70df20-smallwei0301s-projects.vercel.app';
const SHOP_CODE = 'sulawei0301';
const PROD_REF = 'egehnijjpgijmccagxac';
const STAMP = Date.now();
/** 可辨識的假 userId：測後用這個前綴把 chat_messages 清乾淨 */
const PROBE_USER = `U0000verify06probe${STAMP}`;
const CARD_TITLE = `實測選單卡${STAMP % 1000000}`;

const need = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'TEST_LOGIN_EMAIL',
  'TEST_LOGIN_PASSWORD', 'SUPABASE_ACCESS_TOKEN'];
for (const k of need) if (!process.env[k]) { console.error(`缺少環境變數 ${k}`); process.exit(2); }

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;

const fail = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail.push(msg); };
const info = (msg) => console.log(`INFO  ${msg}`);

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Management API ${r.status} ${JSON.stringify(body)}`);
  return body;
}

/** 對 Preview 的 webhook 送一個帶正確簽章的事件（簽章用 Midao channel secret） */
async function postWebhook(events) {
  const body = JSON.stringify({ destination: 'Ub3e83396b8dff617634bb68ce6895cf4', events });
  const sig = createHmac('sha256', LINE_SECRET).update(body).digest('base64');
  const r = await fetch(`${PREVIEW}/api/line/webhook/${SHOP_CODE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
    body,
  });
  return { status: r.status, text: await r.text() };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    proxy: { server: process.env.HTTPS_PROXY },
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors-spki-list=gBdItbWylHhTkoJDRwIiMuweY/qX4F0bJmLNs5wosUQ=,KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=,PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0=',
      '--ssl-version-max=tls1.2',
    ],
  });
  let page;
  let before = null;
  let lineRawBefore = null;

  try {
    page = await browser.newPage();
    const posts = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/')) posts.push(r.url().replace(PREVIEW, ''));
    });

    /* ============================================ PHASE 0：測前狀態存檔 */
    console.log('\n=== PHASE 0：測前狀態（還原的基準）===');
    await page.goto(`${PREVIEW}/tenant/login`, { waitUntil: 'networkidle' });
    await page.fill('#username', process.env.TEST_LOGIN_EMAIL);
    await page.fill('#password', process.env.TEST_LOGIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 }).catch(() => {});
    ok(!page.url().includes('/login'), `登入 Preview 成功（登入後 URL＝${page.url()}）`);

    before = await page.evaluate(async () => {
      const r = await fetch('/api/settings', { credentials: 'include' });
      return (await r.json())?.data?.line ?? null;
    });
    writeFileSync(resolve(OUT, 'preview-line-before.json'), JSON.stringify(before, null, 2));
    info(`測前 GET /api/settings 的 line.flexMenuEnabled=${before && before.flexMenuEnabled}` +
      ` flexMenuFallback=${before && before.flexMenuFallback}` +
      ` flexCards=${JSON.stringify((before && before.flexCards) ?? null)}`);

    /*
     * 還原的基準用**整塊 jsonb 的原文**，不是 GET /api/settings 的回傳。
     * 兩者不等價：GET 會套 zod 的 default（例如 DB 裡根本沒有 flexCards 這個鍵時
     * 也會回 []），照著回寫就會在 DB 裡多長出一個測前不存在的鍵——那不是還原。
     */
    const dbBefore = await sql(
      `select line from tenant_settings ts join tenants t on t.id = ts.tenant_id
        where t.shop_code = '${SHOP_CODE}'`);
    lineRawBefore = dbBefore[0] ? dbBefore[0].line : null;
    writeFileSync(resolve(OUT, 'preview-line-raw-before.json'), JSON.stringify(lineRawBefore, null, 2));
    info(`測前 service role 直查 tenant_settings.line 原文：${JSON.stringify(lineRawBefore)}`);

    /* ============================================ PHASE 1：Flex 分頁編卡→發布 */
    console.log('\n=== PHASE 1：Preview 站 Flex 分頁編卡 → 發布 ===');
    await page.goto(`${PREVIEW}/tenant/rich-menu-design`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.getByRole('tab', { name: /Flex 主選單/ }).first().click();
    await page.waitForTimeout(2500);

    await page.getByRole('button', { name: '新增卡片' }).click();
    await page.waitForTimeout(400);
    const row = page.locator('table.data-table tbody tr').last();
    const inputs = row.locator('input:not([type="file"])');
    await inputs.nth(0).fill(CARD_TITLE);
    await inputs.nth(1).fill(`${CARD_TITLE} 的說明`);
    await inputs.nth(2).fill('https://vibeaico.com/');

    posts.length = 0;
    await page.getByRole('button', { name: /發布 Flex 主選單到 LINE/ }).click();
    await page.waitForTimeout(4000);
    ok(posts.includes('/api/settings/line/flex-menu'),
      `按下發布後真的 POST /api/settings/line/flex-menu（實際送出：${JSON.stringify(posts)}）`);
    ok((await page.locator('body').innerText()).includes('主選單已儲存'),
      '畫面出現「主選單已儲存…」（await 端點成功之後才顯示）');
    await page.screenshot({ path: resolve(OUT, 'preview-flex-published.png'), fullPage: true });

    /* ============================================ PHASE 2：重整後仍在 */
    console.log('\n=== PHASE 2：重新整理（本地假成功會在這一步露餡）===');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: /Flex 主選單/ }).first().click();
    await page.waitForTimeout(3000);
    const titles = await page.locator('table.data-table tbody tr input:not([type="file"])')
      .evaluateAll((els) => els.map((e) => e.value));
    ok(titles.includes(CARD_TITLE),
      `重整後卡片「${CARD_TITLE}」仍在編輯欄位裡（實際：${JSON.stringify(titles)}）`);
    await page.screenshot({ path: resolve(OUT, 'preview-flex-after-reload.png'), fullPage: true });

    const dbAfter = await sql(
      `select line->'flexCards' as flex_cards from tenant_settings ts
         join tenants t on t.id = ts.tenant_id where t.shop_code = '${SHOP_CODE}'`);
    ok(JSON.stringify(dbAfter).includes(CARD_TITLE),
      `service role 直查正式 DB 的 tenant_settings.line->flexCards 含這張卡：${JSON.stringify(dbAfter)}`);

    /* ============================================ PHASE 3：真實 LINE → 我們的 webhook */
    console.log('\n=== PHASE 3：LINE 官方 webhook 測試端點（LINE 自己發、LINE 自己簽）===');
    const epRes = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',
      { headers: { Authorization: `Bearer ${LINE_TOKEN}` } });
    const ep = await epRes.json();
    ok(ep.endpoint === `${PREVIEW}/api/line/webhook/${SHOP_CODE}` && ep.active === true,
      `GET /v2/bot/channel/webhook/endpoint → ${JSON.stringify(ep)}`);

    /*
     * ⚠️ 這一條會**因為 Vercel 冷啟動而假紅**：LINE 這支測試端點的逾時很短，
     * 打到剛睡醒的 serverless function 會回 REQUEST_TIMEOUT / statusCode 0
     * （2026-08-25 實測遇到一次：同一個端點在同一分鐘內，先手動打過一次是
     *   statusCode 200，本腳本第一次跑就 REQUEST_TIMEOUT）。
     * 那是「我們沒在時限內回」，不是「驗簽失敗」，兩件事不可以混。
     * 所以先自己打一次把 function 叫醒，再重試最多三次，並把每一次的原文都印出來
     * ——一次逾時就判 FAIL，是把量測不確定性當成產品缺陷。
     */
    await fetch(`${PREVIEW}/api/line/webhook/${SHOP_CODE}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    let testBody = null;
    for (let i = 1; i <= 3; i += 1) {
      const testRes = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      testBody = await testRes.json();
      info(`第 ${i} 次 POST /v2/bot/channel/webhook/test → HTTP ${testRes.status} ${JSON.stringify(testBody)}`);
      if (testBody.statusCode === 200) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    ok(testBody && testBody.statusCode === 200,
      `LINE 自己發的測試 webhook 打進 Preview，我們回 statusCode=${testBody && testBody.statusCode}`);
    info('↑ 這一條證明的是：LINE **用自己的簽章**打得進 Preview 的 webhook，我們回 200。');
    info('   它送的是 LINE 固定的測試事件（文字不是「選單」），所以它不驗 MENU 分支。');

    /* ============================================ PHASE 4：簽章 webhook「選單」 */
    console.log('\n=== PHASE 4：對 Preview 送真實形狀的簽章 webhook「選單」 ===');
    const unsigned = await fetch(`${PREVIEW}/api/line/webhook/${SHOP_CODE}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });
    ok(unsigned.status === 401, `沒有簽章的 POST → HTTP ${unsigned.status}（驗簽確實在擋）`);

    const ev = {
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: PROBE_USER },
      webhookEventId: `01VERIFY06${STAMP}`,
      deliveryContext: { isRedelivery: false },
      replyToken: '0'.repeat(32),
      message: { id: String(STAMP), type: 'text', quoteToken: 'q'.repeat(20), text: '選單' },
    };
    const res = await postWebhook([ev]);
    ok(res.status === 200, `帶正確簽章的「選單」事件 → HTTP ${res.status} ${JSON.stringify(res.text)}`);

    // 副作用查證：Preview 的 server 真的處理了這個事件（onMessage 一定會寫 chat_messages）
    await new Promise((r) => setTimeout(r, 2500));
    const trace = await sql(
      `select line_user_id, direction, message_type, content, created_at
         from chat_messages where line_user_id = '${PROBE_USER}' order by created_at`);
    ok(Array.isArray(trace) && trace.length === 1 && trace[0].content && trace[0].content.text === '選單',
      `正式 DB 出現這個事件的 chat_messages 列 → ${JSON.stringify(trace)}`);
    info('↑ 這是「Preview 部署真的收下並處理了這個事件」的外部可觀察證據：');
    info('   驗簽通過 → 依 shopCode 查到店 → 進 onMessage → 寫入 chat_messages。');

    /* ============================================ PHASE 5：replyToken 的真相 */
    console.log('\n=== PHASE 5：「送到顧客手機」這一段驗不到——量出邊界在哪 ===');
    const goodMsg = { type: 'text', text: 'probe' };
    const badMsg = { type: 'text', text: '' };   // 空字串 text：LINE 一定退
    const replyProbe = async (label, replyToken, messages) => {
      const r = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyToken, messages }),
      });
      const body = await r.text();
      info(`${label} → HTTP ${r.status} ${body}`);
      return body;
    };
    const p1 = await replyProbe('reply(replyToken=全 0，內容合法)', '0'.repeat(32), [goodMsg]);
    const p2 = await replyProbe('reply(replyToken=全 f，內容合法)', 'f'.repeat(32), [goodMsg]);
    const p3 = await replyProbe('reply(replyToken=全 0，內容故意壞掉)', '0'.repeat(32), [badMsg]);
    ok(p1.includes('Invalid reply token') && p2.includes('Invalid reply token'),
      'LINE 文件上那兩個「測試用」replyToken（全 0 / 全 f）實際上一樣被退：偽造不出可用的 replyToken');
    ok(p3.includes('May not be empty'),
      'LINE 是**先驗訊息內容、再驗 replyToken**（內容壞掉時回的是內容的錯，不是 token 的錯）');
    info('↑ 這兩條合起來釘住的是**邊界**，不是通過：');
    info('   ・偽造的 replyToken 一定被退 → reply 這一支呼叫在本輪不可能成功，');
    info('     「訊息真的出現在顧客手機上」這一段因此**沒有被驗到**。');
    info('   ・既然內容先驗，「400 Invalid reply token」代表內容那一關過了；');
    info('     但那只等於 validate/reply 已經證過的事，不等於送達。本輪不拿它當送達的證據。');

  } finally {
    /* ============================================ PHASE 6：還原 + 清理 */
    console.log('\n=== PHASE 6：還原 Preview 資料 + 清掉探測列 ===');
    try {
      if (page && before) {
        const restored = await page.evaluate(async (b) => {
          const r = await fetch('/api/settings/line/flex-menu', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              flexMenuEnabled: b.flexMenuEnabled,
              flexMenuFallback: b.flexMenuFallback,
              flexCards: b.flexCards ?? [],
            }),
          });
          const after = await (await fetch('/api/settings', { credentials: 'include' })).json();
          return { status: r.status, line: after?.data?.line ?? null };
        }, before);
        writeFileSync(resolve(OUT, 'preview-line-after-restore.json'),
          JSON.stringify(restored.line, null, 2));
        info(`還原 POST /api/settings/line/flex-menu → HTTP ${restored.status}`);
        info(`還原後 GET /api/settings 的 line.flexCards=${JSON.stringify(restored.line && restored.line.flexCards)}`);
        const sameApi = JSON.stringify(restored.line) === JSON.stringify(before);
        ok(sameApi, `還原後 GET /api/settings 的整塊 line 與測前逐字相同（${sameApi ? '相同' : '不同，看 out/preview-line-*.json'}）`);

        /*
         * 走完 API 還原後，再比一次**整塊 jsonb 原文**。
         * API 只寫得回它收得下的那幾個鍵；若 DB 裡多出／少了任何鍵，
         * 這裡會抓到，並用 service role 逐字寫回測前的原文。
         */
        let rawAfter = (await sql(
          `select line from tenant_settings ts join tenants t on t.id = ts.tenant_id
            where t.shop_code = '${SHOP_CODE}'`))[0].line;
        if (JSON.stringify(rawAfter) !== JSON.stringify(lineRawBefore)) {
          info(`API 還原後 jsonb 原文仍與測前不同 → 以 service role 逐字寫回`);
          info(`  差異前：${JSON.stringify(rawAfter)}`);
          const lit = JSON.stringify(lineRawBefore).replace(/'/g, "''");
          await sql(`update tenant_settings set line = '${lit}'::jsonb
                      where tenant_id = (select id from tenants where shop_code = '${SHOP_CODE}')`);
          rawAfter = (await sql(
            `select line from tenant_settings ts join tenants t on t.id = ts.tenant_id
              where t.shop_code = '${SHOP_CODE}'`))[0].line;
        }
        writeFileSync(resolve(OUT, 'preview-line-raw-after.json'), JSON.stringify(rawAfter, null, 2));
        info(`還原後 service role 直查 tenant_settings.line 原文：${JSON.stringify(rawAfter)}`);
        ok(JSON.stringify(rawAfter) === JSON.stringify(lineRawBefore),
          '還原後正式 DB 的 tenant_settings.line 原文與測前逐字相同');
      }
    } catch (e) { console.error('還原失敗', e); fail.push('還原失敗'); }

    try {
      const del = await sql(
        `delete from chat_messages where line_user_id like 'U0000verify06probe%' returning id`);
      info(`刪除探測用 chat_messages：${JSON.stringify(del)}`);
      const left = await sql(
        `select count(*)::int as n from chat_messages where line_user_id like 'U0000verify06probe%'`);
      ok(left[0] && left[0].n === 0, `清理後再查一次，殘留 ${JSON.stringify(left)}`);
      const users = await sql(
        `select count(*)::int as n from line_users where line_user_id like 'U0000verify06probe%'`);
      ok(users[0] && users[0].n === 0,
        `message 事件不寫 line_users（只有 follow/unfollow 會），實查殘留 ${JSON.stringify(users)}`);
    } catch (e) { console.error('清理失敗', e); fail.push('清理失敗'); }

    await browser.close();
  }

  console.log(`\n${fail.length === 0 ? '全部通過' : `失敗 ${fail.length} 項：${JSON.stringify(fail)}`}`);
  process.exit(fail.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
