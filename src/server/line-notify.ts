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
import { ApiHttpError, ERR } from './http';

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

/* ====================================================================== ④
 * 預約加購「消費明細」通知（issue #17）
 *
 * 與 ③ 商品訂單的差異：加購沒有 Email fallback——原站 addonModal 的勾選框文案
 * 只講 LINE（「通知顧客消費明細」），沒有「未綁 LINE 改寄 Email」這句，改動範圍
 * 之外不擅自加一條新的送達管道。未綁 LINE 時維持 0082 已收斂的 `notified='NO_LINE'`
 * 語意，畫面上告知店家「請自行告知顧客」（既有 i18n `messages.addonAddedNoLine`）。
 *
 * 回傳值直接對映 `booking_addons.notified`（0082 canonical 的 6 個值），呼叫端
 * （POST /api/bookings/:id/addons）原樣寫回同一欄，不再另外詮釋一次。
 *
 * #17／#40 分工：這裡只做「這一則現在能不能送、送不送得出去」的**同步**判斷與
 * 一次嘗試，不建重試佇列、不建第二套 outbox——那是 #40 canonical
 * （`docs/integration/17-NOTIFICATION-DELIVERY.md`）的範圍。`addonNotify=false`
 * 時呼叫端根本不會呼叫本函式，本函式因此永遠只在「有要求通知」時才執行一次嘗試，
 * 不會有零意圖卻仍發生的 provider request。
 */
export type BookingAddonNotifyOutcome =
  /** 顧客已綁 LINE → 已推播，扣 1 推播額度 */
  | 'LINE'
  /** 顧客未綁 LINE → 沒有 fallback 管道，畫面提醒店家自行告知 */
  | 'NO_LINE'
  /** 該店尚未設定 LINE Channel */
  | 'NOT_CONFIGURED'
  /** 已綁 LINE 但本月推播額度不足 */
  | 'QUOTA_EXCEEDED'
  /** 試著送了但沒送成（LINE 平台回錯、或查詢預約/顧客/店名時發生非預期錯誤） */
  | 'FAILED';

/** 加購消費明細的 LINE 純文字版（純函式，供單元測試直接驗內容） */
export function buildBookingAddonReceiptText(v: {
  shop: string;
  bookingNo: string;
  itemName: string;
  quantity: number;
  amount: number;
}): string {
  return [
    `【${v.shop}】消費明細更新 🧾`,
    `預約編號：${v.bookingNo}`,
    `・${v.itemName} ×${v.quantity}`,
    `本次加購金額：NT$ ${v.amount.toLocaleString()}`,
  ].join('\n');
}

/**
 * 依「該筆加購是否要求通知」送出一次消費明細推播。
 * 呼叫端只在 `notificationRequested=true` 時呼叫本函式；永不拋錯，任何非預期
 * 例外都轉成 'FAILED' 回傳，不影響已經成功寫入的加購（加購成功與通知結果分離，
 * 見 issue #17 §6「通知」裁示）。
 */
export async function notifyBookingAddonReceipt(
  tenantId: string,
  bookingId: string,
  item: { name: string; quantity: number; amount: number },
): Promise<BookingAddonNotifyOutcome> {
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
      console.error('[line-notify] 加購明細：推播額度不足', tenantId, bookingId);
      return 'QUOTA_EXCEEDED';
    }

    const text = buildBookingAddonReceiptText({
      shop: tenant?.name ?? '',
      bookingNo: String(b.booking_no ?? ''),
      itemName: item.name,
      quantity: item.quantity,
      amount: item.amount,
    });
    await linePush(token, customer.line_user_id, [{ type: 'text', text }]);
    return 'LINE';
  } catch (e) {
    console.error('[line-notify] notifyBookingAddonReceipt 失敗', tenantId, bookingId, e);
    return 'FAILED';
  }
}
