/**
 * src/server/line-notify.ts — 預約狀態變更的 LINE 顧客端推播（Phase 6，06 分冊 §5）
 *
 * #40 replaces the old inline provider call with a durable outbox event.
 * Domain routes write booking state through their tenant-scoped client; the
 * database trigger owns status events transactionally. This compatibility
 * helper is only used by the cron-owned REMINDER flow and never contacts LINE.
 *
 * 流程（§5）：
 *   1. admin 讀 bookings_view 該筆 + customers.line_user_id；未綁定 → return
 *   2. 讀 notify 設定，對應開關（notifyBookingConfirmed 等）關閉 → return
 *   3. consumePushQuota(tenantId, 1) 失敗 → log 後 return（絕不丟錯）
 *   4. linePush(token, lineUserId, [textMessage])，文案含店名/服務/時間
 *
 * 自行決策：憑證讀取（getLineCredentials）放在扣額度**之前**——該店尚未設定
 * LINE 時會丟 LINE_001（被外層 catch 吃掉），若先扣額度會白白燒掉一則配額。
 *
 * 文案：zh-TW 常數寫在本檔。server 端推播文案不受鐵則 1（頁面 i18n）規範
 * ——比照 src/server/email/templates 先例（送到顧客手機的內容，不是後台 UI）。
 */
import { createAdminSupabase } from './supabase';
import { dispatchAfterCommit } from './notifications/outbox';

export type BookingStatusKind =
  | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'MODIFIED' | 'NO_SHOW' | 'REMINDER';

export async function notifyBookingStatus(
  tenantId: string,
  bookingId: string,
  kind: BookingStatusKind,
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.rpc('enqueue_notification_event', {
      p_tenant_id: tenantId,
      event_name: `BOOKING_LINE_${kind}`,
      p_aggregate_type: 'BOOKING',
      p_aggregate_id: bookingId,
      p_idempotency_key: `booking-line-${kind.toLowerCase()}:${bookingId}`,
      p_payload: { bookingId },
    });
    if (error) throw error;
    dispatchAfterCommit();
  } catch (e) {
    console.error('[line-notify] notifyBookingStatus 失敗', tenantId, bookingId, kind, e);
  }
}
