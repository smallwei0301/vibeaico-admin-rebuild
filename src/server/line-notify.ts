/**
 * src/server/line-notify.ts — 預約狀態變更的 LINE 顧客端推播（Phase 6，06 分冊 §5）
 *
 * #40 replaces the old inline provider call with a durable outbox event.
 * Domain routes write booking state through their tenant-scoped client; the
 * database trigger owns status events transactionally. This compatibility
 * helper is only used by the cron-owned REMINDER flow and never contacts LINE.
 * It throws persistence failures back to cron, so cron cannot count a dropped
 * reminder as sent.
 *
 * 流程（§5）：
 *   1. cron 條件式搶到 reminder_sent_at 後呼叫本 helper。
 *   2. service-only RPC 驗證 booking 屬於 tenant，寫入固定 REMINDER event。
 *   3. commit 後 dispatcher 透過 delivery ledger 派送，provider 不在此處直呼。
 *
 * 文案與 provider 憑證處理都留在 outbox dispatcher；本檔不持有或傳送它們。
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
  if (kind !== 'REMINDER') throw new Error('notifyBookingStatus only supports cron REMINDER events');
  const admin = createAdminSupabase();
  const { data: outboxId, error } = await admin.rpc('enqueue_booking_line_reminder', {
    p_tenant_id: tenantId,
    p_booking_id: bookingId,
  });
  if (error) throw error;
  if (typeof outboxId !== 'string') throw new Error('reminder outbox id was not returned');
  dispatchAfterCommit(outboxId);
}
