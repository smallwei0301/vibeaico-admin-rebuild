/**
 * src/server/email/tour-order-email.ts — 導遊處理團體訂單後通知旅客（#954）；旅客送出預約／申請的確認信（#957）
 * -----------------------------------------------------------------------------
 * 由 accept／reject／confirm-payment 三支路由在狀態變更成功後以 `after()` 呼叫。
 * 只在 `tour_orders.contact.email` 有值時寄；整體吞錯只 log，絕不丟進路由。
 * 不經付費通知閘（基本交易通知 Email 免費，17-NOTIFICATION-DELIVERY.md）。
 *
 * 狀態頁連結：`/s/{shopCode}/requests/{orderId}?contact=<email>`。狀態頁以
 * phone／line／email 任一欄位（trim、不分大小寫）比對 `contact`，因此帶旅客
 * 自己的 email 必定開得起來（public-tour-request.ts loadPublicTourRequestStatus）。
 */
import { after } from 'next/server';
import { APP_URL } from '@/config/env';
import { createAdminSupabase } from '@/server/supabase';
import { hydrateTourOrders } from '@/server/tour-orders';
import { resolvePublicTimeZone } from '@/lib/public-time-zone';
import { formatInstantInTimeZone, travelerVisibleRejectReason } from '@/lib/public-order-format';
import { checkRateLimit, peekRateLimit } from '@/server/rate-limit';
import { sendTourOrderStatusEmail } from './send';
import type { TourOrderStatusEmailKind } from './templates';

/** 重讀後的訂單是否仍符合該通知的情境（接受後為 CONFIRMED＋UNPAID；收訂金為 CONFIRMED＋PARTIAL；收款為 PAID）。 */
function isStillCurrent(kind: TourOrderStatusEmailKind, row: Record<string, unknown>): boolean {
  switch (kind) {
    case 'ACCEPTED': return row.status === 'CONFIRMED' && row.payment_status === 'UNPAID';
    case 'DEPOSIT_RECEIVED': return row.status === 'CONFIRMED' && row.payment_status === 'PARTIAL';
    case 'PAID': return row.status !== 'CANCELLED' && row.payment_status === 'PAID';
    default: return true;
  }
}

export async function notifyTravelerTourOrderStatus(
  tenantId: string, orderId: string, kind: TourOrderStatusEmailKind,
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { data: row, error } = await admin.from('tour_orders').select('*')
      .eq('tenant_id', tenantId).eq('id', orderId).maybeSingle();
    if (error) throw error;
    if (!row) return;
    // after() 時才重讀：若狀態在回應後又變動（導遊連點、訂單取消），原通知內容已過時，直接略過。
    if (!isStillCurrent(kind, row as Record<string, unknown>)) {
      console.info('[tour-order-email] 訂單狀態已變動，略過過時通知', kind, orderId);
      return;
    }
    const contact = (row.contact ?? {}) as Record<string, unknown>;
    const email = typeof contact.email === 'string' ? contact.email.trim() : '';
    if (!email) return;

    const { data: tenant, error: tErr } = await admin.from('tenants')
      .select('name, shop_code, tenant_settings(basic)').eq('id', tenantId).maybeSingle();
    if (tErr) throw tErr;
    if (!tenant) return;
    const raw = (tenant as Record<string, unknown>).tenant_settings;
    const settings = (Array.isArray(raw) ? raw[0] : raw) as { basic?: Record<string, unknown> } | null | undefined;
    const shopName = String(settings?.basic?.tenantName || tenant.name || '').trim();
    const timeZone = resolvePublicTimeZone(settings?.basic?.timezone);

    const [order] = await hydrateTourOrders(admin, tenantId, [row]);
    if (!order) return;

    const money = (n: unknown): number | null => {
      const v = typeof n === 'string' && n.trim() === '' ? NaN : Number(n);
      return n == null || !Number.isFinite(v) ? null : v;
    };
    const fmt = (n: number) => `NT$ ${n.toLocaleString('en-US')}`;
    const paidN = kind === 'DEPOSIT_RECEIVED' ? money((row as Record<string, unknown>).paid_amount) : null;
    const totalN = kind === 'DEPOSIT_RECEIVED' ? money(order.totalAmount) : null;
    const balanceN = paidN != null && totalN != null ? totalN - paidN : null;

    const statusUrl = tenant.shop_code
      ? `${APP_URL}/s/${encodeURIComponent(String(tenant.shop_code))}/requests/${encodeURIComponent(orderId)}?contact=${encodeURIComponent(email)}`
      : `${APP_URL}`;
    const result = await sendTourOrderStatusEmail(email, kind, {
      shopName,
      orderNo: order.orderNo,
      tripTitle: order.tripTitle,
      planName: order.planName,
      departsOn: order.departsOn,
      deadlineText: kind === 'ACCEPTED' && order.holdExpiresAt
        ? formatInstantInTimeZone(order.holdExpiresAt, timeZone) : null,
      totalText: kind === 'SUBMITTED_BOOKING' && Number.isFinite(order.totalAmount)
        ? `NT$ ${Number(order.totalAmount).toLocaleString('en-US')}` : null,
      paidText: paidN != null ? fmt(paidN) : null,
      balanceText: balanceN != null && balanceN > 0 ? fmt(balanceN) : null,
      rejectReason: kind === 'REJECTED' ? travelerVisibleRejectReason(order) : null,
      statusUrl,
    });
    console.info('[tour-order-email]', kind, orderId, result);
  } catch (e) {
    console.error('[tour-order-email] 寄送旅客通知失敗', kind, orderId, e);
  }
}

/**
 * 路由用：回應送出後以 `after()` 派送；永不丟進路由。`after()` 在 request scope
 * 之外（例如單元測試）會丟錯，此時退回 fire-and-forget（notify 本身已吞錯）。
 */
export function scheduleTravelerTourOrderNotice(
  tenantId: string, orderId: string, kind: TourOrderStatusEmailKind,
): void {
  try {
    after(() => notifyTravelerTourOrderStatus(tenantId, orderId, kind));
  } catch {
    void notifyTravelerTourOrderStatus(tenantId, orderId, kind);
  }
}

const CONFIRM_WINDOW_MS = 60 * 60 * 1000;
const CONFIRM_PER_EMAIL_MAX = 3;
const CONFIRM_PER_IP_MAX = 10;

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at <= 0 ? '***' : `${email[0]}***${email.slice(at)}`;
}

/**
 * 旅客確認信節流（#957 審查）：公開建單端點匿名可填任意 email，若不節流，攻擊者可反覆
 * 建 REQUEST 單（不鎖位）讓平台對受害者持續寄信，損害共用寄件網域信譽。
 * 兩道只影響「寄信」、不影響建單與 201：
 *   - 同來源對同收件人：`traveler-confirm:<ip>:<trim+lowercase email>` 每小時 3 封
 *   - 同 IP 跨店：`traveler-confirm-ip:<ip>` 每小時 10 封
 * 先 peek 兩道，都過才一起扣額度（被收件人擋下不消耗 IP 額度）。
 * 取捨：刻意「不提供」全域收件人上限。全域上限會讓匿名者只要知道受害者 email，
 * 就能用任一 IP 耗盡額度，使受害者之後的真實預約被靜默略過確認信（對合法通知的 DoS）。
 * 綁定來源後，攻擊者只能耗盡自己 IP 的額度；跨 IP 分散轟炸仍受每 IP 10 封限制。
 * 誠實限制同 rate-limit.ts：單 process 記憶體、盡力而為；持久化節流隨 outbox 由 #945 處理。
 * 沒有 email 時回傳 true（本來就不會寄，不佔額度）。
 */
export function allowTravelerConfirmEmail(email: string | null | undefined, ip: string): boolean {
  const addr = (email ?? '').trim().toLowerCase();
  if (!addr) return true;
  const emailKey = `traveler-confirm:${ip}:${addr}`;
  const ipKey = `traveler-confirm-ip:${ip}`;
  const emailOpt = { max: CONFIRM_PER_EMAIL_MAX, windowMs: CONFIRM_WINDOW_MS };
  const ipOpt = { max: CONFIRM_PER_IP_MAX, windowMs: CONFIRM_WINDOW_MS };
  if (!peekRateLimit(emailKey, emailOpt) || !peekRateLimit(ipKey, ipOpt)) {
    console.info('[tour-order-email] 旅客確認信節流，略過寄送', maskEmail(addr));
    return false;
  }
  checkRateLimit(emailKey, emailOpt);
  checkRateLimit(ipKey, ipOpt);
  return true;
}
