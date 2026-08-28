/**
 * 「假欄位混在真資料列裡」靜態鎖 — issue #35
 * -----------------------------------------------------------------------------
 * 守的 bug：`bookings` / `coupons` / `membership-levels` 三頁把一部分欄位的值寫死在
 * 頁內常數（`BOOKING_EXTRAS_*` / `COUPON_EXTRAS_*` / `LEVEL_EXTRAS_*`），和同一列的
 * 真實資料混在一起顯示。這比「整頁都是假資料」難發現：姓名、時間、金額是真的，
 * 旁邊那個「已收金額」是編的，畫面上沒有任何東西能把兩者分開。
 *
 * 本檔鎖三件事：
 *
 *   ① 三頁不得再出現 `*_EXTRAS_*` 常數或 `extrasOf()`（**變異測試的目標**：
 *      把任一欄位改回吃頁內常數就紅）。
 *   ② 已判定「查不到來源／我方無法判定」而移除的欄位不得復活
 *      （bookings 的 `paidAmount`、coupons 的票券層級 `code` 與 `applicableServices`）。
 *   ③ 「還不知道」不得畫成 0：顧客可用點數為 null 時顯示 `--`，折抵金額為 null 時
 *      整行不顯示，兩者都不可用 `?? 0` 頂替。
 *
 * ⚠️ 本檔是**原始碼靜態掃描**，不掛載元件（本專案的單元測試層一律如此）。
 *    「DB 寫入 X → 端點回 X → 頁面拿到 X」那一段由整合測試
 *    `tests/integration/api/page-local-fields.35.test.ts` 負責。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { mapBooking, mapCoupon, mapMembershipLevel } from '@/server/mappers';
import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

const BOOKINGS = 'src/app/tenant/bookings/page.tsx';
const COUPONS = 'src/app/tenant/coupons/page.tsx';
const LEVELS = 'src/app/tenant/membership-levels/page.tsx';
const PREVIEW_E2E = 'tests/e2e/page-local-fields.35.spec.ts';
const PREVIEW_VERIFY = 'scripts/verify/page-local-fields.35.cjs';

/** 去掉註解再比對：本輪的註解本來就會逐字提到那些被移除的常數名。 */
const codeOf = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('Preview DB/UI 比對腳本使用真實 schema 語意（issue #35）', () => {
  it('WHERE 只使用 DB 欄位 discount_type，不引用同層 SELECT alias type', () => {
    const src = codeOf(PREVIEW_VERIFY);
    expect(src).toContain("discount_type = 'AMOUNT'");
    expect(src).toContain("discount_type = 'PERCENT'");
    expect(src).toContain("discount_type = 'GIFT'");
    expect(src).not.toContain("and ((type = 'DISCOUNT_");
  });

  it('把 DB enum 明確映射成頁面 type enum，coverage 不會把 AMOUNT/PERCENT 誤判缺資料', () => {
    const src = codeOf(PREVIEW_VERIFY);
    expect(src).toContain("when 'AMOUNT' then 'DISCOUNT_AMOUNT'");
    expect(src).toContain("when 'PERCENT' then 'DISCOUNT_PERCENT'");
    expect(src).toContain("when 'GIFT' then 'GIFT'");
    expect(src).toContain("c.type === 'DISCOUNT_AMOUNT'");
    expect(src).toContain("c.type === 'DISCOUNT_PERCENT'");
  });

  it('私密票券以詳情 modal 的 canonical 可見性文字精確比對，不沿用已移除的「可見範圍」文案', () => {
    const src = codeOf(PREVIEW_VERIFY);
    expect(src).toContain("const PRIVATE_VISIBILITY = '可見性：🔒 私密票券（不在公開頁與 LINE 顯示，僅限「發放」指定顧客）'");
    expect(src).toContain('dialog.getByText(PRIVATE_VISIBILITY, { exact: true })');
    expect(src).not.toContain('可見範圍：私密');
  });

  it('資料庫證據使用登入後 Preview session 的 /api/auth/me active tenant，不任選最早 membership', () => {
    const src = codeOf(PREVIEW_VERIFY);
    expect(src).toContain("fetch('/api/auth/me', { credentials: 'same-origin' })");
    expect(src).toContain('async function activeTenantIdForPreview(page)');
    expect(src).toContain('const tenantId = await activeTenantIdForPreview(page);');
    expect(src).not.toContain('async function tenantIdFor(');
    expect(src).not.toContain('from tenant_users');
    expect(src).not.toContain('order by tu.created_at');
  });

  it('只把各票券類型會顯示的 DB 欄位交給 UI 斷言，忽略其他類型遺留值', () => {
    const src = codeOf(PREVIEW_VERIFY);
    expect(src).toContain("case when discount_type = 'AMOUNT' then min_order_amount end as min_order_amount");
    expect(src).toContain("case when discount_type = 'PERCENT' then max_discount_amount end as max_discount_amount");
    expect(src).toContain("case when discount_type = 'GIFT' then gift_item end as gift_item");
    expect(src).toContain("row.type === 'DISCOUNT_AMOUNT' && row.min_order_amount !== null");
    expect(src).toContain("row.type === 'DISCOUNT_PERCENT' && row.max_discount_amount !== null");
    expect(src).toContain("row.type === 'GIFT' && row.gift_item");
  });
});

/* -------------------------------------------------------------------------- */
/* ① 頁內 EXTRAS 常數不得復活（變異測試目標）                                    */
/* -------------------------------------------------------------------------- */

describe('三頁不得再用頁內常數餵欄位（issue #35）', () => {
  it.each([
    [BOOKINGS, 'BOOKING_EXTRAS'],
    [COUPONS, 'COUPON_EXTRAS'],
    [LEVELS, 'LEVEL_EXTRAS'],
  ])('%s 不得宣告 %s_* 常數', (file, prefix) => {
    expect(
      codeOf(file),
      `${prefix}_* 又回來了：這種常數會把假值混進真資料列，`
      + '畫面上沒有任何東西能把兩者分開。欄位要嘛走 src/services/*，'
      + '要嘛誠實顯示未知狀態。',
    ).not.toContain(`${prefix}_`);
  });

  it.each([[BOOKINGS], [COUPONS], [LEVELS]])('%s 不得有 extrasOf()／toRow() 的假資料合成層', (file) => {
    expect(codeOf(file)).not.toContain('extrasOf(');
  });

  it('coupons 與 membership-levels 已不再 import byMode（頁內假資料整組移除）', () => {
    for (const file of [COUPONS, LEVELS]) {
      expect(read(file), `${file} 仍在 import byMode`).not.toMatch(/from '@\/mock'/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* ② 判定為「查不到來源／判定不出來」而移除的欄位不得復活                          */
/* -------------------------------------------------------------------------- */

describe('移除的欄位不得復活（issue #35）', () => {
  it('bookings 頁不得再出現 paidAmount（我方沒有 bookings.paid_amount，判定不出「已收多少」）', () => {
    expect(
      codeOf(BOOKINGS),
      '「已收金額」是錢：店家看著它決定要不要跟顧客收尾款。我方沒有金額型付款欄位'
      + '（顧客端線上付款屬 issue #32），編一個數字出來比空著危險得多。',
    ).not.toContain('paidAmount');
  });

  it('bookings i18n 不得再有把假金額塞進去的兩個鍵（labels.received／detailModal.paidLabel）', () => {
    expect(bookingsPage.labels).not.toHaveProperty('received');
    expect(bookingsPage.detailModal).not.toHaveProperty('paidLabel');
  });

  it('coupons 頁不得再顯示票券層級 code 與 applicableServices（docs/specs/coupons.json 查不到設定入口）', () => {
    const src = codeOf(COUPONS);
    expect(src).not.toContain('applicableServices');
    expect(src, '票券列表下方那一行代碼是頁內常數編的；原站的 ${d.code} 是核銷成功訊息裡的**實例**代碼')
      .not.toContain('{c.code ?');
  });
});

/* -------------------------------------------------------------------------- */
/* ③ 「還不知道」不得畫成 0                                                      */
/* -------------------------------------------------------------------------- */

describe('未知狀態不得顯示 0（issue #35 / CLAUDE.md）', () => {
  it('bookings：顧客可用點數的 fallback 是 null，不是 0', () => {
    const src = codeOf(BOOKINGS);
    expect(src).toContain('booking?.customerPoints ?? null');
    expect(src, '餘額不可以 `?? 0`：0 是「這位顧客沒有點數」，是另一個答案')
      .not.toContain('customerPoints ?? 0');
  });

  it('bookings：餘額為 null 時顯示 pm.balanceUnknown，且該文案不是「0」', () => {
    expect(codeOf(BOOKINGS)).toContain('balance === null ? pm.balanceUnknown : balance');
    expect(bookingsPage.pointsModal.balanceUnknown).toBe('--');
    expect(bookingsPage.pointsModal.balanceUnknown).not.toBe('0');
    expect(bookingsPage.pointsModal.balanceUnknownHint).toMatch(/不是 0/);
  });

  it('bookings：折抵金額為 null（沒有紀錄）時整行不顯示，不會渲染成「折抵 $0」', () => {
    const src = codeOf(BOOKINGS);
    expect(src).toContain('couponDiscount !== null && couponDiscount > 0');
    expect(src).toContain('pointsRedeemed !== null && pointsRedeemed > 0');
  });

  it('mapBooking：欄位缺席 → null（不是 0）', () => {
    const row = {
      id: 'b', booking_no: 'B1', customer_id: 'c', customer_name: 'n', customer_phone: 'p',
      service_id: 's', service_name: 'sn', staff_id: null, staff_name: null,
      start_at: 'a', end_at: 'b', duration_minutes: 60, price: 100, final_price: 100,
      status: 'PENDING', payment_status: 'UNPAID', source: 'MANUAL', note: '', created_at: 'c',
    };
    const b = mapBooking(row);
    expect(b.couponDiscount).toBeNull();
    expect(b.pointsRedeemed).toBeNull();
    expect(b.customerPoints).toBeNull();
  });

  it('mapBooking：真的是 0 就回 0（0 與「無紀錄」不可互相冒充）', () => {
    const b = mapBooking({
      id: 'b', booking_no: 'B1', customer_id: 'c', customer_name: 'n', customer_phone: 'p',
      service_id: 's', service_name: 'sn', staff_id: null, staff_name: null,
      start_at: 'a', end_at: 'b', duration_minutes: 60, price: 100, final_price: 100,
      status: 'PENDING', payment_status: 'UNPAID', source: 'MANUAL', note: '', created_at: 'c',
      coupon_discount: 0, points_redeemed: 0, customer_points: 0,
    });
    expect(b.couponDiscount).toBe(0);
    expect(b.pointsRedeemed).toBe(0);
    expect(b.customerPoints).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* ④ 新欄位真的被送出去（頁面 → service → 端點的第一段）                          */
/* -------------------------------------------------------------------------- */

describe('表單真的把新欄位送給後端（issue #35）', () => {
  it('coupons：五個欄位都進 payload（改成只留在本地 state 就紅）', () => {
    const src = codeOf(COUPONS);
    for (const key of [
      'minOrderAmount: draft.minOrderAmount',
      'maxDiscountAmount: draft.maxDiscountAmount',
      'giftItem: draft.giftItem',
      'limitPerCustomer: draft.limitPerCustomer',
      'privateMode: draft.privateMode',
    ]) {
      expect(src, `票券表單少送 ${key}：存檔 toast 會宣稱已儲存，重整後就不見了`).toContain(key);
    }
  });

  it('membership-levels：三個欄位都進 payload', () => {
    const src = codeOf(LEVELS);
    for (const key of [
      'description: draft.description',
      'active: draft.active',
      'isDefault: draft.isDefault',
    ]) {
      expect(src, `等級表單少送 ${key}`).toContain(key);
    }
  });

  it('mapCoupon / mapMembershipLevel 帶出新欄位（端點回得到）', () => {
    const c = mapCoupon({
      id: 'c', name: 'n', description: '', discount_type: 'AMOUNT', discount_value: 0,
      total_quantity: 0, start_at: null, end_at: null, status: 'DRAFT',
      min_order_amount: '500', max_discount_amount: null, gift_item: '好禮',
      limit_per_customer: 3, private_mode: true, last_redeemed_code: 'AB123456',
    });
    expect(c).toMatchObject({
      minOrderAmount: 500, maxDiscountAmount: null, giftItem: '好禮',
      limitPerCustomer: 3, privateMode: true, lastRedeemedCode: 'AB123456',
    });

    const l = mapMembershipLevel({
      id: 'l', name: 'n', color: '#fff', threshold_spent: 0, discount_percent: 0,
      point_rate_multiplier: 1, customer_count: 0, sort_order: 0,
      description: '說明', active: false, is_default: true,
    });
    expect(l).toMatchObject({ description: '說明', active: false, isDefault: true });
  });
});

/* -------------------------------------------------------------------------- */
/* ⑤ Preview E2E 自建 fixture 的安全鎖                                          */
/* -------------------------------------------------------------------------- */

describe('Preview E2E fixture 的 TEST 隔離（issue #35）', () => {
  it('只接受精確 HTTPS TEST hostname，不可用 project-ref prefix 偽造 host', () => {
    const src = codeOf(PREVIEW_E2E);
    expect(src).toContain("const TEST_SUPABASE_HOSTNAME = 'nmwhwngojosmagjuvxol.supabase.co'");
    expect(src).toContain("parsed.protocol !== 'https:' || parsed.hostname !== TEST_SUPABASE_HOSTNAME");
    expect(src).not.toContain("hostname.split('.')[0]");
  });

  it('cleanup 與 residual query 全部同時鎖 fixture id 與 SHOP_A tenant', () => {
    const src = codeOf(PREVIEW_E2E);
    const cleanup = src.slice(src.indexOf('async function cleanupFixtures'), src.indexOf("test.describe"));
    expect(cleanup.match(/\.eq\('tenant_id', SHOP_A\.id\)/g)).toHaveLength(8);
  });

  it('不改寫既有 membership default，fixture 只驗證自己的非預設狀態', () => {
    const src = codeOf(PREVIEW_E2E);
    const fixtureSetup = src.slice(src.indexOf('test.beforeAll'), src.indexOf('test.afterAll'));
    const cleanup = src.slice(src.indexOf('async function cleanupFixtures'), src.indexOf("test.describe"));
    expect(fixtureSetup).toContain('is_default: false');
    expect(fixtureSetup).not.toContain("from('membership_levels').update");
    expect(cleanup).not.toContain('is_default');
    expect(src).not.toContain('previousDefaultLevelIds');
  });
});
