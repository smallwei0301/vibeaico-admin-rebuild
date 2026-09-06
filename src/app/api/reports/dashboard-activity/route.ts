// GET /api/reports/dashboard-activity — dashboard 頁「最近活動」清單。
// 回應形狀對齊 dashboard 頁 mock 的 `RecentActivity[]`
// （src/app/tenant/dashboard/page.tsx）：{ id, type, name, target, at }[]，
// 依 at 由新到舊排序，取前 LIMIT 筆。
//
// ⚠️ 誠實口徑（無稽核 log，見 docs/DELIVERY-CHAIN.md §5「誠實復原」）：
// 本專案沒有獨立的操作稽核記錄表，因此沒有任何一張表能回答「這筆預約是什麼
// 時候被標記完成／取消的」。這裡用 bookings.updated_at 近似——只要一筆預約的
// 目前狀態是 COMPLETED／CANCELLED，就把它的 updated_at 當成「變成該狀態的
// 時間」顯示為 BOOKING_COMPLETED／BOOKING_CANCELLED 活動。這是「最後更新時間」
// 不是真正的狀態轉換時間戳；例如一筆已完成的預約之後又被改了備註，
// updated_at 會往後跳，活動時間會跟著不準。沒有更好的資料來源之前這是唯一
// 誠實可行的近似值，如需精確歷史應由 Owner 決定是否新增稽核表（待決事項）。
//
// 來源（四種活動類型，各自取最近 LIMIT 筆再合併排序）：
//   - bookings.created_at        → BOOKING_CREATED   (name=customer, target=service)
//   - bookings.updated_at        → BOOKING_COMPLETED / BOOKING_CANCELLED
//                                   （status 為 COMPLETED / CANCELLED 才計入；見上方誠實口徑）
//   - customers.created_at       → CUSTOMER_CREATED  (name=customer, target='')
//   - product_orders.created_at  → ORDER_CREATED     (name=customer, target='')
// 店家量級小：四張表各查最近 LIMIT 筆、Node 端合併排序即可，不寫 SQL union view。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const LIMIT = 10;

type ActivityType =
  | 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'BOOKING_COMPLETED'
  | 'CUSTOMER_CREATED' | 'ORDER_CREATED';

type DashboardActivity = { id: string; type: ActivityType; name: string; target: string; at: string };

export const GET = handle(async () => {
  const t = await requireTenant();

  const [
    { data: createdBookings, error: e1 },
    { data: settledBookings, error: e2 },
    { data: newCustomers, error: e3 },
    { data: newOrders, error: e4 },
  ] = await Promise.all([
    t.supabase.from('bookings_view')
      .select('id, customer_name, service_name, created_at')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false }).limit(LIMIT),
    t.supabase.from('bookings_view')
      .select('id, customer_name, service_name, status, updated_at')
      .eq('tenant_id', t.tenantId)
      .in('status', ['COMPLETED', 'CANCELLED'])
      .order('updated_at', { ascending: false }).limit(LIMIT),
    t.supabase.from('customers')
      .select('id, name, created_at')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false }).limit(LIMIT),
    t.supabase.from('product_orders')
      .select('id, created_at, customers(name)')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false }).limit(LIMIT),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;

  const items: DashboardActivity[] = [
    ...(createdBookings ?? []).map((b: any): DashboardActivity => ({
      id: `bc_${b.id}`, type: 'BOOKING_CREATED', name: b.customer_name, target: b.service_name, at: b.created_at,
    })),
    ...(settledBookings ?? []).map((b: any): DashboardActivity => ({
      id: `bs_${b.id}`,
      type: b.status === 'COMPLETED' ? 'BOOKING_COMPLETED' : 'BOOKING_CANCELLED',
      name: b.customer_name, target: b.service_name, at: b.updated_at,
    })),
    ...(newCustomers ?? []).map((c: any): DashboardActivity => ({
      id: `cc_${c.id}`, type: 'CUSTOMER_CREATED', name: c.name, target: '', at: c.created_at,
    })),
    ...(newOrders ?? []).map((o: any): DashboardActivity => ({
      id: `oc_${o.id}`, type: 'ORDER_CREATED', name: o.customers?.name ?? '', target: '', at: o.created_at,
    })),
  ];

  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return ok(items.slice(0, LIMIT));
});
