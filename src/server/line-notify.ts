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
import { sendProductOrderReceiptEmail } from './email/send';

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

/* ====================================================================== ③
 * 商品訂單「消費明細」通知（issue #27 ③）
 *
 * 手動建單視窗那個勾選框寫著：
 *   「LINE 通知顧客消費明細（未綁 LINE 自動改寄 Email；每則扣 1 推播額度）」
 * 以前它什麼後端都沒接，送出後卻跳一則把這句標籤逐字重播的 toast，讀起來就是
 * 「已通知」。這裡把標籤上寫的那套規則真的實作出來：
 *   LINE 優先 → 未綁 LINE 改寄 Email → LINE 每則扣 1 推播額度（Email 不扣）。
 *
 * 與上面 notifyBookingStatus 的兩點差異，都是刻意的：
 *  1. **回傳結果、呼叫端 await**。06 分冊 §5 的 fire-and-forget 規約管的是預約
 *     狀態推播——那些推播沒有任何 UI 在等結果。這裡相反：店家會在畫面上讀到
 *     「已用 LINE 通知」還是「已改寄 Email」，分不出來就只能寫死一句話，那正是
 *     這個 issue 要修掉的假的已知（00 鐵則 12）。所以要知道結果就必須等它。
 *     函式本身永不拋錯（整段 try/catch），所以 await 它不會讓建單 API 失敗。
 *  2. 不吃 tenant_settings.notify 的任何開關：這則通知的開關就是那個勾選框本身，
 *     一單一勾。硬掛一個沒人設定過的開關等於讓勾選框再次失效。
 * ==================================================================== */

/** 消費明細通知的實際結果（回給頁面顯示；每個值都只描述真的發生過的事） */
export type ProductOrderNotifyOutcome =
  /** 沒有要求通知（勾選框沒勾） */
  | 'NONE'
  /** 顧客已綁 LINE → 已推播，扣 1 推播額度 */
  | 'LINE'
  /** 顧客未綁 LINE → 已改寄 Email（不扣推播額度） */
  | 'EMAIL'
  /** 顧客既未綁 LINE、也沒有 Email → 沒有任何管道可送 */
  | 'NO_CONTACT'
  /** 已綁 LINE 但本月推播額度不足 → 沒送出 */
  | 'QUOTA_EXCEEDED'
  /** 試著送了但沒送成（LINE 平台回錯／未設定 LINE 憑證／寄信失敗或未設定 Resend） */
  | 'FAILED';

/** 消費明細的 LINE 純文字版（純函式，供單元測試直接驗內容） */
export function buildProductOrderReceiptText(v: {
  shop: string;
  orderNo: string;
  items: { name: string; quantity: number; price: number }[];
  totalAmount: number;
}): string {
  const lines = v.items.map(
    (i) => `・${i.name} ×${i.quantity}　NT$ ${(i.price * i.quantity).toLocaleString()}`,
  );
  return [
    `【${v.shop}】感謝您的購買 🧾`,
    `訂單編號：${v.orderNo}`,
    '——————————',
    ...lines,
    '——————————',
    `合計：NT$ ${v.totalAmount.toLocaleString()}`,
  ].join('\n');
}

/**
 * 依「LINE 優先 → 未綁 LINE 改寄 Email」送出一筆商品訂單的消費明細。
 * 永不拋錯：任何例外都轉成 'FAILED' 回傳（呼叫端據以顯示，不會讓建單失敗）。
 */
export async function notifyProductOrderReceipt(
  tenantId: string,
  orderId: string,
): Promise<ProductOrderNotifyOutcome> {
  try {
    const admin = createAdminSupabase();

    const { data: order } = await admin.from('product_orders')
      .select('id, order_no, total_amount, customer_id')
      .eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
    if (!order) return 'FAILED';

    const [{ data: itemRows }, { data: customer }, { data: tenant }] = await Promise.all([
      admin.from('product_order_items').select('product_name, quantity, price')
        .eq('order_id', orderId).eq('tenant_id', tenantId),
      admin.from('customers').select('name, email, line_user_id')
        .eq('id', order.customer_id).eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (!customer) return 'FAILED';

    const items = (itemRows ?? []).map((r) => ({
      name: String(r.product_name ?? ''),
      quantity: Number(r.quantity ?? 0),
      price: Number(r.price ?? 0),
    }));
    const shop = tenant?.name ?? '';
    const totalAmount = Number(order.total_amount ?? 0);

    // ---- ① LINE 優先 ----
    if (customer.line_user_id) {
      const { token } = await getLineCredentials(tenantId);   // 未設定 → LINE_001 → catch
      if (!(await consumePushQuota(tenantId, 1))) {
        console.error('[line-notify] 消費明細：推播額度不足', tenantId, orderId);
        return 'QUOTA_EXCEEDED';
      }
      const text = buildProductOrderReceiptText({
        shop, orderNo: order.order_no, items, totalAmount,
      });
      await linePush(token, customer.line_user_id, [{ type: 'text', text }]);
      return 'LINE';
    }

    // ---- ② 未綁 LINE → 改寄 Email（不扣推播額度）----
    const email = String(customer.email ?? '').trim();
    if (!email) return 'NO_CONTACT';
    const result = await sendProductOrderReceiptEmail(email, {
      shopName: shop,
      orderNo: order.order_no,
      customerName: String(customer.name ?? ''),
      items: items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
      totalAmount,
    });
    // SKIPPED_NO_KEY / FAILED 都代表信根本沒出去 —— 不可報成 'EMAIL'
    return result === 'SENT' ? 'EMAIL' : 'FAILED';
  } catch (e) {
    console.error('[line-notify] notifyProductOrderReceipt 失敗', tenantId, orderId, e);
    return 'FAILED';
  }
}
