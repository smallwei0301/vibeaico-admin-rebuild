/**
 * Issue #5 Preview acceptance probe.
 *
 * The remote browser creates a unique keyword through the deployed UI.  A local
 * server running this exact checkout then reads the same tenant data, while its
 * LINE_API_BASE points at an in-process capture server.  This makes the LINE
 * reply observable without sending a real customer message.
 *
 * Usage:
 *   node --env-file=<credential-file> scripts/verify/keyword-replies-preview-live.cjs
 *
 * Required secrets stay in the environment: TEST_EMAIL, TEST_PASSWORD and
 * LINE_CHANNEL_SECRET.  The credential file must also contain the normal
 * non-mock Next/Supabase variables needed to start the application.
 *
 * IMPORTANT: the current Vercel Preview uses Production Supabase.  Merely
 * having credentials is not authorization to mutate it.  The script therefore
 * fails closed unless the operator has fresh Owner authorization and explicitly
 * sets ALLOW_PRODUCTION_PREVIEW_DML=issue-5-keyword-probe:egehnijjpgijmccagxac.
 *
 * This script changes Preview-backed data.  Its finally block deletes every
 * probe keyword found by its unique value, verifies the authenticated GET no
 * longer returns it, and removes probe chat rows.  It never calls the real LINE API.
 */
const http = require('node:http');
const { createHmac } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { rmSync } = require('node:fs');

const {
  BASE,
  PROD_REF,
  required,
  check,
  summary,
  shot,
  gotoStable,
  launch,
  login,
  clickModalButton,
  sql,
} = require('./_preview-lib.cjs');

const ROOT = resolve(__dirname, '..', '..');
const APP_PORT = Number(process.env.KEYWORD_PROBE_APP_PORT || 3225);
const LINE_MOCK_PORT = Number(process.env.KEYWORD_PROBE_LINE_PORT || 4205);
const STAMP = `${Date.now()}-${process.pid}`;
const KEYWORD = `驗收05-${STAMP}`;
const REPLY = `關鍵字驗收回覆 ${STAMP}`;
const PROBE_USER = `Uverify05${STAMP.replace(/\D/g, '').slice(-24).padStart(24, '0')}`;

const EXPECTED_AUTHORIZATION = `issue-5-keyword-probe:${PROD_REF}`;
if (process.env.ALLOW_PRODUCTION_PREVIEW_DML !== EXPECTED_AUTHORIZATION) {
  console.error(
    'BLOCKED_BY_OWNER: Preview uses Production Supabase. Obtain explicit #5 Preview DML '
      + `authorization, then set ALLOW_PRODUCTION_PREVIEW_DML=${EXPECTED_AUTHORIZATION}.`,
  );
  process.exit(3);
}

/* The webhook is captured locally because a remote Preview cannot call an
 * in-process mock.  That is valid candidate evidence only when both sides are
 * the exact same commit.  PREVIEW_GIT_COMMIT_SHA must come from the inspected
 * Vercel deployment, never from guessing the branch name. */
const LOCAL_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const PREVIEW_SHA = process.env.PREVIEW_GIT_COMMIT_SHA || '';
if (!/^[0-9a-f]{40}$/.test(PREVIEW_SHA) || PREVIEW_SHA !== LOCAL_SHA) {
  console.error(
    `Preview/local SHA mismatch: PREVIEW_GIT_COMMIT_SHA=${PREVIEW_SHA || '(missing)'} local=${LOCAL_SHA}`,
  );
  process.exit(4);
}

const EMAIL = required('TEST_EMAIL');
const PASSWORD = required('TEST_PASSWORD');
const CHANNEL_SECRET = required('LINE_CHANNEL_SECRET');

const captured = [];

function startLineCapture() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = rawBody ? JSON.parse(rawBody) : null; } catch { /* retain raw body */ }
      captured.push({ method: req.method, path: (req.url || '').split('?')[0], body, rawBody });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(LINE_MOCK_PORT, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolvePromise(server);
    });
  });
}

function startApp() {
  return spawn(resolve(ROOT, 'node_modules/.bin/next'), ['dev', '-p', String(APP_PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: '1',
      NEXT_PUBLIC_USE_MOCK: 'false',
      LINE_API_BASE: `http://127.0.0.1:${LINE_MOCK_PORT}`,
      LINE_DATA_API_BASE: `http://127.0.0.1:${LINE_MOCK_PORT}`,
    },
  });
}

async function waitForApp(appLog) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`);
      if (res.status > 0) return;
    } catch { /* compilation/startup still in progress */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`local Next server did not become ready\n${appLog.join('').slice(-4000)}`);
}

async function listKeywords(page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/settings/line/keyword-replies', { credentials: 'include' });
    const json = await res.json();
    if (!res.ok || json.success !== true || !Array.isArray(json.data)) {
      throw new Error(`GET keyword replies failed: ${res.status} ${JSON.stringify(json)}`);
    }
    return json.data;
  });
}

async function deleteProbeKeywords(page) {
  const rows = await listKeywords(page);
  const matches = rows.filter((row) => Array.isArray(row.keywords) && row.keywords.includes(KEYWORD));
  for (const row of matches) {
    const result = await page.evaluate(async (id) => {
      const res = await fetch(`/api/settings/line/keyword-replies/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      return { status: res.status, text: await res.text() };
    }, row.id);
    check(`cleanup DELETE keyword id=${row.id}`, result.status === 200,
      `HTTP ${result.status} ${result.text}`);
  }
  const remaining = (await listKeywords(page))
    .filter((row) => Array.isArray(row.keywords) && row.keywords.includes(KEYWORD));
  check('cleanup verified by authenticated GET', remaining.length === 0,
    `remaining=${remaining.length}`);
}

async function main() {
  let browser = null;
  let page = null;
  let lineCapture = null;
  let app = null;
  const appLog = [];
  let shopCode = '';

  try {
    browser = await launch();
    page = await browser.newPage();
    lineCapture = await startLineCapture();
    app = startApp();
    app.stdout.on('data', (data) => appLog.push(String(data)));
    app.stderr.on('data', (data) => appLog.push(String(data)));

    await login(page, EMAIL, PASSWORD);
    await gotoStable(page, `${BASE}/tenant/keyword-replies`);

    const tenant = await page.evaluate(async () => {
      const res = await fetch('/api/auth/my-tenants', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || json.success !== true) throw new Error(`my-tenants failed: ${res.status}`);
      const rows = Array.isArray(json.data) ? json.data : (json.data?.tenants || []);
      return rows.find((row) => row.current || row.isCurrent) || rows[0] || null;
    });
    shopCode = tenant?.shopCode || tenant?.shop_code || '';
    check('authenticated tenant exposes shopCode', Boolean(shopCode), JSON.stringify(tenant));
    if (!shopCode) throw new Error('cannot determine current tenant shopCode');

    await page.getByRole('button', { name: '新增關鍵字', exact: true }).first().click();
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.locator('#kwKeyword').fill(KEYWORD);
    await dialog.locator('#kwReplyText').fill(REPLY);
    await shot(page, 'pv-issue05-keyword-filled');
    await clickModalButton(page, '儲存');

    await gotoStable(page, `${BASE}/tenant/keyword-replies`);
    check('unique keyword survives Preview reload',
      await page.locator('tbody tr', { hasText: KEYWORD }).count() === 1, KEYWORD);
    const stored = (await listKeywords(page))
      .find((row) => Array.isArray(row.keywords) && row.keywords.includes(KEYWORD));
    check('authenticated API returns the configured reply',
      stored?.active === true && stored?.content?.text === REPLY,
      stored ? `id=${stored.id}` : 'not found');
    if (!stored) throw new Error('Preview UI did not persist the probe keyword');

    await waitForApp(appLog);
    captured.length = 0;
    const raw = JSON.stringify({
      destination: 'Uverify05bot',
      events: [{
        type: 'message',
        mode: 'active',
        timestamp: Date.now(),
        source: { type: 'user', userId: PROBE_USER },
        webhookEventId: `01VERIFY05${STAMP.replace(/\D/g, '').slice(-16)}`,
        deliveryContext: { isRedelivery: false },
        replyToken: `verify05-${STAMP}`,
        message: { id: `m-${STAMP}`, type: 'text', text: KEYWORD },
      }],
    });
    const signature = createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
    const webhook = await fetch(`http://127.0.0.1:${APP_PORT}/api/line/webhook/${shopCode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
      body: raw,
    });
    check('correctly signed webhook is accepted', webhook.status === 200,
      `HTTP ${webhook.status} ${await webhook.text()}`);

    const drain = await fetch(`http://127.0.0.1:${APP_PORT}/api/line/webhook/${shopCode}`);
    const drainBody = await drain.json().catch(() => ({}));
    check('webhook background work drains without errors',
      drain.status === 200 && Array.isArray(drainBody.errors) && drainBody.errors.length === 0,
      `HTTP ${drain.status} ${JSON.stringify(drainBody)}`);

    const replies = captured.filter((call) =>
      call.method === 'POST' && call.path === '/v2/bot/message/reply');
    check('mock LINE captures exactly one reply request', replies.length === 1,
      `captured=${captured.map((call) => `${call.method} ${call.path}`).join(', ')}`);
    const messages = replies[0]?.body?.messages;
    check('captured LINE reply exactly matches the UI value',
      Array.isArray(messages) && messages.length === 1
        && messages[0]?.type === 'text' && messages[0]?.text === REPLY,
      JSON.stringify(messages || null));
    await shot(page, 'pv-issue05-keyword-persisted');
  } finally {
    console.log('\n=== cleanup ===');
    try {
      if (page) await deleteProbeKeywords(page);
    } catch (error) {
      check('cleanup keyword through authenticated API', false, String(error));
    }
    try {
      const escaped = PROBE_USER.replace(/'/g, "''");
      await sql(`delete from chat_messages where line_user_id = '${escaped}'`);
      const left = await sql(
        `select count(*)::int as n from chat_messages where line_user_id = '${escaped}'`,
      );
      check('cleanup probe chat rows verified', left[0]?.n === 0, JSON.stringify(left));
    } catch (error) {
      check('cleanup probe chat rows', false, String(error));
    }
    if (app?.pid) {
      try { process.kill(-app.pid, 'SIGTERM'); } catch { /* already stopped */ }
    }
    if (lineCapture) {
      lineCapture.closeAllConnections?.();
      await new Promise((resolvePromise) => lineCapture.close(resolvePromise));
    }
    if (browser) await browser.close();
    rmSync(resolve(ROOT, '.next'), { recursive: true, force: true });
  }

  const result = summary();
  process.exit(result.fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
