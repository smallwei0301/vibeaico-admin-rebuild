/**
 * tests/unit/public-shop-api-route.11.test.ts — `GET /api/public/shops/{shopCode}`
 * 真的接到既有的白名單 loader，不是另開一套查詢（issue #11 §2）
 * -----------------------------------------------------------------------------
 * 這支端點的安全性完全建立在「重用 `src/server/public-shop.ts` 已驗證過的白名單」
 * 這個前提上。這裡讀原始碼守住這個前提本身：route 檔案裡不得出現任何直接對
 * Supabase 發查詢的痕跡（那會是另開一套查詢規則，繞過既有三條安全規則），且必須
 * 真的呼叫 `loadPublicShop()`、套用節流、附上 CORS header、並且不把內部用的
 * `tenantId` 洩漏到公開回應裡。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const route = readFileSync(
  resolve(ROOT, 'src/app/api/public/shops/[shopCode]/route.ts'), 'utf8',
);

describe('#11 GET /api/public/shops/{shopCode} 的接線', () => {
  it('呼叫既有的 loadPublicShop()，不直接對 Supabase 發查詢', () => {
    expect(route).toContain('loadPublicShop(shopCode)');
    expect(route).not.toMatch(/createAdminSupabase|\.from\(['"]tenants['"]\)/);
  });

  it('套用節流（同一套 checkRateLimit/clientIpFromHeaders，不是另開一套）', () => {
    expect(route).toContain("from '@/server/rate-limit'");
    expect(route).toContain('checkRateLimit(');
  });

  it('回應附上 CORS header（同一套 publicCorsHeaders，不是自己組 header）', () => {
    expect(route).toContain("from '@/server/public-cors'");
    expect(route).toContain('publicCorsHeaders(');
    expect(route).toContain('export function OPTIONS');
  });

  it('刻意不把內部用的 tenantId 洩漏到公開回應', () => {
    expect(route).toMatch(/tenantId:\s*_tenantId/);
    expect(route).not.toMatch(/ok\(data\)/);
  });

  it('找不到店家時回 404，且仍帶 CORS header（不是繞過 CORS 邏輯直接 fail）', () => {
    const notFoundBlock = route.slice(route.indexOf('if (!data)'), route.indexOf('// `tenantId`'));
    expect(notFoundBlock).toContain('fail(404');
    expect(notFoundBlock).toContain('corsHeaders');
  });
});
