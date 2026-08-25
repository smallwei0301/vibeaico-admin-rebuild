/**
 * `flexShowTip`（LINE 設定頁的「顯示使用提示」）目前是一顆**切得動但沒有效果**的開關：
 * 頁面讀它、存它、「恢復預設」重設它，端點也收它並寫進 `tenant_settings.line`，
 * 但 `src/server/` 底下零引用——顧客那端不會因為它而有任何不同。
 *
 * 擁有者裁決（14 分冊 §8.22-c）是 (b)「給它語意並補齊」，且指定併進 issue #19
 * （Rich Menu 進階設計器）一起做。在 #19 完成之前，畫面必須說實話。
 *
 * 這份測試釘的是**過渡期的誠實**，不是最終行為：
 * - 只要 server 端仍然沒有人讀 `flexShowTip`，畫面上就必須有那句「尚未生效」。
 * - 等 #19 真的接上（server 端出現引用），這份測試會**自己反過來要求把那句拿掉**——
 *   否則就變成新的不誠實：功能已經生效了，畫面卻還說沒有。
 *
 * 也就是說這不是一條「等人記得刪」的暫時測試，而是一條會隨事實翻面的守門測試。
 * 同型作法見 `honest-not-built-residuals.test.ts`（QR 補齊後前提反轉的那一組）。
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

describe('flexShowTip —— 過渡期誠實標註（14 分冊 §8.22-c）', () => {
  const wiredUp = serverFilesMentioning('flexShowTip');

  it('server 端一旦真的讀了 flexShowTip，這份測試就要求移除「尚未生效」文案', () => {
    if (wiredUp.length === 0) {
      // 尚未接線：下面兩條才是現在該守的規則
      expect(lineSettingsPage.flexMenu.showTipNotBuilt).toContain('尚未生效');
      return;
    }
    // 已接線（issue #19 完成）：畫面不得再說它沒生效
    expect(
      PAGE.includes('showTipNotBuilt'),
      `src/server 已有 ${wiredUp.length} 處引用 flexShowTip（${wiredUp.join(', ')}），`
      + '功能已生效，line-settings 頁不得再顯示「尚未生效」。請改成描述真實行為。',
    ).toBe(false);
  });

  it('未接線期間，那句話必須真的渲染在開關旁邊（不是只寫在註解或 i18n 裡）', () => {
    if (wiredUp.length > 0) return;
    // SwitchField 的 description 是唯一會顯示在 label 底下的插槽
    expect(PAGE).toMatch(/description=\{t\.flexMenu\.showTipNotBuilt\}/);
  });

  it('文案要指出它排在哪裡，店家才知道不是被遺忘', () => {
    if (wiredUp.length > 0) return;
    expect(lineSettingsPage.flexMenu.showTipNotBuilt).toContain('#19');
  });
});
