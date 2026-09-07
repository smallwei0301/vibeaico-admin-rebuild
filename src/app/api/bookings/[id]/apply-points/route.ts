// POST /api/bookings/:id/apply-points — {points}：顧客點數折抵，1 點 = 1 元（04 §B-1）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

const bodySchema = z.object({ points: z.number().int().positive('點數需為正整數') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'POINT_SYSTEM');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  // The RPC locks booking then customer and performs the debit, ledger insert, and
  // price update in one PostgreSQL transaction. Do not replace with separate writes.
  const { data, error } = await t.supabase.rpc('apply_booking_points', {
    p_tenant_id: t.tenantId,
    p_booking_id: id,
    p_points: b.points,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('BOOKING_POINTS_BOOKING_NOT_FOUND') || message.includes('BOOKING_POINTS_CUSTOMER_NOT_FOUND'))
      throw new ApiHttpError(404, message.includes('CUSTOMER') ? '找不到此顧客' : '找不到此預約', ERR.NOT_FOUND);
    if (message.includes('BOOKING_POINTS_FINAL_PRICE_EXCEEDED'))
      throw new ApiHttpError(400, '折抵點數不可超過預約金額', ERR.VALIDATION);
    if (message.includes('BOOKING_POINTS_INSUFFICIENT'))
      throw new ApiHttpError(409, '顧客點數不足', 'POINTS_001');
    if (message.includes('BOOKING_POINTS_FEATURE_LOCKED'))
      throw new ApiHttpError(403, '此功能尚未訂閱，請至功能商店開通', ERR.FEATURE_LOCKED);
    if (message.includes('BOOKING_POINTS_FORBIDDEN'))
      throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  return ok({
    finalPrice: Number((result as { final_price: number }).final_price),
    customerPoints: Number((result as { customer_points: number }).customer_points),
  });
});
