import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { richMenuDesignPage as t } from '@/i18n/zh-TW/pages/rich-menu-design';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const page = src('src/app/tenant/rich-menu-design/page.tsx');

describe('#1078 選單設計頁真實模式不假成功', () => {
  it('匯入 USE_MOCK', () => {
    expect(page).toMatch(/import \{[^}]*USE_MOCK[^}]*\} from '@\/config\/env'/);
  });

  it('發布／刪除／還原／草稿／範本／步驟說明卡／popup 的成功 toast 只在 USE_MOCK 下可達', () => {
    expect(page).toMatch(/if \(USE_MOCK\) toast\.show\(t\.publish\.draftSaved\)/);
    expect(page).toMatch(/setConfirm\(null\);\s*if \(!USE_MOCK\) return;\s*setPublishing\(true\)/);
    expect(page).toMatch(/setConfirm\(null\);\s*if \(!USE_MOCK\) return;\s*setHasBackup\(true\);\s*toast\.show\(\s*subscribed/);
    expect(page).toMatch(/if \(!USE_MOCK\) return; setHasBackup\(false\); toast\.show\(t\.scene\.restoreDone\)/);
    expect(page).toMatch(/if \(!USE_MOCK\) return; toast\.show\(t\.publish\.deleted\)/);
    expect(page).toMatch(/if \(USE_MOCK\) toast\.show\(t\.flex\.popupSaved\)/);
    expect(page).toMatch(/if \(!USE_MOCK\) return;\s*setGuideCard\(v\);\s*toast\.show/);
  });

  it('假動作的入口按鈕在真實模式停用', () => {
    expect(page.match(/disabled=\{!USE_MOCK\}/g)!.length).toBeGreaterThanOrEqual(7);
  });

  it('真實模式顯示 notAvailable 提示，並連到 LINE 設定頁', () => {
    expect(t.notAvailable.message).toContain('尚未開放');
    expect(page).toMatch(/\{!USE_MOCK && <NotAvailableNotice \/>\}/);
    expect(page).toContain('t.notAvailable.message');
    expect(page).toContain('href="/tenant/line-settings"');
  });

  it('「即時生效」說明不在真實模式顯示', () => {
    expect(t.bookingSteps.guideHelp).toContain('即時生效');
    expect(t.bookingSteps.guideHelpReal).not.toContain('即時生效');
    expect(page).toContain('USE_MOCK ? t.bookingSteps.guideHelp : t.bookingSteps.guideHelpReal');
  });

  it('真實模式不推進階選單訂閱：FeatureLockBar 與 lockedHint 只在 USE_MOCK 下渲染', () => {
    expect(page).toMatch(/\{USE_MOCK && !loading && !subscribed && <FeatureLockBar \/>\}/);
    expect(page).toMatch(/\{USE_MOCK && !subscribed && \(\s*<Alert[\s\S]*?\{t\.cells\.lockedHint\}/);
  });
  it('真實模式不顯示「發布需訂閱」說明與進階標籤', () => {
    const subBullets = t.scene.bullets.filter((b) => b.mockOnly);
    expect(subBullets.length).toBe(2);
    expect(subBullets.map((b) => b.strong)).toEqual(['發布', '放心試']);
    expect(subBullets[0].text).toContain('訂閱');
    expect(t.scene.bullets.filter((b) => !b.mockOnly).every((b) => !b.text.includes('訂閱'))).toBe(true);
    expect(page).toContain('t.scene.bullets.filter((b) => USE_MOCK || !b.mockOnly)');
    expect(page).toContain('{USE_MOCK && th.advanced && !subscribed &&');
    expect(page).toContain('{USE_MOCK && l.advanced && !subscribed &&');
  });
});
