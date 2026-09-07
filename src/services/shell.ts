import { adapt, request } from '@/lib/api';
import { MOCK_SIDEBAR_COUNTS, MOCK_USER } from '@/mock';
import { listBookings } from './bookings';
import { listConversations } from './chat';

/**
 * AppShell（Sidebar/Topbar）用的「外框值」service — Issue #34。
 *
 * 修的是：AppShell 過去不分 USE_MOCK，一律把 MOCK_SIDEBAR_COUNTS /
 * MOCK_SETUP_STATUS / MOCK_USER 塞進 Sidebar/Topbar，真實租戶也看到假資料；
 * 加上 real 模式從不呼叫 applyMockMode()，mock 模組又預設停在 GUIDE 資料集，
 * 兩個問題疊加，real 模式下連 mock 資料本身都是錯業態的。
 *
 * 這裡的 real 分支只組裝已存在的端點；沒有資料來源的徽章（pendingTourOrderBadge，
 * tour_orders 是 Phase 8b/#8 才有的表）**不生一個 0 出來**，直接不列這個 key，
 * Sidebar 對缺 key／0 一視同仁地不畫 DOM（CountBadge：!count → null）。
 */

export type SidebarCounts = Partial<
  Record<'pendingBookingBadge' | 'pendingOrderBadge' | 'unreadChatBadge', number>
>;

/**
 * 把三個獨立來源的 Promise.allSettled 結果組成 SidebarCounts —— 拆成純函式
 * 方便單元測試「一個來源失敗，不拖垮另外兩個」而不用真的打網路（見
 * tests/unit/shell.34.test.ts）。任一來源 rejected 就不列對應的 key
 * （不是塞 0 —— 0 跟「不知道」是兩件事）。
 */
export function combineSidebarCounts(
  bookingsR: PromiseSettledResult<{ totalElements: number }>,
  ordersR: PromiseSettledResult<{ count: number }>,
  chatR: PromiseSettledResult<Array<{ unread?: number }>>,
): SidebarCounts {
  const counts: SidebarCounts = {};
  if (bookingsR.status === 'fulfilled') {
    counts.pendingBookingBadge = bookingsR.value.totalElements;
  }
  if (ordersR.status === 'fulfilled') {
    counts.pendingOrderBadge = ordersR.value.count;
  }
  if (chatR.status === 'fulfilled') {
    counts.unreadChatBadge = chatR.value.reduce((sum, c) => sum + (c.unread ?? 0), 0);
  }
  // pendingTourOrderBadge：刻意不列 — 見檔頭註解與 Issue #34，tour_orders 尚無資料來源。
  return counts;
}

/**
 * 側邊欄徽章數字。real 分支的三個來源彼此獨立（Promise.allSettled）——
 * 任一來源掛掉只讓那顆徽章消失，不會拖垮其他徽章或整個側邊欄（CLAUDE.md：
 * 誠實面對 unknown，不要因為一個端點失敗就整塊 blank）。
 */
export function sidebarCounts(): Promise<SidebarCounts> {
  return adapt<SidebarCounts>(
    () => MOCK_SIDEBAR_COUNTS,
    async () => {
      const [bookingsR, ordersR, chatR] = await Promise.allSettled([
        listBookings({ status: 'PENDING', size: 1 }),
        request<{ count: number }>('/api/product-orders/pending/count'),
        listConversations(),
      ]);
      return combineSidebarCounts(bookingsR, ordersR, chatR);
    },
  );
}

/**
 * Topbar 使用者名稱。GET /api/auth/me 只回 {email,tenantId,tenantName,shopCode,role}，
 * 沒有顯示名稱欄位 —— 顯示 email，不生一個假的顯示名稱（不是 MOCK_USER.name「小威」）。
 */
export function currentUserName(): Promise<string> {
  return adapt<string>(
    () => MOCK_USER.name,
    async () => {
      const me = await request<{ email: string }>('/api/auth/me');
      return me.email;
    },
  );
}
