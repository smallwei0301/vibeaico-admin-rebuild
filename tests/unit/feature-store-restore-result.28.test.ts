/**
 * feature-store「恢復訂閱」三種結果的不可回歸測試（GitHub issue #28 第 ⑧ 筆）
 * -----------------------------------------------------------------------------
 * 修改前：頁面 `await restoreFeature(item.key)` **完全丟棄回傳值**，一律顯示
 * 「「X」訂閱已恢復！」。但端點成功時回 { restoredCoupons, restoredProducts }，
 * §6 還原副作用失敗時回 { restoreSideEffectFailed: true }（restore/route.ts:78-83，
 * 註解還寫著「前端已有對應警示文案」）。那三句文案
 * （feature-store.ts:147-151 的 couponsRestored / productsRestored /
 * restoreSideEffectFailed）**全站零引用**，票券／商品沒恢復成功時店家不會知道。
 *
 * 端點在三種情況下實際回什麼，由整合測試
 * tests/integration/api/feature-store-restore.28.test.ts 驗；這裡驗的是頁面
 * 有沒有真的依那個回傳值分岔（node 環境無法 render React 元件，見
 * tests/unit/honest-support-chat-widget.test.ts 開頭的說明）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { featureStorePage as t } from '@/i18n/zh-TW/pages/feature-store';

const PAGE = 'src/app/tenant/feature-store/page.tsx';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const code = withoutComments(src(PAGE));
/**
 * runPending 的函式本體（恢復／取消都在這裡）。
 * 結尾抓下一個同層 `const `（去註解後段落分隔線已消失，不能用它當界標）。
 */
const runPendingStart = code.indexOf('const runPending');
const runPending = code.slice(
  runPendingStart,
  code.indexOf('\n  const ', runPendingStart + 'const runPending'.length),
);

describe('feature-store：restoreFeature 的回傳值不再被丟棄（issue #28 第 ⑧ 筆）', () => {
  it('回傳值被接住成 FeatureRestoreResult，而不是裸 await', () => {
    expect(runPending).toMatch(/restoreResult\s*=\s*await restoreFeature\(/);
    expect(code).toMatch(/type FeatureRestoreResult/);
    // 修改前的樣子：`else await restoreFeature(item.key);`
    expect(runPending).not.toMatch(/else await restoreFeature\(/);
  });

  it('分支 1：沒有票券／商品要恢復時，只顯示既有的「訂閱已恢復」', () => {
    expect(runPending).toMatch(/toast\.show\(\s*\n?\s*extras\.length/);
    expect(t.messages.restored('X')).toBe('「X」訂閱已恢復！');
  });

  it('分支 2：引用早就備好的 couponsRestored / productsRestored，且 0 筆時不顯示', () => {
    expect(runPending).toMatch(/restoreResult\?\.restoredCoupons\s*\n?\s*\?\s*t\.messages\.couponsRestored\(restoreResult\.restoredCoupons\)/);
    expect(runPending).toMatch(/restoreResult\?\.restoredProducts\s*\n?\s*\?\s*t\.messages\.productsRestored\(restoreResult\.restoredProducts\)/);
    expect(runPending).toMatch(/\.filter\(Boolean\)/);
    expect(t.messages.couponsRestored(3)).toBe('3 張票券已自動恢復發布');
    expect(t.messages.productsRestored(2)).toBe('2 項商品已自動重新上架');
  });

  it('分支 3：restoreSideEffectFailed 走 warning，並附上既有的警示文案', () => {
    expect(runPending).toMatch(/restoreResult\?\.restoreSideEffectFailed/);
    expect(runPending).toMatch(/t\.messages\.restoreSideEffectFailed/);
    // 訂閱本身確實恢復成功了，所以是 warning 不是 danger
    const branch = runPending.slice(runPending.indexOf('restoreSideEffectFailed'));
    expect(branch.slice(0, branch.indexOf('} else'))).toMatch(/'warning'/);
    expect(t.messages.restoreSideEffectFailed).toMatch(/票券\/商品自動恢復失敗/);
  });

  it('三句文案不是新寫的（值與 issue #28 引述的既有字典一致）', () => {
    expect(t.messages.restoreSideEffectFailed).toBe(
      '\n⚠️ 但票券/商品自動恢復失敗，請到票券管理／商品管理手動恢復（已通知平台處理）',
    );
  });
});
