/**
 * 分類「編輯」鈕的圖示與行為終於相符（GitHub issue #28 第 ⑭ 筆的後續）
 * -----------------------------------------------------------------------------
 * commit `9829f12` 把這顆按鈕**接真**了（真的打 `PUT /api/{service,product}-categories/:id`），
 * 但它仍然是「鉛筆圖示 + common.edit 標籤，按下去只切換啟用狀態」——圖示與行為
 * 不相符的問題被保留下來。這是一種比較安靜的欺騙：使用者看到鉛筆會預期能改名稱
 * 與說明，按下去卻是把分類停用了，而且畫面還說「分類已更新」（它確實更新了，只是
 * 更新的不是使用者以為的那一欄）。
 *
 * 依擁有者方針「對齊原站功能，缺少功能用補齊取代刪除」（14 分冊 §8 的一貫語氣），
 * 正解是**補成真正的編輯 modal**，而不是把鉛筆換成開關圖示把功能砍掉。所以本輪：
 *
 *   - 鉛筆 → 開編輯 modal（名稱／說明／啟用三欄）
 *   - 快速切換保留，但給它自己的圖示（ToggleLeft/ToggleRight）與標籤
 *     （t.category.enableAction / disableAction）
 *   - sortOrder **不進 modal**：排序走 reorder 端點，兩條寫入路徑會打架
 *     （category-edit.28.test.ts:「sortOrder 不由這支端點寫入…」鎖著）
 *
 * 欄位是否真的落到資料庫由整合測試
 * tests/integration/api/category-edit-modal.28.test.ts 驗（PUT 後 service role 直查）。
 * 這裡驗的是頁面這一段沒有斷線，且成功旗標排在 await 之後（00 分冊鐵則 12）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { servicesPage } from '@/i18n/zh-TW/pages/services';
import { productsPage } from '@/i18n/zh-TW/pages/products';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/**
 * 與其他 wiring 測試同一組去註解規則（JSX 的 `{/* … *\/}` 會留下一對空 `{}`，
 * 對這裡的斷言無害）。⚠️ 不要「順手」加一條先吃掉 `{…}` 包裹的 JSX 註解——
 * 那條 regex 會回溯到後面的 `*\/` + `}` 而吞掉整段程式碼，斷言就變成假綠。
 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 每一頁的斷言完全同型，只有型別名／service 函式名不同 */
function assertPage(opts: {
  label: string;
  pagePath: string;
  typeName: string;
  updateFn: string;
  patchType: string;
  stateUpdate: RegExp;
}): void {
  const page = withoutComments(src(opts.pagePath));

  describe(opts.label, () => {
    const saveEdit = page.match(/const saveEdit = async \(\) => \{[\s\S]*?\n  \};/)?.[0];

    it('鉛筆鈕開的是編輯 modal，不再是切換啟用狀態', () => {
      expect(page).toMatch(/onClick=\{\(\) => openEdit\(c\)\}/);
      expect(page).toMatch(new RegExp(`const openEdit = \\(c: ${opts.typeName}\\) => \\{`));
      /*
       * 本筆缺陷本體：鉛筆 + common.edit 標籤直接接到 toggleActive。
       * 這個否定式斷言配上上面的肯定式，兩者一起才鎖得住
       * （只有否定式的話，把整組按鈕刪掉也會綠）。
       */
      expect(page).not.toMatch(
        /title=\{common\.edit\} aria-label=\{common\.edit\}\s*\n\s*disabled=\{savingId === c\.id\}\s*\n\s*onClick=\{\(\) => void toggleActive\(c\)\}/,
      );
    });

    it('快速切換有自己的圖示與標籤，不再冒用鉛筆與「編輯」', () => {
      // 切換鈕仍在（擁有者方針：補齊而非刪除），但標籤依目前狀態說明按下去會發生什麼
      expect(page).toMatch(/onClick=\{\(\) => void toggleActive\(c\)\}/);
      expect(page).toMatch(/title=\{c\.active \? t\.category\.disableAction : t\.category\.enableAction\}/);
      expect(page).toMatch(/aria-label=\{c\.active \? t\.category\.disableAction : t\.category\.enableAction\}/);
      expect(page).toMatch(/\{c\.active \? <ToggleRight size=\{13\} \/> : <ToggleLeft size=\{13\} \/>\}/);
      expect(page).toMatch(/ToggleLeft, ToggleRight/);
    });

    it('saveEdit 先 await 端點，畫面更新與 toast 才執行（鐵則 12）', () => {
      expect(saveEdit).toBeDefined();
      expect(saveEdit!).toMatch(new RegExp(`await ${opts.updateFn}\\(id, patch\\)`));
      const awaitAt = saveEdit!.indexOf(`await ${opts.updateFn}(id, patch)`);
      const stateAt = saveEdit!.search(opts.stateUpdate);
      const toastAt = saveEdit!.indexOf('toast.show(t.category.updated)');
      expect(awaitAt).toBeGreaterThan(-1);
      expect(stateAt).toBeGreaterThan(awaitAt);
      expect(toastAt).toBeGreaterThan(awaitAt);
      // 失敗要說失敗，不可吞掉後照樣報成功
      expect(saveEdit!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
    });

    it('只送有變的欄位（不動而非重設）', () => {
      expect(saveEdit!).toMatch(new RegExp(`const patch: ${opts.patchType} = \\{\\};`));
      expect(saveEdit!).toMatch(/if \(trimmedName !== editTarget\.name\) patch\.name = trimmedName;/);
      expect(saveEdit!).toMatch(
        /if \(trimmedDescription !== \(editTarget\.description \?\? ''\)\) patch\.description = trimmedDescription;/,
      );
      expect(saveEdit!).toMatch(/if \(editActive !== editTarget\.active\) patch\.active = editActive;/);
    });

    it('modal 不碰 sortOrder（排序走 reorder 端點，不開第二條寫入路徑）', () => {
      expect(saveEdit!).not.toMatch(/sortOrder/);
      const modal = page.slice(page.indexOf('t.category.editTitle'));
      expect(modal.slice(0, modal.indexOf('</Modal>'))).not.toMatch(/sortOrder/);
    });

    it('什麼都沒改＝不送請求，所以不報「分類已更新」', () => {
      const noChangeBranch = saveEdit!.slice(saveEdit!.indexOf('Object.keys(patch).length === 0'));
      const endOfBranch = noChangeBranch.indexOf('return;');
      expect(endOfBranch).toBeGreaterThan(-1);
      const branch = noChangeBranch.slice(0, endOfBranch);
      expect(branch).toMatch(/toast\.show\(t\.category\.noChange, 'info'\)/);
      // 沒發生的事不准報成功
      expect(branch).not.toMatch(/t\.category\.updated/);
      expect(branch).not.toMatch(new RegExp(opts.updateFn));
    });

    it('modal 三欄都是 controlled，值真的被收集（不是 uncontrolled 空殼）', () => {
      const modal = page.slice(page.indexOf('t.category.editTitle'));
      const body = modal.slice(0, modal.indexOf('</Modal>'));
      expect(body).toMatch(/value=\{editName\}/);
      expect(body).toMatch(/onChange=\{\(e\) => setEditName\(e\.target\.value\)\}/);
      expect(body).toMatch(/value=\{editDescription\}/);
      expect(body).toMatch(/onChange=\{\(e\) => setEditDescription\(e\.target\.value\)\}/);
      expect(body).toMatch(/checked=\{editActive\} onCheckedChange=\{setEditActive\}/);
      // 送出鈕在送出中要停用，避免連按兩次送兩筆
      expect(body).toMatch(/loading=\{editSaving\} onClick=\{\(\) => void saveEdit\(\)\}/);
    });

    it('openEdit 用該列的現值預填（不是空白或上一列殘留）', () => {
      const openEdit = page.match(/const openEdit = \(c: \w+\) => \{[\s\S]*?\n  \};/)?.[0];
      expect(openEdit).toBeDefined();
      expect(openEdit!).toMatch(/setEditName\(c\.name\)/);
      expect(openEdit!).toMatch(/setEditDescription\(c\.description \?\? ''\)/);
      expect(openEdit!).toMatch(/setEditActive\(c\.active\)/);
    });
  });
}

assertPage({
  label: '服務分類：鉛筆＝真的編輯（issue #28 第 ⑭ 筆的後續）',
  pagePath: 'src/app/tenant/services/page.tsx',
  typeName: 'ServiceCategory',
  updateFn: 'updateServiceCategory',
  patchType: 'ServiceCategoryUpdate',
  stateUpdate: /onChange\(\(list\) => list\.map/,
});

assertPage({
  label: '商品分類：鉛筆＝真的編輯（issue #28 第 ⑭ 筆的後續）',
  pagePath: 'src/app/tenant/products/page.tsx',
  typeName: 'ProductCategory',
  updateFn: 'updateProductCategory',
  patchType: 'ProductCategoryUpdate',
  stateUpdate: /onChange\(categories\.map/,
});

describe('文案：新增的字典鍵存在且頁面沒有內嵌中文字面量（鐵則 1）', () => {
  it('服務頁', () => {
    expect(servicesPage.category.editTitle).toBe('編輯分類');
    expect(servicesPage.category.enableAction).toBe('啟用分類');
    expect(servicesPage.category.disableAction).toBe('停用分類');
    expect(servicesPage.category.noChange).toContain('未送出');
    // 註解可以有中文，畫面上的字不行——所以比對去註解後的原始碼
    const page = withoutComments(src('src/app/tenant/services/page.tsx'));
    expect(page).not.toContain('編輯分類');
    expect(page).not.toContain('啟用分類');
  });

  it('商品頁', () => {
    expect(productsPage.category.editTitle).toBe('編輯分類');
    expect(productsPage.category.enableAction).toBe('啟用分類');
    expect(productsPage.category.disableAction).toBe('停用分類');
    expect(productsPage.category.noChange).toContain('未送出');
    // 說明欄位新增進商品分類列表，否則使用者編輯了說明卻永遠看不到它
    expect(productsPage.category.columns.description).toBe('說明');
    const page = withoutComments(src('src/app/tenant/products/page.tsx'));
    expect(page).not.toContain('編輯分類');
    expect(page).not.toContain('停用分類');
  });
});
