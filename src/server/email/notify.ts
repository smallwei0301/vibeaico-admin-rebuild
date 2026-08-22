/**
 * src/server/email/notify.ts — 預約 Email 通知派送（Phase 4）
 * 規格：docs/integration/05-EMAIL-RESEND.md §3（觸發點與開關對應表）。
 *
 * 拆兩層方便單元測試（12 分冊 §3：純函式邏輯與 I/O 分離）：
 *  - `resolveBookingNotifications()`：純函式，只做「開關 + 資料是否齊全」的
 *    收件人判斷，不碰網路/DB。
 *  - `notifyBookingEvent()`：薄封裝，負責用 service role client 查
 *    tenant_settings + bookings（join 顧客/服務/員工/租戶名稱）、組出
 *    `resolveBookingNotifications()` 的輸入、逐一呼叫 `sendBookingNotifyEmail`。
 *    整段 try/catch 吞錯，只 `console.error`——寄信絕不可拖垮呼叫端的 API 回應。
 *
 * ⚠️ 開關鍵名：店家/員工收到的「新預約 email」對應 `notifyNewBooking`/
 * `notifyStaffBooking`；取消時寄店家用的是 `notifyBookingCancel`（不是
 * `notifyBookingCancelled`——後者是「顧客端 LINE 預約狀態推播」開關，見
 * src/config/tenant-settings.ts notifySettingsSchema 註解「顧客：LINE 預約
 * 狀態推播」區塊，屬 06 分冊，與本檔無關）。
 */

import type { createAdminSupabase } from '@/server/supabase';
import { notifySettingsSchema, basicSettingsSchema } from '@/config/tenant-settings';
import { sendBookingNotifyEmail } from './send';

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

interface BookingNotifyRow {
  start_at: string;
  customers: { name: string } | null;
  services: { name: string } | null;
  staff: { name: string; email: string | null } | null;
  tenants: { name: string } | null;
}

/**
 * 薄封裝：查 DB → `resolveBookingNotifications()` → 逐一 `sendBookingNotifyEmail()`。
 * 用 service role client（呼叫端已在 API 層通過 RLS 驗證過歸屬，這裡只是背景
 * 派送，不需要走使用者 session）。整段吞錯，只 log，不對外拋出。
 */
export async function notifyBookingEvent(
  adminSupabase: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  bookingId: string,
  kind: BookingNotifyKind,
): Promise<void> {
  try {
    const [{ data: settingsRow }, { data: bookingRow }] = await Promise.all([
      adminSupabase.from('tenant_settings').select('notify, basic')
        .eq('tenant_id', tenantId).maybeSingle(),
      adminSupabase.from('bookings')
        .select('start_at, customers(name), services(name), staff(name, email), tenants(name)')
        .eq('id', bookingId).eq('tenant_id', tenantId).maybeSingle(),
    ]);
    if (!bookingRow) return;

    // supabase-js 在沒有生成的 Database 型別時，對巢狀 join 的靜態型別一律推斷成
    // 陣列（無法從 select 字串判斷 FK 基數）；但 customer_id/service_id/staff_id/
    // tenant_id 在 bookings 都是單一外鍵（多對一關聯），PostgREST 實際回傳的是
    // 物件而非陣列，故先轉 unknown 再轉型，繞過靜態型別不吻合的檢查。
    const b = bookingRow as unknown as BookingNotifyRow;
    const notify = notifySettingsSchema.parse(settingsRow?.notify ?? {});
    // 只取 tenantEmail 這一欄（其餘 basic 欄位如 tenantName/shopCode 為必填，
    // 這裡沒有可用的保底值可補，parse() 整包會直接丟錯）。
    const { tenantEmail } = basicSettingsSchema.pick({ tenantEmail: true })
      .parse(settingsRow?.basic ?? {});

    const targets = resolveBookingNotifications({
      notify, tenantEmail, kind, staffEmail: b.staff?.email ?? null,
    });

    for (const target of targets) {
      await sendBookingNotifyEmail(target.to, target.kind, {
        shopName: b.tenants?.name ?? '',
        customerName: b.customers?.name ?? '',
        serviceName: b.services?.name ?? '',
        startAt: b.start_at,
        staffName: b.staff?.name ?? null,
      });
    }
  } catch (e) {
    console.error('[email] notifyBookingEvent 失敗', tenantId, bookingId, kind, e);
  }
}
