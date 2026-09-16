import { handle, ok } from '@/server/http';
import { requireUser } from '@/server/tenant';
import { buildDonationCheckout } from '@/server/donations';
import { APP_URL } from '@/config/env';

/**
 * GET /api/donations/:id/checkout —— 組出 ECPay AIO 自動送出表單欄位。
 *
 * 平台目前沒有真實 ECPay 商店憑證，未設定時回 503 + `EXT_001`
 * （`EXTERNAL_CONFIG_BLOCKED`，issue #25 C 段），前端據此顯示誠實的
 * 「金流尚未開通」訊息，而不是假裝可以付款。
 */
export const GET = handle(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const checkout = await buildDonationCheckout({
    donationId: id,
    donorUserId: user.id,
    appUrl: APP_URL,
  });

  return ok(checkout);
});
