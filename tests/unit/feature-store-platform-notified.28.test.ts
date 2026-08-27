/**
 * 「已通知平台」這句話終於有依據了——但只有在真的量到的時候才准說
 * -----------------------------------------------------------------------------
 * 接續 commit `9829f12`（issue #28 第 ⑭ 筆的後續）。事情的三個階段：
 *
 *   1. 原本：文案結尾寫「（已通知平台處理）」，而 `restore/route.ts` 的失敗分支
 *      只有一行 `console.error`——**零通知**。店家以為平台知道了，於是不會主動
 *      回報，問題就此消失。這是本專案定義的「捏造的已知」。
 *   2. `9829f12`：端點真的寫一筆 `bug_reports`（reporter='system'）當平台端待處理
 *      紀錄，同時把那句話**拿掉**——因為那筆寫入自己也可能失敗（route 內 try/catch
 *      吞掉），而回應裡沒有旗標可以據實分岔。宣稱一個沒量到的狀態，跟原本同一種錯。
 *   3. 本輪：`FeatureRestoreResult` 加 optional 的 `platformNotified`，端點依 insert
 *      的**實際成敗**回傳，畫面依旗標分岔。
 *
 * 這一檔鎖的就是第 3 步不可以退化成「無條件回 true」——那等於把捏造的已知從文案
 * 搬到 API，同一個錯換個地方犯。旗標與 DB 真實狀態是否一致，由整合測試
 * tests/integration/api/feature-store-platform-notified.28.test.ts 兩條路各驗一次。
 *
 * （node 環境無法 render React 元件，所以頁面部分讀原始碼比對，見
 * tests/unit/honest-support-chat-widget.test.ts 開頭的說明。）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { featureStorePage as t } from '@/i18n/zh-TW/pages/feature-store';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const settings = withoutComments(src('src/services/settings.ts'));
const route = withoutComments(src('src/app/api/feature-store/[code]/restore/route.ts'));
const page = withoutComments(src('src/app/tenant/feature-store/page.tsx'));

describe('契約：FeatureRestoreResult 的 platformNotified（鐵則 3 只新增 optional 欄位）', () => {
  it('新增的是 optional 欄位，既有三個欄位的名稱與形狀原封不動', () => {
    const shape = settings.match(/export interface FeatureRestoreResult \{[\s\S]*?\n\}/)?.[0];
    expect(shape).toBeDefined();
    expect(shape!).toMatch(/platformNotified\?: boolean;/);
    // 既有欄位不得改名或改形狀（鐵則 3）
    expect(shape!).toMatch(/restoredCoupons\?: number;/);
    expect(shape!).toMatch(/restoredProducts\?: number;/);
    expect(shape!).toMatch(/restoreSideEffectFailed\?: boolean;/);
  });
});

describe('端點：platformNotified 反映 bug_reports insert 的真實結果', () => {
  it('recordPlatformIssue 回傳 boolean，成功回 true、被吞掉的錯回 false', () => {
    expect(route).toMatch(/async function recordPlatformIssue\([\s\S]*?\): Promise<boolean> \{/);
    const fn = route.match(
      /async function recordPlatformIssue\([\s\S]*?\n\}/,
    )?.[0];
    expect(fn).toBeDefined();
    // 成功路徑：insert 的 error 拋出去之後才 return true
    const throwAt = fn!.indexOf('if (error) throw error;');
    const trueAt = fn!.indexOf('return true;');
    expect(throwAt).toBeGreaterThan(-1);
    expect(trueAt).toBeGreaterThan(throwAt);
    // 失敗路徑：catch 內 log 之後回 false（不是靜靜地什麼都不回＝undefined）
    const catchBlock = fn!.slice(fn!.indexOf('} catch (e) {'));
    expect(catchBlock).toMatch(/console\.error\(/);
    expect(catchBlock).toMatch(/return false;/);
  });

  it('失敗分支把 recordPlatformIssue 的回傳值原封帶進回應，不是寫死 true', () => {
    expect(route).toMatch(
      /const platformNotified =\s*\n?\s*await recordPlatformIssue\(admin, t\.tenantId, t\.user\.email \?\? '', code, e\);/,
    );
    expect(route).toMatch(/return ok\(\{ restoreSideEffectFailed: true, platformNotified \}\);/);
    /*
     * ⚠️ 變異測試的鎖：把旗標改成 `platformNotified: true`（無條件宣稱已記錄）
     * 這一行就會紅。那正是本輪要清掉的錯——只是從文案搬到了 API。
     */
    expect(route).not.toMatch(/platformNotified: true/);
    expect(route).not.toMatch(/platformNotified: !!/);
  });
});

describe('頁面：只有旗標明確為 true 才敢說「已自動記錄」', () => {
  const runPendingStart = page.indexOf('const runPending');
  const runPending = page.slice(
    runPendingStart,
    page.indexOf('\n  const ', runPendingStart + 'const runPending'.length),
  );

  it('比對寫成 === true，false 與 undefined 都走不宣稱的那一句', () => {
    expect(runPending).toMatch(/restoreResult\.platformNotified === true/);
    /*
     * 不可以寫成 truthy 判斷（`restoreResult.platformNotified ?` 或 `?.`），
     * 那會讓「mock 分支／舊版後端沒回這欄」與「確實記錄成功」在語意上分不開——
     * undefined 是「我們不知道」，不是 false 的相反面。
     */
    expect(runPending).not.toMatch(/restoreResult\?\.platformNotified \?/);
    expect(runPending).not.toMatch(/if \(restoreResult\.platformNotified\)/);
  });

  it('兩句文案都來自字典，頁面沒有內嵌中文字面量（鐵則 1）', () => {
    expect(runPending).toMatch(/t\.messages\.restoreSideEffectFailedNotified/);
    expect(runPending).toMatch(/t\.messages\.restoreSideEffectFailed\b/);
    expect(page).not.toMatch(/已自動記錄/);
    expect(page).not.toMatch(/票券\/商品自動恢復失敗/);
  });

  it('true 的分支用 Notified 那句、else 用原句（順序不可對調）', () => {
    const ternary = runPending.slice(
      runPending.indexOf('restoreResult.platformNotified === true'),
    );
    const notifiedAt = ternary.indexOf('restoreSideEffectFailedNotified');
    const plainAt = ternary.indexOf(': t.messages.restoreSideEffectFailed');
    expect(notifiedAt).toBeGreaterThan(-1);
    expect(plainAt).toBeGreaterThan(notifiedAt);
  });
});

describe('文案：兩句各自只講自己有依據的事', () => {
  /**
   * ⚠️ 前提變更（主導者複核，2026-08-25）——**不是**把斷言放寬。
   *
   * 這一格原本釘的是「…此問題已自動記錄，**平台會協助處理**」。複核時判定後半句
   * 仍然超出量到的範圍：端點量到的只有「`bug_reports` 那一列 insert 成功了」，
   * 而「平台會處理」是平台端的**作業承諾**，系統無從得知，也沒有任何機制保證。
   *
   * 這是同一個病的小劑量版本——最初那句「（已通知平台處理）」錯在通知根本沒發生；
   * 這句錯在把「記下來了」講成「有人會處理」。
   *
   * 釘子照樣是釘子（維持 `toBe`，沒有改成 `toContain`），只是釘在收緊後的字串上，
   * 並在下方新增一組斷言把「不得承諾平台會處理」這個方向也鎖住。
   */
  it('「已記錄」那句只講已記錄，不承諾後續；另一句維持要店家聯絡客服', () => {
    expect(t.messages.restoreSideEffectFailedNotified).toBe(
      '\n⚠️ 但票券/商品自動恢復失敗，請到票券管理／商品管理手動恢復；此問題已自動記錄給平台，若需要盡快處理請直接聯絡客服',
    );
    expect(t.messages.restoreSideEffectFailed).toBe(
      '\n⚠️ 但票券/商品自動恢復失敗，請到票券管理／商品管理手動恢復；若無法自行恢復，請聯絡平台客服協助處理',
    );
  });

  it('兩句都仍不宣稱「已通知」（14 分冊 §8.10 全站通則）', () => {
    // 寫進 bug_reports 是「已記錄」，不是「已通知」——沒有人被 email、被推播
    expect(t.messages.restoreSideEffectFailedNotified).not.toMatch(/已通知/);
    expect(t.messages.restoreSideEffectFailed).not.toMatch(/已通知/);
  });

  it('沒有依據的那一句不得出現「已記錄」字樣（否則兩句就沒差別了）', () => {
    expect(t.messages.restoreSideEffectFailed).not.toMatch(/已自動記錄/);
    // 兩句都必須保留店家自己該做的那件事
    expect(t.messages.restoreSideEffectFailedNotified).toContain('手動恢復');
    expect(t.messages.restoreSideEffectFailed).toContain('手動恢復');
  });
});

/**
 * 主導者複核時收緊的一條：`platformNotified === true` 那句一度寫成
 * 「此問題已自動記錄，平台會協助處理」。
 *
 * 我們真正量到的只有一件事——`bug_reports` 那一列 insert 成功了。
 * 「平台會處理」是平台端的**作業承諾**，系統無從得知，也沒有任何機制保證。
 * 這是同一個病的小劑量版本：原句（「已通知平台處理」）錯在通知根本沒發生，
 * 這句錯在把「記下來了」講成「有人會處理」。
 */
describe('連「已記錄」之後的那半句也不得超出量到的範圍', () => {
  it('不承諾平台會處理，只陳述「已記錄」這個真的量到的事實', () => {
    expect(t.messages.restoreSideEffectFailedNotified).not.toContain('平台會協助處理');
    expect(t.messages.restoreSideEffectFailedNotified).not.toContain('平台會處理');
    expect(t.messages.restoreSideEffectFailedNotified).toContain('已自動記錄給平台');
  });

  it('仍然給店家一個可以自己採取的動作（不是只丟一句話就沒了）', () => {
    expect(t.messages.restoreSideEffectFailedNotified).toMatch(/請直接聯絡客服/);
  });

  it('兩句都仍不宣稱「已通知」（§8.10 通則沒有因為這次收緊而鬆掉）', () => {
    for (const line of [t.messages.restoreSideEffectFailed, t.messages.restoreSideEffectFailedNotified]) {
      expect(line).not.toContain('已通知');
    }
  });
});
