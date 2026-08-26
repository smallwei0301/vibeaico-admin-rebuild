/**
 * 商品訂單「完成取貨」modal 的票券折抵金額（GitHub issue #33 ①）
 * -----------------------------------------------------------------------------
 * 這是 CLAUDE.md「絕不用貌似合理的佔位值」鐵律點名的教科書案例：
 * `src/app/tenant/product-orders/page.tsx` 曾在「套用票券並完成」時寫死
 * `const discount = withCoupon ? 100 : 0`，toast 宣稱「票券已套用！折抵 NT$100」，
 * 並把這個 100 加進訂單的 `couponDiscount` 欄位——使用者輸入的票券代碼從未離開
 * 瀏覽器、沒有被核銷，折抵金額是純捏造的，卻顯示在訂單真實金額旁邊。
 *
 * ⚠️ **本檔的前提在 issue #33 ① 完成時真的變了**（不是「把斷言放寬讓它繼續綠」）：
 *   - `d7b8158`（前一輪）：端點不存在 → 誠實化，移除寫死的 100，加上
 *     「尚未串接後端」的常駐說明，`couponApplied` / `couponAppliedButFailed`
 *     兩個 i18n 鍵刪除。當時的斷言守的是「不准宣稱套用了票券」。
 *   - 本輪：`POST /api/product-orders/:id/apply-coupon` 已建置
 *     （`src/app/api/product-orders/[id]/apply-coupon/route.ts`，核銷走
 *     `src/server/coupon-redeem.ts` 的共用實作），票券真的會被核銷。
 *     於是「宣稱票券已套用」變成一句**真話**，那條禁令失去對象。
 *
 * 所以斷言換成守新的不變條件——**折抵金額必須來自後端回應，不得由前端組**：
 *   1. 一樣不准出現寫死的折抵金額（原本那組斷言原封不動保留）。
 *   2. toast 的金額只能是 `applyProductOrderCoupon()` 回應裡的 `couponDiscount`。
 *   3. 端點回 null（示範模式）時不得宣稱套用了任何折抵。
 *   4. 「套券成功但完成訂單失敗」要說出票券已經被核銷掉了。
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
const SERVICE = 'src/services/products.ts';
const ROUTE = 'src/app/api/product-orders/[id]/apply-coupon/route.ts';

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

  it('沒有任何字面量把 100 指派給折抵相關變數或欄位', () => {
    expect(code).not.toMatch(/discount\s*=\s*100\b/);
    expect(code).not.toMatch(/couponDiscount:\s*100\b/);
  });

  it('finish() 裡出現的折抵金額只有一個來源：applyProductOrderCoupon 的回應', () => {
    const finishBlock = code.match(/const finish = async[\s\S]*?\n  \};/);
    expect(finishBlock, '找不到 finish() 函式本體').toBeTruthy();
    const body = finishBlock![0];
    // 唯一的賦值來源
    expect(body).toMatch(/applied\s*=\s*res\.couponDiscount/);
    // 不得有第二個賦值（例如再塞一個常數或用訂單金額回推）
    // (?!=) 排除 `applied === null` 這種比較（那不是賦值）
    const assignments = body.match(/\bapplied\s*=(?!=)\s*/g) ?? [];
    expect(assignments).toHaveLength(1);
    // 宣告時的初值必須是 null（「還不知道」），不是 0（「知道是 0」）
    expect(body).toMatch(/let applied: number \| null = null;/);
    // toast 的金額只能是 applied
    expect(body).toMatch(/t\.complete\.couponApplied\(formatCurrency\(applied\)\)/);
  });
});

describe('商品訂單套用票券：端點真的被呼叫（不是只改 React state）', () => {
  const code = withoutComments(src(PAGE));
  const service = withoutComments(src(SERVICE));

  it('頁面 → service：finish() 呼叫 applyProductOrderCoupon(order.id, code)', () => {
    expect(code).toMatch(/await applyProductOrderCoupon\(order\.id,\s*code\.trim\(\)\)/);
    expect(code).toMatch(/import \{[\s\S]*?applyProductOrderCoupon[\s\S]*?\} from '@\/services\/products'/);
  });

  it('service → 端點：applyProductOrderCoupon 打的是 /api/product-orders/:id/apply-coupon', () => {
    expect(service).toMatch(/export const applyProductOrderCoupon/);
    expect(service).toMatch(/`\/api\/product-orders\/\$\{id\}\/apply-coupon`/);
    expect(service).toMatch(/method: 'POST'/);
  });

  it('端點檔存在，且折抵金額是後端算的（回應欄位名對齊原站的 couponDiscount）', () => {
    const route = withoutComments(src(ROUTE));
    expect(route).toMatch(/applyCouponDiscount\(/);
    expect(route).toMatch(/return ok\(\{ totalAmount: after, couponDiscount \}\)/);
  });

  it('核銷邏輯不是第三份拷貝：端點呼叫 src/server/coupon-redeem.ts 的共用函式', () => {
    const route = withoutComments(src(ROUTE));
    expect(route).toMatch(/from '@\/server\/coupon-redeem'/);
    expect(route).toMatch(/await redeemCouponByCode\(/);
    // 端點自己不得再寫一次 redeemed_at 的條件式 update
    expect(route).not.toMatch(/redeemed_at/);
  });
});

describe('商品訂單套用票券：宣稱與實際一致', () => {
  const code = withoutComments(src(PAGE));

  it('示範模式（端點回 null）不宣稱套用了折抵，改顯示 couponMockOnly', () => {
    expect(code).toMatch(/if \(res === null\) \{\s*toast\.show\(t\.complete\.couponMockOnly, 'warning'\)/);
    expect(t.complete.couponMockOnly).toContain('不會');
    expect(t.complete.couponMockOnly).not.toContain('已套用');
  });

  it('「套券成功但完成訂單失敗」時說出票券已被核銷（原站 jsStrings[77] 同一句）', () => {
    expect(code).toMatch(/t\.complete\.couponAppliedButFailed/);
    expect(t.complete.couponAppliedButFailed).toContain('票券已套用');
    expect(t.complete.couponAppliedButFailed).toContain('失敗');
  });

  it('前一輪的「尚未串接後端」說明已移除（端點建好之後那句話變成假的）', () => {
    expect(code).not.toMatch(/couponNotBuilt/);
    expect((t.complete as Record<string, unknown>).couponNotBuilt).toBeUndefined();
  });

  it('表單裡的常駐說明不預告任何折抵金額（金額要等後端算完才知道）', () => {
    const formGroup = code.match(/<FormGroup>\s*<Label htmlFor="orderCouponCode">[\s\S]*?<\/FormGroup>/);
    expect(formGroup, '找不到票券代碼輸入框所在的 FormGroup').toBeTruthy();
    expect(formGroup![0]).toMatch(/<FormText>\{t\.complete\.couponHelp\}<\/FormText>/);
    expect(t.complete.couponHelp).not.toMatch(/\d/);
  });

  it('completeProductOrder（真實完成取貨 API）呼叫維持不動', () => {
    expect(code).toMatch(/await completeProductOrder\(order\.id\)/);
  });

  it('父層回呼收到的折抵金額只能是 finish() 從 API 拿到的那一個', () => {
    const wiring = code.match(/onCompleted=\{[\s\S]*?\}\}\s*\n\s*\/>/);
    expect(wiring, '找不到 <CompleteOrderModal onCompleted={...}/> 接線區塊').toBeTruthy();
    // 沒套券（null）時完全不碰 couponDiscount / totalAmount
    expect(wiring![0]).toMatch(/appliedDiscount === null \? \{\} :/);
    expect(wiring![0]).not.toMatch(/\+\s*100\b/);
    expect(wiring![0]).toMatch(/status:\s*'COMPLETED'/);
  });
});
