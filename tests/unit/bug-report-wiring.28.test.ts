/**
 * 「回報問題」modal 的接線不可回歸測試（GitHub issue #28 第 ① 筆）
 * -----------------------------------------------------------------------------
 * 修改前（14 分冊 §7 的 26 筆 MISMATCH 之一）：
 *   const submit = async () => {
 *     setSubmitting(true);
 *     await new Promise((r) => setTimeout(r, 500));   // ← 假延遲
 *     setSubmitting(false); setOpen(false);
 *     toast.show('已收到您的回報，感謝協助！');          // ← 硬編碼中文 + 假成功
 *   };
 * 而且四個欄位全是 uncontrolled（`<Input id="bugSubject" />`，無 value/onChange），
 * 所以使用者打的字連收集都沒收集。`POST /api/bug-report` 一直存在、從未被呼叫。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有安裝
 *    @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 *    這裡測的是靜態不變條件；「送出後資料庫真的有那四個欄位的內容」由整合測試
 *    tests/integration/api/bug-report.28.test.ts 負責。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { common } from '@/i18n/zh-TW/common';

const MODAL = 'src/components/layout/BugReportModal.tsx';
const SERVICE = 'src/services/bug-report.ts';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的說明被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('BugReportModal：四個欄位是 controlled（issue #28 第 ① 筆）', () => {
  const code = withoutComments(src(MODAL));

  it('category / subject / description / contactEmail 四個欄位各有 state 與 value+onChange', () => {
    for (const state of ['category', 'subject', 'description', 'contactEmail']) {
      const setter = `set${state[0].toUpperCase()}${state.slice(1)}`;
      expect(code, `${state} 沒有對應的 useState`)
        .toMatch(new RegExp(`const \\[${state}, ${setter}\\] = React\\.useState`));
    }
    // 四個輸入元件都必須同時有 value 與 onChange —— 少一個就是又回到 uncontrolled
    for (const id of ['bugCategory', 'bugSubject', 'bugDesc', 'bugEmail']) {
      const tagStart = code.indexOf(`id="${id}"`);
      expect(tagStart, `找不到 id="${id}"`).toBeGreaterThan(-1);
      const tag = code.slice(tagStart, code.indexOf('>', tagStart));
      expect(tag, `${id} 沒有 value=`).toMatch(/value=\{/);
      expect(tag, `${id} 沒有 onChange=`).toMatch(/onChange=\{/);
    }
  });

  it('沒有 defaultValue（uncontrolled 的殘跡）', () => {
    expect(code).not.toMatch(/defaultValue/);
  });
});

describe('BugReportModal：送出真的打端點（issue #28 第 ① 筆）', () => {
  const code = withoutComments(src(MODAL));

  it('沒有 setTimeout 假延遲', () => {
    expect(code).not.toMatch(/setTimeout/);
    expect(code).not.toMatch(/new Promise\(\s*\(r\)\s*=>/);
  });

  it('submit 內 await src/services 的 submitBugReport，且四個欄位都被送出去', () => {
    expect(code).toMatch(/import \{ submitBugReport \} from '@\/services\/bug-report'/);
    const submit = code.slice(code.indexOf('const submit'), code.indexOf('return ('));
    expect(submit).toMatch(/await submitBugReport\(/);
    expect(submit).toMatch(/category:/);
    expect(submit).toMatch(/subject:\s*subject\.trim\(\)/);
    expect(submit).toMatch(/content:\s*description\.trim\(\)/);
    expect(submit).toMatch(/contactEmail:/);
  });

  it('成功訊息在 await 之後才顯示，失敗顯示 danger（鐵則 12：成功訊息不得早於動作）', () => {
    const submit = code.slice(code.indexOf('const submit'), code.indexOf('return ('));
    expect(submit.indexOf('await submitBugReport('))
      .toBeLessThan(submit.indexOf('toast.show(t.submitted)'));
    expect(submit).toMatch(/catch[\s\S]*toast\.show\([\s\S]*'danger'\)/);
  });

  it('元件不自己 fetch（CLAUDE.md「Pages never fetch」）', () => {
    expect(code).not.toMatch(/fetch\(/);
  });
});

describe('BugReportModal：零硬編碼中文字面量（鐵則 1）', () => {
  const code = withoutComments(src(MODAL));

  it('原始碼（去註解後）不含任何中日韓文字元', () => {
    const cjk = code.match(/[一-鿿　-〿＀-￯]/g);
    expect(cjk ?? [], `仍有中文字面量：${(cjk ?? []).join('')}`).toEqual([]);
  });

  it('先前硬編碼的成功訊息已移進 common.bugReport 字典且被引用', () => {
    expect(common.bugReport.submitted).toBe('已收到您的回報，感謝協助！');
    expect(code).toMatch(/toast\.show\(t\.submitted\)/);
    expect(code).toMatch(/t\.submitFailed/);
  });
});

describe('BugReportModal：截圖上傳誠實化（CLAUDE.md「Never fabricate a known」）', () => {
  const code = withoutComments(src(MODAL));

  it('截圖欄位停用，且畫面上（不是只在註解裡）說明尚未建置', () => {
    const tagStart = code.indexOf('id="bugShot"');
    const tag = code.slice(tagStart, code.indexOf('/>', tagStart));
    expect(tag).toMatch(/disabled/);
    expect(code).toMatch(/t\.screenshotNotBuilt/);
    expect(common.bugReport.screenshotNotBuilt).toMatch(/尚未建置/);
  });
});

describe('services/bug-report.ts：端點路徑與 body 欄位（DoD 10 的第三段）', () => {
  const code = withoutComments(src(SERVICE));

  it('real 分支打 POST /api/bug-report', () => {
    expect(code).toMatch(/request<\{ id: string \}>\('\/api\/bug-report'/);
    expect(code).toMatch(/method: 'POST'/);
  });

  it('BugReportInput 含 subject 與 contactEmail（0018 補的兩個欄位）', () => {
    expect(code).toMatch(/subject: string/);
    expect(code).toMatch(/contactEmail\?: string/);
  });
});
