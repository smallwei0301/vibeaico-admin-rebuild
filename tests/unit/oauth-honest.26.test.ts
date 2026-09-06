import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loginPage as t } from '@/i18n/zh-TW/pages/login';

/**
 * `src/app/tenant/login/page.tsx` is a Client Component (`'use client'` +
 * JSX). vitest.config.mts deliberately runs unit tests without a JSX/TSX
 * transform (see its header comment — unit tests are pure functions, no
 * DOM), so it cannot be `import`ed here; the page's own decision logic is
 * instead verified by reading its source, the same technique already used
 * by tests/unit/portfolio-wiring.7.test.ts for that page's load/save
 * functions.
 */

/** Re-implementation mirrored 1:1 against the page's own `oauthNoteFor` to
 *  exercise the three real states without needing a JSX/DOM runtime; the
 *  assertions below on `page` (the raw source) guard that the two stay in
 *  sync — any drift in the page's condition breaks those. */
function oauthNoteFor(loading: boolean, configured: boolean): string {
  if (loading) return t.oauth.checking;
  return configured ? t.oauth.buildingFlow : t.oauth.notConfigured;
}

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/login/page.tsx');
const copy = read('src/i18n/zh-TW/pages/login.ts');
const service = read('src/services/auth.ts');

/**
 * Issue #26 slice 1 —— 「先消滅現有 404」，且 Owner 明確要求
 * 「未設定第三方憑證時介面不得假成功，需顯示真實可理解的設定狀態」。
 *
 * 這份測試取代 PR #63 草稿裡的 tests/unit/oauth-disabled.26.test.ts：
 * 除了「按鈕不可點擊、不連到不存在的 authorize 端點」之外，還要證明畫面顯示的
 * 是「真的去問後端」得到的狀態（不是寫死字串），且狀態端點本身絕不回傳憑證值。
 */
describe('#26 login page: no link to non-existent OAuth authorize routes', () => {
  it('never renders an <a href> or literal href to the authorize endpoints', () => {
    expect(page).not.toMatch(/\/api\/auth\/oauth\/line\/authorize/);
    expect(page).not.toMatch(/\/api\/auth\/oauth\/google\/authorize/);
    expect(page).not.toMatch(/href=\{OAUTH/);
    expect(page).not.toMatch(/<a\s+className="btn btn-line/);
  });

  it('removed the now-unused lineHref/googleHref i18n keys', () => {
    expect(copy).not.toContain('lineHref');
    expect(copy).not.toContain('googleHref');
  });
});

describe('#26 login page: both OAuth buttons stay disabled regardless of status', () => {
  it('keeps both provider buttons statically disabled (not conditioned on status)', () => {
    const lineButton = page.match(/<Button[\s\S]*?data-testid="oauth-line-disabled"[\s\S]*?<\/Button>/)?.[0];
    const googleButton = page.match(/<Button[\s\S]*?data-testid="oauth-google-disabled"[\s\S]*?<\/Button>/)?.[0];
    expect(lineButton).toBeTruthy();
    expect(googleButton).toBeTruthy();
    // `disabled` is a bare static prop here, never `disabled={...}` gated on
    // the fetched status — configured:true must never make it clickable.
    expect(lineButton).toMatch(/\bdisabled\b(?!=)/);
    expect(googleButton).toMatch(/\bdisabled\b(?!=)/);
  });

  it('loads status from getOAuthStatus() on mount instead of hardcoding it', () => {
    expect(page).toContain("import { getOAuthStatus, login } from '@/services'");
    expect(page).toContain('getOAuthStatus()');
    expect(page).toContain('React.useEffect');
  });
});

describe('#26 login page: honest note switches between the two real states', () => {
  it('the page defines oauthNoteFor with exactly the loading/configured branch mirrored above', () => {
    const fn = page.match(/function oauthNoteFor\([\s\S]*?\n\}/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn).toContain('if (loading) return t.oauth.checking;');
    expect(fn).toContain('configured ? t.oauth.buildingFlow : t.oauth.notConfigured');
  });

  it('the rendered note for each provider is derived from oauthNoteFor(oauthLoading, ...configured), not hardcoded', () => {
    expect(page).toMatch(/lineNote = oauthNoteFor\(oauthLoading, oauthStatus\?\.line\.configured/);
    expect(page).toMatch(/googleNote = oauthNoteFor\(oauthLoading, oauthStatus\?\.google\.configured/);
  });

  it('oauthNoteFor(loading=true, ...) always shows the checking copy, regardless of configured', () => {
    expect(oauthNoteFor(true, false)).toBe(t.oauth.checking);
    expect(oauthNoteFor(true, true)).toBe(t.oauth.checking);
  });

  it('oauthNoteFor(loading=false, configured=false) shows "not configured yet"', () => {
    expect(oauthNoteFor(false, false)).toBe(t.oauth.notConfigured);
  });

  it('oauthNoteFor(loading=false, configured=true) shows "flow still being built", never a fake success', () => {
    expect(oauthNoteFor(false, true)).toBe(t.oauth.buildingFlow);
    expect(oauthNoteFor(false, true)).not.toBe(t.oauth.notConfigured);
  });

  it('the three note copies are distinct and none claims a working login', () => {
    const notes = [t.oauth.checking, t.oauth.notConfigured, t.oauth.buildingFlow];
    expect(new Set(notes).size).toBe(3);
    for (const note of notes) {
      expect(note).not.toMatch(/成功|已登入/);
    }
  });
});

describe('#26 service: getOAuthStatus() goes through adapt(mock, real)', () => {
  it('mock branch reports both providers unconfigured — mock must never claim readiness', () => {
    expect(service).toMatch(/getOAuthStatus[\s\S]*?adapt</);
    expect(service).toContain("google: { configured: false }, line: { configured: false }");
  });

  it('real branch calls the status endpoint and nothing else under that name', () => {
    expect(service).toContain("request<OAuthStatus>('/api/auth/oauth/status')");
  });
});

describe('#26 API route: GET /api/auth/oauth/status never leaks credential values', () => {
  it('reads env for both id+secret pairs and only returns booleans', async () => {
    vi.resetModules();
    vi.doMock('@/config/env', () => ({
      serverEnv: {
        GOOGLE_OAUTH_CLIENT_ID: 'super-secret-google-client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'super-secret-google-client-secret',
        LINE_LOGIN_CHANNEL_ID: 'super-secret-line-channel-id',
        LINE_LOGIN_CHANNEL_SECRET: 'super-secret-line-channel-secret',
      },
    }));
    const { GET } = await import('@/app/api/auth/oauth/status/route');
    const res = await GET(new Request('http://localhost/api/auth/oauth/status'), {});
    const body = await res.json();

    expect(body).toEqual({
      success: true,
      data: { google: { configured: true }, line: { configured: true } },
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('super-secret-google-client-id');
    expect(raw).not.toContain('super-secret-google-client-secret');
    expect(raw).not.toContain('super-secret-line-channel-id');
    expect(raw).not.toContain('super-secret-line-channel-secret');
    vi.doUnmock('@/config/env');
    vi.resetModules();
  });

  it('reports configured:false for each provider missing either id or secret', async () => {
    vi.resetModules();
    vi.doMock('@/config/env', () => ({
      serverEnv: {
        GOOGLE_OAUTH_CLIENT_ID: 'has-id-only',
        GOOGLE_OAUTH_CLIENT_SECRET: undefined,
        LINE_LOGIN_CHANNEL_ID: undefined,
        LINE_LOGIN_CHANNEL_SECRET: undefined,
      },
    }));
    const { GET } = await import('@/app/api/auth/oauth/status/route');
    const res = await GET(new Request('http://localhost/api/auth/oauth/status'), {});
    const body = await res.json();

    expect(body).toEqual({
      success: true,
      data: { google: { configured: false }, line: { configured: false } },
    });
    vi.doUnmock('@/config/env');
    vi.resetModules();
  });
});
