import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settingsPage } from '@/i18n/zh-TW/pages/settings';
import { calendarSyncPage } from '@/i18n/zh-TW/pages/calendar-sync';
import { getNavLeaf } from '@/config/nav';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('#892 真實模式不顯示假功能', () => {
  it('settings 頁 ICS 控制項受 USE_MOCK 控管，且有誠實說明', () => {
    const s = src('src/app/tenant/settings/page.tsx');
    expect(s).toMatch(/import \{[^}]*USE_MOCK[^}]*\} from '@\/config\/env'/);
    expect(s).toMatch(/\{USE_MOCK \? \(\s*<>\s*<FormGroup>\s*<Label htmlFor="calIcsUrl">/);
    expect(s).toContain('t.calendarSync.notAvailable');
    expect(s).toMatch(/\{USE_MOCK && \(\s*<ConfirmModal\s+open=\{confirmRegen\}/);
    expect(settingsPage.calendarSync.notAvailable).toContain('尚未開放');
  });

  it('calendar-sync 頁 URL／最後同步／重新產生受 USE_MOCK 控管', () => {
    const s = src('src/app/tenant/calendar-sync/page.tsx');
    expect(s).toMatch(/import \{[^}]*USE_MOCK[^}]*\} from '@\/config\/env'/);
    expect(s).toMatch(/\{USE_MOCK \? \(\s*<>\s*<FormGroup>\s*<Label htmlFor="calIcsUrl">/);
    expect(s).toContain('t.subscribe.notAvailable');
    expect(s).toMatch(/\{USE_MOCK && \(\s*<ConfirmModal\s+open=\{confirmRegen\}/);
    expect(calendarSyncPage.subscribe.notAvailable).toContain('尚未開放');
  });

  it('Topbar 安裝 App／推播按鈕僅 mock 顯示', () => {
    const s = src('src/components/layout/Topbar.tsx');
    expect(s).toMatch(/import \{ USE_MOCK \} from '@\/config\/env'/);
    const m = s.match(/\{USE_MOCK && \(([\s\S]*?)\n\s*\)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('common.topbar.installApp');
    expect(m![1]).toContain('common.topbar.enablePush');
  });

  it('report_issue 不再是死連結，側欄與更多頁都開啟回報視窗', () => {
    expect(getNavLeaf('report_issue')).toBeDefined();
    const modal = src('src/components/layout/BugReportModal.tsx');
    expect(modal).toContain("'vibeai:open-bug-report'");
    expect(modal).toContain('addEventListener(OPEN_BUG_REPORT_EVENT');
    const sidebar = src('src/components/layout/Sidebar.tsx');
    expect(sidebar).toMatch(/leaf\.key === 'report_issue'[\s\S]*?<button\s+type="button"\s+onClick=\{\(\) => \{ onCloseMobile\(\); openBugReport\(\); \}\}/);
    const more = src('src/app/tenant/more/page.tsx');
    expect(more).toContain('onClick={openBugReport}');
    // 視窗本體不受 hidden lg:flex 影響：事件監聽在元件最外層、Modal 不在隱藏的按鈕內
    expect(src('src/components/layout/AppShell.tsx')).toContain('<BugReportButton />');
  });
});
