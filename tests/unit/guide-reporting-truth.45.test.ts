import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reportPage = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/reports/page.tsx'),
  'utf8',
);
const modes = readFileSync(
  resolve(process.cwd(), 'src/config/modes.ts'),
  'utf8',
);
const reportsCopy = readFileSync(
  resolve(process.cwd(), 'src/i18n/zh-TW/pages/reports.ts'),
  'utf8',
);

describe('#45-A truthful GUIDE reporting availability', () => {
  it('declares GUIDE reporting availability in the shared mode preset', () => {
    expect(modes).toContain("reportingMode: 'GUIDE_PENDING'");
    expect(modes).toContain("reportingMode: 'GENERAL'");
    expect(reportPage).toContain('const showGeneralReports = modePreset.reportingMode === \'GENERAL\';');
  });

  it('does not fetch or render generic report data for the unavailable mode', () => {
    expect((reportPage.match(/if \(!showGeneralReports\)/g) || [])).toHaveLength(4);
    expect(reportPage).toContain('setData(null);');
    expect(reportPage).toContain('setStaff([]);');
    expect(reportPage).toContain('setAdvancedUnlocked(false);');
    expect(reportPage).toContain('title={t.guideUnavailable.title}');
  });

  it('gives the operator an honest next step instead of fabricated numbers', () => {
    expect(reportsCopy).toContain('GUIDE 專屬報表尚未建置');
    expect(reportsCopy).toContain('不顯示通用店家報表');
    expect(reportsCopy).toContain('前往行程與方案');
  });
});
