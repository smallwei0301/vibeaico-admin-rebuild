// POST /api/bookings/:id/apply-points — {points}：顧客點數折抵，1 點 = 1 元（04 §B-1）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const bodySchema = z.object({ points: z.number().int().positive('點數需為正整數') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, customer_id, final_price')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  // 折抵後不可低於 0（1 點 = 1 元）→ 400：這是輸入不合法（要求折太多），不是狀態衝突。
  const newFinal = Number(booking.final_price) - b.points;
  if (newFinal < 0)
    throw new ApiHttpError(400, '折抵點數不可超過預約金額', ERR.VALIDATION);

  const { data: customer, error: cErr } = await t.supabase.from('customers')
    .select('id, points')
    .eq('id', booking.customer_id).eq('tenant_id', t.tenantId).maybeSingle();
  if (cErr) throw cErr;
  if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
  // POINTS_001（錯誤碼總表：點數不足 409）。http.ts 的 ERR 常數表沒收這個碼
  // （該檔不在本次分工可動清單），依總表直接帶字面值。
  if (customer.points < b.points)
    throw new ApiHttpError(409, '顧客點數不足', 'POINTS_001');

  // 扣點（條件帶 gte points 防併發扣到負）→ 寫 log → 改 final_price。
  const pointsAfter = customer.points - b.points;
  const { data: deducted, error: dErr } = await t.supabase.from('customers')
    .update({ points: pointsAfter })
    .eq('id', customer.id).eq('tenant_id', t.tenantId).gte('points', b.points)
    .select('id').maybeSingle();
  if (dErr) throw dErr;
  if (!deducted) throw new ApiHttpError(409, '顧客點數不足', 'POINTS_001');

  const { error: lErr } = await t.supabase.from('customer_point_logs').insert({
    tenant_id: t.tenantId, customer_id: customer.id,
    delta: -b.points, reason: 'REDEEM_BOOKING', points_after: pointsAfter,
  });
  if (lErr) throw lErr;

  const { error: uErr } = await t.supabase.from('bookings')
    .update({ final_price: newFinal })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  return ok({ finalPrice: newFinal, customerPoints: pointsAfter });
});
