import { adapt, request } from '@/lib/api';
import {
  getGuideActionInboxPriority,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';
import { MOCK_BOOKINGS } from '@/mock';

const BOOKING_INBOX_HREF = '/tenant/bookings?status=PENDING';

/**
 * GUIDE 首頁目前可自主完成的 action inbox slice：既有 PENDING 預約。
 * mock 只模擬相對於現在的預約時間，避免舊 fixture 日期讓首頁顯示過期假資料。
 */
export function getGuideActionInbox(): Promise<GuideActionInboxItem[]> {
  return adapt(
    () => {
      const now = Date.now();
      const items = MOCK_BOOKINGS
        .filter((booking) => booking.status === 'PENDING')
        .slice(0, 20)
        .map((booking, index) => {
          const dueAt = new Date(now + (index + 2) * 60 * 60 * 1000).toISOString();
          return {
            id: booking.id,
            kind: 'BOOKING_REQUEST' as const,
            bookingNo: booking.bookingNo,
            customerName: booking.customerName,
            serviceName: booking.serviceName,
            priority: getGuideActionInboxPriority(dueAt, new Date(now)),
            dueAt,
            createdAt: booking.createdAt,
            href: BOOKING_INBOX_HREF,
          };
        });
      return sortGuideActionInboxItems(items);
    },
    () => request<GuideActionInboxItem[]>('/api/guide/action-inbox'),
  );
}
