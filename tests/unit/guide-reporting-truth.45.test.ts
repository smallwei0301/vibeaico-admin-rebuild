import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const reportPage = read('src/app/tenant/reports/page.tsx');
const modes = read('src/config/modes.ts');
const reportsCopy = read('src/i18n/zh-TW/pages/reports.ts');

describe('#45 GUIDE reporting routing (mode preset)', () => {
  it('routes GUIDE to the tour report via the shared mode preset, not a businessType check', () => {
    expect(modes).toContain("reportingMode: 'GUIDE_TOUR'");
    expect(modes).not.toContain('GUIDE_PENDING');
    expect(modes).toContain("reportingMode: 'GENERAL'");
    expect(reportPage).toContain("const showGeneralReports = modePreset.reportingMode === 'GENERAL';");
    expect(reportPage).toContain('<GuideReportView />');
    expect(reportPage).not.toContain("businessType === 'GUIDE'");
  });

  it('does not fetch generic report data for the GUIDE mode', () => {
    expect((reportPage.match(/if \(!showGeneralReports\)/g) || [])).toHaveLength(4);
  });

  it('keeps honest not-enabled copy for metrics without a data model', () => {
    expect(reportsCopy).toContain('尚未啟用的指標');
    expect(reportsCopy).toContain('不顯示成交率');
    expect(reportsCopy).toContain('尚無足夠資料');
  });

  // 本專案 unit 跑 node 環境、無 RTL，無法掛載頁面；以原始碼斷言守住 403 與失敗還原兩個分支（行為已由 route 403 測試與型別保證另一半）
  it('GuideReportView 對 403 顯示權限狀態、失敗時把輸入框還原為現有報表區間', () => {
    const view = read('src/app/tenant/reports/GuideReportView.tsx');
    expect(view).toContain('e.status === 403');
    expect(view).toContain('t.forbidden.title');
    expect(view).toContain('setFromInput(last.range.from)');
    expect(reportsCopy).toContain('需要店長或管理者權限');
  });
});
