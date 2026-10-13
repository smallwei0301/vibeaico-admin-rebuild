// 儀表板「設定進度」未完成項可點進對應設定頁：每個 step key 在每個模式的目標
// 必須是真實存在的 src/app/tenant/** 頁面（或明確為 null 的隱藏頁）。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES, MODE_PRESETS, type SetupStepKey } from '@/config/modes';
import { getSetupStepHref } from '@/lib/setup-step-routes';

const root = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const STEP_KEYS: SetupStepKey[] = ['SHOP_INFO', 'STAFF', 'SERVICE', 'BUSINESS_HOURS', 'LINE_BOT'];

describe('setup step routes', () => {
  for (const mode of BUSINESS_TYPES) {
    for (const key of STEP_KEYS) {
      it(`${mode}/${key} maps to an existing tenant page or null`, () => {
        const href = getSetupStepHref(key, mode);
        if (href === null) {
          // 只有該模式側邊欄隱藏的頁面才能為 null
          expect(key).toBe('SERVICE');
          expect(MODE_PRESETS[mode].hiddenNavKeys).toContain('services');
          return;
        }
        const path = href.split('#')[0];
        expect(path.startsWith('/tenant/')).toBe(true);
        expect(existsSync(root(`src/app${path}/page.tsx`))).toBe(true);
      });
    }
  }

  it('settings hashes are tabs the settings page already understands', () => {
    const settings = readFileSync(root('src/app/tenant/settings/page.tsx'), 'utf8');
    expect(settings).toContain("'#basic': 'basic'");
    expect(settings).toContain("'#business': 'business'");
    expect(getSetupStepHref('BUSINESS_HOURS', 'LOCAL_SHOP')).toBe('/tenant/settings#business');
  });

  it('dashboard renders Link for undone steps with accessible name', () => {
    const page = readFileSync(root('src/app/tenant/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('getSetupStepHref(s.key, businessType)');
    expect(page).toMatch(/<Link\s+href=\{href\}\s+aria-label=\{t\.setup\.goSetupLabel\(stepLabel\)\}/);
    expect(page).toContain('min-h-11');
  });
});
