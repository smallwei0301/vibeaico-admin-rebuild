/**
 * 營運頁接線靜態鎖 — issue #7（乙）前半六頁
 * -----------------------------------------------------------------------------
 * 六頁：customers / block-times / points / staff / shifts / shop-design。
 * 接線前它們的「成功」都是 `await new Promise(r => setTimeout(r, N))` 之後直接
 * 顯示成功訊息——按鈕按下去畫面說成功，資料庫什麼都沒發生（14 分冊 §1 A-1）。
 *
 * 本檔鎖三件事，全部用靜態原始碼比對（手法與 `shift-template-wiring.28`、
 * `category-action-order.28` 相同；vitest 跑在 node 環境、專案沒有裝
 * @testing-library/react，掛載元件不可行，見 14 分冊 §7.2「判準的第四層」）：
 *
 *   ① 這六頁不得再出現 `setTimeout` 假延遲當成儲存
 *   ② 每一個成功訊息，都要能在同一段程式碼裡追到排在它**前面**的
 *      `await <service 函式>`（鐵則 12：成功訊息是一個事實主張）
 *   ③ points 的儲值不得把 501 做成成功：`accepted` 為假時不關閉、不報成功，
 *      而是顯示後端原文
 *
 * 變異驗證（每一條都實跑確認會轉紅，見 issue #7 留言）：
 *   - 把 customers 的 `await createCustomer(payload)` 拿掉 → ② 的 customers 條轉紅
 *   - 把 block-times 儲存改回 setTimeout → ① 轉紅
 *   - 把 points 的 `if (res.accepted)` 改成無條件 `onClose()` → ③ 轉紅
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，免得「解釋為什麼不能這樣寫」的說明被當成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGES = {
  customers: 'src/app/tenant/customers/page.tsx',
  blockTimes: 'src/app/tenant/block-times/page.tsx',
  points: 'src/app/tenant/points/page.tsx',
  staff: 'src/app/tenant/staff/page.tsx',
  shifts: 'src/app/tenant/shifts/page.tsx',
  shopDesign: 'src/app/tenant/shop-design/page.tsx',
} as const;

/** 抓某個 `const <name> = async () => { … };`（頂層兩格縮排的收尾） */
function asyncFn(code: string, name: string, from = 0): string | undefined {
  const re = new RegExp(`const ${name} = async \\(\\) => \\{[\\s\\S]*?\\n  \\};`);
  return code.slice(from).match(re)?.[0];
}

/* ========================================================================== */
/* ① 假延遲                                                                    */
/* ========================================================================== */

describe('六頁不得再用 setTimeout 假延遲冒充儲存', () => {
  for (const [key, path] of Object.entries(PAGES)) {
    it(`${key}：沒有 new Promise((r) => setTimeout(...)) 這種假等待`, () => {
      const code = withoutComments(src(path));
      expect(code, `${path} 仍有假延遲`).not.toMatch(/new Promise\(\s*\(\s*r\s*\)\s*=>\s*setTimeout/);
    });
  }
});

/* ========================================================================== */
/* ② 成功訊息必須排在 await <service> 之後                                     */
/* ========================================================================== */

describe('customers：新增／編輯／綁定／解除綁定都真的打端點（鐵則 12）', () => {
  const code = withoutComments(src(PAGES.customers));

  it('表單 submit：await createCustomer / updateCustomer 在 onSaved(isEdit) 之前', () => {
    const submit = asyncFn(code, 'submit');
    expect(submit, '找不到 CustomerFormModal 的 submit').toBeDefined();
    const updateAt = submit!.indexOf('await updateCustomer(');
    const createAt = submit!.indexOf('await createCustomer(');
    const savedAt = submit!.indexOf('onSaved(isEdit)');
    expect(updateAt, '找不到 await updateCustomer(').toBeGreaterThan(-1);
    expect(createAt, '找不到 await createCustomer(').toBeGreaterThan(-1);
    expect(savedAt).toBeGreaterThan(updateAt);
    expect(savedAt).toBeGreaterThan(createAt);
    expect(submit!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('綁定：await bindCustomerLine 在 onBound() 之前', () => {
    const bind = code.match(/const bind = async \(u: UnboundLineUser\) => \{[\s\S]*?\n  \};/)?.[0];
    expect(bind, '找不到 bind 函式').toBeDefined();
    const awaitAt = bind!.indexOf('await bindCustomerLine(');
    const boundAt = bind!.indexOf('onBound()');
    expect(awaitAt, '找不到 await bindCustomerLine(').toBeGreaterThan(-1);
    expect(boundAt).toBeGreaterThan(awaitAt);
    expect(bind!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('解除綁定：await unbindCustomerLine 在 toast(lineUnbound) 之前，且用專用端點', () => {
    const awaitAt = code.indexOf('await unbindCustomerLine(');
    const toastAt = code.indexOf('toast.show(t.messages.lineUnbound)');
    expect(awaitAt, '找不到 await unbindCustomerLine(').toBeGreaterThan(-1);
    expect(toastAt, '找不到解除綁定的成功 toast').toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
  });

  it('不再顯示沒有資料來源的「殘留綁定／自動建立檔案」徽章', () => {
    expect(code).not.toMatch(/AUTO_CREATED_CUSTOMER_IDS/);
    expect(code).not.toMatch(/ORPHAN/);
  });

  it('待綁定清單用既有的 chat 服務，不另外複製一份同名函式', () => {
    expect(code).toMatch(/import \{ listUnboundLineUsers[\s\S]*?\} from '@\/services\/chat'/);
    const service = src('src/services/customers.ts');
    expect(service, 'services/customers.ts 不該再宣告第二份 listUnboundLineUsers')
      .not.toMatch(/export const listUnboundLineUsers/);
  });

  it('綁定 modal：載入中不得顯示「沒有待綁定的 LINE 用戶」（還不知道 ≠ 已知為零）', () => {
    expect(code).toMatch(/\{loading \|\| !loaded \?/);
  });
});

describe('block-times：整頁改吃 /api/block-times（鐵則 12）', () => {
  const code = withoutComments(src(PAGES.blockTimes));

  it('載入走 listBlockTimes，不再有頁內假資料常數', () => {
    expect(code).toMatch(/await listBlockTimes\(/);
    expect(code).not.toMatch(/const MOCK_BLOCK_TIMES/);
  });

  it('儲存：await createBlockTime / updateBlockTime 在 onSaved(...) 之前', () => {
    const submit = asyncFn(code, 'submit');
    expect(submit, '找不到 BlockTimeModal 的 submit').toBeDefined();
    const updateAt = submit!.indexOf('await updateBlockTime(');
    const createAt = submit!.indexOf('await createBlockTime(');
    const savedAt = submit!.indexOf('onSaved(!form.id)');
    expect(updateAt, '找不到 await updateBlockTime(').toBeGreaterThan(-1);
    expect(createAt, '找不到 await createBlockTime(').toBeGreaterThan(-1);
    expect(savedAt).toBeGreaterThan(updateAt);
    expect(savedAt).toBeGreaterThan(createAt);
  });

  it('刪除：await deleteBlockTime 在 toast(deleted) 之前', () => {
    const awaitAt = code.indexOf('await deleteBlockTime(');
    const toastAt = code.indexOf('toast.show(t.messages.deleted)');
    expect(awaitAt, '找不到 await deleteBlockTime(').toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
  });

  it('營業時間來自 /api/settings，不是寫死的 10:00–21:00', () => {
    expect(code).toMatch(/await getTenantSettings\(\)/);
    expect(code).not.toMatch(/open: '10:00'/);
  });
});

describe('staff：自訂稱呼寫進 tenant_settings.basic.staffTerm（鐵則 12）', () => {
  const code = withoutComments(src(PAGES.staff));

  it('await saveTenantSettings 在 onSaved(next) 之前', () => {
    const submit = asyncFn(code, 'submit', code.indexOf('function StaffTermModal('));
    expect(submit, '找不到 StaffTermModal 的 submit').toBeDefined();
    const awaitAt = submit!.indexOf('await saveTenantSettings(');
    const savedAt = submit!.indexOf('onSaved(next)');
    expect(awaitAt, '找不到 await saveTenantSettings(').toBeGreaterThan(-1);
    expect(savedAt).toBeGreaterThan(awaitAt);
    expect(submit!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('送出的是整包 basic 群組（端點是群組整包覆蓋，只送一個鍵會洗掉其他欄位）', () => {
    expect(code).toMatch(/saveTenantSettings\(\{ basic: next\.basic \}\)/);
  });
});

describe('shifts：週班表與排班模式（鐵則 12）', () => {
  const code = withoutComments(src(PAGES.shifts));

  it('週班表 submit：await repeatShiftCycles 與 saveShifts 都在 onSaved(draft) 之前', () => {
    const submit = asyncFn(code, 'submit', code.indexOf('function WeeklyScheduleModal('));
    expect(submit, '找不到 WeeklyScheduleModal 的 submit').toBeDefined();
    const clearAt = submit!.indexOf('await repeatShiftCycles(');
    const writeAt = submit!.indexOf('await saveShifts(');
    const savedAt = submit!.indexOf('onSaved(draft)');
    expect(clearAt, '找不到 await repeatShiftCycles(（先清區間）').toBeGreaterThan(-1);
    expect(writeAt, '找不到 await saveShifts(（再寫入上班日）').toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(clearAt);
    expect(savedAt).toBeGreaterThan(writeAt);
  });

  it('排班模式：await saveTenantSettings 在 toast(modeSwitched) 之前，且送整包 business', () => {
    const awaitAt = code.indexOf('await saveTenantSettings({ business: next.business })');
    const toastAt = code.indexOf('toast.show(t.modes[modeTarget.next]');
    const switchedAt = code.indexOf('t.modeSwitched(');
    expect(awaitAt, '找不到 await saveTenantSettings({ business: next.business })').toBeGreaterThan(-1);
    expect(switchedAt).toBeGreaterThan(awaitAt);
    expect(toastAt).toBe(-1); // 不是直接 toast 模式名稱，而是走 t.modeSwitched(...)
  });

  it('不再有寫死的員工模式假資料與寫死的營業時間', () => {
    expect(code).not.toMatch(/MOCK_STAFF_MODES/);
    expect(code).not.toMatch(/start: '10:00', end: '20:00'/);
    expect(code).toMatch(/await getTenantSettings\(\)/);
  });
});

describe('shop-design：儲存送出真的 branding patch（鐵則 12）', () => {
  const code = withoutComments(src(PAGES.shopDesign));

  it('不再送空 patch', () => {
    expect(code).not.toMatch(/saveTenantSettings\(\{\}\)/);
    expect(code).toMatch(/saveTenantSettings\(\{ branding: config \}\)/);
  });

  it('await 在 toast(saved) 之前', () => {
    const save = asyncFn(code, 'save');
    expect(save, '找不到 save 函式').toBeDefined();
    const awaitAt = save!.indexOf('await saveTenantSettings(');
    const toastAt = save!.indexOf('toast.show(t.messages.saved)');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
  });

  it('初始值來自 tenant_settings.branding，不是頁內 byMode 示範內容', () => {
    expect(code).toMatch(/setConfig\(\{ \.\.\.s\.branding/);
    expect(code).not.toMatch(/SHOP_PAGE_BY_MODE/);
  });
});

/* ========================================================================== */
/* ③ points：501 必須如實呈現，不得做成成功                                    */
/* ========================================================================== */

describe('points 儲值：501 是規格內的誠實回覆，頁面要照實顯示', () => {
  const code = withoutComments(src(PAGES.points));
  const service = withoutComments(src('src/services/points.ts'));

  it('打的是 /api/points/topup/pay（/api/points/topup 不存在）', () => {
    expect(service).toMatch(/'\/api\/points\/topup\/pay'/);
  });

  it('501 不往上丟成例外，而是轉成 accepted:false + 後端原文', () => {
    expect(service).toMatch(/e\.status === 501/);
    expect(service).toMatch(/return \{ accepted: false, message: e\.message \}/);
  });

  it('頁面：只有 accepted 為真才關閉 modal；否則顯示後端訊息', () => {
    const submit = asyncFn(code, 'submit', code.indexOf('function TopupModal('));
    expect(submit, '找不到 TopupModal 的 submit').toBeDefined();
    expect(submit!).toMatch(/await requestPointTopup\(/);
    expect(submit!).toMatch(/if \(res\.accepted\) \{ onClose\(\); return; \}/);
    expect(submit!).toMatch(/setOutcome\(res\.message \?\? t\.topup\.unavailableMock\)/);
  });

  it('沒有任何無條件的成功路徑（await 之後直接 onClose 就是假成功）', () => {
    const submit = asyncFn(code, 'submit', code.indexOf('function TopupModal('));
    // onClose() 只准出現在 accepted 分支裡
    const closes = submit!.match(/onClose\(\)/g) ?? [];
    expect(closes.length, 'TopupModal 的 submit 只該有一處 onClose()（accepted 分支）').toBe(1);
  });

  it('文案不得再承諾不存在的金流流程（藍新／信用卡導向）', () => {
    const copy = src('src/i18n/zh-TW/pages/points.ts');
    const values = withoutComments(copy);
    expect(values).not.toMatch(/藍新金流安全付款頁面/);
    expect(values).not.toMatch(/支援信用卡 \/ Apple Pay/);
  });
});
