/**
 * tests/unit/public-shop-cancellation-policy.46.test.ts — issue #46 下單前顯示現行取消／退款政策
 *
 * 修復前：公開店家頁（`/s/{shopCode}`）列出所有行程與方案時完全不顯示取消／退款政策，
 * 顧客只有先點進 REQUEST 方案的申請表單才看得到（`RequestForm.tsx`）。FIXED_DEPARTURE
 * 方案則從頭到尾看不到——但那正是多數旅客做決定的地方。
 *
 * 這裡讀原始碼文字（不是渲染行為），驗證：
 * 1. `src/server/public-shop.ts` 的 trips select 真的多取了 `refund_policy_type`，
 *    且 `PublicTrip` 型別與 mapping 都帶出這個欄位。
 * 2. `src/app/s/[shopCode]/page.tsx` 真的把這個欄位渲染出來，而不是只加了型別沒接畫面。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const loader = readFileSync(resolve(ROOT, 'src/server/public-shop.ts'), 'utf8');
const page = readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/page.tsx'), 'utf8');
const i18n = readFileSync(resolve(ROOT, 'src/i18n/zh-TW/pages/public-shop.ts'), 'utf8');

describe('公開店家頁下單前顯示現行取消／退款政策 (#46)', () => {
  it('trips 的 select 白名單真的多取了 refund_policy_type（仍不是 select(*)）', () => {
    const tripsSelect = [...loader.matchAll(/\.select\(\s*'([^']*)'/g)]
      .map((m) => m[1])
      .find((s) => s.includes('trips.') === false && s.includes('title') && s.includes('duration_hours'));
    expect(tripsSelect, '找不到 trips 的 select').toBeTruthy();
    expect(tripsSelect).toContain('refund_policy_type');
    expect(tripsSelect).not.toContain('*');
  });

  it('PublicTrip 型別與 mapping 帶出 refundPolicyType，且值域收斂到三個合法值', () => {
    expect(loader).toMatch(/refundPolicyType:\s*'STANDARD'\s*\|\s*'FLEXIBLE'\s*\|\s*'STRICT'/);
    expect(loader).toMatch(
      /refundPolicyType:\s*row\.refund_policy_type === 'FLEXIBLE' \|\| row\.refund_policy_type === 'STRICT'\s*\n\s*\? row\.refund_policy_type : 'STANDARD'/,
    );
  });

  it('頁面真的渲染了政策文字，不是只加型別沒接畫面', () => {
    expect(page).toContain('t.trips.cancellationPolicyLabel');
    expect(page).toContain('t.trips.cancellationPolicy[trip.refundPolicyType]');
  });

  it('i18n 提供三種政策值域各自的文案，沒有硬編中文字面量落在頁面裡', () => {
    expect(i18n).toMatch(/cancellationPolicy:\s*\{/);
    expect(i18n).toContain('STANDARD:');
    expect(i18n).toContain('FLEXIBLE:');
    expect(i18n).toContain('STRICT:');
    // 頁面本身不得出現這三個值域字面量以外、直接寫死的政策說明中文
    expect(page).not.toMatch(/出發前\s*7\s*天可全額退款/);
  });
});
