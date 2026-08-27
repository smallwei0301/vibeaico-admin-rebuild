/**
 * 班別範本 modal 的三個動作（編輯／新增／刪除）——issue #28 第 ⑦ 筆
 * -----------------------------------------------------------------------------
 * 兩個獨立缺陷，本輪一起修：
 *
 * 1. **文案憑空宣稱一個沒發生的動作**：`updated` 說「班表時間已同步」，但
 *    `PUT /api/shift-templates/:id`（src/app/api/shift-templates/[id]/route.ts）
 *    只 update `shift_templates` 一列，完全沒有碰 `shifts` 表。
 *    `deleteConfirm` / `deleted` 說「已套用此範本的班表會一併清除」，但 DELETE
 *    端點是真刪一列，`shifts.template_id` 是 `on delete set null`（migration
 *    0005：`template_id uuid references shift_templates(id) on delete set null`），
 *    且 `shifts` 表自己存 `start_time`/`end_time`（0005 migration；
 *    `src/app/api/shifts/route.ts` 讀寫都是這兩欄，不是即時查範本），所以刪範本
 *    只會讓 `shifts.template_id` 變 null，日期原本的時間與「已排班」狀態不受影響。
 *    兩句都是把「沒發生的事」講成已發生——本輪依擁有者裁決 (a) 改文案，
 *    不做範本→班表的連動同步。
 *
 * 2. **成功 toast 排在 await 之前**（違反鐵則 12）：修改前 `submit`／刪除的
 *    `onConfirm` 都是先 `onChange(...)` + `toast.show(成功)`，再用 `void` 射後
 *    不理地打 API；API 失敗時使用者已經看過綠色成功提示。
 *
 * 手法沿用 tests/unit/category-action-order.28.test.ts：讀原始碼、用 `indexOf`
 * 比對 await 與 toast 的相對位置。本專案沒有安裝 @testing-library/react，
 * vitest 單元測試跑在 node 環境（vitest.config.mts: environment: 'node'），
 * 無法掛載 React 元件、也無法真的讓一個 mock service 的 promise 保持 pending
 * 再斷言畫面此刻沒有 toast——這是 14 分冊 §7.2「判準的第四層」指定的替代方案：
 * 用靜態原始碼鎖代替掛載測試，鎖的是同一個不變條件（await 完成前不可能執行到
 * toast 那一行，因為兩者在同一個 async function 的順序敘述裡）。
 *
 * 端點本身「PUT 不碰 shifts / DELETE 是 on delete set null」的行為由
 * migration 0005 與 route.ts 本身佐證（本檔不重複驗證資料庫行為，那是既有事實
 * 不是本輪改的程式碼）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { shiftsPage } from '@/i18n/zh-TW/pages/shifts';

const PAGE = 'src/app/tenant/shifts/page.tsx';
const MIGRATION_0005 = 'supabase/migrations/0005_line_marketing_other.sql';
const SHIFT_TEMPLATE_ROUTE = 'src/app/api/shift-templates/[id]/route.ts';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的說明被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('文案：不得再宣稱範本改動會連動 shifts 表（除非查證證明為真）', () => {
  it('查證基準：shifts.template_id 是 on delete set null，且 shifts 自存 start_time/end_time', () => {
    const migration = src(MIGRATION_0005);
    expect(migration).toMatch(
      /template_id\s+uuid\s+references\s+shift_templates\(id\)\s+on delete set null/,
    );
    // shifts 有自己的 start_time/end_time 欄位，不是讀取時才去 join 範本算出來的
    expect(migration).toMatch(/start_time\s+time not null/);
    expect(migration).toMatch(/end_time\s+time not null/);
  });

  it('查證基準：PUT /api/shift-templates/:id 只 update shift_templates，完全沒碰 shifts 表', () => {
    const route = withoutComments(src(SHIFT_TEMPLATE_ROUTE));
    const putHandler = route.slice(route.indexOf('export const PUT'), route.indexOf('export const DELETE'));
    expect(putHandler).toMatch(/\.from\('shift_templates'\)\.update\(/);
    expect(putHandler).not.toMatch(/\.from\('shifts'\)/);
  });

  it('updated / deleteConfirm / deleted 三句都不含「已同步」「一併清除」「相關班表已清除」', () => {
    const claims = [
      shiftsPage.templateModal.updated,
      shiftsPage.templateModal.deleteConfirm,
      shiftsPage.templateModal.deleted,
    ];
    for (const text of claims) {
      expect(text, `文案仍宣稱連動 shifts 表：「${text}」`).not.toMatch(/已同步/);
      expect(text, `文案仍宣稱連動 shifts 表：「${text}」`).not.toMatch(/一併清除/);
      expect(text, `文案仍宣稱連動 shifts 表：「${text}」`).not.toMatch(/相關班表已清除/);
      expect(text, `文案仍宣稱連動 shifts 表：「${text}」`).not.toMatch(/變為「未排班」/);
    }
  });

  it('updated：改成「不影響已排定的班表」的誠實版本（擁有者裁決 (a)：範本只是下次排班的預設值）', () => {
    expect(shiftsPage.templateModal.updated).toMatch(/不會更動已排定的班表|不影響已排定的班表/);
  });

  it('deleteConfirm / deleted：改成「已套用的班表不受影響」的誠實版本', () => {
    expect(shiftsPage.templateModal.deleteConfirm).toMatch(/不受影響/);
    expect(shiftsPage.templateModal.deleted).toMatch(/不受影響/);
  });
});

describe('編輯／新增：成功 toast 必須排在 await 端點之後（鐵則 12）', () => {
  const page = withoutComments(src(PAGE));
  /**
   * ⚠️ 2026-08-26（issue #7 乙）：這裡原本是對整個檔案抓**第一個**
   * `const submit = async () => {`。那時 shifts 頁只有一個 submit（TemplateModal 的）；
   * 週排班接線後 `WeeklyScheduleModal` 也有了一個，而且排在前面，於是這三條
   * 斷言開始檢查錯的函式。**斷言本身一字未改**（TemplateModal 的成功 toast 仍然
   * 必須排在 await 之後、失敗仍然必須 'danger'），只是把取樣範圍限縮到
   * TemplateModal 這個元件內，讓它不再受「檔案裡有幾個 submit」影響。
   */
  const templateModal = page.slice(page.indexOf('function TemplateModal('));
  const submit = templateModal.match(/const submit = async \(\) => \{[\s\S]*?\n  \};/)?.[0];

  it('submit 函式存在且為 async（不是舊的 void 射後不理）', () => {
    expect(submit).toBeDefined();
  });

  it('編輯分支（draft.id 為真）：await updateShiftTemplate 在 toast.show(updated) 之前', () => {
    expect(submit).toBeDefined();
    const editBranch = submit!.slice(submit!.indexOf('if (draft.id) {'), submit!.indexOf('} else {'));
    const awaitAt = editBranch.indexOf('await updateShiftTemplate(');
    const toastAt = editBranch.indexOf('toast.show(t.templateModal.updated)');

    expect(awaitAt, '編輯分支找不到 await updateShiftTemplate(').toBeGreaterThan(-1);
    expect(toastAt, '編輯分支找不到成功 toast').toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
    // 失敗要說失敗，不可吞掉後照樣報成功
    expect(editBranch).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('新增分支（draft.id 為假）：await createShiftTemplate 在 toast.show(created) 之前', () => {
    expect(submit).toBeDefined();
    const createBranch = submit!.slice(submit!.indexOf('} else {'));
    const awaitAt = createBranch.indexOf('await createShiftTemplate(');
    const toastAt = createBranch.indexOf('toast.show(t.templateModal.created)');

    expect(awaitAt, '新增分支找不到 await createShiftTemplate(').toBeGreaterThan(-1);
    expect(toastAt, '新增分支找不到成功 toast').toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
    expect(createBranch).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('兩個分支都不再用「射後不理」的 void 呼叫（缺陷本體的否定式，肯定式在上面兩個 it 已鎖）', () => {
    expect(page).not.toMatch(/void updateShiftTemplate\(/);
    expect(page).not.toMatch(/void createShiftTemplate\(/);
  });
});

describe('刪除：成功 toast 必須排在 await deleteShiftTemplate 之後（鐵則 12）', () => {
  const page = withoutComments(src(PAGE));
  // onConfirm 是 ConfirmModal 的 prop，用「onConfirm={async () => {」定位，
  // 收尾抓到下一個 `}}`（ConfirmModal 這顆 JSX 屬性值的結尾）。
  /**
   * ⚠️ 2026-08-26（issue #7 乙）：同上，取樣範圍限縮到 TemplateModal 元件內。
   * 排班模式切換接線後，主元件也有一個 `onConfirm={async () => {`，而且排在
   * 這個刪除確認之前——原本抓「檔案裡第一個」會檢查到錯的地方。斷言未改。
   */
  const templateModalSrc = page.slice(page.indexOf('function TemplateModal('));
  const startAt = templateModalSrc.indexOf('onConfirm={async () => {');
  const endAt = templateModalSrc.indexOf('}}', startAt);
  const onConfirm = startAt > -1 && endAt > -1 ? templateModalSrc.slice(startAt, endAt) : undefined;

  it('onConfirm 是 async（不是舊的同步 + void 射後不理）', () => {
    expect(onConfirm).toBeDefined();
  });

  it('await deleteShiftTemplate 在 toast.show(deleted) 之前', () => {
    expect(onConfirm).toBeDefined();
    const awaitAt = onConfirm!.indexOf('await deleteShiftTemplate(');
    const toastAt = onConfirm!.indexOf('toast.show(t.templateModal.deleted)');

    expect(awaitAt, '找不到 await deleteShiftTemplate(').toBeGreaterThan(-1);
    expect(toastAt, '找不到成功 toast').toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
    expect(onConfirm).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('不再用「射後不理」的 void 呼叫', () => {
    expect(page).not.toMatch(/void deleteShiftTemplate\(/);
  });
});
