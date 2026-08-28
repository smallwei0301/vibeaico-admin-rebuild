// PUT /api/bookings/:id — 改時間/員工/備註（04 分冊 §B-1）。
// 改 startAt 時以既有 duration_minutes 重算 end_at；重疊同 POST 交給
// DB 排除約束 x_bookings_overlap，catch 23P01 回 409。
//
// 顧客端「預約已變更」推播（06 分冊 §5，issue #27 ②）：
//   五個 kind 裡 MODIFIED 原本全站沒有任何呼叫端 —— 顧客的預約時間被改了不會
//   收到通知，頁面卻顯示「已發送通知給顧客」。這裡補上唯一的呼叫點。
//
//   ⚠️ 只有「時間」或「服務人員」真的變了才推播；**只改備註不推**。備註是店家
//   內部註記，顧客不需要為了一行內部備註收到推播（決策見 issue #27 ②）。
//   判斷是拿送進來的值跟資料庫現值比對 —— 編輯視窗每次送出都會帶齊
//   startAt/staffId/note 三個欄位，不比對就無從分辨「有改」與「原樣送出」。
//
//   回應多帶 `notifyTriggered`，讓頁面照**實際發生的事**顯示訊息，而不是不分
//   青紅皂白寫死「已發送通知給顧客」（00 鐵則 12）。它的語意嚴格是「本次有沒有
//   觸發推播」——推播本身依 §5 規約是 fire-and-forget，成敗（顧客未綁 LINE、
//   店家關掉 notifyBookingModified、額度不足）在回應當下無從得知，所以頁面文案
//   也只敢說「已送出」並標明哪些情況收不到，不宣稱顧客一定收到了。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { notifyBookingStatus } from '@/server/line-notify';

const bodySchema = z.object({
  startAt: z.string().optional(),
  /** undefined = 不動；null = 清除指定員工 */
  staffId: z.string().uuid().nullable().optional(),
  note: z.string().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: existing, error: e0 } = await t.supabase.from('bookings')
    .select('id, duration_minutes, start_at, staff_id')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  const update: Record<string, unknown> = {};
  /** 時間或人員實際有變 → 才值得推播給顧客（見檔頭） */
  let notifyTriggered = false;

  if (b.startAt !== undefined) {
    const startMs = Date.parse(b.startAt);
    if (Number.isNaN(startMs))
      throw new ApiHttpError(400, '開始時間格式錯誤', ERR.VALIDATION);
    update.start_at = new Date(startMs).toISOString();
    update.end_at = new Date(startMs + existing.duration_minutes * 60_000).toISOString();
    // 用毫秒比，不比字串：DB 回的是 '+00:00' 尾巴、送進來的是 'Z'，同一時刻兩種寫法
    if (Date.parse(existing.start_at) !== startMs) notifyTriggered = true;
  }
  if (b.staffId !== undefined) {
    if (b.staffId) {
      const { data: staff, error } = await t.supabase.from('staff').select('id')
        .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
      if (error) throw error;
      if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
    }
    update.staff_id = b.staffId; // null = 清除
    if ((existing.staff_id ?? null) !== (b.staffId ?? null)) notifyTriggered = true;
  }
  if (b.note !== undefined) update.note = b.note;   // 備註不影響 notifyTriggered

  if (Object.keys(update).length === 0) return ok({ notifyTriggered: false }); // 沒有要改的欄位

  const { error } = await t.supabase.from('bookings')
    .update(update)
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) {
    if (error.code === '23P01')
      throw new ApiHttpError(409, '該時段已有預約', ERR.CONFLICT);
    throw error;
  }

  // LINE 顧客端推播（06 分冊 §5：notifyBookingModified 開關）——同 cancel/confirm/
  // complete，一律 `void` 不 await：推播慢或失敗都不可拖垮這支 API 的回應，
  // notifyBookingStatus 內部整段 try/catch 吞錯。
  if (notifyTriggered) void notifyBookingStatus(t.tenantId, id, 'MODIFIED');

  return ok({ notifyTriggered });
});
