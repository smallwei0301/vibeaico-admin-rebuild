/**
 * src/server/email/notify.ts — 預約 Email 通知派送（Phase 4）
 * 規格：docs/integration/05-EMAIL-RESEND.md §3（觸發點與開關對應表）。
 *
 * 拆兩層方便單元測試（12 分冊 §3：純函式邏輯與 I/O 分離）：
 *  - `resolveBookingNotifications()`：純函式，只做「開關 + 資料是否齊全」的
 *    收件人判斷，不碰網路/DB。
 *  - `notifyBookingEvent()`：舊相容入口；事件本身已由 0037 DB trigger 和
 *    `notifications/outbox` 收斂，這裡只喚醒 post-commit dispatcher，絕不直接
 *    呼叫 Email provider。
 *    整段 try/catch 吞錯，只 `console.error`——寄信絕不可拖垮呼叫端的 API 回應。
 *
 * ⚠️ 開關鍵名：店家/員工收到的「新預約 email」對應 `notifyNewBooking`/
 * `notifyStaffBooking`；取消時寄店家用的是 `notifyBookingCancel`（不是
 * `notifyBookingCancelled`——後者是「顧客端 LINE 預約狀態推播」開關，見
 * src/config/tenant-settings.ts notifySettingsSchema 註解「顧客：LINE 預約
 * 狀態推播」區塊，屬 06 分冊，與本檔無關）。
 */

import { notifySettingsSchema } from '@/config/tenant-settings';
import { dispatchAfterCommit } from '@/server/notifications/outbox';

export type BookingNotifyKind = 'NEW' | 'CANCELLED';

type NotifySettings = ReturnType<typeof notifySettingsSchema.parse>;

export interface ResolveBookingNotificationsInput {
  /** `tenant_settings.notify`，已用 `notifySettingsSchema` 補齊預設值 */
  notify: NotifySettings;
  /** `tenant_settings.basic.tenantEmail`；空字串＝未填，店家通知直接跳過 */
  tenantEmail: string;
  kind: BookingNotifyKind;
  /** 該預約指定員工的 email；未指定員工，或員工未填 email 時為 null */
  staffEmail: string | null;
}

export interface BookingNotificationTarget {
  to: string;
  kind: BookingNotifyKind;
}

/**
 * 純函式：依 05 §3 開關對應表決定這次事件要寄給誰。
 *
 * | 事件 | 開關 | 收件人 |
 * |---|---|---|
 * | NEW | `notifyNewBooking` | 店家（`tenantEmail` 非空才寄） |
 * | NEW + 有指定員工 | `notifyStaffBooking` | 該員工（`staffEmail` 非空才寄） |
 * | CANCELLED | `notifyBookingCancel` | 店家（`tenantEmail` 非空才寄） |
 */
export function resolveBookingNotifications(
  input: ResolveBookingNotificationsInput,
): BookingNotificationTarget[] {
  const { notify, tenantEmail, kind, staffEmail } = input;
  const targets: BookingNotificationTarget[] = [];

  if (kind === 'NEW') {
    if (notify.notifyNewBooking && tenantEmail) targets.push({ to: tenantEmail, kind });
    if (notify.notifyStaffBooking && staffEmail) targets.push({ to: staffEmail, kind });
  } else {
    if (notify.notifyBookingCancel && tenantEmail) targets.push({ to: tenantEmail, kind });
  }

  return targets;
}

/**
 * @deprecated #40 keeps this symbol for callers from older branches. New
 * domain routes must only write their business row; the 0037 trigger records
 * the event transactionally and this function merely wakes the shared worker.
 */
export async function notifyBookingEvent(
  _adminSupabase: unknown,
  _tenantId: string,
  _bookingId: string,
  _kind: BookingNotifyKind,
): Promise<void> {
  dispatchAfterCommit();
}
