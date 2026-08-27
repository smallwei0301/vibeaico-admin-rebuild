/**
 * DELETE `/api/bookings/:id/addons/:addonId` — 移除一筆加購並回沖（04 §B-1.1）。
 *
 * 原站端點事實依據：docs/specs/bookings.json 的 jsApiCalls
 * `/api/bookings/${bookingId}/addons/${itemId}`。
 *
 * 「回沖」的完整定義與兩種已知不精確的互動，寫在同目錄的 `../route.ts` 檔頭，
 * 不在這裡重複一份（兩份會走鐘）。摘要：**減去 `applied_amount` / `applied_minutes`
 * ——建立當下真的加上去的那個數字——下限 0**，不是刪除時重算 price × quantity。
 *
 * 刪除順序刻意是「先刪明細列、再回沖預約」：
 *   刪除帶 `.select()` 且以 id 為條件，兩個併發的刪除只有一個會拿到資料列，
 *   因此**回沖恰好發生一次**。反過來（先回沖再刪）在重試時會回沖兩次。
 *   若回沖那一步失敗，明細列會原樣補回（見下方 restore），不讓兩者不一致。
 */
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/** 可移除加購的預約狀態：與新增同一條規則（見 ../route.ts EDITABLE_STATUSES） */
const EDITABLE_STATUSES = ['PENDING', 'CONFIRMED'];

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id, addonId } = await params;

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, status, final_price, duration_minutes, start_at, end_at')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  if (!EDITABLE_STATUSES.includes(booking.status))
    throw new ApiHttpError(409, '已結案的預約不能移除加購', ERR.CONFLICT);

  // 先刪（帶 select 取回整列）：拿不到列 = 不存在／不屬於本店／已被別人刪掉 → 404
  const { data: addon, error: dErr } = await t.supabase.from('booking_addons')
    .delete()
    .eq('id', addonId).eq('booking_id', id).eq('tenant_id', t.tenantId)
    .select('*').maybeSingle();
  if (dErr) throw dErr;
  if (!addon) throw new ApiHttpError(404, '找不到此加購項目', ERR.NOT_FOUND);

  const appliedAmount = Number(addon.applied_amount);
  const appliedMinutes = Number(addon.applied_minutes);

  /** 回沖失敗時把明細列原樣放回去（含原本的 id 與 created_at），維持兩者一致 */
  const restore = async () => {
    await t.supabase.from('booking_addons').insert(addon);
  };

  // CAS 重試（同新增路由）：併發的刪除／折抵各自以讀到的舊值為條件
  let prev = {
    final_price: Number(booking.final_price),
    end_at: booking.end_at as string,
    duration_minutes: Number(booking.duration_minutes),
  };
  for (let attempt = 0; ; attempt++) {
    // 下限 0：票券／點數折抵可能已經把總價壓到低於這筆加購的金額，
    // 硬減會變負數。apply-coupon 的 applyDiscount 也是同一個 max(0, …) 選擇。
    const nextFinal = Math.max(0, prev.final_price - appliedAmount);
    // 時長同理夾在 0 以上；end_at 依實際扣掉的分鐘往前收，
    // 且不得早於 start_at（DB check end_at > start_at）。
    const minutesBack = Math.min(appliedMinutes, prev.duration_minutes);
    const startMs = Date.parse(booking.start_at as string);
    const nextEndMs = Math.max(
      Date.parse(prev.end_at) - minutesBack * 60_000,
      startMs + 60_000,
    );
    const next = {
      final_price: nextFinal,
      end_at: minutesBack > 0 ? new Date(nextEndMs).toISOString() : prev.end_at,
      duration_minutes: prev.duration_minutes - minutesBack,
    };

    const { data: updated, error: uErr } = await t.supabase.from('bookings')
      .update(next)
      .eq('id', id).eq('tenant_id', t.tenantId)
      .eq('final_price', prev.final_price).eq('end_at', prev.end_at)   // CAS
      .select('final_price, end_at, duration_minutes').maybeSingle();
    if (uErr) { await restore(); throw uErr; }
    if (updated) {
      return ok({
        finalPrice: Number(updated.final_price),
        endAt: updated.end_at as string,
        durationMinutes: Number(updated.duration_minutes),
        /** 這一次實際扣回的金額（畫面照實顯示，不自行推算） */
        revertedAmount: prev.final_price - Number(updated.final_price),
      });
    }
    if (attempt >= 2) {
      await restore();
      throw new ApiHttpError(409, '預約金額異動頻繁，請重試', ERR.CONFLICT);
    }
    const { data: reread, error: rErr } = await t.supabase.from('bookings')
      .select('final_price, end_at, duration_minutes')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (rErr) { await restore(); throw rErr; }
    if (!reread) { await restore(); throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND); }
    prev = {
      final_price: Number(reread.final_price),
      end_at: reread.end_at as string,
      duration_minutes: Number(reread.duration_minutes),
    };
  }
});
