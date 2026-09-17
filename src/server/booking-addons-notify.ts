/**
 * src/server/booking-addons-notify.ts — 預約加購「消費明細」通知（issue #17）。
 *
 * PREPARE 階段獨立檔案（#530 staged schema release，見
 * `scripts/agents/schema-staged-release-policy.mjs`）：本 PR 同時帶 migration
 * （`supabase/migrations/0119_issue_17_booking_addons_hardening.sql`）與新的
 * Product runtime 檔案，所以每一個新檔的每一個 export 都必須被同一顆
 * default-off gate（`bookingAddonsSchemaActive`）擋在函式本體第一行，且不得
 * 對既有檔案（`src/server/line-notify.ts` 等）做 in-place 增補——那些檔案裡
 * 已經在正常運作的既有 export（例如 `notifyBookingStatus`）沒有辦法只為了
 * 新功能被整檔一起套上「flag 關閉就整檔失效」的 gate。本檔是本次唯一定義
 * gate 本身的檔案（`SCHEMA_ACTIVATION_GUARD_PATH`）。
 *
 * 與 `line-notify.ts` ③ 商品訂單通知的差異：加購沒有 Email fallback——原站
 * addonModal 的勾選框文案只講 LINE（「通知顧客消費明細」），沒有「未綁 LINE
 * 改寄 Email」這句，改動範圍之外不擅自加一條新的送達管道。未綁 LINE 時維持
 * 0082 已收斂的 `notified='NO_LINE'` 語意。
 *
 * #17／#40 分工：這裡只做「這一則現在能不能送、送不送得出去」的**同步**判斷與
 * 一次嘗試，不建重試佇列、不建第二套 outbox——那是 #40 canonical
 * （`docs/integration/17-NOTIFICATION-DELIVERY.md`）的範圍。
 */
import { createAdminSupabase } from './supabase';
import { getLineCredentials, linePush, consumePushQuota } from './line';
import { ApiHttpError, ERR } from './http';
import type { BookingAddonNotifiedOutcome } from '@/types/booking-addons';

// schema-activation-gate: BOOKING_ADDONS_SCHEMA_ACTIVE default-off symbol=bookingAddonsSchemaActive
/**
 * 本 slice 的唯一開關，PREPARE 階段預設關閉。每一個本檔（與同一 PR 內其他新
 * runtime 檔案）的 exported entry 都必須以
 * `if (!bookingAddonsSchemaActive()) …` 作為函式本體第一行；ACTIVATE PR 移除
 * 這些 gate 呼叫時才真正接線。
 */
export function bookingAddonsSchemaActive() {
  return process.env.BOOKING_ADDONS_SCHEMA_ACTIVE === 'true';
}

type BookingAddonReceiptTextInput = {
  shop: string;
  bookingNo: string;
  itemName: string;
  quantity: number;
  amount: number;
};

/**
 * 加購消費明細的 LINE 純文字版（純函式，供單元測試直接驗內容）。
 *
 * ⚠️ 刻意不寫回傳型別註記（`): string {`）：`scripts/agents/
 * schema-staged-release-policy.mjs` 偵測 exported entry 的正則
 * （`\([^)]*\)\s*\{`）要求參數列的右括號後只能接空白就是函式本體的
 * `{`，中間插一段回傳型別註記會讓這個 export 完全偵測不到，PREPARE
 * 階段的 gate 因此形同虛設（甚至可能整檔被判定成「沒有任何受 gate
 * 控制的 exported entry」而擋下 PR）。TypeScript 仍能從 `return` 陳述式
 * 推回正確型別，型別安全不受影響。
 */
export function buildBookingAddonReceiptText(v: BookingAddonReceiptTextInput) {
  if (!bookingAddonsSchemaActive()) {
    throw new ApiHttpError(404, '加購功能尚未啟用', ERR.NOT_FOUND);
  }
  return [
    `【${v.shop}】消費明細更新 🧾`,
    `預約編號：${v.bookingNo}`,
    `・${v.itemName} ×${v.quantity}`,
    `本次加購金額：NT$ ${v.amount.toLocaleString()}`,
  ].join('\n');
}

/**
 * 依「該筆加購是否要求通知」送出一次消費明細推播。
 * 呼叫端只在 `notificationRequested=true` 時呼叫本函式；永不拋錯（gate 關閉
 * 例外），任何非預期例外都轉成 'FAILED' 回傳，不影響已經成功寫入的加購
 * （加購成功與通知結果分離，見 issue #17 §6「通知」裁示）。
 */
type NotifyBookingAddonItem = { name: string; quantity: number; amount: number };

/** 見上方 `buildBookingAddonReceiptText` 註解：同一理由，刻意不寫回傳型別註記。 */
export async function notifyBookingAddonReceipt(
  tenantId: string,
  bookingId: string,
  item: NotifyBookingAddonItem,
) {
  if (!bookingAddonsSchemaActive()) {
    throw new ApiHttpError(404, '加購功能尚未啟用', ERR.NOT_FOUND);
  }
  try {
    const admin = createAdminSupabase();

    const { data: b } = await admin.from('bookings_view')
      .select('booking_no, customer_id')
      .eq('id', bookingId).eq('tenant_id', tenantId).maybeSingle();
    if (!b) return 'FAILED';

    const [{ data: customer }, { data: tenant }] = await Promise.all([
      admin.from('customers').select('line_user_id')
        .eq('id', b.customer_id).eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (!customer?.line_user_id) return 'NO_LINE';

    let token: string;
    try {
      ({ token } = await getLineCredentials(tenantId));
    } catch (e) {
      if (e instanceof ApiHttpError && e.code === ERR.LINE_NOT_CONFIGURED) return 'NOT_CONFIGURED';
      throw e;
    }

    if (!(await consumePushQuota(tenantId, 1))) {
      console.error('[booking-addons-notify] 推播額度不足', tenantId, bookingId);
      return 'QUOTA_EXCEEDED';
    }

    const text = [
      `【${tenant?.name ?? ''}】消費明細更新 🧾`,
      `預約編號：${String(b.booking_no ?? '')}`,
      `・${item.name} ×${item.quantity}`,
      `本次加購金額：NT$ ${item.amount.toLocaleString()}`,
    ].join('\n');
    await linePush(token, customer.line_user_id, [{ type: 'text', text }]);
    return 'LINE';
  } catch (e) {
    console.error('[booking-addons-notify] notifyBookingAddonReceipt 失敗', tenantId, bookingId, e);
    return 'FAILED';
  }
}
