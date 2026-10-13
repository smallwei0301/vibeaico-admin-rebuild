// POST /api/bookings/:id/apply-coupon — {code}：核銷票券並重算 final_price（04 §B-1）。
// 核銷邏輯（找票券、核對顧客、核銷、算折扣）共用 src/server/coupons.ts
// redeemCoupon()——product-orders 的 apply-coupon 端點也呼叫同一支函式
// （issue #33 第 ① 筆：核銷邏輯只能有一份）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { redeemCoupon } from '@/server/coupons';

const APPLICABLE_STATUSES: string[] = ['PENDING', 'CONFIRMED'];

const bodySchema = z.object({ code: z.string().min(1, '請輸入票券代碼') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, status, customer_id, final_price, custom_fields')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  // issue #923：與 apply-points（#291 / 0093）同一份白名單，僅 PENDING／CONFIRMED。
  // 必須在 redeemCoupon 之前擋下，否則票券會先被燒掉。
  if (!APPLICABLE_STATUSES.includes(booking.status)) {
    throw new ApiHttpError(
      409,
      '此預約已完成、已取消或未到店，無法核銷票券；如需補核銷請先將預約改回已確認',
      ERR.CONFLICT,
    );
  }

  const redemption = await redeemCoupon(
    t.supabase, t.tenantId, b.code, booking.customer_id, Number(booking.final_price));

  // bookings 表沒有 coupon 欄位（0004 migration；欄位真相以 DB 為準），
  // 「booking 記 coupon」改記在 custom_fields jsonb 的保留鍵 _coupon 底下
  // （不與預約自訂欄位填答的一般鍵衝突），保住票券↔預約的追溯性。
  // 注意：核銷（coupon_instances）與寫回（bookings）不是同一個交易，非原子，見 #925。
  // 這裡刻意不做應用層補償：寫回若遇逾時等傳輸層錯誤，DB 可能其實已提交，
  // 此時還原票券會造成重複折抵；單一交易 RPC 由 #925 處理。寫回失敗直接 throw。
  const { error: uErr } = await t.supabase.from('bookings')
    .update({
      final_price: redemption.newAmount,
      custom_fields: {
        ...(booking.custom_fields ?? {}),
        _coupon: {
          instanceId: redemption.instanceId, code: b.code,
          discountType: redemption.discountType, discountValue: redemption.discountValue,
        },
      },
    })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  return ok({ finalPrice: redemption.newAmount });
});
