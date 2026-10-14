/** #944：導遊拒絕申請可附說明的字數上限；前端輸入框與 server schema 共用同一個值。 */
export const REJECT_REASON_MAX_LENGTH = 200;

/**
 * `expire_tour_order` 的 `cancel_reason` 標記字串（#350 逾期釋位）。原定義在
 * `src/server/tour-orders.ts`（仍由該檔 re-export）；移到 lib 讓旅客頁的純函式可共用。
 */
export const TOUR_ORDER_AUTO_EXPIRE_REASON = '未在保留期限內完成付款，系統自動取消';
