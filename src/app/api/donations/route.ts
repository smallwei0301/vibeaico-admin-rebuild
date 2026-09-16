import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireUser } from '@/server/tenant';
import {
  DISPLAY_NAME_MAX,
  DONATION_MAX_AMOUNT,
  DONATION_MIN_AMOUNT,
  createDonationOrder,
} from '@/server/donations';

/**
 * POST /api/donations —— 建立一筆待付款贊助訂單（issue #25 C 段）。
 *
 * 任何已登入的後台使用者都可以贊助（贊助是個人行為，不要求特定租戶角色），
 * 建單本身只寫我方 DB，不需要 ECPay 憑證——真正需要憑證的是後續
 * `GET /api/donations/:id/checkout`。
 */
const bodySchema = z.object({
  amount: z.number().int().min(DONATION_MIN_AMOUNT).max(DONATION_MAX_AMOUNT),
  displayName: z.string().trim().max(DISPLAY_NAME_MAX).optional().default(''),
});

export const POST = handle(async (req) => {
  const { user } = await requireUser();
  const body = bodySchema.parse(await req.json());

  const donation = await createDonationOrder({
    donorUserId: user.id,
    amount: body.amount,
    displayName: body.displayName,
  });

  return ok(donation);
});
