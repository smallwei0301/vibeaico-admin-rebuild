/**
 * issue #31 — webhook 驗簽前的 DB round-trip 必須維持一趟。
 *
 * 這條鎖存在的理由：那段查詢坐在冷啟動的關鍵路徑上（驗簽需要 channel secret，
 * 而驗簽必須在回 200 之前完成）。實測顯示正式站閒置後的第一發會 REQUEST_TIMEOUT，
 * 而 LINE 預設不重送——逾時就是顧客訊息被丟掉。多加一趟 round-trip 不會讓任何
 * 測試變紅，只會讓冷啟動再慢一點，所以需要一條靜態鎖把它擋住。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routePath = resolve(process.cwd(), 'src/app/api/line/webhook/[shopCode]/route.ts');
const route = readFileSync(routePath, 'utf8');
const linePath = resolve(process.cwd(), 'src/server/line.ts');
const line = readFileSync(linePath, 'utf8');

/** 去掉註解——「不得出現」的斷言若連註解一起掃，會逼人刪掉解釋才能通過。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const routeCode = stripComments(route);

/**
 * 同步回應路徑：`after(async` 之前的所有程式碼。
 *
 * 刻意**不**用 `return new Response('ok')` 當切點——`after()` 的 callback 在原始碼
 * 裡寫在那行之前，但執行在回應之後。以文字位置當執行位置會把背景工作誤判成
 * 回應路徑上的工作。
 */
function ackPath(source: string): string {
  const i = source.indexOf('after(async');
  expect(i).toBeGreaterThan(-1);
  return source.slice(0, i);
}

describe('#31 webhook 驗簽前只做一趟 DB 查詢', () => {
  it('route 走合併查詢，且回應路徑上沒有第二支查詢函式', () => {
    expect(routeCode).toContain('getWebhookTenantWithCredentials(shopCode)');
    // 舊的兩趟寫法：先 from('tenants') 再 getLineCredentials(tenant.id)
    expect(routeCode).not.toContain('getLineCredentials');
    expect(ackPath(routeCode)).not.toMatch(/\.from\(\s*['"]tenants['"]\s*\)/);
    expect(ackPath(routeCode)).not.toMatch(/\.from\(\s*['"]tenant_settings['"]\s*\)/);
  });

  it('service role client 在回應之後才建立，不在回應路徑上', () => {
    const ack = ackPath(routeCode);
    expect(ack).not.toContain('createAdminSupabase()');
    // 但 after() 內仍然要有——事件處理需要它
    expect(routeCode).toContain('createAdminSupabase()');
    const afterBlock = routeCode.slice(routeCode.indexOf('after(async'));
    expect(afterBlock).toContain('createAdminSupabase()');
  });

  it('驗簽仍在回應之前，且失敗直接 401', () => {
    const ack = ackPath(routeCode);
    // ackPath 的定義就是「after(async 之前」，所以這兩項出現在 ack 裡
    // 本身即證明驗簽早於背景排程。
    expect(ack).toContain('timingSafeEqual');
    expect(ack).toContain("new Response('bad signature', { status: 401 })");
  });

  it('三種既有回應語意都保留：unknown shop / line not configured / invalid JSON', () => {
    expect(routeCode).toContain("new Response('unknown shop', { status: 404 })");
    expect(routeCode).toContain("new Response('line not configured', { status: 404 })");
    expect(routeCode).toContain("new Response('invalid JSON', { status: 400 })");
  });

  it('合併查詢用 PostgREST embedding 一次取回 tenants 與 tenant_settings', () => {
    const fn = line.slice(line.indexOf('export async function getWebhookTenantWithCredentials'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body).toContain("from('tenants')");
    expect(body).toContain('tenant_settings(line, line_channel_secret_enc, line_channel_access_token_enc)');
    // 整個函式裡只能有一次 .from(——兩次就代表又變回兩趟
    expect(body.match(/\.from\(/g) ?? []).toHaveLength(1);
  });

  it('不快取憑證：店家輪替 token 後不得繼續用舊值', () => {
    const fn = line.slice(line.indexOf('export async function getWebhookTenantWithCredentials'));
    const body = stripComments(fn.slice(0, fn.indexOf('\n}\n') + 3));
    expect(body).not.toMatch(/\bcache\b|\bMap\(|\bmemo/i);
  });
});
