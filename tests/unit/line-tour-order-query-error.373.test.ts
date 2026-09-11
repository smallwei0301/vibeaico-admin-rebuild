/**
 * issue #373 — GUIDE 的「我的訂單」查 `tour_orders` 失敗時，不得說成「沒有訂單」
 * -----------------------------------------------------------------------------
 * ## 為什麼這一支是單元測試，不是整合測試
 *
 * 驗收原文要求一支「查詢失敗（例如指向不存在的欄位）」的整合測試。實際嘗試後
 * 發現黑箱打不出這個場景：`tour_orders` 的 `tenant_id`／`customer_id` 都是
 * `uuid` 型別，正常 DML 塞不進格式錯誤的值（insert 當場被型別擋下）；
 * `replyTourOrders()` 的 `.select('trips(title), trip_departures(departs_on)')`
 * 每個內嵌關聯都只有一條外鍵路徑，沒有「多重關聯」的歧義可以觸發 PostgREST
 * 錯誤；也沒有可用的 RLS 落差（`ctx.admin` 一律是 service_role，天生繞過
 * RLS）。經過對 `nmwhwngojosmagjuvxol`（canonical TEST）跑一段唯讀診斷查詢
 * 確認：現行 schema 下這支查詢不會自然出錯，且本專案沒有裝可執行 DDL 的測試
 * 工具——要在 TEST 專案上臨時改欄位名稱才能造出這個錯誤，代價（影響其他同時
 * 在跑的測試檔／agent）大於這一條案例本身的價值，也不會留在 CI 可重跑的整合
 * 測試裡（DDL 不能寫進 `supabase-js` 的 REST 查詢）。
 *
 * 所以改用同檔已有前例（`isLikelyChitchat`，見 `tests/unit/ai-settings-wiring.
 * 27.test.ts`）的作法：把 `replyTourOrders()` `export` 出來，直接餵一個假的
 * `admin` client 讓它回傳 `{ data: null, error }`，在單元測試裡（不碰網路/DB，
 * 12 分冊 §3）驗證「error 發生時，回覆不是『沒有旅遊訂單』」。
 *
 * GUIDE 租戶 + 已綁定 LINE 使用者 + 真的查得到 `tour_orders`（訂單編號、狀態
 * 都在回覆裡、不是「準備中」）的正向案例，走真實 webhook 的整合測試在
 * `tests/integration/api/line-tour-order-query.373.test.ts`。
 */
import { describe, expect, it, vi } from 'vitest';
import { replyTourOrders } from '@/server/line-events';

type QueryResult<T> = { data: T | null; error: { message: string; code?: string } | null };

/**
 * 最小可用的假 `SupabaseClient`：只認得 `replyTourOrders()` 實際會呼叫的兩張表
 * （`line_users` 給 `boundCustomerId()`、`tour_orders` 給本函式自己），其餘表一律
 * 丟例外——呼叫到沒預期的表，代表函式的查詢對象變了，測試要能立刻抓到。
 */
function fakeAdmin(opts: {
  boundCustomerId: string | null;
  tourOrders: QueryResult<Array<Record<string, unknown>>>;
}) {
  return {
    from(table: string) {
      if (table === 'line_users') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.boundCustomerId ? { customer_id: opts.boundCustomerId } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'tour_orders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => opts.tourOrders,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`fakeAdmin 沒預期會查表「${table}」`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function ctxWith(admin: ReturnType<typeof fakeAdmin>) {
  return {
    admin,
    tenant: { id: 'tenant-373-itest', shop_code: 'itest-373', name: 'itest GUIDE 店', business_type: 'GUIDE' },
    token: 'itest-token-373',
    replyToken: 'itest-reply-373',
    userId: 'Uitest373',
    lineConfig: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('replyTourOrders() 查詢失敗不得說成「沒有訂單」（issue #373）', () => {
  it('tour_orders 查詢回 error → 回傳 false（落到 ⑤ AI／⑥ 預設回覆），完全不呼叫 LINE reply API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const admin = fakeAdmin({
        boundCustomerId: 'customer-373-a1',
        tourOrders: { data: null, error: { message: 'relation error (itest 模擬)', code: '42P01' } },
      });
      const result = await replyTourOrders(ctxWith(admin));

      // ⚠️ 這一條是本案例的靈魂：故障必須落到 false，讓真人在 ⑤／⑥ 看得到，
      // 不能被 replyTourOrders 自己吞掉、包裝成一句「您目前沒有旅遊訂單」。
      expect(result).toBe(false);
      // error 分支不呼叫 replyText／lineReply，所以 LINE reply API 完全沒打。
      expect(fetchSpy).not.toHaveBeenCalled();
      // 留了 log，讓故障有真人看得到（12 分冊 §3 允許斷言 console 副作用）。
      expect(consoleSpy).toHaveBeenCalledWith(
        '[line] replyTourOrders 查詢 tour_orders 失敗',
        expect.objectContaining({ message: expect.stringContaining('itest 模擬') }),
      );
    } finally {
      vi.unstubAllGlobals();
      consoleSpy.mockRestore();
    }
  });

  it('對照組：真的沒有任何旅遊訂單（data 是空陣列、沒有 error）→ 才可以回「沒有旅遊訂單」', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const admin = fakeAdmin({
        boundCustomerId: 'customer-373-a1',
        tourOrders: { data: [], error: null },
      });
      const result = await replyTourOrders(ctxWith(admin));

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.messages[0].text).toContain('您目前沒有旅遊訂單');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('LINE 使用者尚未綁定顧客 → 回「還沒有找到您的顧客資料」，不查 tour_orders', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      // tour_orders 給一組「如果被查了就會露餡」的假資料：data 非空但沒有 error，
      // 用來證明未綁定分支確實在查 tour_orders 之前就 return 了。
      const admin = fakeAdmin({
        boundCustomerId: null,
        tourOrders: { data: [{ order_no: '不該被念出來的訂單編號' }], error: null },
      });
      const result = await replyTourOrders(ctxWith(admin));

      expect(result).toBe(true);
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.messages[0].text).toContain('還沒有找到您的顧客資料');
      expect(body.messages[0].text).not.toContain('不該被念出來的訂單編號');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
