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

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, customer_id, final_price, points_redeemed')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  // 折抵後不可低於 0（1 點 = 1 元）→ 400：這是輸入不合法（要求折太多），不是狀態衝突。
  const newFinal = Number(booking.final_price) - b.points;
  if (newFinal < 0)
    throw new ApiHttpError(400, '折抵點數不可超過預約金額', ERR.VALIDATION);

  // 扣點採 compare-and-swap（同 products adjust-stock 的寫法）：
  // update 條件帶 .eq('points', 讀到的舊值)，兩個併發折抵只有一個能匹配成功，
  // 另一個重讀新值重試。先前版本用 .gte('points', b.points) 只擋得住「扣成
  // 負數」，擋不住 lost update（兩邊都讀到 100、都扣 30、最終 70 而非 40）
  // ——審計實抓，勿改回。
  let pointsAfter = 0;
  for (let attempt = 0; ; attempt++) {
    const { data: customer, error: cErr } = await t.supabase.from('customers')
      .select('id, points')
      .eq('id', booking.customer_id).eq('tenant_id', t.tenantId).maybeSingle();
    if (cErr) throw cErr;
    if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
    // POINTS_001（錯誤碼總表：點數不足 409）。http.ts 的 ERR 常數表沒收這個碼
    // （該檔不在本次分工可動清單），依總表直接帶字面值。
    if (customer.points < b.points)
      throw new ApiHttpError(409, '顧客點數不足', 'POINTS_001');

    pointsAfter = customer.points - b.points;
    const { data: deducted, error: dErr } = await t.supabase.from('customers')
      .update({ points: pointsAfter })
      .eq('id', customer.id).eq('tenant_id', t.tenantId).eq('points', customer.points) // CAS
      .select('id').maybeSingle();
    if (dErr) throw dErr;
    if (deducted) break;
    if (attempt >= 2)
      throw new ApiHttpError(409, '顧客點數異動頻繁，請重試', ERR.CONFLICT);
  }

  const { error: lErr } = await t.supabase.from('customer_point_logs').insert({
    tenant_id: t.tenantId, customer_id: booking.customer_id,
    delta: -b.points, reason: 'REDEEM_BOOKING', points_after: pointsAfter,
  });
  if (lErr) throw lErr;

  /*
   * issue #35：折抵掉多少點以前沒有留下來，於是 bookings 頁詳情的「點數折抵」
   * 只能吃頁內假資料（BOOKING_EXTRAS_*）。這裡累計進 `points_redeemed`
   * （migration 0022）；同一筆預約分兩次折抵就相加。
   */
  const { error: uErr } = await t.supabase.from('bookings')
    .update({
      final_price: newFinal,
      points_redeemed: Number(booking.points_redeemed ?? 0) + b.points,
    })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  return ok({ finalPrice: newFinal, customerPoints: pointsAfter });
});
