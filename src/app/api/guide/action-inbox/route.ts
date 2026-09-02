import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  getGuideActionInboxPriority,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';

/**
 * GUIDE 首頁第一個可出貨的 action inbox 類別：待確認預約。
 * 只讀既有 bookings_view 與 tenant timezone，不建立新狀態，也不觸發通知、付款或其他外部副作用。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const [bookingResult, settingsResult] = await Promise.all([
    t.supabase
      .from('bookings_view')
      .select('id, booking_no, customer_name, service_name, start_at, created_at')
      .eq('tenant_id', t.tenantId)
      .eq('status', 'PENDING')
      .order('start_at', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(20),
    t.supabase
      .from('tenant_settings')
      .select('basic')
      .eq('tenant_id', t.tenantId)
      .maybeSingle(),
  ]);

  if (bookingResult.error) throw bookingResult.error;
  if (settingsResult.error) throw settingsResult.error;

  const basic = settingsResult.data?.basic;
  const rawTimeZone = basic && typeof basic === 'object' && !Array.isArray(basic)
    ? (basic as Record<string, unknown>).timezone
    : undefined;
  const timeZone = normalizeGuideTimeZone(rawTimeZone);
  const now = new Date();

  const items: GuideActionInboxItem[] = (bookingResult.data ?? []).map((row) => ({
    id: row.id,
    kind: 'BOOKING_REQUEST',
    bookingNo: row.booking_no,
    customerName: row.customer_name ?? '',
    serviceName: row.service_name ?? '',
    priority: getGuideActionInboxPriority(row.start_at, now, timeZone),
    dueAt: row.start_at,
    createdAt: row.created_at,
    href: '/tenant/bookings?status=PENDING',
  }));

  return ok(sortGuideActionInboxItems(items));
});
