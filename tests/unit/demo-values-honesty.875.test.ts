import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');

describe('#875 示範值誠實性', () => {
  it('referrals：示範推薦碼與列表只在 mock 模式出現', () => {
    const s = read('src/app/tenant/referrals/page.tsx');
    expect(s).toContain("import { APP_URL, USE_MOCK } from '@/config/env'");
    expect(s).toMatch(/if \(!USE_MOCK\) \{\s*return \(/);
    expect(s).toContain('t.unavailable.title');
    // 示範碼只在早退之後的 JSX 使用；真實模式 effect 不載入 MOCK_REFERRALS
    expect(s).toMatch(/if \(!USE_MOCK\) \{ setLoading\(false\); return; \}/);
    expect(s.indexOf('if (!USE_MOCK) {\n    return')).toBeLessThan(s.indexOf('value={MOCK_REFERRAL_CODE}'));
  });

  it('points：月費與待審儲值兩個寫死值在真實模式顯示 dash', () => {
    const s = read('src/app/tenant/points/page.tsx');
    expect(s).toContain('!USE_MOCK ? t.labels.dash : loading ? t.labels.dash : t.labels.points(MOCK_MONTHLY_COST)');
    expect(s).toContain('!USE_MOCK ? t.labels.dash : loading ? t.labels.dash : t.labels.points(MOCK_PENDING_TOPUP)');
    expect(s).toContain('t.stats.notAvailableHint');
  });

  it('dashboard：真實模式不渲染 MOCK_LINE_PLAN 方案名', () => {
    const s = read('src/app/tenant/dashboard/page.tsx');
    const i = s.indexOf('const linePlanLabel');
    const block = s.slice(i, s.indexOf(';', s.indexOf('linePlanLite', i)));
    expect(block.indexOf('!USE_MOCK')).toBeGreaterThan(-1);
    expect(block.indexOf('!USE_MOCK')).toBeLessThan(block.indexOf('MOCK_LINE_PLAN'));
    expect(block).toContain('t.stats.lineConnected');
  });

  it('product-orders：收款方式欄位停用且不從假清單寫入 paymentMethodName', () => {
    const s = read('src/app/tenant/product-orders/page.tsx');
    expect(s).not.toContain('MOCK_PAYMENT_METHODS');
    expect(s).not.toContain('setPaymentMethodId');
    expect(s).toMatch(/id="moPaymentMethodId"[^>]*disabled/);
    expect(s).toContain('t.manual.paymentUnavailable');
    expect(s).toMatch(/paymentMethodName: null, \/\/ #875/);
  });
});
