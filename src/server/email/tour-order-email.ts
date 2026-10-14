/**
 * src/server/email/tour-order-email.ts — 導遊處理團體訂單後通知旅客（#954）
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
import { sendTourOrderStatusEmail } from './send';
import type { TourOrderStatusEmailKind } from './templates';

export async function notifyTravelerTourOrderStatus(
  tenantId: string, orderId: string, kind: TourOrderStatusEmailKind,
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { data: row, error } = await admin.from('tour_orders').select('*')
      .eq('tenant_id', tenantId).eq('id', orderId).maybeSingle();
    if (error) throw error;
    if (!row) return;
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
