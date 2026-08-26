import { adapt } from '@/lib/api';
import { MOCK_SIDEBAR_COUNTS } from '@/mock';
import { listBookings } from './bookings';
import { pendingProductOrderCount } from './catalog';
import { unreadChatCount } from './chat';
import { listTourOrders } from './tours';

/**
 * 全站外框（AppShell）的資料入口 — issue #34。
 *
 * 為什麼要有這一支：`AppShell` 是每一頁都會經過的外框，先前它**無條件**把
 * `MOCK_SIDEBAR_COUNTS` 送進側邊欄（沒有任何 USE_MOCK 分支），於是
 * `NEXT_PUBLIC_USE_MOCK=false` 之後店家一登入就看到「待確認預約 3」，
 * 點開一筆都沒有——不會報錯、不會變空，也沒有任何測試會紅。
 *
 * ⚠️ 回傳值的三種狀態要分清楚（CLAUDE.md「Never fabricate a known」）：
 *   · key 有值   → 真的查到了，這個數字可以顯示
 *   · key 不存在 → **不知道**（查詢失敗，或該徽章根本沒有資料來源）。
 *                  呼叫端不得把它當成 0——0 是「沒有待處理」，是一個有意義的答案。
 *   · 整個回傳值還沒到（Promise 未 settle）→ 由呼叫端以 `null` 表示「載入中」，
 *                  同樣不得先顯示 0。
 */
export type SidebarCounts = Record<string, number>;

/**
 * 側邊欄徽章數字。
 *
 * real 模式的三段鏈路（每一支都是**既有端點**，本 issue 沒有新增任何端點）：
 *   pendingBookingBadge → services/bookings.ts listBookings({status:'PENDING',size:1})
 *                         → GET /api/bookings?status=PENDING&size=1 的 totalElements
 *                         （整合測試 tests/integration/api/bookings.a2.test.ts
 *                           :「status=PENDING → 只回 seed 的 bookingPending，totalElements=1」）
 *   pendingOrderBadge   → services/catalog.ts pendingProductOrderCount()
 *                         → GET /api/product-orders/pending/count
 *                         （整合測試 tests/integration/api/products-orders.b3.test.ts
 *                           :「建一張 PENDING 單 → count +1；取消後 → 還原」）
 *   unreadChatBadge     → services/chat.ts unreadChatCount()
 *                         → GET /api/chat/conversations 的 unread 加總
 *                         （整合測試 tests/integration/api/chat-link.06.test.ts
 *                           :「未讀 = 2 筆 IN、最後訊息 = 最新的 OUT 回覆、displayName 來自 mock profile」）
 *
 *   pendingTourOrderBadge → services/tours.ts listTourOrders({status:'PENDING', size:1})
 *                         → GET /api/tour-orders?status=PENDING&size=1 的 totalElements
 *                         （整合測試 tests/integration/api/tour-orders.10.test.ts
 *                           :「status 篩選：只回該狀態」＋「回 Spring 風格分頁信封，
 *                             且只含本租戶的訂單」）
 *
 * ⚠️ `pendingTourOrderBadge` 在 issue #34 當時**刻意不設值**：`/api/tour-orders/**`
 * 這棵路由樹整個不存在、`tour_orders` 表也還沒建，所以「待處理旅遊訂單有幾筆」
 * 我們查不到，寫 0 會變成「已知為零」。issue #8（migration 0026 + 端點）
 * 之後這件事查得到了，所以補上——而「查不到就不給值」的紀律不變：
 * `Promise.allSettled` 失敗的那一支仍然不會寫進回傳值。
 *
 * 任一支失敗只讓該 key 缺席，不影響其他幾支（外框不能因為一個徽章查不到就整片壞掉）。
 */
export function sidebarCounts(): Promise<SidebarCounts> {
  return adapt<SidebarCounts>(
    // mock／示範店家：維持骨架 demo 的固定數字（骨架要看得出徽章長什麼樣）
    () => ({ ...MOCK_SIDEBAR_COUNTS }),
    async () => {
      const [booking, order, chat, tour] = await Promise.allSettled([
        listBookings({ status: 'PENDING', size: 1 }).then((p) => p.totalElements),
        pendingProductOrderCount(),
        unreadChatCount(),
        listTourOrders({ status: 'PENDING', size: 1 }).then((p) => p.totalElements),
      ]);
      const counts: SidebarCounts = {};
      if (booking.status === 'fulfilled') counts.pendingBookingBadge = booking.value;
      if (order.status === 'fulfilled') counts.pendingOrderBadge = order.value;
      if (chat.status === 'fulfilled') counts.unreadChatBadge = chat.value;
      if (tour.status === 'fulfilled') counts.pendingTourOrderBadge = tour.value;
      return counts;
    },
  );
}
