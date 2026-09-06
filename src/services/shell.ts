import { adapt } from '@/lib/api';
import { MOCK_SIDEBAR_COUNTS } from '@/mock';
import { listBookings } from './bookings';
import { pendingProductOrderCount } from './catalog';
import { unreadChatCount } from './chat';

/** A missing key means the count is unknown, never a known zero. */
export type SidebarCounts = Record<string, number>;

/**
 * AppShell's three existing count contracts.  Each source settles separately
 * so one unavailable endpoint cannot fabricate or erase the other badges.
 */
export const sidebarCounts = () =>
  adapt<SidebarCounts>(
    () => ({ ...MOCK_SIDEBAR_COUNTS }),
    async () => {
      const [bookings, orders, chat] = await Promise.allSettled([
        listBookings({ status: 'PENDING', size: 1 }).then((page) => page.totalElements),
        pendingProductOrderCount(),
        unreadChatCount(),
      ]);
      const counts: SidebarCounts = {};
      if (bookings.status === 'fulfilled') counts.pendingBookingBadge = bookings.value;
      if (orders.status === 'fulfilled') counts.pendingOrderBadge = orders.value;
      if (chat.status === 'fulfilled') counts.unreadChatBadge = chat.value;
      return counts;
    },
  );
