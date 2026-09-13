/**
 * GET /api/auth/oauth/status 整合測試 — Issue #26 slice 1「先消滅現有 404」。
 *
 * 這個端點必須不需要登入就能打（登入頁在使用者按下第三方登入按鈕、甚至還沒
 * 送出帳密表單之前，就要先知道平台有沒有設定 OAuth 憑證），且只回布林值，
 * 絕不回傳 GOOGLE_OAUTH_CLIENT_ID/SECRET、LINE_LOGIN_CHANNEL_ID/SECRET 這幾把
 * 本身。canonical TEST 環境沒有設定這四個平台憑證（見 src/config/env.ts 對
 * 它們維持 optional 的理由），所以這裡預期兩個 provider 都是 configured:false——
 * 這與 mock 分支的行為一致，也是本測試唯一能在共用 TEST 上驗證的真實狀態。
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

describe('#26 GET /api/auth/oauth/status (unauthenticated, public)', () => {
  it('returns 200 with the {google:{configured}, line:{configured}} boolean shape — no auth cookie sent', async () => {
    const res = await fetch(`${BASE}/api/auth/oauth/status`);
    expect(res.status).toBe(200);

    const body = await readJson<{ google: { configured: boolean }; line: { configured: boolean } }>(res);
    expect(body.success).toBe(true);
    expect(typeof body.data?.google.configured).toBe('boolean');
    expect(typeof body.data?.line.configured).toBe('boolean');
  });

  it('reports both providers unconfigured on TEST (platform OAuth env vars are unset there)', async () => {
    const res = await fetch(`${BASE}/api/auth/oauth/status`);
    const body = await readJson<{ google: { configured: boolean }; line: { configured: boolean } }>(res);
    expect(body.data).toEqual({ google: { configured: false }, line: { configured: false } });
  });

  it('never leaks the underlying credential values, whatever they are', async () => {
    const res = await fetch(`${BASE}/api/auth/oauth/status`);
    const raw = await res.text();
    expect(raw).not.toMatch(/CLIENT_ID|CLIENT_SECRET|CHANNEL_ID|CHANNEL_SECRET/);
  });
});
