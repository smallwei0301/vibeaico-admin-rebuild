// GET /api/export/reports/:format?from&to — 營運報表匯出（04 分冊 §B-6）。
// csv / excel 兩個 UI 選項都產生 UTF-8 CSV；不把 CSV 假命名成 .xlsx。
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiMonthRange, taipeiTodayDateString } from '@/server/tz';
import {
  csvRow as row,
  REPORT_DAY_MS as DAY_MS,
  reportExportQuerySchema as querySchema,
  TAIPEI_OFFSET_MS,
  taipeiDate,
  taipeiDayMs,
  taipeiLabel,
} from '@/server/report-export';

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'BASIC_REPORT');

  const { format } = await params;
  if (format !== 'csv' && format !== 'excel') {
    throw new ApiHttpError(400, '不支援的匯出格式', ERR.VALIDATION);
  }

  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromMs = q.from ? taipeiDayMs(q.from) : Date.parse(month.fromIso);
  const toMs = q.to ? taipeiDayMs(q.to, 1) : Date.parse(month.toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    throw new ApiHttpError(400, '報表日期區間錯誤', ERR.VALIDATION);
  }
  if (toMs - fromMs > 366 * DAY_MS) {
    throw new ApiHttpError(400, '報表日期區間不可超過 366 天', ERR.VALIDATION);
  }
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  const [{ data: bookingRows, error: bookingError }, { count: newCustomers, error: customerError },
    { data: itemRows, error: itemError }] = await Promise.all([
    t.supabase.from('bookings_view')
      .select('start_at, status, final_price, service_id, service_name')
      .eq('tenant_id', t.tenantId).gte('start_at', fromIso).lt('start_at', toIso),
    t.supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('active', true)
      .gte('created_at', fromIso).lt('created_at', toIso),
    t.supabase.from('product_order_items')
      .select('product_id, product_name, quantity, price, product_orders!inner(status, created_at)')
      .eq('tenant_id', t.tenantId)
      .eq('product_orders.status', 'COMPLETED')
      .gte('product_orders.created_at', fromIso)
      .lt('product_orders.created_at', toIso),
  ]);
  if (bookingError) throw bookingError;
  if (customerError) throw customerError;
  if (itemError) throw itemError;

  const bookings = bookingRows ?? [];
  let totalRevenue = 0;
  let completedBookings = 0;
  for (const booking of bookings) {
    if (booking.status === 'COMPLETED') {
      completedBookings += 1;
      totalRevenue += Number(booking.final_price);
    }
  }

  const days: { label: string; bookings: number; revenue: number }[] = [];
  for (let ms = fromMs; ms < toMs; ms += DAY_MS) {
    days.push({ label: taipeiLabel(ms), bookings: 0, revenue: 0 });
  }
  const hourlyCounts = new Array<number>(24).fill(0);
  const serviceMap = new Map<string, { name: string; bookings: number; revenue: number }>();
  for (const booking of bookings) {
    const startMs = Date.parse(booking.start_at);
    const day = days[Math.floor((startMs - fromMs) / DAY_MS)];
    if (day) {
      day.bookings += 1;
      if (booking.status === 'COMPLETED') day.revenue += Number(booking.final_price);
    }
    hourlyCounts[new Date(startMs + TAIPEI_OFFSET_MS).getUTCHours()] += 1;
    const current = serviceMap.get(booking.service_id) ?? {
      name: booking.service_name, bookings: 0, revenue: 0,
    };
    current.bookings += 1;
    if (booking.status === 'COMPLETED') current.revenue += Number(booking.final_price);
    serviceMap.set(booking.service_id, current);
  }
  const topServices = [...serviceMap.values()]
    .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
    .slice(0, 5);

  const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const item of itemRows ?? []) {
    const current = productMap.get(item.product_id) ?? {
      name: item.product_name, quantity: 0, revenue: 0,
    };
    current.quantity += item.quantity;
    current.revenue += item.quantity * Number(item.price);
    productMap.set(item.product_id, current);
  }
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 10);

  const lines: string[] = [
    row('營運報表'),
    row('統計區間', `${taipeiDate(fromMs)} ~ ${taipeiDate(toMs - DAY_MS)}`),
    '',
    row('營運總覽'),
    row('項目', '數值'),
    row('總預約數', bookings.length),
    row('總營收', totalRevenue),
    row('已完成預約', completedBookings),
    row('新客戶', newCustomers ?? 0),
    '',
    row('每日趨勢'),
    row('日期', '預約數', '營收'),
    ...days.map((d) => row(d.label, d.bookings, d.revenue)),
    '',
    row('預約時段分布'),
    row('時段', '預約數', '尖峰'),
  ];

  const firstHour = hourlyCounts.findIndex((count) => count > 0);
  if (firstHour === -1) {
    lines.push(row('（此區間無預約）'));
  } else {
    let lastHour = hourlyCounts.length - 1;
    while (hourlyCounts[lastHour] === 0) lastHour -= 1;
    const peak = Math.max(...hourlyCounts);
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      lines.push(row(`${String(hour).padStart(2, '0')}:00`, hourlyCounts[hour], hourlyCounts[hour] === peak ? '尖峰' : ''));
    }
  }
  lines.push('', row('熱門服務 TOP 5'), row('排名', '服務名稱', '預約數', '營收'));
  topServices.forEach((service, index) => lines.push(row(index + 1, service.name, service.bookings, service.revenue)));
  lines.push('', row('熱門商品 TOP 10'), row('排名', '商品名稱', '銷售數量', '營收'));
  topProducts.forEach((product, index) => lines.push(row(index + 1, product.name, product.quantity, product.revenue)));

  const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reports-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
