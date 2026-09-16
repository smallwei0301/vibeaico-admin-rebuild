import { handle, ok } from '@/server/http';
import { requireUser } from '@/server/tenant';
import { getDonationSummary } from '@/server/donations';

/**
 * GET /api/donations/summary —— 全平台累積贊助、我已贊助多少、感謝名單。
 * 需要登入（後台頁面本來就在登入牆後面），但不要求任何租戶角色——
 * 贊助總覽對任何登入的後台使用者都是公開資訊。
 */
export const GET = handle(async () => {
  const { user } = await requireUser();
  const summary = await getDonationSummary(user.id);
  return ok(summary);
});
