// PENDING/CONFIRMED → CANCELLED，寫 cancel_reason。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { notifyBookingEvent } from '@/server/email/notify';
import { notifyBookingStatus } from '@/server/line-notify';
import { notifyOwnerBookingSelfCancel } from '@/server/owner-notify';

/**
 * `customerInitiated`（Issue #18「旅客自行取消」）：本 repo 目前沒有獨立的
 * 未登入旅客自助取消端點（`src/app/s/[shopCode]` 公開頁只有展示，沒有取消
 * 動作），這支端點是唯一的取消路徑，一律經由已登入店家成員呼叫。所以老闆
 * 通知的「旅客自行取消」開關不能靠「誰呼叫了這支 API」判斷——一律由呼叫端
 * 明確標記這次取消是不是代替顧客記錄（例：顧客來電要求取消時，畫面上一顆
 * 「這是顧客本人要求取消」勾選框），預設 false（一般店家操作不誤觸發）。
 * 未來若補上真正的旅客自助取消入口，一樣呼叫本端點並帶 `customerInitiated:true`
 * 即可重用同一段邏輯，不需要另建一條通知路徑。
 */
const bodySchema = z.object({
  reason: z.string().optional(),
  customerInitiated: z.boolean().optional().default(false),
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'CANCELLED', cancel_reason: b.reason ?? null })
    .eq('id', id).eq('tenant_id', t.tenantId).in('status', ['PENDING', 'CONFIRMED'])
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);
  // Email 通知（05 分冊 §3：notifyBookingCancel 開關）不 await ——寄信慢或失敗
  // 都不可拖垮這支 API 的回應，函式內部已吞錯。
  void notifyBookingEvent(createAdminSupabase(), t.tenantId, id, 'CANCELLED');
  // LINE 顧客端推播（06 分冊 §5：notifyBookingCancelled 開關）——與上面的 email
  // 通知並存不互斥（email 寄店家、LINE 推顧客），同為 fire-and-forget。
  void notifyBookingStatus(t.tenantId, id, 'CANCELLED');
  // 老闆通知 owner-notify（Issue #18）：僅在標記為旅客自行取消時發送，
  // 且只發給開了「旅客自行取消」開關的接收者（見檔頭 customerInitiated 說明）。
  if (b.customerInitiated) void notifyOwnerBookingSelfCancel(t.tenantId, id);
  return ok();
});
