/** GUIDE 營運報表（Issue #45）mock 訂單；只供 NEXT_PUBLIC_USE_MOCK=true 使用。 */
import type { GuideReportOrderRow } from '@/server/guide-report';

export const MOCK_GUIDE_TRIPS = new Map([
  ['trip_1', '龜山島賞鯨半日遊'],
  ['trip_2', '花蓮砂婆礑溯溪體驗'],
  ['trip_3', '九份山城夜訪散策'],
]);
export const MOCK_GUIDE_PLANS = new Map([
  ['plan_1', '標準班（含保險）'],
  ['plan_2', '包團專案'],
  ['plan_3', '親子友善班'],
  ['plan_4', '夜間散策'],
]);

/**
 * mock 訂單：dayOffset = 距「to」往前幾天（本期為 0..days-1，上一期為 days..2*days-1，
 * 以 days = 30 為基準；區間較短時超出的列自然落在區間外被忽略）。
 * 刻意包含部分付款、退款與取消，讓畫面能看到各口徑分開。
 */
export type MockGuideOrder = Omit<GuideReportOrderRow, 'created_at'> & { dayOffset: number };
export const MOCK_GUIDE_ORDERS: MockGuideOrder[] = [
  { id: 'o01', trip_id: 'trip_1', plan_id: 'plan_1', party_size: 4, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 6400, refunded_amount: 0, source: 'MIDAO', customer_id: 'cust_1', dayOffset: 2 },
  { id: 'o02', trip_id: 'trip_1', plan_id: 'plan_2', party_size: 8, status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: 4000, refunded_amount: 0, source: 'LINE', customer_id: 'cust_2', dayOffset: 4 },
  { id: 'o03', trip_id: 'trip_2', plan_id: 'plan_1', party_size: 2, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 3600, refunded_amount: 0, source: 'MIDAO', customer_id: 'cust_1', dayOffset: 6 },
  { id: 'o04', trip_id: 'trip_2', plan_id: 'plan_3', party_size: 3, status: 'CANCELLED', payment_status: 'REFUNDED', paid_amount: 2700, refunded_amount: 2700, source: 'LINE', customer_id: 'cust_3', dayOffset: 9 },
  { id: 'o05', trip_id: 'trip_3', plan_id: 'plan_4', party_size: 5, status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 4500, refunded_amount: 0, source: 'MANUAL', customer_id: null, dayOffset: 11 },
  { id: 'o06', trip_id: 'trip_3', plan_id: 'plan_4', party_size: 2, status: 'PENDING', payment_status: 'UNPAID', paid_amount: 0, refunded_amount: 0, source: 'VIBEAI_SHOP', customer_id: 'cust_7', dayOffset: 13 },
  { id: 'o07', trip_id: 'trip_1', plan_id: 'plan_1', party_size: 6, status: 'CANCELLED', payment_status: 'REFUND_PENDING', paid_amount: 9600, refunded_amount: 0, source: 'MIDAO', customer_id: 'cust_5', dayOffset: 16 },
  { id: 'o08', trip_id: 'trip_2', plan_id: 'plan_1', party_size: 4, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 7200, refunded_amount: 0, source: 'LINE', customer_id: 'cust_6', dayOffset: 21 },
  { id: 'o09', trip_id: 'trip_1', plan_id: 'plan_1', party_size: 3, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 4800, refunded_amount: 0, source: 'MIDAO', customer_id: 'cust_4', dayOffset: 33 },
  { id: 'o10', trip_id: 'trip_3', plan_id: 'plan_4', party_size: 4, status: 'COMPLETED', payment_status: 'PAID', paid_amount: 3600, refunded_amount: 0, source: 'MANUAL', customer_id: 'cust_6', dayOffset: 40 },
  { id: 'o11', trip_id: 'trip_2', plan_id: 'plan_3', party_size: 2, status: 'CANCELLED', payment_status: 'UNPAID', paid_amount: 0, refunded_amount: 0, source: 'LINE', customer_id: 'cust_3', dayOffset: 47 },
];

