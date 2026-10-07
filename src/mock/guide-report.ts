/**
 * GUIDE 營運報表（Issue #45）mock：與旅遊訂單清單 mock 是「同一份資料、同一個日期基準」。
 *
 * 資料來源只有 MOCK_TOUR_ORDERS（src/mock/tours.ts）。種子訂單的建立時間固定在 2026-08，
 * 這裡在「呼叫當下」把它們平移成相對於今天（店家時區）的日期——函式內計算，不在模組層級
 * 凍結（CLAUDE.md：mock 資料不得在 module scope 依賴執行時狀態）。報表與訂單清單 mock
 * 都呼叫 mockTourOrdersRelativeToNow()，所以預設區間內有數字，且下鑽連結列出的正是被計數的訂單。
 * 報表數字由 src/server/guide-report.ts 的純函式計算，不另寫一套 mock 算法。
 */
import { addDays, zonedToday, type GuideReportOrderRow } from '@/server/guide-report';
import type { TourOrder } from '@/lib/types';
import { MOCK_TOUR_ORDERS, MOCK_TRIPS, MOCK_TRIP_PLANS } from '@/mock/tours';

const ZONE = 'Asia/Taipei';
/** 種子訂單建立時間的參考日（最新一筆所在日）；平移後它落在「昨天」，確保所有種子都在現在之前 */
const SEED_ANCHOR_DATE = '2026-08-23';

const ymd = (iso: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso));
const hms = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/**
 * 回傳 MOCK_TOUR_ORDERS 的複本；種子訂單（建立時間 ≤ 參考日）的 createdAt 平移為相對今天，
 * 之後新建的訂單（建立時間在參考日之後）保持原值。不改動 MOCK_TOUR_ORDERS 本身。
 */
export function mockTourOrdersRelativeToNow(nowMs: number = Date.now()): TourOrder[] {
  const today = zonedToday(ZONE, nowMs);
  return MOCK_TOUR_ORDERS.map((o) => {
    const day = ymd(o.createdAt);
    if (day > SEED_ANCHOR_DATE) return { ...o };
    const offset = diffDays(SEED_ANCHOR_DATE, day) + 1; // 最新種子 = 昨天
    return { ...o, createdAt: `${addDays(today, -offset)}T${hms(o.createdAt)}+08:00` };
  });
}

/** mock 沒有 paid_amount／customer_id 欄位：以訂單狀態誠實推導；旅客以電話識別 */
export function mockOrderToReportRow(o: TourOrder): GuideReportOrderRow {
  const plan = MOCK_TRIP_PLANS.find((p) => p.tripId === o.tripId && p.name === o.planName);
  let paid = 0;
  if (o.paymentStatus === 'PAID' || o.paymentStatus === 'REFUNDED' || o.paymentStatus === 'REFUND_PENDING') paid = o.totalAmount;
  else if (o.paymentStatus === 'PARTIAL') paid = o.depositAmount;
  const refunded = o.paymentStatus === 'REFUNDED' ? (o.refundedAmount ?? o.totalAmount) : (o.refundedAmount ?? 0);
  return {
    id: o.id,
    trip_id: o.tripId,
    plan_id: plan?.id ?? `plan:${o.planName}`,
    party_size: o.partySize,
    status: o.status,
    payment_status: o.paymentStatus,
    paid_amount: paid,
    refunded_amount: refunded,
    created_at: o.createdAt,
    source: o.source,
    customer_id: o.customerPhone ? `phone:${o.customerPhone}` : null,
  };
}

/** 行程／方案名稱對照（id 與旅遊訂單 mock 同一份） */
export function mockGuideNames(): { trips: Map<string, string>; plans: Map<string, string> } {
  return {
    trips: new Map(MOCK_TRIPS.map((t) => [t.id, t.title])),
    plans: new Map(MOCK_TRIP_PLANS.map((p) => [p.id, p.name])),
  };
}
