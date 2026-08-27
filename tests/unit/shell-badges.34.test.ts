/**
 * 側邊欄徽章的 real 分支 — issue #34（甲）
 * -----------------------------------------------------------------------------
 * 這裡測的是 `src/services/shell.ts` 的 `sidebarCounts()` **real 分支**：
 * 它到底有沒有去問後端、問的是不是那三支既有端點、以及「查不到」時回什麼。
 *
 * 作法：把 `@/lib/api` 換掉——`adapt(mock, real)` 一律走 `real`（單元測試環境
 * 沒有 `NEXT_PUBLIC_USE_MOCK=false`，不換的話永遠測到 mock 分支），`request()`
 * 依路徑回罐頭資料。這樣可以驗「呼叫了哪些端點、怎麼把回應組成徽章數字」，
 * 端點本身的正確性由整合測試守（見各 case 的註解）。
 *
 * ⚠️ 最重要的一條是最後一個 case：**某一支查詢失敗時，那個徽章的 key 必須缺席，
 * 不可退回 0**。0 是「沒有待處理」，是一個有意義的答案；拿它當「查不到」，
 * 就是把不知道畫成已知。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('@/lib/api', () => ({
  // 單元測試固定走 real 分支
  adapt: <T>(_mock: () => T, real: () => Promise<T>) => real(),
  request: (path: string, init?: unknown) => requestMock(path, init),
  delay: () => Promise.resolve(),
  isDemoMode: () => false,
  setDemoMode: () => {},
  ApiError: class ApiError extends Error {},
}));

/** 依端點路徑回罐頭資料；`overrides` 可以把某一支換成 reject */
function stubEndpoints(overrides: Record<string, () => Promise<unknown>> = {}) {
  requestMock.mockImplementation((path: string) => {
    for (const [prefix, fn] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) return fn();
    }
    if (path === '/api/bookings') {
      return Promise.resolve({
        content: [], totalElements: 7, totalPages: 7, number: 0, size: 1,
      });
    }
    if (path === '/api/product-orders/pending/count') return Promise.resolve({ count: 4 });
    if (path === '/api/chat/conversations') {
      return Promise.resolve([
        { lineUserId: 'U1', unread: 2 },
        { lineUserId: 'U2', unread: 0 },
        { lineUserId: 'U3', unread: 9 },
      ]);
    }
    return Promise.reject(new Error(`未預期的端點：${path}`));
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe('sidebarCounts()：real 分支真的去問後端（issue #34）', () => {
  it('三個徽章數字來自三支既有端點，不是 MOCK_SIDEBAR_COUNTS 的 3/2/5', async () => {
    stubEndpoints();
    const { sidebarCounts } = await import('@/services/shell');
    const counts = await sidebarCounts();

    // 端點各自的正確性由整合測試守：
    //   bookings.a2「status=PENDING → 只回 seed 的 bookingPending，totalElements=1」
    //   products-orders.b3「建一張 PENDING 單 → count +1；取消後 → 還原」
    //   chat-link.06「未讀 = 2 筆 IN、最後訊息 = 最新的 OUT 回覆…」
    expect(counts.pendingBookingBadge).toBe(7);
    expect(counts.pendingOrderBadge).toBe(4);
    expect(counts.unreadChatBadge).toBe(11); // 2 + 0 + 9
  });

  it('待確認預約走 GET /api/bookings?status=PENDING（既有端點，不另開一支計數 API）', async () => {
    stubEndpoints();
    const { sidebarCounts } = await import('@/services/shell');
    await sidebarCounts();

    const call = requestMock.mock.calls.find(([path]) => path === '/api/bookings');
    expect(call, '沒有呼叫 /api/bookings').toBeDefined();
    expect(call![1]).toMatchObject({ query: { status: 'PENDING', size: 1 } });
  });

  it('未讀訊息走 GET /api/chat/conversations 的 unread 加總（不新增 /api/chat/unread）', async () => {
    stubEndpoints();
    const { sidebarCounts } = await import('@/services/shell');
    await sidebarCounts();

    const paths = requestMock.mock.calls.map(([p]) => p);
    expect(paths).toContain('/api/chat/conversations');
    expect(paths.some((p: string) => p.includes('unread'))).toBe(false);
  });

  it('旅遊訂單徽章沒有資料來源（tour_orders 表與端點都還不存在）→ key 不存在，不是 0', async () => {
    stubEndpoints();
    const { sidebarCounts } = await import('@/services/shell');
    const counts = await sidebarCounts();

    expect(Object.keys(counts)).not.toContain('pendingTourOrderBadge');
    // 若哪天有人「順手補 0」，這條會紅：0 會讓嚮導看到「沒有待處理訂單」的假結論
    expect(counts.pendingTourOrderBadge).toBeUndefined();
  });

  it('mock 分支維持骨架 demo 的固定數字（USE_MOCK=true 行為不變）', async () => {
    // 這一條刻意走 mock 分支：骨架 demo 要看得出徽章長什麼樣，所以那組數字要留著。
    // 分支存在本身才是本 issue 的重點——先前是「沒有分支」，兩種模式都吃同一組常數。
    const { MOCK_SIDEBAR_COUNTS } = await import('@/mock');
    const { sidebarCounts } = await import('@/services/shell');
    requestMock.mockImplementation(() => Promise.reject(new Error('mock 分支不該打 API')));

    const api = await import('@/lib/api');
    const spy = vi.spyOn(api, 'adapt').mockImplementation(
      (mock: () => unknown) => Promise.resolve(mock()) as never,
    );
    try {
      expect(await sidebarCounts()).toEqual({ ...MOCK_SIDEBAR_COUNTS });
      expect(requestMock).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('某一支查詢失敗 → 該 key 缺席（不得退回 0），其餘兩支照常', async () => {
    stubEndpoints({
      '/api/product-orders/pending/count': () => Promise.reject(new Error('500')),
    });
    const { sidebarCounts } = await import('@/services/shell');
    const counts = await sidebarCounts();

    expect(counts.pendingOrderBadge, '查不到就不要給數字——0 是「沒有待處理」')
      .toBeUndefined();
    expect(counts.pendingBookingBadge).toBe(7);
    expect(counts.unreadChatBadge).toBe(11);
  });
});
