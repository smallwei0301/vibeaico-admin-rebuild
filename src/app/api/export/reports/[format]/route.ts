// GET /api/export/reports/:format?from&to — 營運報表匯出。
//
// Retained source: claude/deploy-vercel-project-nnno59 的 issue #15 實作。
// 該實作修的是同一個缺陷：reports 頁的 Excel 曾下載顧客名單、CSV 曾下載預約列表，
// 但 UI 卻宣稱是「營運報表」。本檔復原同一份五區塊資料口徑，並把歷史的
// excel=CSV 升級為 issue #246 已引進的真 xlsx。
//
// CSV 與 xlsx 共用同一份 reportRows，避免兩種格式日後各自漂移。
import { z } from 'zod';
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiMonthRange, taipeiTodayDateString } from '@/server/tz';
import { csvCell } from '@/server/export-bookings';
import { buildXlsx, xlsxResponse, type XlsxCell } from '@/server/xlsx';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

const ALLOWED_FORMATS = new Set(['csv', 'excel']);

type ReportRow = XlsxCell[];

function taipeiDayMs(ymd: string, offsetDays = 0): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS;
}

function taipeiLabel(ms: number): string {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  return `${String(t.getUTCMonth() + 1).padStart(2, '0')}/${String(t.getUTCDate()).padStart(2, '0')}`;
}

function taipeiYmd(ms: number): string {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'BASIC_REPORT');

  const { format } = await params;
  if (!ALLOWED_FORMATS.has(format)) {
    throw new ApiHttpError(400, '不支援的匯出格式', ERR.VALIDATION);
  }

  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromMs = q.from ? taipeiDayMs(q.from) : Date.parse(month.fromIso);
  const toMs = q.to ? taipeiDayMs(q.to, 1) : Date.parse(month.toIso);
  if (fromMs >= toMs) {
    throw new ApiHttpError(400, '統計區間不正確', ERR.VALIDATION);
  }

  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  const [
    { data: bookingRows, error: bookingError },
    { count: newCustomers, error: customerError },
    { data: itemRows, error: itemError },
  ] = await Promise.all([
    t.supabase
      .from('bookings_view')
      .select('start_at, status, final_price, service_id, service_name')
      .eq('tenant_id', t.tenantId)
      .gte('start_at', fromIso)
      .lt('start_at', toIso),
    t.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId)
      .eq('active', true)
      .gte('created_at', fromIso)
      .lt('created_at', toIso),
    t.supabase
      .from('product_order_items')
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

  const hourCounts = new Array<number>(24).fill(0);
  const byService = new Map<string, { name: string; bookings: number; revenue: number }>();

  for (const booking of bookings) {
    const startMs = Date.parse(booking.start_at);
    const bucket = days[Math.floor((startMs - fromMs) / DAY_MS)];
    if (bucket) {
      bucket.bookings += 1;
      if (booking.status === 'COMPLETED') bucket.revenue += Number(booking.final_price);
    }
    hourCounts[new Date(startMs + TAIPEI_OFFSET_MS).getUTCHours()] += 1;

    const serviceId = String(booking.service_id);
    let aggregate = byService.get(serviceId);
    if (!aggregate) {
      aggregate = { name: booking.service_name, bookings: 0, revenue: 0 };
      byService.set(serviceId, aggregate);
    }
    aggregate.bookings += 1;
    if (booking.status === 'COMPLETED') aggregate.revenue += Number(booking.final_price);
  }

  const topServices = [...byService.values()]
    .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
    .slice(0, 5);

  const byProduct = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const item of itemRows ?? []) {
    const productId = String(item.product_id);
    let aggregate = byProduct.get(productId);
    if (!aggregate) {
      aggregate = { name: item.product_name, quantity: 0, revenue: 0 };
      byProduct.set(productId, aggregate);
    }
    aggregate.quantity += item.quantity;
    aggregate.revenue += item.quantity * Number(item.price);
  }
  const topProducts = [...byProduct.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 10);

  const reportRows: ReportRow[] = [];
  reportRows.push(['統計區間', `${taipeiYmd(fromMs)} ~ ${taipeiYmd(toMs - DAY_MS)}`]);
  reportRows.push([]);

  reportRows.push(['營運總覽']);
  reportRows.push(['項目', '數值']);
  reportRows.push(['總預約數', bookings.length]);
  reportRows.push(['總營收', totalRevenue]);
  reportRows.push(['已完成預約', completedBookings]);
  reportRows.push(['新客戶', newCustomers ?? 0]);
  reportRows.push([]);

  reportRows.push(['每日趨勢']);
  reportRows.push(['日期', '預約數', '營收']);
  for (const day of days) reportRows.push([day.label, day.bookings, day.revenue]);
  reportRows.push([]);

  reportRows.push(['預約時段分布']);
  reportRows.push(['時段', '預約數', '尖峰']);
  const firstHour = hourCounts.findIndex((count) => count > 0);
  if (firstHour === -1) {
    reportRows.push(['（此區間無預約）']);
  } else {
    let lastHour = 23;
    while (hourCounts[lastHour] === 0) lastHour -= 1;
    const peak = Math.max(...hourCounts);
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      reportRows.push([
        `${String(hour).padStart(2, '0')}:00`,
        hourCounts[hour],
        hourCounts[hour] === peak ? '尖峰' : '',
      ]);
    }
  }
  reportRows.push([]);

  reportRows.push(['熱門服務 TOP 5']);
  reportRows.push(['排名', '服務名稱', '預約數', '營收']);
  topServices.forEach((service, index) => {
    reportRows.push([index + 1, service.name, service.bookings, service.revenue]);
  });
  reportRows.push([]);

  reportRows.push(['熱門商品 TOP 10']);
  reportRows.push(['排名', '商品名稱', '銷售數量', '營收']);
  topProducts.forEach((product, index) => {
    reportRows.push([index + 1, product.name, product.quantity, product.revenue]);
  });

  const today = taipeiTodayDateString();
  if (format === 'excel') {
    const xlsx = await buildXlsx('營運報表', ['營運報表', '', '', ''], reportRows);
    return xlsxResponse(`reports-${today}.xlsx`, xlsx);
  }

  const lines = [
    ['營運報表'],
    ...reportRows,
  ].map((cells) => cells.map(csvCell).join(','));
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reports-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
