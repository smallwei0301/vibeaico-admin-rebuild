import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/feature-store/page.tsx');
const copy = read('src/i18n/zh-TW/pages/feature-store.ts');
const service = read('src/services/settings.ts');

const runPending = page.slice(page.indexOf('const runPending'), page.indexOf('/* -------------------------------------------------------------- 卡片 */'));

describe('feature-store restore result (#28⑧)', () => {
  it('awaits the real restore result before showing the success state', () => {
    expect(runPending).toContain('let restoreResult: FeatureRestoreResult | undefined;');
    expect(runPending).toContain('restoreResult = await restoreFeature(item.key)');
    expect(runPending.indexOf('restoreResult = await restoreFeature(item.key)')).toBeLessThan(
      runPending.indexOf('setPending(null)'),
    );
    expect(runPending).toContain('t.messages.restoreSideEffectFailed');
    expect(runPending).toContain('t.messages.couponsRestored(restoreResult.restoredCoupons)');
    expect(runPending).toContain('t.messages.productsRestored(restoreResult.restoredProducts)');
  });

  it('does not fabricate zero or missing side-effect counts', () => {
    expect(runPending).toContain('if (restoreResult?.restoredCoupons)');
    expect(runPending).toContain('if (restoreResult?.restoredProducts)');
    expect(runPending).not.toContain('couponsRestored(0)');
    expect(runPending).not.toContain('productsRestored(0)');
  });

  it('keeps the page on the service boundary and the result contract typed', () => {
    expect(page).toContain("import { applyFeature, cancelFeature, listFeatures, restoreFeature, type FeatureRestoreResult } from '@/services/settings';");
    expect(page).not.toMatch(/fetch\(/);
    expect(service).toContain('export interface FeatureRestoreResult');
    expect(service).toContain('restoreSideEffectFailed?: boolean');
  });

  it('does not claim an unperformed platform notification', () => {
    expect(copy).not.toContain('已通知平台處理');
    expect(copy).toContain('請到票券管理／商品管理手動恢復');
  });
});
