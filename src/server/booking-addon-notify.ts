/**
 * src/server/booking-addon-notify.ts — 預約加購的「消費明細」LINE 通知
 * （GitHub issue #17 / 補齊-2；契約見 04 分冊 §B-1.1）
 *
 * 原站加購對話框有一個勾選框 `addonNotify`「通知顧客消費明細（連續加多項時可先
 * 勾掉、最後一項再通知，避免顧客連收多則）」。它以前什麼後端都沒接，送出後卻跳
 * 一則「顧客將收到 LINE 消費明細」的成功 toast（issue #3 已把那句誠實化）。
 * 這支模組把那個勾選框真的實作出來。
 *
 * 與 line-notify.ts 兩個函式的關係：
 *  - `notifyBookingStatus`（06 分冊 §5）是 fire-and-forget、吃 tenant_settings
 *    的通知開關。本模組**兩者都不是**。
 *  - `notifyProductOrderReceipt`（issue #27 ③）才是同型的先例：呼叫端 await、
 *    回傳「實際發生了什麼」，因為店家會在畫面上讀到結果，分不出來就只能寫死
 *    一句話——那正是 00 鐵則 12 要修掉的假的已知。本模組照抄那個形狀。
 *
 * 刻意的差異（相對 notifyProductOrderReceipt）：
 *  1. **不吃 tenant_settings.notify 的任何開關**：這則通知的開關就是勾選框本身，
 *    一筆一勾（同 notifyProductOrderReceipt 的理由）。
 *  2. **未綁 LINE 不改寄 Email**：商品訂單那個勾選框的標籤明寫「未綁 LINE 自動
 *    改寄 Email」，加購這個標籤沒有這句話。標籤沒承諾的事就不要做，也不要在
 *    回應裡宣稱做了——回 'NO_LINE'，由畫面照實說「顧客未綁定 LINE，沒有送出」。
 *  3. 額度不足回 'QUOTA_EXCEEDED'，**呼叫端據以回 409**（issue #17 驗收明列，
 *    比照 /api/chat/messages）。此時加購本身已經寫入，不回滾——店家做的事真的
 *    做了，只是通知沒送出去，兩件事要分開陳述。
 *
 * 這支函式**永不拋錯**：任何例外都轉成 'FAILED'，加購本身不會因為通知失敗而失敗。
 */
import { createAdminSupabase } from './supabase';
import { getLineCredentials, linePush, consumePushQuota } from './line';
import { ApiHttpError, ERR } from './http';
import type { BookingAddonNotifyOutcome } from '@/lib/types';

/** 消費明細的 LINE 純文字版（純函式，供單元測試直接驗內容） */
export function buildBookingAddonReceiptText(v: {
  shop: string;
  bookingNo: string;
  items: { name: string; quantity: number; price: number }[];
  addonTotal: number;
  bookingTotal: number;
}): string {
  const lines = v.items.map(
    (i) => `・${i.name} ×${i.quantity}　NT$ ${(i.price * i.quantity).toLocaleString()}`,
  );
  return [
    `【${v.shop}】已為您登記加購項目 🧾`,
    `預約編號：${v.bookingNo}`,
    '——————————',
    ...lines,
    '——————————',
    `本次加購：NT$ ${v.addonTotal.toLocaleString()}`,
    `預約金額：NT$ ${v.bookingTotal.toLocaleString()}`,
  ].join('\n');
}

/**
 * 送出一筆加購的消費明細，回傳**實際發生的事**。
 *
 * 憑證讀取（getLineCredentials）放在扣額度之前：該店尚未設定 LINE 時直接回
 * 'NOT_CONFIGURED'，先扣額度會白白燒掉一則配額（同 line-notify.ts 的決策）。
 */
export async function notifyBookingAddonReceipt(
  tenantId: string,
  params: {
    bookingId: string;
    item: { name: string; quantity: number; price: number };
    addonTotal: number;
    bookingTotal: number;
  },
): Promise<BookingAddonNotifyOutcome> {
  try {
    const admin = createAdminSupabase();

    const { data: booking } = await admin.from('bookings')
      .select('booking_no, customer_id')
      .eq('id', params.bookingId).eq('tenant_id', tenantId).maybeSingle();
    if (!booking) return 'FAILED';

    const [{ data: customer }, { data: tenant }] = await Promise.all([
      admin.from('customers').select('line_user_id')
        .eq('id', booking.customer_id).eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (!customer?.line_user_id) return 'NO_LINE';   // 未綁定 → 沒有管道，不改寄 Email（見檔頭）

    // 未設定 LINE Channel → getLineCredentials 丟 LINE_001。
    // ⚠️ 只認這一個錯誤碼，其餘例外（DB 讀取失敗、解密失敗…）往外丟給最外層
    // catch 轉 'FAILED'：把「讀不到設定」一律說成「尚未設定」等於報一個沒查證過
    // 的狀態（CLAUDE.md「Never fabricate a known」）。
    let token: string;
    try {
      ({ token } = await getLineCredentials(tenantId));
    } catch (e) {
      if (e instanceof ApiHttpError && e.code === ERR.LINE_NOT_CONFIGURED) return 'NOT_CONFIGURED';
      throw e;
    }

    if (!(await consumePushQuota(tenantId, 1))) {
      console.error('[addon-notify] 推播額度不足，未送出', tenantId, params.bookingId);
      return 'QUOTA_EXCEEDED';
    }

    const text = buildBookingAddonReceiptText({
      shop: tenant?.name ?? '',
      bookingNo: String(booking.booking_no ?? ''),
      items: [params.item],
      addonTotal: params.addonTotal,
      bookingTotal: params.bookingTotal,
    });
    await linePush(token, customer.line_user_id, [{ type: 'text', text }]);
    return 'LINE';
  } catch (e) {
    console.error('[addon-notify] notifyBookingAddonReceipt 失敗', tenantId, params.bookingId, e);
    return 'FAILED';
  }
}
