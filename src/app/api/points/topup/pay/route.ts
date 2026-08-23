import { fail, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/points/topup/pay — 點數儲值（09 分冊 §4）⚙OWNER。
 * MVP 階段不接金流：平台管理者收到轉帳後用 service role 腳本寫 TOPUP 交易，
 * 本端點一律回 501。正式金流（綠界/藍新）屬 Phase 7+ 選配，實作前須先與
 * 平台擁有者確認選哪家金流（本規劃唯一留白的商業決策）。
 */
export const POST = handle(async () => {
  await requireTenant('OWNER');
  return fail(501, '請聯絡平台客服儲值');
});
