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
    expect(src).toMatch(/aria-label=\{listedPlanWritesBlocked \? t\.actions\.view : t\.actions\.edit\}\s*\n\s*onClick=\{\(\) => openPlanEditor\(p\)\}/);
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

  it('進階切換按鈕在 LISTED 時不被 disabled（唯讀仍可進入看季節）', () => {
    const idx = src.indexOf('onClick={openAdvancedPlanEditor}');
    expect(idx).toBeGreaterThan(-1);
    const btn = src.slice(src.lastIndexOf('<Button', idx), idx);
    expect(btn).toContain('disabled={!planDraft.id || savingPlan}');
    expect(btn).not.toContain('listedPlanWritesBlocked');
  });

  it('季節定價區塊位於第二個 fieldset 之後（不被整區 disabled）', () => {
    const first = src.indexOf('</fieldset>');
    const second = src.indexOf('</fieldset>', first + 1);
    const season = src.indexOf('季節定價（issue #42）');
    expect(second).toBeGreaterThan(first);
    expect(season).toBeGreaterThan(second);
  });

  it('assistedHint（仍可自由修改）只在非 LISTED 時渲染，來源標籤保留', () => {
    expect(src).toContain('{!listedPlanWritesBlocked ? <span className="ml-1">{t.plans.source.assistedHint}</span> : null}');
    expect(src).toContain('{t.plans.source[planDraft.source]}');
  });

  it('LISTED 時列表按鈕、退回提示、Modal 標題、intro、進階提示都改用唯讀文案', () => {
    const L = String.raw`(?<![!\w])listedPlanWritesBlocked\s*\?\s*`;
    const tern = (a: string, b: string) => new RegExp(`${L}${a}\\s*:\\s*${b}(?![\\w.])`);
    expect(src).toMatch(tern('t\\.actions\\.view', 't\\.actions\\.edit'));
    expect(src.match(new RegExp(`(?:title|aria-label)=\\{${L}t\\.actions\\.view\\s*:\\s*t\\.actions\\.edit\\}`, 'g'))?.length).toBe(2);
    expect(src).toMatch(tern('t\\.plans\\.review\\.changesHintListed', 't\\.plans\\.review\\.changesHint'));
    expect(src).toMatch(tern('t\\.plans\\.viewTitle\\(planDraft\\.name\\)', 't\\.plans\\.editTitle\\(planDraft\\.name\\)'));
    expect(src).toMatch(/\{!listedPlanWritesBlocked \? <Alert tone="info">\{t\.plans\.quick\.intro\}<\/Alert> : null\}/);
    expect(src).toMatch(tern('t\\.plans\\.quick\\.listedAdvancedHint', 't\\.plans\\.quick\\.advancedHint'));
    expect(tripsPage.actions.view).toBe('檢視');
    expect(tripsPage.plans.viewTitle('X')).toBe('檢視方案「X」');
    expect(tripsPage.plans.review.changesHintListed).toBe('管理者要求修改，但此行程已上架 Midao，目前無法儲存或送審；方案內容僅供檢視。');
    expect(tripsPage.plans.quick.listedAdvancedHint).toBe('可開啟進階設定檢視販售方式、人數、成團規則、訂金、時長與季節定價，目前僅供檢視。');
    for (const s of [tripsPage.plans.review.changesHintListed, tripsPage.plans.quick.listedAdvancedHint]) {
      expect(s).not.toContain('請調整');
      expect(s).not.toContain('並送審');
      expect(s).not.toContain('重新儲存');
    }
  });

  it('進階模式 LISTED：標題、intro、季節檢視按鈕、footer 儲存按鈕都走唯讀分支', () => {
    const L = String.raw`(?<![!\w])listedPlanWritesBlocked\s*\?\s*`;
    expect(src).toMatch(new RegExp(`${L}t\\.plans\\.advanced\\.viewTitle\\s*:\\s*t\\.plans\\.advanced\\.title(?![\\w.])`));
    expect(src).toMatch(new RegExp(`${L}t\\.plans\\.advanced\\.listedIntro\\s*:\\s*t\\.plans\\.advanced\\.intro(?![\\w.])`));
    expect(src.match(new RegExp(`(?:title|aria-label)=\\{${L}t\\.actions\\.view\\s*:\\s*t\\.actions\\.edit\\}`, 'g'))?.length).toBe(2);
    // 季節列：LISTED 不渲染編輯／刪除（不能標「檢視」卻按不下）；未上架保留原按鈕與原 title
    const seasonStart = src.search(/\{!listedPlanWritesBlocked \? \(\s*<span className="btn-group shrink-0">/);
    expect(seasonStart).toBeGreaterThan(-1);
    const seasonBlock = src.slice(seasonStart);
    const seasonEnd = seasonBlock.indexOf(') : null}');
    expect(seasonEnd).toBeGreaterThan(-1);
    const seasonBtns = seasonBlock.slice(0, seasonEnd);
    expect(seasonBtns).toContain('title={t.actions.edit} aria-label={t.actions.edit}');
    expect(seasonBtns).toContain('title={t.actions.delete} aria-label={t.actions.delete}');
    expect(seasonBtns).not.toContain('t.actions.view');
    expect(seasonBtns.match(/disabled=\{listedPlanWritesBlocked \|\| savingPlan \|\| !!seasonDraft\}/g)?.length).toBe(2);
    // 未上架儲存按鈕：原文案、原 loadingText、無額外 disabled
    expect(src).toContain("loadingText={planEditorMode === 'advanced' ? t.plans.advanced.saving : t.plans.quick.saving}");
    expect(src).toContain("{planEditorMode === 'advanced' ? t.plans.advanced.save : t.plans.quick.save}");
    const saveBtn = src.slice(src.indexOf('{!listedPlanWritesBlocked ? (\n              <Button\n                loading={savingPlan}'));
    expect(saveBtn.slice(0, saveBtn.indexOf('</Button>'))).not.toMatch(/disabled=/);
    expect(tripsPage.plans.quick.save).toBe('儲存快速編輯');
    expect(tripsPage.plans.quick.saving).toBe('儲存並確認中…');
    // footer 儲存按鈕：LISTED 時完全不渲染（不是 disabled 的「儲存」）
    expect(src).toMatch(/\{!listedPlanWritesBlocked \? \(\s*<Button\s+loading=\{savingPlan\}/);
    expect(src).not.toMatch(/<Button\s+disabled=\{listedPlanWritesBlocked\}\s+loading=\{savingPlan\}/);
    expect(tripsPage.plans.advanced.viewTitle).toBe('檢視方案進階設定');
    expect(tripsPage.plans.advanced.listedIntro).toBe('以下為此方案的販售方式、團型、單筆人數、成團規則、時長、計價方式、訂金政策與季節定價，目前僅供檢視。');
    for (const s of [tripsPage.plans.advanced.viewTitle, tripsPage.plans.advanced.listedIntro]) {
      for (const bad of ['請調整', '並送審', '儲存', '設定販售方式']) expect(s).not.toContain(bad);
    }
    // 未上架文案不變
    expect(tripsPage.plans.advanced.title).toBe('方案進階設定');
    expect(tripsPage.plans.advanced.save).toBe('儲存進階設定');
  });
});
