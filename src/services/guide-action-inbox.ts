import { adapt, request } from '@/lib/api';
import {
  buildGuideActionInboxFormationItem,
  buildGuideActionInboxRefundPendingItem,
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  isGuideActionInboxFormationStatus,
  sortGuideActionInboxItems,
  type GuideActionInboxFormationKind,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';
import { MOCK_BOOKINGS } from '@/mock';
import { MOCK_TOUR_ORDERS, MOCK_TRIP_DEPARTURES, MOCK_TRIP_PLANS, MOCK_TRIPS } from '@/mock/tours';

const refundPendingHref = (id: string) =>
  `/tenant/tour-orders?paymentStatus=REFUND_PENDING&orderId=${encodeURIComponent(id)}`;

const bookingRequestHref = (id: string) =>
  `/tenant/bookings?status=PENDING&bookingId=${encodeURIComponent(id)}`;
const bookingPaymentHref = (id: string) =>
  `/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID&bookingId=${encodeURIComponent(id)}`;

/**
 * GUIDE 首頁 action inbox：待確認預約、待收款預約、今日／明日出發團次，以及 #43
 * 類別 3／4——REVIEW_REQUIRED（成團截止不足）與 AT_RISK（已成團後人數跌破門檻）。
 * 單一聚合入口，由這裡在 server／mock 端把不同資料表的候選彙整、排序成一份清單
 * 再回傳（#43 §4：「不可把不同資料表全抓到前端後自行拼湊」）；前端只消費這一份
 * 已排序好的陣列，不需要也不應該自己併多次呼叫的結果。
 *
 * formation 兩類只讀 `trip_departures.formation_status`（0107, #41 canonical）與其
 * snapshot 欄位，不建立新狀態、不重新推算成團與否，也不觸發通知、付款或其他外部
 * 副作用；mock 只模擬相對於現在的預約時間，避免舊 fixture 日期讓首頁顯示過期假資料。
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
        .filter((departure) =>
          departure.status !== 'CANCELLED'
          // 與 route.ts 的 DEPARTURE query 同一條規則：REVIEW_REQUIRED／AT_RISK 團次
          // 只當作 formation 卡片出現，不再同時當作「今日／明日出發」卡片——否則
          // 同一個團次、同一個深連結會在收件匣裡出現兩張卡。
          && !isGuideActionInboxFormationStatus(departure.formationStatus))
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
      const formationItems: GuideActionInboxItem[] = MOCK_TRIP_DEPARTURES
        .filter((departure) =>
          departure.status !== 'CANCELLED'
          && isGuideActionInboxFormationStatus(departure.formationStatus))
        .map((departure, index) => {
          const trip = MOCK_TRIPS.find((candidate) => candidate.id === departure.tripId);
          const plan = MOCK_TRIP_PLANS.find((candidate) => candidate.id === departure.planId);
          // fixture 的 departsOn 是固定寫死的日期（Aug 2026），跟 DEPARTURE 卡片在
          // `:80` 一樣，這裡也要把它換算成相對於「現在」的今日／明日，否則 demo 模式
          // 會永遠顯示兩張過期的「立即處理」卡片，跟本檔開頭的註解自相矛盾——也跟
          // route.ts 新加的 `.gte('departs_on', today)` 下限不一致（真實 API 不會回
          // 過期的 formation 列，mock 不該回）。
          const departureDate = index === 0 ? today : tomorrow;
          return buildGuideActionInboxFormationItem({
            id: departure.id,
            tripId: departure.tripId,
            tripName: trip?.title ?? '',
            planName: plan?.name ?? departure.planName,
            departureDate,
            startTime: departure.startTime || '00:00',
            capacity: departure.capacity,
            seatsBooked: departure.seatsBooked,
            // 注意：這裡的 `?? 1` 是給 mock fixture 型別（`minToDepartSnapshot?: number`，
            // `src/lib/types.ts`）用的，跟 route.ts 那個已移除的 `?? 1` 不是同一件事——
            // 真實 DB 欄位 `min_to_depart_snapshot` 是 `not null`，mock 型別的這個欄位
            // 沒有那條資料庫層的保證，所以這裡的防禦性 fallback 要留著。
            minToDepart: departure.minToDepartSnapshot ?? 1,
            formationStatus: departure.formationStatus as GuideActionInboxFormationKind,
            formationDeadlineAt: departure.formationDeadlineAt ?? null,
            formedParticipants: departure.formedParticipants ?? null,
            createdAt: new Date(now).toISOString(),
          }, nowDate);
        });
      // #43 類別 5：REFUND_PENDING。獨立 fixture 表（MOCK_TOUR_ORDERS），與上面
      // MOCK_BOOKINGS 衍生的 paymentItems 天生不相交（不同的 mock 資料集、不同
      // 的 paymentStatus 值域），理由同 route.ts 檔案頂端註解。
      const refundPendingItems: GuideActionInboxItem[] = MOCK_TOUR_ORDERS
        .filter((order) => order.paymentStatus === 'REFUND_PENDING')
        .slice(0, 20)
        .map((order) => buildGuideActionInboxRefundPendingItem({
          id: order.id,
          orderNo: order.orderNo,
          customerName: order.customerName,
          // mock 的 TourOrder 沒有 paidAmount 欄位（#41 選填欄位目前只補了
          // refundedAmount，見 src/lib/types.ts）；demo fixture 誠實地假設
          // REFUND_PENDING 訂單先前已收足 totalAmount，尚未退回的金額 =
          // totalAmount - refundedAmount，跟 route.ts 用 paid_amount -
          // refunded_amount 是同一個算法在不同資料形狀下的等價寫法。
          refundOutstandingAmount: Math.max(order.totalAmount - (order.refundedAmount ?? 0), 0),
          // mock 的 TourOrder 沒有 updatedAt 欄位，誠實地借用 createdAt——理由同
          // buildGuideActionInboxRefundPendingItem() 的說明：priority 固定
          // IMMEDIATE，這裡只影響同為 IMMEDIATE 卡片間的排序。
          dueAt: order.createdAt,
          createdAt: order.createdAt,
          href: refundPendingHref(order.id),
        }));
      return sortGuideActionInboxItems([
        ...items, ...paymentItems, ...departureItems, ...formationItems, ...refundPendingItems,
      ]);
    },
    () => request<GuideActionInboxItem[]>('/api/guide/action-inbox'),
  );
}
