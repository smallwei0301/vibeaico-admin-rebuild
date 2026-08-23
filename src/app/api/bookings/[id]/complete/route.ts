// PENDING/CONFIRMED → COMPLETED，成功後依 tenant_settings.points 累點（A-2 表格）。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { isFeatureActive } from '@/server/features';
import { pointsSettingsSchema } from '@/config/tenant-settings';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'COMPLETED' })
    .eq('id', id).eq('tenant_id', t.tenantId).in('status', ['PENDING', 'CONFIRMED'])
    .select('id, customer_id, final_price').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);

  // 完成動作本身已成立（上面已 update 成功）。累點是附加效果，即使失敗也不該讓
  // 整個 complete 請求 500 ——店員在前台看到的是「完成失敗」，但 DB 其實已經
  // 完成，會造成狀態混淆。因此累點整段包 try/catch，錯誤只 log，仍回 ok()。
  try {
    const { data: settingsRow } = await t.supabase.from('tenant_settings')
      .select('points').eq('tenant_id', t.tenantId).maybeSingle();
    const points = pointsSettingsSchema.parse(settingsRow?.points ?? {});

    // §5 閘門（09 分冊）：POINT_SYSTEM 未訂閱 → 只跳過累點，不是 403——
    // 完成動作本身不受限（上面的 update 已成立）。fire-and-forget 語意不變。
    if (points.pointEarnEnabled && (await isFeatureActive(t.tenantId, 'POINT_SYSTEM'))) {
      // src/config/tenant-settings.ts 的欄位註解：pointEarnRate = 「消費多少元
      // 累積 1 點」，因此是 final_price / pointEarnRate 取整，不是相乘——相乘
      // 會讓消費 100 元、費率 100 時得到 10000 點，不合理。
      const raw = Number(data.final_price) / points.pointEarnRate;
      const n = points.rounding === 'CEIL' ? Math.ceil(raw)
        : points.rounding === 'ROUND' ? Math.round(raw)
        : Math.floor(raw); // FLOOR（預設）＝無條件捨去

      if (n > 0) {
        // CAS（.eq('points', 舊值) + 重試）防 lost update：與 apply-points/
        // adjust-stock 同語意，兩筆併發異動不會互相覆蓋（審計統一修正）。
        let pointsAfter = 0;
        for (let attempt = 0; ; attempt++) {
          const { data: customer, error: cErr } = await t.supabase.from('customers')
            .select('points').eq('id', data.customer_id).eq('tenant_id', t.tenantId).maybeSingle();
          if (cErr) throw cErr;
          const current = customer?.points ?? 0;
          pointsAfter = current + n;

          const { data: updated, error: uErr } = await t.supabase.from('customers')
            .update({ points: pointsAfter })
            .eq('id', data.customer_id).eq('tenant_id', t.tenantId).eq('points', current) // CAS
            .select('id').maybeSingle();
          if (uErr) throw uErr;
          if (updated) break;
          if (attempt >= 2) throw new Error('point-earn CAS 重試 3 次仍衝突');
        }

        const { error: lErr } = await t.supabase.from('customer_point_logs').insert({
          tenant_id: t.tenantId, customer_id: data.customer_id,
          delta: n, reason: 'EARN_BOOKING', points_after: pointsAfter,
        });
        if (lErr) throw lErr;
      }
    }
  } catch (e) {
    console.error('[api] booking complete: point-earn failed', id, e);
  }

  // Phase 4 之後：這裡呼叫 notifyBookingStatus(t.tenantId, id, 'COMPLETED')（05/06 分冊）
  return ok();
});
