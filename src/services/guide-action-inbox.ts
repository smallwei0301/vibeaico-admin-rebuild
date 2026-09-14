import { adapt, request } from '@/lib/api';
import {
  buildGuideActionInboxFormationItem,
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  isGuideActionInboxFormationStatus,
  sortGuideActionInboxItems,
  type GuideActionInboxFormationItem,
  type GuideActionInboxFormationKind,
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

/**
 * #43 類別 3／4：REVIEW_REQUIRED（成團截止不足）與 AT_RISK（已成團後人數跌破門檻）。
 * 刻意是獨立於 `getGuideActionInbox()` 的另一個匯出：後者的回傳型別 `GuideActionInboxItem[]`
 * 被 `src/app/tenant/dashboard/page.tsx` 直接消費，而該頁面不在 #43 的 FILE_OWNERSHIP 內、
 * 也還沒有能認得這兩種新 kind 的渲染分支。把它們併進同一個函式會讓頁面在型別層或執行期
 * 收到它處理不了的卡片；分成獨立函式讓資料層可以誠實、完整地出貨，串接進首頁 UI 留給
 * 擁有 dashboard 頁面的 lane 決定何時、如何呈現。
 *
 * 只讀 `trip_departures.formation_status`（0107, #41 canonical），不建立新狀態、
 * 不重新推算成團與否，也不觸發通知、付款或其他外部副作用。
 */
export function getGuideActionInboxFormationItems(): Promise<GuideActionInboxFormationItem[]> {
  return adapt(
    () => {
      const now = Date.now();
      const nowDate = new Date(now);
      const items = MOCK_TRIP_DEPARTURES
        .filter((departure) =>
          departure.status !== 'CANCELLED'
          && isGuideActionInboxFormationStatus(departure.formationStatus))
        .map((departure) => {
          const trip = MOCK_TRIPS.find((candidate) => candidate.id === departure.tripId);
          const plan = MOCK_TRIP_PLANS.find((candidate) => candidate.id === departure.planId);
          return buildGuideActionInboxFormationItem({
            id: departure.id,
            tripId: departure.tripId,
            tripName: trip?.title ?? '',
            planName: plan?.name ?? departure.planName,
            departureDate: departure.departsOn,
            startTime: departure.startTime || '00:00',
            capacity: departure.capacity,
            seatsBooked: departure.seatsBooked,
            minToDepart: departure.minToDepartSnapshot ?? 1,
            formationStatus: departure.formationStatus as GuideActionInboxFormationKind,
            formationDeadlineAt: departure.formationDeadlineAt ?? null,
            formedParticipants: departure.formedParticipants ?? null,
            createdAt: new Date(now).toISOString(),
          }, nowDate);
        });
      return sortGuideActionInboxItems(items);
    },
    () => request<GuideActionInboxFormationItem[]>('/api/guide/action-inbox/formation'),
  );
}
