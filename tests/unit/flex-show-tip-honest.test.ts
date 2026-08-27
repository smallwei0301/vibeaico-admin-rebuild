/**
 * `flexShowTip`（LINE 設定頁的「顯示使用提示」）—— **前提已於 2026-08-26 翻面**。
 *
 * 這份測試原本釘的是「過渡期的誠實」：只要 `src/server/` 底下沒有人讀 `flexShowTip`，
 * 畫面上就必須有一句「尚未生效」。它同時寫明了會自己反過來的條件：
 *
 * > 等 #19 真的接上（server 端出現引用），這份測試會**自己反過來要求把那句拿掉**——
 * > 否則就變成新的不誠實：功能已經生效了，畫面卻還說沒有。
 *
 * issue #19 已接線（`src/server/flex-menu.ts` 的 `buildFlexMenuOutcome()` 真的讀它，
 * 06 分冊 §6.2.10），所以本檔改成守**接線後**的規則。原本的三條斷言不是被刪掉，
 * 是被它們自己寫好的翻面條件換掉了：
 *
 *   舊：i18n 有 showTipNotBuilt 且含「尚未生效」  → 新：那個鍵**不得再存在**
 *   舊：頁面渲染 showTipNotBuilt                  → 新：頁面渲染 showTipHelp
 *   舊：文案要寫出它排在哪個 issue                → 新：文案要**逐字描述真實行為**
 *
 * ⚠️ 行為本身（多送一則、只在 FLEX 生效）由 `tests/unit/flex-menu.06.test.ts` 的
 * 「buildFlexMenuOutcome — flexShowTip」那一組釘住，本檔只管**畫面說的話對不對**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lineSettingsPage } from '@/i18n/zh-TW/pages/line-settings';

const PAGE = readFileSync('src/app/tenant/line-settings/page.tsx', 'utf-8');

/** 遞迴收集 src/server 底下所有 .ts，找 `flexShowTip` 的引用。 */
function serverFilesMentioning(needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts') && readFileSync(full, 'utf-8').includes(needle)) hits.push(full);
    }
  };
  walk('src/server');
  return hits;
}

describe('flexShowTip —— 已接線，畫面必須改口（06 分冊 §6.2.10 / 14 分冊 §8.22-c）', () => {
  const wiredUp = serverFilesMentioning('flexShowTip');

  it('server 端真的有人讀它（否則整份誠實文案的前提就不成立）', () => {
    expect(
      wiredUp,
      'src/server 底下沒有任何檔案讀 flexShowTip —— 它又變回一顆假開關了',
    ).not.toHaveLength(0);
    expect(wiredUp.some((f) => f.endsWith('flex-menu.ts'))).toBe(true);
  });

  it('畫面不得再說它「尚未生效」——功能已生效，那句話現在才是謊', () => {
    expect(
      PAGE.includes('showTipNotBuilt'),
      `src/server 已有 ${wiredUp.length} 處引用 flexShowTip（${wiredUp.join(', ')}），`
      + 'line-settings 頁不得再顯示「尚未生效」。',
    ).toBe(false);
    expect(
      'showTipNotBuilt' in lineSettingsPage.flexMenu,
      '過渡期的 showTipNotBuilt 文案還留在字典裡，遲早有人把它接回畫面上',
    ).toBe(false);
    for (const value of Object.values(lineSettingsPage.flexMenu)) {
      if (typeof value === 'string') expect(value).not.toContain('尚未生效');
    }
  });

  it('說明文字真的渲染在開關旁邊（不是只寫在註解或字典裡）', () => {
    expect(PAGE).toMatch(/description=\{t\.flexMenu\.showTipHelp\}/);
  });

  it('文案逐字描述真實行為：多一則、以及哪些情況不會出現', () => {
    const help = lineSettingsPage.flexMenu.showTipHelp;
    // 「會多送一則」是這顆開關唯一的效果，不講清楚店家看不出差別
    expect(help).toContain('一則');
    // 只在 FLEX 生效——關閉主選單（HINT/SILENT）與沒有卡片時都不會出現，
    // 不寫出來的話店家在那些狀態下切開它、什麼都沒發生，又會回到同一種困惑
    expect(help).toContain('關閉');
    expect(help).toContain('卡片');
  });
});
