import { handle, fail, ERR } from '@/server/http';

/**
 * POST /api/public/tour-requests/mine — 旅客「我的訂單」舊匿名查詢入口。
 *
 * issue #650 / parent #12：
 * 聯絡方式（電話、LINE ID、Email）只能拿來定位資料，不能證明呼叫者就是本人。
 * 舊實作只要猜中聯絡方式，就會批次回傳該店符合的 tour_orders，這不符合
 * docs/integration/11-PARTNER-API.md 已定義的 traveler JWT 邊界。
 *
 * 在正式 /api/public/me/orders（traveler_user_id = auth.uid()）接上前，這個舊入口
 * 必須 fail closed：不讀取訂單、不根據聯絡方式做任何 ownership 判斷，也不回傳
 * 空陣列假裝只是「查不到」。
 */
export const POST = handle(async () =>
  fail(401, '查詢所有訂單需要先完成旅客身分驗證', ERR.UNAUTHORIZED),
);
