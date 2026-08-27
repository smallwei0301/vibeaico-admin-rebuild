/**
 * scripts/verify/flex-menu-reply-capture.cjs
 * -----------------------------------------------------------------------------
 * issue #6 最後一條驗收裡「**真的對 api.line.me 發出了 reply 請求**」那一段的證據。
 *
 * 為什麼需要另一支腳本：Preview 上的 webhook 把 handleEvent 的錯誤吞掉永遠回 200
 * （LINE 才不會重送），而這個帳號的 Vercel token 讀不到 runtime logs
 * （/v1/deployments/:id/runtime-logs → 404、/v3/…/events → 403 Not authorized）。
 * 也就是說 **從 Preview 外面看不到 reply 那一段發生了什麼**。
 * 所以這裡在本機跑**同一個 commit 的同一份程式碼**、連**同一個正式 Supabase 專案**
 * （店家設定、卡片內容都是 Preview 讀的那一份），只把 `LINE_API_BASE` 指到一個
 * **會轉發到真的 api.line.me 的側錄伺服器**，於是可以逐字看到：
 *   ① 我們的 server 真的對 /v2/bot/message/reply 發出了請求
 *   ② 送出去的 Flex JSON 逐字是什麼
 *   ③ 真的 LINE 對那個請求回了什麼
 *
 * ⚠️ **這仍然不是「訊息送到顧客手機」的證據。** replyToken 偽造不出來，
 * LINE 對假 token 一律 400；本檔把 ③ 原樣印出來，不做任何「所以內容是對的」
 * 的延伸推論。內容合法與否由 scripts/verify/flex-menu-validate.cjs 用官方
 * validate/reply 端點單獨證明，本檔也會把 ② 捕捉到的那一份再送去驗一次。
 *
 * ⚠️ 本檔對**正式** Supabase 專案寫入（暫時塞一張探測卡片、事件會寫一列
 * chat_messages），跑完會逐字還原並貼出還原後的查詢輸出。
 * ⚠️ 收尾會 `rm -rf .next`：本檔起的 next dev 與整合測試共用同一份開發建置快取
 * （15 分冊「不要在整合測試的同時另起第二個 next dev」）。
 *
 * 用法：
 *   NODE_USE_ENV_PROXY=1 node --env-file=<憑證檔> scripts/verify/flex-menu-reply-capture.cjs
 */
const http = require('node:http');
const { createHmac } = require('node:crypto');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { rmSync, mkdirSync, writeFileSync } = require('node:fs');

const ROOT = resolve(__dirname, '..', '..');
const OUT = resolve(ROOT, 'scripts/verify/out');
mkdirSync(OUT, { recursive: true });

const APP_PORT = 3210;
const PROXY_PORT = 4199;
const SHOP_CODE = 'sulawei0301';
const PROD_REF = 'egehnijjpgijmccagxac';
const STAMP = Date.now();
const PROBE_USER = `U0000verify06probe${STAMP}`;
const CARD_TITLE = `側錄卡${STAMP % 1000000}`;

for (const k of ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'SUPABASE_ACCESS_TOKEN']) {
  if (!process.env[k]) { console.error(`缺少環境變數 ${k}`); process.exit(2); }
}

const fail = [];
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail.push(m); };
const info = (m) => console.log(`INFO  ${m}`);

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

/** 側錄伺服器：記下我們的 server 送出的每一個 LINE 請求，再原封不動轉給真的 LINE */
const captured = [];
function startProxy() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let status = 0; let text = '';
      try {
        const upstream = await fetch(`https://api.line.me${req.url}`, {
          method: req.method,
          headers: {
            Authorization: req.headers.authorization ?? '',
            'Content-Type': req.headers['content-type'] ?? 'application/json',
          },
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        });
        status = upstream.status;
        text = await upstream.text();
      } catch (e) {
        status = 599; text = String(e);
      }
      captured.push({ method: req.method, path: req.url, body, lineStatus: status, lineBody: text });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(text);
    });
  });
  return new Promise((r) => server.listen(PROXY_PORT, '127.0.0.1', () => r(server)));
}

function startApp() {
  return spawn(resolve(ROOT, 'node_modules/.bin/next'), ['dev', '-p', String(APP_PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: '1',                 // Supabase 走 sandbox 的出口 proxy
      LINE_API_BASE: `http://127.0.0.1:${PROXY_PORT}`,   // ← 唯一的改動
      NEXT_PUBLIC_USE_MOCK: 'false',
    },
  });
}

async function waitReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${APP_PORT}/api/health`)).status > 0) return; } catch { /* 未就緒 */ }
    try { if ((await fetch(`http://127.0.0.1:${APP_PORT}/`)).status > 0) return; } catch { /* 未就緒 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('next dev 逾時未就緒');
}

async function main() {
  let rawBefore = null;
  const proxy = await startProxy();
  const app = startApp();
  const appLog = [];
  app.stdout.on('data', (d) => appLog.push(String(d)));
  app.stderr.on('data', (d) => appLog.push(String(d)));

  try {
    /* ---------------------------------------------- 測前狀態 + 塞一張探測卡片 */
    rawBefore = (await sql(
      `select line from tenant_settings ts join tenants t on t.id = ts.tenant_id
        where t.shop_code = '${SHOP_CODE}'`))[0].line;
    writeFileSync(resolve(OUT, 'capture-line-raw-before.json'), JSON.stringify(rawBefore, null, 2));
    info(`測前 tenant_settings.line 原文：${JSON.stringify(rawBefore)}`);

    const probeCards = [
      { title: CARD_TITLE, subtitle: `${CARD_TITLE} 的說明`, imageUrl: '', ad: false, linkUrl: 'https://vibeaico.com/' },
      { title: '本月優惠', subtitle: '廣告卡', imageUrl: '', ad: true, linkUrl: 'tel:0212345678' },
    ];
    const withCards = JSON.stringify({ ...rawBefore, flexCards: probeCards, flexMenuEnabled: true })
      .replace(/'/g, "''");
    await sql(`update tenant_settings set line = '${withCards}'::jsonb
                where tenant_id = (select id from tenants where shop_code = '${SHOP_CODE}')`);
    info(`已暫時寫入 ${probeCards.length} 張探測卡片（測後逐字還原）`);

    await waitReady();
    info(`本機 next dev 就緒（port ${APP_PORT}，LINE_API_BASE → 127.0.0.1:${PROXY_PORT} → api.line.me）`);

    /* ---------------------------------------------- 送同一個簽章 webhook「選單」 */
    const body = JSON.stringify({
      destination: 'Ub3e83396b8dff617634bb68ce6895cf4',
      events: [{
        type: 'message', mode: 'active', timestamp: Date.now(),
        source: { type: 'user', userId: PROBE_USER },
        webhookEventId: `01CAPTURE06${STAMP}`,
        deliveryContext: { isRedelivery: false },
        replyToken: '0'.repeat(32),
        message: { id: String(STAMP), type: 'text', text: '選單' },
      }],
    });
    const sig = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(body).digest('base64');
    const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/line/webhook/${SHOP_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
      body,
    });
    ok(r.status === 200, `本機（同一 commit、同一份正式資料）webhook「選單」→ HTTP ${r.status} ${JSON.stringify(await r.text())}`);
    await new Promise((x) => setTimeout(x, 2000));

    /* ---------------------------------------------- 側錄到了什麼 */
    console.log('\n=== 側錄：我們的 server 對 api.line.me 發出的請求 ===');
    ok(captured.length === 1, `一共側錄到 ${captured.length} 個 LINE 請求（「選單」應該只回一則）`);
    const call = captured[0];
    if (call) {
      ok(call.method === 'POST' && call.path === '/v2/bot/message/reply',
        `真的打了 ${call.method} ${call.path}（＝ src/server/line.ts 的 lineReply）`);
      const sent = JSON.parse(call.body);
      writeFileSync(resolve(OUT, 'capture-reply-payload.json'), JSON.stringify(sent, null, 2));
      const msg = sent.messages && sent.messages[0];
      ok(msg && msg.type === 'flex' && msg.contents && msg.contents.type === 'carousel',
        `送出的第一則是 flex/carousel（altText＝${msg && JSON.stringify(msg.altText)}）`);
      ok(msg && msg.contents.contents.length === probeCards.length,
        `carousel 的 bubble 數 ${msg && msg.contents.contents.length} ＝ 店家發布的卡片數 ${probeCards.length}`);
      const flat = JSON.stringify(sent);
      ok(flat.includes(CARD_TITLE), `送出的 JSON 裡逐字含剛發布的卡片標題「${CARD_TITLE}」`);
      ok(flat.includes('"uri":"https://vibeaico.com/"') && flat.includes('"uri":"tel:0212345678"'),
        '兩張卡的 linkUrl 都變成了 uri action（白名單 https:// 與 tel: 都走完整條路）');
      ok(!flat.includes('{shopName}'), '{shopName} 已被換成真的店名，樣板沒有原樣送出去');
      console.log(`\n--- 送出的 reply payload（前 1200 字）---\n${flat.slice(0, 1200)}\n`);
      console.log(`--- 真的 LINE 對這個 reply 請求的回應（逐字）---\nHTTP ${call.lineStatus} ${call.lineBody}\n`);
      info('↑ **這一段就是驗不到的邊界**：replyToken 是 LINE 在真實事件裡發的一次性 token，');
      info('   偽造不出來，所以這通 reply 一定失敗，訊息不會出現在任何人的手機上。');
      info('   本檔只主張「請求真的發出去了」與「LINE 這樣回」，不主張送達。');

      /* 同一份 payload 再送官方 validate/reply：內容本身合法與否，由這一條說了算 */
      const v = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: sent.messages }),
      });
      const vBody = await v.text();
      ok(v.status === 200,
        `同一份 payload 送官方 POST /v2/bot/message/validate/reply → HTTP ${v.status} ${vBody}`);
    }
  } finally {
    /* ---------------------------------------------- 還原 + 清理 */
    console.log('\n=== 還原正式資料 ===');
    try {
      if (rawBefore) {
        const lit = JSON.stringify(rawBefore).replace(/'/g, "''");
        await sql(`update tenant_settings set line = '${lit}'::jsonb
                    where tenant_id = (select id from tenants where shop_code = '${SHOP_CODE}')`);
        const after = (await sql(
          `select line from tenant_settings ts join tenants t on t.id = ts.tenant_id
            where t.shop_code = '${SHOP_CODE}'`))[0].line;
        writeFileSync(resolve(OUT, 'capture-line-raw-after.json'), JSON.stringify(after, null, 2));
        info(`還原後 tenant_settings.line 原文：${JSON.stringify(after)}`);
        ok(JSON.stringify(after) === JSON.stringify(rawBefore), '還原後與測前逐字相同');
      }
      const del = await sql(
        `delete from chat_messages where line_user_id like 'U0000verify06probe%' returning id`);
      info(`刪除探測用 chat_messages：${JSON.stringify(del)}`);
      const left = await sql(
        `select count(*)::int as n from chat_messages where line_user_id like 'U0000verify06probe%'`);
      ok(left[0].n === 0, `清理後再查一次，殘留 ${JSON.stringify(left)}`);
    } catch (e) { console.error('還原/清理失敗', e); fail.push('還原/清理失敗'); }

    try { process.kill(-app.pid, 'SIGTERM'); } catch { /* 已結束 */ }
    proxy.close();
    writeFileSync(resolve(OUT, 'capture-next-dev.log'), appLog.join(''));
    await new Promise((x) => setTimeout(x, 1000));
    rmSync(resolve(ROOT, '.next'), { recursive: true, force: true });
    info('[cleanup] 已刪除 .next（避免污染整合測試的開發建置快取）');
  }

  console.log(`\n${fail.length === 0 ? '全部通過' : `失敗 ${fail.length} 項：${JSON.stringify(fail)}`}`);
  process.exit(fail.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
