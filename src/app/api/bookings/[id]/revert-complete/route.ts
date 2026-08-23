// POST /api/bookings/:id/revert-complete — 僅 COMPLETED→PENDING，回沖完成時
// 發的點數，需 MANAGER（04 §B-1 ⚙M；狀態機 A-2：COMPLETED→PENDING 只有這裡允許）。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pointsSettingsSchema } from '@/config/tenant-settings';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'PENDING' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'COMPLETED') // 僅已完成可退回
    .select('id, customer_id, final_price').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);

  // 回沖 complete 時發的點數。狀態已退回（上面 update 已成立），回沖是附加效果，
  // 失敗只 log 不讓整個請求 500（同 complete/route.ts 的累點理由）。
  //
  // ⚠️ 已知限制：customer_point_logs 沒有 booking_id 欄位（0004 migration），
  // 無法精準找回「這筆預約完成時發的那一筆 EARN_BOOKING log」。保守做法：
  // 依 complete/route.ts 當下同一套公式（final_price / pointEarnRate + rounding）
  // 重算應回沖點數。若完成後 points 設定（費率/進位）曾變更、或 final_price
  // 曾被調整，回沖數可能與當時實發數不一致——此為 schema 限制下的近似值。
  try {
    const { data: settingsRow } = await t.supabase.from('tenant_settings')
      .select('points').eq('tenant_id', t.tenantId).maybeSingle();
    const points = pointsSettingsSchema.parse(settingsRow?.points ?? {});

    if (points.pointEarnEnabled) {
      const raw = Number(data.final_price) / points.pointEarnRate;
      const n = points.rounding === 'CEIL' ? Math.ceil(raw)
        : points.rounding === 'ROUND' ? Math.round(raw)
        : Math.floor(raw); // FLOOR（預設）

      if (n > 0) {
        // CAS（.eq('points', 舊值) + 重試）防 lost update，與 apply-points/
        // complete/adjust-stock 同語意（審計統一修正）。
        for (let attempt = 0; ; attempt++) {
          const { data: customer, error: cErr } = await t.supabase.from('customers')
            .select('points').eq('id', data.customer_id).eq('tenant_id', t.tenantId).maybeSingle();
          if (cErr) throw cErr;
          const current = customer?.points ?? 0;
          // 顧客可能已把點數折抵掉，最多扣到 0，不讓餘額變負（log 記實際扣回數）。
          const deduct = Math.min(n, current);
          if (deduct <= 0) break;
          const pointsAfter = current - deduct;

          const { data: updated, error: uErr } = await t.supabase.from('customers')
            .update({ points: pointsAfter })
            .eq('id', data.customer_id).eq('tenant_id', t.tenantId).eq('points', current) // CAS
            .select('id').maybeSingle();
          if (uErr) throw uErr;
          if (updated) {
            const { error: lErr } = await t.supabase.from('customer_point_logs').insert({
              tenant_id: t.tenantId, customer_id: data.customer_id,
              delta: -deduct, reason: 'REVERT_COMPLETE', points_after: pointsAfter,
            });
            if (lErr) throw lErr;
            break;
          }
          if (attempt >= 2) throw new Error('revert-complete 回沖 CAS 重試 3 次仍衝突');
        }
      }
    }
  } catch (e) {
    console.error('[api] booking revert-complete: point-revert failed', id, e);
  }

  return ok();
});
