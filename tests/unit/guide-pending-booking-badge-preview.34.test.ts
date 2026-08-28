/**
 * issue #34 的 GUIDE Preview 驗收腳本契約。
 *
 * Preview 需要互動登入與同一個非正式資料庫，不能在 unit CI 偽造成功；這裡只鎖
 * 驗收腳本本身不能再把 GUIDE 的 pending booking 路徑 SKIP 掉。真正的判準仍在
 * scripts/verify/appshell-shell-values.34.cjs：建立 → API/DB/UI 三方比對 → 清理。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('scripts/verify/appshell-shell-values.34.cjs', 'utf8');

describe('GUIDE pending booking badge 的 Preview 驗收（issue #34）', () => {
  it('有 opt-in 的 GUIDE 受控 pending booking，不能因資料為 0 而 SKIP', () => {
    expect(script).toContain('VERIFY_GUIDE_PENDING_BOOKING');
    expect(script).toContain("businessType !== 'GUIDE'");
    expect(script).toContain("'/api/bookings'");
    expect(script).toMatch(/method:\s*'POST'/);
    expect(script).toMatch(/status:\s*'PENDING'/);
  });

  it('等待真實 pending-bookings API 回應，並讓 API、DB 與側邊欄徽章相等', () => {
    expect(script).toContain('page.waitForResponse');
    expect(script).toContain("url.pathname === '/api/bookings'");
    expect(script).toContain("url.searchParams.get('status') === 'PENDING'");
    expect(script).toContain('apiPendingTotal === expectedBooking');
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
