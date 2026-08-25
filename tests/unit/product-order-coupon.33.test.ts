/**
 * 商品訂單「完成取貨」modal 的捏造票券折抵金額（GitHub issue #33 ①）
 * -----------------------------------------------------------------------------
 * 這是 CLAUDE.md「絕不用貌似合理的佔位值」鐵律點名的教科書案例，比 points 頁的
 * `MOCK_MONTHLY_COST = 196` 更嚴重：`src/app/tenant/product-orders/page.tsx` 曾在
 * 「套用票券並完成」時寫死 `const discount = withCoupon ? 100 : 0`，
 * toast 宣稱「票券已套用！折抵 NT$100」，並把這個 100 加進訂單的 `couponDiscount`
 * 欄位——使用者輸入的票券代碼從未離開瀏覽器、沒有被核銷，折抵金額是純捏造的，
 * 卻顯示在訂單真實金額（`order.totalAmount`）旁邊。
 *
 * 商品訂單套用票券的後端端點（`POST /api/product-orders/:id/apply-coupon`）
 * 尚未建置——issue #33 ①才是補齊它的工作，本輪只做誠實化：
 *   - 移除寫死的 100（以及「加 0」這種沒有意義但看起來像有做事的運算）。
 *   - 不再宣稱「票券已套用」，改成畫面上常駐可讀的「尚未串接後端，指向 #33」提醒。
 *   - 完成取貨本身是真 API（`POST /api/product-orders/:id/complete`），保留不動。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有安裝
 *    @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 *    這裡測的是靜態不變條件，手法沿用 tests/unit/product-order-paylink.28.test.ts。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { productOrdersPage as t } from '@/i18n/zh-TW/pages/product-orders';

const PAGE = 'src/app/tenant/product-orders/page.tsx';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的說明本身被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('商品訂單「完成取貨」modal：不得再有寫死的票券折抵金額', () => {
  const raw = src(PAGE);
  const code = withoutComments(raw);

  it('原始碼不再出現 withCoupon ? 100 這種寫死折抵金額的三元運算', () => {
    expect(code).not.toMatch(/withCoupon\s*\?\s*100/);
    // 連數字本身都不該作為「折抵金額」出現在 finish() 附近
    expect(code).not.toMatch(/const discount = withCoupon/);
  });

  it('finish() 不再把任何字面量金額（discount 變數）傳給 onCompleted 或 couponDiscount', () => {
    const finishBlock = code.match(/const finish = async[\s\S]*?\n  \};/);
    expect(finishBlock, '找不到 finish() 函式本體').toBeTruthy();
    expect(finishBlock![0]).not.toMatch(/\bdiscount\b/);
    // onCompleted 只接收 order，不再接收第二個「折抵金額」參數
    expect(finishBlock![0]).toMatch(/onCompleted\(order\)/);
    expect(finishBlock![0]).not.toMatch(/onCompleted\(order,\s*discount\)/);
  });

  it('onCompleted 的型別簽章不再有 discount 參數（避免呼叫端可以偷塞一個數字回去）', () => {
    expect(code).toMatch(/onCompleted:\s*\(order:\s*OrderRow\)\s*=>\s*void/);
    expect(code).not.toMatch(/onCompleted:\s*\(order:\s*OrderRow,\s*discount:\s*number\)/);
  });

  it('父層 onCompleted 回呼不再對 couponDiscount 做加法（含「+ 0」這種沒有意義的假動作）', () => {
    const wiring = code.match(/onCompleted=\{[\s\S]*?\}\}\s*\n\s*\/>/);
    expect(wiring, '找不到 <CompleteOrderModal onCompleted={...}/> 接線區塊').toBeTruthy();
    expect(wiring![0]).not.toMatch(/couponDiscount/);
    expect(wiring![0]).not.toMatch(/\+\s*discount/);
    // 沒有真實折抵資料時，patch 只更新狀態與完成時間，維持訂單原本的 couponDiscount 不動
    expect(wiring![0]).toMatch(/status:\s*'COMPLETED'/);
  });

  it('沒有任何字面量把 100 指派給折抵相關變數或欄位', () => {
    expect(code).not.toMatch(/discount\s*=\s*100\b/);
    expect(code).not.toMatch(/couponDiscount:\s*100\b/);
  });
});

describe('商品訂單「完成取貨」modal：不再宣稱票券已套用（鐵則：成功訊息是事實主張）', () => {
  const raw = src(PAGE);
  const code = withoutComments(raw);

  it('原始碼不再引用 t.complete.couponApplied 或 t.complete.couponAppliedButFailed', () => {
    expect(code).not.toMatch(/t\.complete\.couponApplied\b/);
    expect(code).not.toMatch(/t\.complete\.couponAppliedButFailed\b/);
  });

  it('i18n 字典裡這兩個鍵已經不存在（避免留下沒有呼叫端把關的死鍵，日後被誤用）', () => {
    const complete = t.complete as Record<string, unknown>;
    expect(complete.couponApplied).toBeUndefined();
    expect(complete.couponAppliedButFailed).toBeUndefined();
  });

  it('couponNotBuilt 如實標示「尚未串接」且指向 issue #33，不承諾折抵已套用', () => {
    expect(t.complete.couponNotBuilt).toContain('尚未');
    expect(t.complete.couponNotBuilt).toContain('#33');
    expect(t.complete.couponNotBuilt).not.toContain('已套用');
  });

  it('completeProductOrder（真實完成取貨 API）呼叫維持不動，未被誠實化這一輪停用', () => {
    expect(code).toMatch(/await completeProductOrder\(order\.id\)/);
  });

  it('票券折抵尚未串接的提醒常駐顯示在表單裡（不只是一閃即逝的 toast）', () => {
    const formGroup = code.match(/<FormGroup>\s*<Label htmlFor="orderCouponCode">[\s\S]*?<\/FormGroup>/);
    expect(formGroup, '找不到票券代碼輸入框所在的 FormGroup').toBeTruthy();
    expect(formGroup![0]).toMatch(/<FormText>\{t\.complete\.couponNotBuilt\}<\/FormText>/);
  });

  it('全字典裡沒有任何字串是「票券已套用」（=無論哪一個鍵，都不得再做這個主張）', () => {
    const walk = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (typeof value === 'function') return [];
      if (Array.isArray(value)) return value.flatMap(walk);
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).flatMap(walk);
      }
      return [];
    };
    const offending = walk(t).filter((s) => s.includes('票券已套用'));
    expect(offending).toEqual([]);
  });
});
