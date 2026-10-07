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
import type { GuideDepartureRow } from '@/server/guide-report-formation';
import { MOCK_TOUR_ORDERS, MOCK_TRIPS, MOCK_TRIP_DEPARTURES, MOCK_TRIP_PLANS } from '@/mock/tours';

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

/** MOCK_TRIP_DEPARTURES 種子團次的參考出發日（最早一筆）；平移後整批落在「今天往前 9 天起」的區間內 */
const DEPARTURE_ANCHOR_DATE = '2026-08-23';

/**
 * 成團表現 mock：把種子團次的出發日在呼叫當下平移為相對今天（全部落在今天以前，與報表日期上限一致），
 * 另補上一期的幾筆（已成團／未成團）讓「與上一期比較」有真實資料。formation_status 取自團次 mock 本身（dp_3 FORMED、dp_5 FAILED 皆已在 MOCK_TRIP_DEPARTURES），
 * 不另造；GUIDE 專屬，函式內計算、不在模組層級凍結。
 */
export function mockDepartureRows(nowMs: number = Date.now()): GuideDepartureRow[] {
  const today = zonedToday(ZONE, nowMs);
  // 唯一的報表示範調整，僅是日期平移，formation_status 不覆寫（一律取團次 mock）：
  //  - dp_4（REVIEW_REQUIRED）出發日設為今天 → 呈現「今天出發、尚待成團決策 1 團」（尚未結案）
  //  - dp_10 保留過去的 COLLECTING → 呈現「無最終成團結果 1 團」
  const reportOverride: Record<string, { departs_on?: string }> = {
    dp_4: { departs_on: today },
  };
  const seeded = MOCK_TRIP_DEPARTURES.map((d) => ({
    id: d.id,
    departs_on: addDays(today, -9 + diffDays(d.departsOn, DEPARTURE_ANCHOR_DATE)),
    formation_status: d.formationStatus ?? 'COLLECTING',
    status: d.status,
    formation_decided_at: d.formationDecidedAt ?? null,
    ...reportOverride[d.id],
  }));
  const previousPeriod: GuideDepartureRow[] = [
    { id: 'mock_prev_1', departs_on: addDays(today, -40), formation_status: 'FORMED' },
    { id: 'mock_prev_2', departs_on: addDays(today, -38), formation_status: 'FAILED' },
    { id: 'mock_prev_3', departs_on: addDays(today, -35), formation_status: 'FORMED' },
  ];
  // 本期補充（不屬於上一期）：一筆導遊決策取消（已取消＋未成團）、一筆已取消但未有最終成團結果（成團狀態仍是募集中）
  const currentPeriodExtras: GuideDepartureRow[] = [
    { id: 'mock_failed_1', departs_on: addDays(today, -4), formation_status: 'FAILED', status: 'CANCELLED' },
    { id: 'mock_cancel_1', departs_on: addDays(today, -3), formation_status: 'COLLECTING', status: 'CANCELLED' },
  ];
  return [...seeded, ...currentPeriodExtras, ...previousPeriod];
}
