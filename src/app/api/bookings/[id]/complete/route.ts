// PENDING/CONFIRMED → COMPLETED，成功後依 tenant_settings.points 累點（A-2 表格）。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { isFeatureActive } from '@/server/features';
import { pointsSettingsSchema } from '@/config/tenant-settings';
import { notifyBookingStatus } from '@/server/line-notify';
import { grantCampaignRewards } from '@/server/campaign-rewards';

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

  /**
   * 行銷活動獎勵（issue #176 第 2、3 項）——新客首購與滿額回饋的觸發點。
   *
   * 在此之前，活動頁的「贈送票券／贈送點數」存得進 `campaigns.content` 卻沒有
   * 任何程式會讀，店家設好、按發布、看到成功訊息，實際什麼都不會發生。
   *
   * ⚠️ 與上面的累點同樣包 try/catch 且錯誤只 log：完成動作本身早就成立（`update`
   * 已 commit），活動獎勵是附加效果。讓它把整個 complete 請求打成 500，店員會看到
   * 「完成失敗」但 DB 其實已完成——那是更糟的狀態混淆。
   *
   * 這裡吞掉錯誤是安全的，因為**發放本身是原子的**：`grant_campaign_reward()`
   * 把搶冪等鍵、加點數、寫帳本、發票券放在同一筆交易（`0091`），不會留下半套。
   * 吞掉的是「這次沒發成」，不是「發了一半」。
   */
  try {
    const { count } = await t.supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId)
      .eq('customer_id', data.customer_id)
      .eq('status', 'COMPLETED');

    // 上面那筆 update 已經把本筆改成 COMPLETED，所以「第一筆」＝總數恰好 1。
    // ⚠️ `count` 為 null 代表**查詢沒有回傳計數**，不是 0；當成 0 會讓
    // `=== 1` 恆為 false，新客活動就永遠不發，而且完全靜默。分開判斷。
    const isFirstCompletedBooking = count === 1;

    const outcomes = await grantCampaignRewards({
      tenantId: t.tenantId,
      customerId: data.customer_id as string,
      trigger: 'BOOKING_COMPLETED',
      sourceId: id,
      amount: Number(data.final_price),
      isFirstCompletedBooking,
    });
    for (const o of outcomes) {
      if (o.error) console.error('[api] booking complete: campaign reward failed', id, o.campaignId, o.error);
    }
  } catch (e) {
    console.error('[api] booking complete: campaign rewards failed', id, e);
  }

  // LINE 顧客端推播（06 分冊 §5）：不 await、不影響 API 結果，函式內部已吞錯。
  void notifyBookingStatus(t.tenantId, id, 'COMPLETED');
  return ok();
});
