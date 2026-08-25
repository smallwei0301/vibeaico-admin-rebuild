/**
 * 分類的三個動作（新增／編輯／刪除）順序一致：await 在前，成功才更新畫面
 * -----------------------------------------------------------------------------
 * 承 14 分冊 §6.4「由本輪衍生、尚未處理的三件」第 1 條的後續。
 *
 * commit `9829f12` + `a36cb71` 只把**編輯**（鉛筆）改成「先 await 端點、成功才
 * 更新畫面與 toast」。同一個 `CategoryModal` 裡的**新增**與**刪除**沒有一起改：
 *
 *   - `services/page.tsx` 的 `create`：`toast.show(t.category.created)` 排在
 *     `void createServiceCategory(...)` **之前**。
 *   - `services/page.tsx` 的刪除：先 `onChange(categories.filter(...))` 把列
 *     移掉並 toast「分類已刪除」，才 `void deleteServiceCategory(id).catch(...)`。
 *
 * 兩者都是 00 分冊鐵則 12 的違反：成功訊息是一項事實主張，不得早於它所宣稱的
 * 動作。實際症狀不是資料錯誤（後端多半會成功），而是**後端失敗時使用者同時看到
 * 綠色的「已建立／已刪除」與紅色的錯誤訊息**，且畫面上的列已經跟著動了。
 *
 * 這一支測試存在的理由是「補了一半」本身：同一個檔案裡剛修好的編輯與沒修的
 * 新增／刪除並存了兩個 commit。所以鎖住的不是單一函式，而是**三個動作同型**——
 * 任何一個被改回「先報成功再送出」都要轉紅。
 *
 * 手法沿用 tests/unit/category-edit-modal.28.test.ts：讀原始碼、用 `indexOf`
 * 比對 await 與 toast／state 更新的相對位置（頁面無法用 unit test 掛載，
 * 靜態鎖是 14 分冊 §7.2「判準的第四層」指定的替代方案）。
 *
 * 欄位是否真的落到資料庫由整合測試
 * tests/integration/api/category-fields.28.test.ts 驗（POST 後 service role 直查）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { servicesPage } from '@/i18n/zh-TW/pages/services';
import { productsPage } from '@/i18n/zh-TW/pages/products';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/**
 * 與 category-edit-modal.28.test.ts 同一組去註解規則。
 * ⚠️ 不要「順手」加一條吃掉 `{/* … *\/}` 包裹的 JSX 註解——那條 regex 會回溯到
 * 後面的 `*\/` + `}` 而吞掉整段程式碼，斷言就變成假綠。
 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 取 CategoryModal 裡某個具名 handler 的函式本體（同 saveEdit 的取法） */
const handler = (page: string, name: string): string | undefined =>
  page.match(new RegExp(`const ${name} = async \\(\\) => \\{[\\s\\S]*?\\n  \\};`))?.[0];

function assertPage(opts: {
  label: string;
  pagePath: string;
  createFn: string;
  updateFn: string;
  deleteFn: string;
}): void {
  const page = withoutComments(src(opts.pagePath));

  describe(opts.label, () => {
    it('新增：先 await 端點，畫面更新與「已建立」toast 才執行（鐵則 12）', () => {
      const create = handler(page, 'create');
      expect(create).toBeDefined();

      const awaitAt = create!.indexOf(`await ${opts.createFn}(`);
      const stateAt = create!.indexOf('onChange(');
      const toastAt = create!.indexOf('toast.show(t.category.created)');

      expect(awaitAt).toBeGreaterThan(-1);
      expect(stateAt).toBeGreaterThan(awaitAt);
      expect(toastAt).toBeGreaterThan(awaitAt);
      // 失敗要說失敗，不可吞掉後照樣報成功
      expect(create!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
    });

    it('刪除：先 await 端點，移除列與「已刪除」toast 才執行（不再樂觀更新）', () => {
      const remove = handler(page, 'removeCategory');
      expect(remove).toBeDefined();

      const awaitAt = remove!.indexOf(`await ${opts.deleteFn}(`);
      const stateAt = remove!.indexOf('onChange(');
      const toastAt = remove!.indexOf('toast.show(t.category.deleted)');

      expect(awaitAt).toBeGreaterThan(-1);
      expect(stateAt).toBeGreaterThan(awaitAt);
      expect(toastAt).toBeGreaterThan(awaitAt);
      expect(remove!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
    });

    it('編輯：先 await 端點（本輪一起鎖，確認三個動作同型）', () => {
      const saveEdit = handler(page, 'saveEdit');
      expect(saveEdit).toBeDefined();

      const awaitAt = saveEdit!.indexOf(`await ${opts.updateFn}(id, patch)`);
      const stateAt = saveEdit!.indexOf('onChange(');
      const toastAt = saveEdit!.indexOf('toast.show(t.category.updated)');

      expect(awaitAt).toBeGreaterThan(-1);
      expect(stateAt).toBeGreaterThan(awaitAt);
      expect(toastAt).toBeGreaterThan(awaitAt);
    });

    it('三個動作都不再用「射後不理」的 void 呼叫（缺陷本體的否定式）', () => {
      /*
       * 這三條是修改前的原始寫法。單有否定式會被「整段刪掉」騙過去，
       * 所以上面三個 it 的肯定式斷言是它的對照組，兩者一起才鎖得住。
       */
      expect(page).not.toMatch(new RegExp(`void ${opts.createFn}\\(`));
      expect(page).not.toMatch(new RegExp(`void ${opts.deleteFn}\\(`));
      expect(page).not.toMatch(new RegExp(`void ${opts.updateFn}\\(`));
    });

    it('等待期間有 loading 回饋（不會變成「按了沒反應」）', () => {
      // 新增鈕：await 期間轉圈並停用，避免連按兩次送兩筆
      expect(page).toMatch(/loading=\{creating\} onClick=\{\(\) => void create\(\)\}/);
      // 刪除確認鈕：ConfirmModal 的 loading 會停用按鈕並轉圈
      expect(page).toMatch(/loading=\{deleting\}/);
      expect(page).toMatch(/onConfirm=\{\(\) => void removeCategory\(\)\}/);
    });

    it('新增 modal 有「說明」欄，且真的送進端點（不是只留在瀏覽器）', () => {
      // controlled：值真的被收集（editDescription 是編輯 modal 的，另一個識別字）
      expect(page).toMatch(/value=\{description\}/);
      expect(page).toMatch(/onChange=\{\(e\) => setDescription\(e\.target\.value\)\}/);
      expect(page).toMatch(/\{t\.category\.description\}/);
      expect(page).toMatch(/placeholder=\{t\.category\.descriptionPlaceholder\}/);
      // 收集到的值有進 POST body
      const create = handler(page, 'create');
      expect(create!).toMatch(/const trimmedDescription = description\.trim\(\);/);
      expect(create!).toMatch(/description: trimmedDescription/);
    });
  });
}

assertPage({
  label: '服務分類：新增／編輯／刪除三個動作同型',
  pagePath: 'src/app/tenant/services/page.tsx',
  createFn: 'createServiceCategory',
  updateFn: 'updateServiceCategory',
  deleteFn: 'deleteServiceCategory',
});

assertPage({
  label: '商品分類：新增／編輯／刪除三個動作同型',
  pagePath: 'src/app/tenant/products/page.tsx',
  createFn: 'createProductCategory',
  updateFn: 'updateProductCategory',
  deleteFn: 'deleteProductCategory',
});

describe('文案：說明欄用的字典鍵存在（鐵則 1）', () => {
  it('服務頁與商品頁都有 description / descriptionPlaceholder', () => {
    expect(servicesPage.category.description).toBe('描述');
    expect(servicesPage.category.descriptionPlaceholder).toBe('選填');
    expect(productsPage.category.description).toBe('說明');
    expect(productsPage.category.descriptionPlaceholder).toBe('選填');
  });
});

/**
 * 第四顆按鈕：排序（move）。
 *
 * 本輪（issue #28 收尾）原本只派了新增／編輯／刪除三顆，執行者在報告裡指出
 * **排序也是同一個缺陷，而且兩頁又分岔了**——服務頁是「先換位置＋toast，才
 * void 送出」，商品頁早已 await-first。它依 playbook 不自行擴充範圍、把問題
 * 交上來，主導者裁決後補上。
 *
 * 為什麼排序也要 await-first：即使接受「排序是少數樂觀更新可接受的場景」，
 * 會說謊的也是那句 toast，不是換位置這個動作本身。而商品頁已經證明 await-first
 * 在這裡體感沒問題（骨架模式下 adapt() 的 mock 分支同步 resolve）。
 * 兩頁分岔本身就是缺陷：維護者讀到哪一邊就學到哪一種寫法。
 */
describe('第四顆按鈕：分類排序兩頁同型', () => {
  for (const [label, file, fn] of [
    ['服務分類', 'src/app/tenant/services/page.tsx', 'reorderServiceCategories'],
    ['商品分類', 'src/app/tenant/products/page.tsx', 'reorderProductCategories'],
  ] as const) {
    it(`${label}：排序先 await 端點，換位置與 toast 才執行（鐵則 12）`, () => {
      const code = src(file);
      /* 兩個檔案裡都有兩個 `move`——一個排「服務／商品」本身、一個排「分類」。
         所以不能用 indexOf 抓第一個（那會抓到前者），改為從分類的 reorder 呼叫
         往回找它所屬的那個 move。 */
      const callAt = code.indexOf(`${fn}(`);
      expect(callAt, `${label}：整個檔案找不到 ${fn}(`).toBeGreaterThan(-1);
      const start = code.lastIndexOf('const move = ', callAt);
      expect(start, `${label}：找不到分類排序所屬的 move`).toBeGreaterThan(-1);
      const body = code.slice(start, callAt + 400);

      expect(body, `${label} 的分類 move 不是 async——表示還是舊的 void 寫法`)
        .toMatch(/const move = async \(index: number, delta: number\)/);

      const awaitAt = body.indexOf(`await ${fn}(`);
      const onChangeAt = body.indexOf('onChange(next.map(');
      const toastAt = body.indexOf('toast.show(t.category.reordered)');

      expect(awaitAt, `${label}：找不到 await ${fn}(`).toBeGreaterThan(-1);
      expect(onChangeAt).toBeGreaterThan(awaitAt);
      expect(toastAt).toBeGreaterThan(awaitAt);
    });

    it(`${label}：排序不再用「射後不理」的 void 呼叫`, () => {
      expect(src(file)).not.toMatch(new RegExp(`void ${fn}\\(`));
    });
  }
});
