/**
 * src/server/line-notify.ts — 預約狀態變更的 LINE 顧客端推播（Phase 6，06 分冊 §5）
 *
 * 呼叫規約（§5 原文）：動作端點內 `void notifyBookingStatus(...)`，不 await、
 * 不影響 API 結果。整段 try/catch 吞錯，只 console.error——推播慢或失敗都
 * 不可拖垮呼叫端的 API 回應（與 email/notify.ts 同一精神）。
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
import { notifySettingsSchema } from '@/config/tenant-settings';
import { getLineCredentials, linePush, consumePushQuota } from './line';

export type BookingStatusKind =
  | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'MODIFIED' | 'NO_SHOW' | 'REMINDER';

/** 各事件的推播文案；{shop}/{service}/{time} 由 buildMessage 代入 */
const COPY: Record<BookingStatusKind, { title: string; footer: string }> = {
  CONFIRMED: { title: '您的預約已確認 ✅', footer: '期待您的光臨！' },
  COMPLETED: { title: '感謝您今日的光臨 💛', footer: '期待下次再為您服務！' },
  CANCELLED: { title: '您的預約已取消', footer: '如需重新預約，歡迎隨時與我們聯繫。' },
  MODIFIED:  { title: '您的預約內容已變更', footer: '若有疑問，歡迎與我們聯繫確認。' },
  NO_SHOW:   { title: '我們今日未能等到您 🙏', footer: '如需改約，歡迎與我們聯繫重新安排。' },
  REMINDER:  { title: '預約提醒 🔔', footer: '若無法如期前來，請提前與我們聯繫改期。' },
};

/** kind → notifySettingsSchema 開關鍵（鍵名以 src/config/tenant-settings.ts 為準） */
const SWITCH_KEY = {
  CONFIRMED: 'notifyBookingConfirmed',
  COMPLETED: 'notifyBookingCompleted',
  CANCELLED: 'notifyBookingCancelled',
  MODIFIED:  'notifyBookingModified',
  NO_SHOW:   'notifyBookingNoShow',
  REMINDER:  'notifyBookingReminder',
} as const satisfies Record<BookingStatusKind, string>;

/** timestamptz → 台北牆上時間「YYYY/MM/DD HH:mm」（與 tz.ts 同一 +08:00 假設） */
function formatTaipei(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ` +
         `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function buildMessage(
  kind: BookingStatusKind,
  v: { shop: string; service: string; time: string },
): string {
  const c = COPY[kind];
  return `【${v.shop}】${c.title}\n服務項目：${v.service}\n預約時間：${v.time}\n${c.footer}`;
}

export async function notifyBookingStatus(
  tenantId: string,
  bookingId: string,
  kind: BookingStatusKind,
): Promise<void> {
  try {
    const admin = createAdminSupabase();

    // 1. 該筆預約（bookings_view 已 join 出 service_name）＋顧客 LINE 綁定
    const { data: b } = await admin.from('bookings_view')
      .select('customer_id, service_name, start_at')
      .eq('id', bookingId).eq('tenant_id', tenantId).maybeSingle();
    if (!b) return;
    const { data: customer } = await admin.from('customers')
      .select('line_user_id')
      .eq('id', b.customer_id).eq('tenant_id', tenantId).maybeSingle();
    if (!customer?.line_user_id) return;                    // 未綁定 → 不推

    // 2. 通知開關（tenant_settings.notify）＋店名（文案要用）
    const [{ data: settingsRow }, { data: tenant }] = await Promise.all([
      admin.from('tenant_settings').select('notify').eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    const notify = notifySettingsSchema.parse(settingsRow?.notify ?? {});
    if (!notify[SWITCH_KEY[kind]]) return;                  // 開關關閉 → 不推

    // 憑證先於扣額度（見檔頭「自行決策」）：未設定 LINE 丟 LINE_001 → 外層吞
    const { token } = await getLineCredentials(tenantId);

    // 3. 推播額度
    if (!(await consumePushQuota(tenantId, 1))) {
      console.error('[line-notify] 推播額度不足，略過', tenantId, bookingId, kind);
      return;
    }

    // 4. 推播
    const text = buildMessage(kind, {
      shop: tenant?.name ?? '',
      service: b.service_name ?? '',
      time: formatTaipei(b.start_at),
    });
    await linePush(token, customer.line_user_id, [{ type: 'text', text }]);
  } catch (e) {
    console.error('[line-notify] notifyBookingStatus 失敗', tenantId, bookingId, kind, e);
  }
}
