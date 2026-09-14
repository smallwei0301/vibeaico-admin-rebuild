/**
 * #43 類別 5 FIX 2：`/tenant/tour-orders` 消費 GUIDE 收件匣 REFUND_PENDING 卡片帶的
 * `?paymentStatus=REFUND_PENDING&orderId=<id>` deep link（`src/app/api/guide/action-inbox/
 * route.ts` 產生這組 query string）。
 *
 * ## 這個檔證得到什麼、證不到什麼（如實說明，不用 grep 測試充數）
 *
 * 本專案的 vitest 單元測試跑在 node 環境（`vitest.config.mts`: `environment: 'node'`），
 * 未安裝 `@testing-library/react`，無法掛載 `'use client'` 頁面元件（`window.location`
 * 在 node 環境也不存在），所以無法對 `/tenant/tour-orders` 做真正的「render → 讀 DOM
 * 斷言 detail modal 開了」這種互動測試。
 *
 * 這裡分兩層各自證到能證的部分：
 *
 *   1. `parseTourOrdersDeepLink()`（`src/services/tours.ts`）：頁面 `useEffect` 讀
 *      `window.location.search` 後**唯一**呼叫的函式，純函式、跟 React 無關，可以
 *      直接匯入呼叫、真的執行解析與值域驗證邏輯。這證到 (a)（拿掉 orderId 處理）與
 *      (b)（拿掉 paymentStatus 處理／值域驗證）的「解析」那一半——mutation 拿掉這個
 *      函式裡任何一段處理都會被下面的行為測試抓到。
 *      頁面內把這個函式的回傳值指定給 `setPaymentFilter`／`setRequestedOrderId` 兩個
 *      state、以及 `load()` 用 `requestedOrderId` 去開 `detail` modal 那幾行——是機械
 *      的 pass-through 賦值，不在這個測試邊界內，本專案目前的測試基礎設施做不到對它
 *      的行為驗證（見上一段原因）。這是誠實的落差，不是用其他測試假裝補上。
 *
 *   2. `/api/tour-orders` route（(c)：orderId 精準查詢是否繞過租戶邊界）：這是
 *      伺服器端邏輯，跟 React／DOM 無關，可以比照
 *      `tests/unit/guide-action-inbox.43.test.ts` 的假 supabase query-builder harness，
 *      直接呼叫真正的 route handler、實際套用過濾鏈，驗證 `.eq('tenant_id', ...)`
 *      在有 `orderId` 時仍然生效——跨租戶的 id 精準查詢撈不到任何列。
 */
import { describe, expect, it, vi } from 'vitest';
import { parseTourOrdersDeepLink } from '@/services/tours';

describe('parseTourOrdersDeepLink（#43 類別 5 deep link 解析，純函式）', () => {
  it('讀出合法的 paymentStatus 與 orderId', () => {
    expect(parseTourOrdersDeepLink('?paymentStatus=REFUND_PENDING&orderId=ord-1')).toEqual({
      paymentStatus: 'REFUND_PENDING',
      orderId: 'ord-1',
    });
  });

  it('值域外的 paymentStatus 一律忽略，不把任意字串塞進 filter（mutation：拿掉值域驗證會讓這裡回傳原始字串）', () => {
    expect(parseTourOrdersDeepLink('?paymentStatus=NOT_A_REAL_STATUS&orderId=ord-1')).toEqual({
      paymentStatus: '',
      orderId: 'ord-1',
    });
    // TourPaymentStatus 值域內的五個值都要被接受——不是只認得 REFUND_PENDING 一個。
    for (const value of ['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED']) {
      expect(parseTourOrdersDeepLink(`?paymentStatus=${value}`).paymentStatus).toBe(value);
    }
  });

  it('沒有 orderId 就回傳空字串，不是 undefined 或 null（mutation：拿掉 orderId 處理會讓這裡整個 key 消失或丟例外）', () => {
    expect(parseTourOrdersDeepLink('?paymentStatus=REFUND_PENDING')).toEqual({
      paymentStatus: 'REFUND_PENDING',
      orderId: '',
    });
  });

  it('沒有 query string 兩者都回空值，不丟例外', () => {
    expect(parseTourOrdersDeepLink('')).toEqual({ paymentStatus: '', orderId: '' });
  });
});

/* -------------------------------------------------------------------------- */
/* /api/tour-orders route 行為測試：orderId 精準查詢不得繞過 tenant_id 邊界        */
/* -------------------------------------------------------------------------- */

type FilterCall = [string, unknown[]];
type FakeRow = Record<string, unknown>;

function applyFilterOps(rows: FakeRow[], calls: FilterCall[]): FakeRow[] {
  let result = rows;
  for (const [method, args] of calls) {
    const field = args[0] as string;
    switch (method) {
      case 'eq': result = result.filter((r) => r[field] === args[1]); break;
      case 'in': result = result.filter((r) => (args[1] as unknown[]).includes(r[field])); break;
      default: break;
    }
  }
  return result;
}

const requireTenantMock = vi.fn();
vi.mock('@/server/tenant', () => ({
  requireTenant: (...a: unknown[]) => requireTenantMock(...a),
}));

/**
 * 跟 `tests/unit/guide-action-inbox.43.test.ts` 用的是同一種 harness 手法：記錄
 * `.from(table)` 之後串起來的過濾鏈，`then()` 時真的把它套用在 in-memory fixture
 * 上——不是重新實作一份過濾邏輯去猜 route.ts 做了什麼，而是讓真正的 route.ts
 * 對假資料跑一遍。
 */
function makeFakeSupabase(tables: Record<string, FakeRow[]>) {
  return {
    from(table: string) {
      const calls: FilterCall[] = [];
      const builder: any = {
        select: (...a: unknown[]) => { calls.push(['select', a]); return builder; },
        eq: (...a: unknown[]) => { calls.push(['eq', a]); return builder; },
        neq: (...a: unknown[]) => { calls.push(['neq', a]); return builder; },
        in: (...a: unknown[]) => { calls.push(['in', a]); return builder; },
        or: (...a: unknown[]) => { calls.push(['or', a]); return builder; },
        order: (...a: unknown[]) => { calls.push(['order', a]); return builder; },
        range: (...a: unknown[]) => { calls.push(['range', a]); return builder; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const rows = tables[table] ? applyFilterOps(tables[table], calls) : [];
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const TENANT_ID = 'tenant-a';
const OTHER_TENANT_ID = 'tenant-b';

const TOUR_ORDER_ROWS: FakeRow[] = [
  {
    id: 'ord-a-1', tenant_id: TENANT_ID, order_no: 'T001', contact: { name: '許家瑜', phone: '' },
    party_size: 1, unit_price: 100, total_amount: 100, deposit_amount: 0,
    status: 'CONFIRMED', payment_status: 'REFUND_PENDING', payment_ref: '', source: 'MANUAL',
    hold_expires_at: null, note: '', created_at: '2026-09-10T00:00:00.000Z',
    trip_id: null, plan_id: null, departure_id: null,
  },
  {
    // 其他租戶但**同一個 id 字面值不同**——先證明一般情況下 tenant_id 過濾本來就在擋。
    id: 'ord-b-1', tenant_id: OTHER_TENANT_ID, order_no: 'T002', contact: { name: '林小美', phone: '' },
    party_size: 1, unit_price: 100, total_amount: 100, deposit_amount: 0,
    status: 'CONFIRMED', payment_status: 'REFUND_PENDING', payment_ref: '', source: 'MANUAL',
    hold_expires_at: null, note: '', created_at: '2026-09-11T00:00:00.000Z',
    trip_id: null, plan_id: null, departure_id: null,
  },
];

async function callRoute(searchParams: string) {
  const { GET } = await import('@/app/api/tour-orders/route');
  return GET(new Request(`https://app.test/api/tour-orders${searchParams}`), {});
}

describe('route.ts behaviour: /api/tour-orders orderId 精準查詢（#43 類別 5 deep link 接線）', () => {
  it('tenant-a 用 orderId 撈自己的訂單，正常撈到', async () => {
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: makeFakeSupabase({ tour_orders: TOUR_ORDER_ROWS }),
      tenantId: TENANT_ID,
      user: { id: 'user-a' },
      role: 'OWNER',
    });

    const res = await callRoute('?orderId=ord-a-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content.map((o: any) => o.id)).toEqual(['ord-a-1']);
  });

  it(
    '跨租戶的 orderId 撈不到任何列——`.eq(\'tenant_id\', ...)` 邊界在 orderId 精準查詢時仍然生效'
      + '（mutation：把 orderId 精準查詢改成不帶 tenant 範圍，會讓這裡撈到別的租戶的那一筆）',
    async () => {
      requireTenantMock.mockReset();
      requireTenantMock.mockResolvedValue({
        supabase: makeFakeSupabase({ tour_orders: TOUR_ORDER_ROWS }),
        tenantId: TENANT_ID,
        user: { id: 'user-a' },
        role: 'OWNER',
      });

      // tenant-a 的 session，卻查 tenant-b 那一筆的 id——必須查無資料，不能因為
      // orderId 精準到單一 id 就悄悄放行到其他租戶的資料。
      const res = await callRoute('?orderId=ord-b-1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.content).toEqual([]);
      expect(body.data.totalElements).toBe(0);
    },
  );

  it('沒有 orderId 時維持既有行為，回傳整個租戶的分頁清單（對照組：不是 orderId 邏輯把清單清空了）', async () => {
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({
      supabase: makeFakeSupabase({ tour_orders: TOUR_ORDER_ROWS }),
      tenantId: TENANT_ID,
      user: { id: 'user-a' },
      role: 'OWNER',
    });

    const res = await callRoute('');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content.map((o: any) => o.id)).toEqual(['ord-a-1']);
  });
});
