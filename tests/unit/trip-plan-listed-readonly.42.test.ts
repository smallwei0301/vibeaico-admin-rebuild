import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';

// Source-pin：祕島 LISTED 行程可唯讀開啟方案編輯器（看得到季節價格），所有寫入入口仍早退／disabled。
const src = readFileSync(resolve(process.cwd(), 'src/app/tenant/trips/[id]/page.tsx'), 'utf8');

function fnBody(name: string): string {
  const start = src.indexOf(`const ${name} = `);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, start + 400);
}

describe('issue #42 LISTED 方案編輯器唯讀', () => {
  it('openPlanEditor 不再因 LISTED 早退，LISTED 也能開啟', () => {
    const body = fnBody('openPlanEditor');
    expect(body).not.toContain('blockListedPlanWrite');
    expect(body).toContain('setPlanDraft(draft)');
  });

  it('列表編輯（檢視）按鈕不因 LISTED disabled，刪除與排序仍 disabled', () => {
    expect(src).toMatch(/aria-label=\{t\.actions\.edit\}\s*\n\s*onClick=\{\(\) => openPlanEditor\(p\)\}/);
    expect(src).toMatch(/disabled=\{listedPlanWritesBlocked\}\s*\n\s*onClick=\{\(\) => setDeleteTarget\(\{ kind: 'plan'/);
    expect(src).toContain('disabled={listedPlanWritesBlocked || i === 0}');
    expect(src).toContain('disabled={listedPlanWritesBlocked || i === plans.length - 1}');
  });

  it('編輯器顯示 LISTED 唯讀說明，且文案在 i18n', () => {
    expect(src).toContain('t.plans.review.listedReadonly');
    expect(tripsPage.plans.review.listedReadonly).toContain('僅供檢視');
  });

  it('quick／advanced 表單欄位包在 disabled fieldset，高級入口按鈕在 fieldset 外', () => {
    const fieldsets = src.match(/<fieldset disabled=\{listedPlanWritesBlocked\}/g) ?? [];
    expect(fieldsets.length).toBe(2);
    const closeFirst = src.indexOf('</fieldset>');
    const advBtn = src.indexOf('onClick={openAdvancedPlanEditor}');
    expect(advBtn).toBeGreaterThan(closeFirst);
  });

  it('儲存方案與季節新增／編輯／刪除按鈕 disabled', () => {
    expect(src).toMatch(/disabled=\{listedPlanWritesBlocked\}\s*\n\s*loading=\{savingPlan\}/);
    expect(src).toContain('disabled={listedPlanWritesBlocked || savingPlan || !!seasonDraft}');
    expect(src).toMatch(/<Button type="button" size="sm" disabled=\{listedPlanWritesBlocked\} loading=\{savingSeason\}/);
  });

  it('所有寫入 handler 本身早退', () => {
    for (const name of ['openSeasonEditor', 'saveSeason', 'savePlan', 'movePlan']) {
      expect(fnBody(name)).toContain('if (blockListedPlanWrite()) return;');
    }
    expect(src).toContain("if ((kind === 'plan' || kind === 'season') && blockListedPlanWrite()) return;");
  });

  it('非 LISTED 不受影響：封鎖旗標只由 midaoListing === LISTED 決定', () => {
    expect(src).toContain("const listedPlanWritesBlocked = trip?.midaoListing === 'LISTED';");
    expect(src).toContain('if (!listedPlanWritesBlocked) return false;');
  });
});
