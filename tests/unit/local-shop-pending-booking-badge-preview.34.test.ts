/**
 * issue #34 的 LOCAL_SHOP Preview 驗收腳本契約。
 *
 * Preview 需要互動登入與同一個非正式資料庫，不能在 unit CI 偽造成功；這裡只鎖
 * 驗收腳本使用 canonical LOCAL_SHOP fixture，並實際要求非零 API/DB/UI 三方相等。
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = readFileSync('scripts/verify/appshell-shell-values.34.cjs', 'utf8');

describe('LOCAL_SHOP pending booking badge 的 Preview 驗收（issue #34）', () => {
  it('只接受 canonical LOCAL_SHOP fixture，不能誤用隱藏 bookings nav 的 GUIDE', () => {
    expect(script).toContain('VERIFY_LOCAL_SHOP_PENDING_BOOKING');
    expect(script).toContain("const CANONICAL_LOCAL_SHOP_EMAIL = 'owner-a@test.local'");
    expect(script).toContain("businessType !== 'LOCAL_SHOP'");
    expect(script).not.toContain('VERIFY_GUIDE_PENDING_BOOKING');
    expect(script).not.toContain("businessType !== 'GUIDE'");
  });

  it('透過真實 booking API 建立受控 PENDING 預約', () => {
    expect(script).toContain("'/api/bookings'");
    expect(script).toMatch(/method:\s*'POST'/);
    expect(script).toMatch(/status=eq\.PENDING/);
  });

  it('等待真實 pending-bookings API，要求非零 API、DB 與可見側邊欄徽章相等', () => {
    expect(script).toContain('page.waitForResponse');
    expect(script).toContain("url.pathname === '/api/bookings'");
    expect(script).toContain("url.searchParams.get('status') === 'PENDING'");
    expect(script).toContain('apiPendingTotal > 0');
    expect(script).toContain('apiPendingTotal === expectedBooking');
    expect(script).toContain('shown !== undefined');
    expect(script).toContain('shown === String(apiPendingTotal)');
  });

  it('無論成功或失敗都刪掉建立的 booking，並驗證沒有殘留', () => {
    expect(script).toContain("'bookings'");
    expect(script).toContain('seededBookingId');
    expect(script).toContain('await cleanupSeed()');
    expect(script).toMatch(/cleanupSeed\(\)\.catch/);
    expect(script).toContain("const left = await sbCount(table, `id=eq.${id}`)");
    expect(script).toContain('!res.ok || left !== 0');
  });
});

describe('Preview 驗收的目標環境安全鎖（issue #34 P0）', () => {
  it('只接受精確 TEST Supabase host，並限制 BASE_URL 為 localhost 或 branch Preview', () => {
    expect(script).toContain("const TEST_SUPABASE_HOST = 'nmwhwngojosmagjuvxol.supabase.co'");
    expect(script).toContain("supabase.protocol !== 'https:'");
    expect(script).toContain('supabase.hostname !== TEST_SUPABASE_HOST');
    expect(script).toContain("base.hostname === 'localhost'");
    expect(script).toContain("base.hostname === '127.0.0.1'");
    expect(script).toContain('VERCEL_PREVIEW_HOST.test(base.hostname)');
    expect(script).toContain("base.hostname.includes('midao.com.tw')");
  });

  it('在任何 login、service-role API 或 seed 前執行安全鎖', () => {
    const guardAt = script.indexOf('assertSafeTarget();');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(script.indexOf('async function sbSelect'));
    expect(guardAt).toBeLessThan(script.indexOf('async function main'));
  });

  it.each([
    ['Production Supabase', 'http://localhost:3117', 'https://egehnijjpgijmccagxac.supabase.co'],
    ['midao Production deployment', 'https://midao.com.tw', 'https://nmwhwngojosmagjuvxol.supabase.co'],
  ])('在 %s 時 fail closed，未觸發登入或 API', (_caseName, baseUrl, supabaseUrl) => {
    const run = spawnSync(process.execPath, ['scripts/verify/appshell-shell-values.34.cjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        SUPABASE_URL: supabaseUrl,
        TEST_EMAIL: 'safety@test.local',
        TEST_PASSWORD: 'not-used',
        SUPABASE_SERVICE_ROLE_KEY: 'not-used',
      },
    });
    expect(run.status).toBe(2);
    expect(`${run.stdout}\n${run.stderr}`).toMatch(/安全鎖|拒絕/);
  });
});
