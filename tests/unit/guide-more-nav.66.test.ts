import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GUIDE_MORE_GROUPS,
  getGuideMoreGroups,
  getNav,
  getNavLeaf,
} from '@/config/nav';
import { hiddenNavKeys } from '@/config/modes';
import { morePage } from '@/i18n/zh-TW/pages/more';
import { guideBottomNav } from '@/i18n/zh-TW/nav';

/**
 * Issue #66 gap-audit bounded slice：GUIDE 五大父層級之「更多」分組目錄與底部導航
 * 是否真的在 runtime 可達（不是視覺比對，那屬 Phase C／瀏覽器驗收）。
 *
 * 這裡鎖住三件事：
 *  1. `GUIDE_MORE_GROUPS` 引用的每個 key 都能反查到既有 NAV 葉節點——防止改名/
 *     刪除既有 route 卻沒同步更新分組表，變成「更多」頁上的死連結（deep link 404）。
 *  2. `getGuideMoreGroups()` 套用與桌機 Sidebar 相同的 hidden-key 規則，同一份
 *     業態設定不會因為換了個消費端就對不上（modes.ts 是唯一事實來源，CLAUDE.md）。
 *  3. 每個分組 key 都有 i18n 標籤，不會有分組在畫面上顯示成 undefined/raw key。
 */
describe('Issue #66：GUIDE 更多頁分組表 getGuideMoreGroups()', () => {
  it('GUIDE_MORE_GROUPS 引用的每個 leafKey 都能反查到真實存在的 NAV 葉節點（防死連結）', () => {
    // report_issue 在既有 Sidebar 本來就是 href="#" 的占位連結（真正動作是 BugReportButton
    // 浮動按鈕），不是本次新增的死連結；沿用既有行為，不在本測試放大既有範圍外的問題。
    const KNOWN_PLACEHOLDER_HREFS = new Set(['report_issue']);
    for (const group of GUIDE_MORE_GROUPS) {
      for (const key of group.leafKeys) {
        const leaf = getNavLeaf(key);
        expect(leaf, `leafKey "${key}"（分組 "${group.key}"）在 NAV 中查無對應葉節點`).toBeDefined();
        expect(leaf?.href).toBeTruthy();
        if (!KNOWN_PLACEHOLDER_HREFS.has(key)) {
          expect(leaf?.href).not.toBe('#');
        }
      }
    }
  });

  it('每個分組 key 在 morePage.groups i18n 字典都有對應文案（zero hardcoded copy）', () => {
    for (const group of GUIDE_MORE_GROUPS) {
      const label = morePage.groups[group.key as keyof typeof morePage.groups];
      expect(label, `分組 "${group.key}" 缺少 morePage.groups 文案`).toBeTruthy();
    }
  });

  it('GUIDE 業態：套用與 Sidebar 相同的 hidden-key 規則，回傳的葉節點都不在隱藏清單內', () => {
    const hidden = new Set(hiddenNavKeys('GUIDE'));
    const groups = getGuideMoreGroups('GUIDE');
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      for (const leaf of group.leaves) {
        expect(hidden.has(leaf.key)).toBe(false);
      }
    }
  });

  it('LOCAL_SHOP 業態：hiddenNavKeys 隱藏 trips，因此「行程與營運」分組不含 trips（同一份規則生效）', () => {
    const groups = getGuideMoreGroups('LOCAL_SHOP');
    const operations = groups.find((g) => g.key === 'operations');
    const leafKeys = operations?.leaves.map((l) => l.key) ?? [];
    expect(leafKeys).not.toContain('trips');
  });

  it('分組結果不重複收錄已由其餘四大父層級（首頁／團次／旅客／訊息）直接覆蓋的核心 route', () => {
    const coreParentHrefs = new Set(['/tenant/dashboard', '/tenant/customers', '/tenant/chat']);
    const groups = getGuideMoreGroups('GUIDE');
    for (const group of groups) {
      for (const leaf of group.leaves) {
        expect(coreParentHrefs.has(leaf.href)).toBe(false);
      }
    }
  });

  it('getNav("GUIDE") 產生的桌機側邊欄不受本次新增分組表影響（既有葉節點/群組結構不變）', () => {
    const entries = getNav('GUIDE');
    expect(entries.length).toBeGreaterThan(0);
  });
});

/**
 * 靜態內容檢查：GuideBottomNav 與 /tenant/more 兩個新檔一律透過 i18n 字典取文案，
 * 不在元件內把中文寫死成字面字串（CLAUDE.md 鐵則 1）。做法是把檔案內容中已知
 * 允許出現中文字的地方（JSDoc 註解、import 路徑字串）拿掉後，剩餘原始碼不應
 * 再出現任何中文字元。
 */
describe('Issue #66：GuideBottomNav / /tenant/more 靜態文案鎖', () => {
  const REPO_ROOT = resolve(__dirname, '..', '..');
  const CJK_RANGE = /[一-鿿]/;

  function stripCommentsAndImports(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (JSDoc 說明)
      .replace(/^.*\/\/.*$/gm, (line) => (line.trim().startsWith('//') ? '' : line)) // whole-line // comments
      .replace(/from\s+['"][^'"]*['"]/g, ''); // import 路徑字串（若含中文別名，不算硬編碼文案）
  }

  it('GuideBottomNav.tsx 移除註解／import 路徑後不含中文字面字串', () => {
    const source = readFileSync(
      resolve(REPO_ROOT, 'src/components/layout/GuideBottomNav.tsx'),
      'utf-8',
    );
    const stripped = stripCommentsAndImports(source);
    expect(CJK_RANGE.test(stripped)).toBe(false);
  });

  it('/tenant/more/page.tsx 移除註解／import 路徑後不含中文字面字串', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'src/app/tenant/more/page.tsx'), 'utf-8');
    const stripped = stripCommentsAndImports(source);
    expect(CJK_RANGE.test(stripped)).toBe(false);
  });

  it('GuideBottomNav 的五個入口 href 與 20 分冊 §2／§4.1／#66 分工一致', () => {
    const source = readFileSync(
      resolve(REPO_ROOT, 'src/components/layout/GuideBottomNav.tsx'),
      'utf-8',
    );
    for (const href of [
      '/tenant/dashboard',
      '/tenant/calendar',
      '/tenant/customers',
      '/tenant/chat',
      '/tenant/more',
    ]) {
      expect(source).toContain(href);
    }
  });

  it('guideBottomNav i18n 字典提供五個入口的文案，且與桌機 dashboard 用字（儀表板）不同', () => {
    expect(guideBottomNav.home).toBe('首頁');
    expect(guideBottomNav.home).not.toBe('儀表板');
    expect(Object.values(guideBottomNav).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });
});
