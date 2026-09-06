import { adapt, request } from '@/lib/api';
import {
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';
import { MOCK_BOOKINGS } from '@/mock';
import { MOCK_TRIP_DEPARTURES, MOCK_TRIP_PLANS, MOCK_TRIPS } from '@/mock/tours';

const bookingRequestHref = (id: string) =>
  `/tenant/bookings?status=PENDING&bookingId=${encodeURIComponent(id)}`;
const bookingPaymentHref = (id: string) =>
  `/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID&bookingId=${encodeURIComponent(id)}`;

/**
 * GUIDE 首頁目前可自主完成的 action inbox slice：既有待確認與待收款預約。
 * mock 只模擬相對於現在的預約時間，避免舊 fixture 日期讓首頁顯示過期假資料。
 */
export function getGuideActionInbox(): Promise<GuideActionInboxItem[]> {
  return adapt(
    () => {
      const now = Date.now();
      const nowDate = new Date(now);
      const { today, tomorrow } = getGuideActionInboxDateWindow(nowDate);
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
            href: bookingRequestHref(booking.id),
          };
        });
      const paymentItems: GuideActionInboxItem[] = MOCK_BOOKINGS
        .filter((booking) =>
          booking.status === 'CONFIRMED'
          && booking.paymentStatus === 'UNPAID'
          && booking.finalPrice > 0)
        .slice(0, 20)
        .map((booking, index) => {
          const dueAt = new Date(now + (index + 3) * 60 * 60 * 1000).toISOString();
          return {
            id: booking.id,
            kind: 'BOOKING_PAYMENT' as const,
            bookingNo: booking.bookingNo,
            customerName: booking.customerName,
            serviceName: booking.serviceName,
            amount: booking.finalPrice,
            priority: getGuideActionInboxPriority(dueAt, new Date(now)),
            dueAt,
            createdAt: booking.createdAt,
            href: bookingPaymentHref(booking.id),
          };
        });
      const departureItems: GuideActionInboxItem[] = MOCK_TRIP_DEPARTURES
        .filter((departure) => departure.status !== 'CANCELLED')
        .slice(0, 2)
        .map((departure, index): GuideActionInboxItem | null => {
          const departureDate = index === 0 ? today : tomorrow;
          const departureDay = getGuideDepartureDay(departureDate, nowDate);
          if (!departureDay) return null;
          const trip = MOCK_TRIPS.find((candidate) => candidate.id === departure.tripId);
          const plan = MOCK_TRIP_PLANS.find((candidate) => candidate.id === departure.planId);
          const startTime = departure.startTime || '00:00';
          return {
            id: departure.id,
            kind: 'DEPARTURE' as const,
            tripId: departure.tripId,
            tripName: trip?.title ?? '',
            planName: plan?.name ?? departure.planName,
            departureDate,
            startTime,
            capacity: departure.capacity,
            seatsBooked: departure.seatsBooked,
            departureDay,
            priority: departureDay === 'TODAY' ? 'TODAY' : 'UPCOMING',
            dueAt: getGuideDepartureDueAt(departureDate, startTime),
            createdAt: new Date(now).toISOString(),
            href: `/tenant/trips/${departure.tripId}`,
          };
        })
        .filter((item): item is GuideActionInboxItem => item !== null);
      return sortGuideActionInboxItems([...items, ...paymentItems, ...departureItems]);
    },
    () => request<GuideActionInboxItem[]>('/api/guide/action-inbox'),
  );
}
