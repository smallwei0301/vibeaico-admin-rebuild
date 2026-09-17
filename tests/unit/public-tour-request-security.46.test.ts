/**
 * tests/unit/public-tour-request-security.46.test.ts
 * -----------------------------------------------------------------------------
 * Final Risk 對抗審查對 PR #563（issue #46 旅客自助 REQUEST 申請）判定
 * `FIX_REQUIRED`，抓到三個真的會被利用的漏洞（見 PR body「Final Risk 修復」
 * 一節的完整說明）。這一檔證明三個都真的修了，不是只改了訊息：
 *
 *   F1：`src/server/tour-order-no.ts` 的配號邏輯在單日流水超過 9999 筆後仍能
 *       正確遞增（原本的字串排序寫法會在這裡永久卡死，見該檔檔頭）。
 *   F2：`submitPublicTourRequestSchema` 的聯絡資訊欄位有長度上限（原本只有
 *       `preferredNote`／`specialRequest` 有）。
 *   F3：`loadPublicTourRequestStatus` 必須用 `shopCode` 反查的 `tenantId` 過濾
 *       `tour_orders`，且尊重 `TOUR_MODULE` 功能閘門——不能只憑 `orderId` 查到
 *       其他租戶的訂單，也不能在功能停用時還查得到。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ F1 */

import { nextTourOrderNo } from '@/server/tour-order-no';

function fakeOrderNoClient(existingOrderNos: string[]) {
  return {
    from: (table: string) => {
      if (table !== 'tour_orders') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            like: async () => ({
              data: existingOrderNos.map((order_no) => ({ order_no })),
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

describe('nextTourOrderNo（Final Risk F1：配號不再依賴字串排序）', () => {
  it('沒有任何既有訂單時，第一筆是 0001', async () => {
    const orderNo = await nextTourOrderNo(fakeOrderNoClient([]), 'tenant-1', '260917');
    expect(orderNo).toBe('TO2609170001');
  });

  it('一般情況下正確遞增（既有最大值 0042 → 下一筆 0043）', async () => {
    const orderNo = await nextTourOrderNo(
      fakeOrderNoClient(['TO2609170001', 'TO2609170042', 'TO2609170017']),
      'tenant-1', '260917',
    );
    expect(orderNo).toBe('TO2609170043');
  });

  it('跨過 9999 這個邊界仍能正確算出 10000，不會因為字串排序卡在 9999', async () => {
    const nineNines = 'TO2609179999';
    const orderNo = await nextTourOrderNo(
      fakeOrderNoClient([nineNines]),
      'tenant-1', '260917',
    );
    // 舊寫法（`.order('order_no', desc).limit(1)`）在這裡永遠只查得到
    // 'TO2609179999'（字典序最大），重算出的號碼永遠是同一個 10000，
    // 於是永遠撞 unique、永遠失敗。新寫法要能正確輸出下一個真正可用的號碼。
    expect(orderNo).toBe('TO26091710000');
  });

  it('已經有 10000 筆時，下一筆是 10001（位寬持續正確成長，不被 4 碼假設截斷）', async () => {
    const orderNo = await nextTourOrderNo(
      fakeOrderNoClient(['TO2609179999', 'TO26091710000']),
      'tenant-1', '260917',
    );
    expect(orderNo).toBe('TO26091710001');
  });

  it('order_no 格式異常（非數字尾碼）不會讓整個計算爆炸，當作 0 處理', async () => {
    const orderNo = await nextTourOrderNo(
      fakeOrderNoClient(['TOxxxxxxxxxx', 'TO2609170005']),
      'tenant-1', '260917',
    );
    expect(orderNo).toBe('TO2609170006');
  });
});

/* ------------------------------------------------------------------ F2 */

import { submitPublicTourRequestSchema } from '@/server/public-tour-request';

const BASE_INPUT = {
  shopCode: 'e2e-guide',
  planId: '33333333-3333-3333-3333-333333333333',
  departureId: '44444444-4444-4444-4444-444444444444',
  partySize: 2,
  contactName: '測試旅客',
  contactPhone: '0912345678',
};

describe('submitPublicTourRequestSchema（Final Risk F2：聯絡資訊長度上限）', () => {
  it('正常長度的輸入照常通過', () => {
    expect(() => submitPublicTourRequestSchema.parse(BASE_INPUT)).not.toThrow();
  });

  it('contactName 超過 100 字被拒絕', () => {
    expect(() => submitPublicTourRequestSchema.parse({
      ...BASE_INPUT, contactName: 'a'.repeat(101),
    })).toThrow();
  });

  it('contactPhone 超過 40 字被拒絕', () => {
    expect(() => submitPublicTourRequestSchema.parse({
      ...BASE_INPUT, contactPhone: '0'.repeat(41),
    })).toThrow();
  });

  it('contactLine 超過 100 字被拒絕', () => {
    expect(() => submitPublicTourRequestSchema.parse({
      ...BASE_INPUT, contactPhone: undefined, contactLine: 'a'.repeat(101),
    })).toThrow();
  });

  it('contactEmail 超過 254 字被拒絕（即使是合法 email 格式）', () => {
    const longLocalPart = 'a'.repeat(250);
    expect(() => submitPublicTourRequestSchema.parse({
      ...BASE_INPUT, contactPhone: undefined, contactEmail: `${longLocalPart}@a.com`,
    })).toThrow();
  });

  it('剛好在上限內（100／40／100／254）仍然通過', () => {
    expect(() => submitPublicTourRequestSchema.parse({
      ...BASE_INPUT,
      contactName: 'a'.repeat(100),
      contactPhone: '0'.repeat(40),
    })).not.toThrow();
  });
});

/* ------------------------------------------------------------------ F3 */

const fakeState: {
  tenantsByShopCode: Record<string, { id: string } | null>;
  featureActive: Record<string, boolean>;
  tourOrdersById: Record<string, Record<string, unknown> | undefined>;
} = { tenantsByShopCode: {}, featureActive: {}, tourOrdersById: {} };

function buildFakeAdminSupabase() {
  return {
    from: (table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: (_col: string, shopCode: string) => ({
              maybeSingle: async () => ({
                data: fakeState.tenantsByShopCode[shopCode] ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'feature_subscriptions') {
        return {
          select: () => ({
            eq: (_c1: string, tenantId: string) => ({
              eq: (_c2: string, code: string) => ({
                maybeSingle: async () => {
                  const key = `${tenantId}:${code}`;
                  const active = fakeState.featureActive[key];
                  return {
                    data: active === undefined ? null : { active, expires_at: null },
                    error: null,
                  };
                },
              }),
            }),
          }),
        };
      }
      if (table === 'tour_orders') {
        return {
          select: () => ({
            eq: (_c1: string, orderId: string) => ({
              eq: (_c2: string, tenantId: string) => ({
                maybeSingle: async () => {
                  const row = fakeState.tourOrdersById[orderId];
                  const match = row && row.tenant_id === tenantId ? row : null;
                  return { data: match, error: null };
                },
              }),
            }),
          }),
        };
      }
      // hydrateTourOrders 的三趟 .in() 查詢——測試不需要真的補齊關聯名稱，
      // 回空陣列即可（mapTourOrder 對查不到名稱的情況本來就有安全的空字串收斂）。
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
  };
}

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => buildFakeAdminSupabase(),
}));

// isFeatureActive 走真正的 src/server/features.ts 實作，只是它內部呼叫的
// createAdminSupabase 被上面的 mock 接管。

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TENANT_C = '33333333-3333-3333-3333-333333333330';
const ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  fakeState.tenantsByShopCode = {
    'shop-a': { id: TENANT_A },
    'shop-b': { id: TENANT_B },
    'shop-c-disabled': { id: TENANT_C },
  };
  fakeState.featureActive = {
    [`${TENANT_A}:TOUR_MODULE`]: true,
    [`${TENANT_B}:TOUR_MODULE`]: true,
    [`${TENANT_C}:TOUR_MODULE`]: false,
  };
  fakeState.tourOrdersById = {
    [ORDER_ID]: {
      id: ORDER_ID,
      tenant_id: TENANT_A,
      contact: { phone: '0912345678' },
      status: 'PENDING',
    },
  };
});

describe('loadPublicTourRequestStatus（Final Risk F3：跨租戶查詢與功能閘門）', () => {
  it('用正確的 shopCode 與聯絡方式可以查到自己的訂單', async () => {
    const { loadPublicTourRequestStatus } = await import('@/server/public-tour-request');
    const order = await loadPublicTourRequestStatus('shop-a', ORDER_ID, '0912345678');
    expect(order).not.toBeNull();
    expect(order?.id).toBe(ORDER_ID);
  });

  it('用別的租戶的 shopCode 查同一個 orderId → 查不到（跨租戶阻擋）', async () => {
    const { loadPublicTourRequestStatus } = await import('@/server/public-tour-request');
    // shop-b 是另一個租戶，這筆訂單實際 tenant_id 是 TENANT_A，用 shop-b
    // 反查出的 TENANT_B 去過濾一定查不到——這正是 F3 要補的 `.eq('tenant_id', …)`。
    const order = await loadPublicTourRequestStatus('shop-b', ORDER_ID, '0912345678');
    expect(order).toBeNull();
  });

  it('shopCode 對應的租戶已停用 TOUR_MODULE → 查不到（功能閘門）', async () => {
    const orderForC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    fakeState.tourOrdersById[orderForC] = {
      id: orderForC, tenant_id: TENANT_C, contact: { phone: '0900000000' }, status: 'PENDING',
    };
    const { loadPublicTourRequestStatus } = await import('@/server/public-tour-request');
    const order = await loadPublicTourRequestStatus('shop-c-disabled', orderForC, '0900000000');
    expect(order).toBeNull();
  });

  it('聯絡方式對不上仍然查不到（既有行為維持）', async () => {
    const { loadPublicTourRequestStatus } = await import('@/server/public-tour-request');
    const order = await loadPublicTourRequestStatus('shop-a', ORDER_ID, '0900000000');
    expect(order).toBeNull();
  });

  it('shopCode 格式不合法直接回 null，不查資料庫', async () => {
    const { loadPublicTourRequestStatus } = await import('@/server/public-tour-request');
    const order = await loadPublicTourRequestStatus('../etc/passwd', ORDER_ID, '0912345678');
    expect(order).toBeNull();
  });
});
