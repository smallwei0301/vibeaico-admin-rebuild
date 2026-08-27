// GET /api/export/reports/:format?from&to — 營運報表匯出（原站端點，見
// docs/specs/reports.json 的 jsApiCalls `/api/export/reports/${format}`）。
//
// 為什麼要有這一支（修復-7 / issue #15 第 ③ 項）：報表頁的「匯出」原本把
// Excel 選項導到 /api/export/customers/excel（顧客名單）、CSV 選項導到
// /api/export/bookings（預約列表），卻 toast「匯出成功：營運報表_日期.xlsx」——
// 檔名宣稱是報表，內容不是。本支匯出的就是**該頁畫面上的統計**。
//
// 內容 = reports 頁的五個區塊，與各自的 /api/reports/* 端點同一套口徑：
//   營運總覽（summary）／每日趨勢（daily）／預約時段分布（hourly）／
//   熱門服務 TOP 5（top-services）／熱門商品 TOP 10（top-products）
// 前四塊共用同一次 bookings_view 查詢，第五塊查 product_order_items。
//
// format：'csv' | 'excel'（原站的兩個匯出選項），其他值 400。
// **兩者產出的都是 CSV**（UTF-8 加 BOM，Excel 開啟中文不亂碼），檔名副檔名也
// 都是 .csv——專案沒有裝任何 xlsx 產生器，把 CSV 命名成 .xlsx 就是謊報檔案格式
// （CLAUDE.md「Never fabricate a known」）。路徑保留 excel 是為了對齊原站端點
// 命名，與 /api/export/customers/excel 的既有處理一致。
//
// 慣例同其他 /api/export/*：不走 { success, data } 信封，直接回檔案；
// Content-Disposition: attachment；Cache-Control: no-store。
// 區間 ?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，含 to 當天），
// 缺省預設本月（同各 /api/reports/* 端點）。
import { z } from 'zod';
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiMonthRange, taipeiTodayDateString } from '@/server/tz';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

/** 原站的兩個匯出選項；兩者內容都是 CSV（見檔頭） */
const ALLOWED_FORMATS = new Set(['csv', 'excel']);

function taipeiDayMs(ymd: string, offsetDays = 0): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS;
}

/** UTC 瞬間 → 台北牆上時鐘 'MM/DD'（同 /api/reports/daily 的 label） */
function taipeiLabel(ms: number): string {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  return `${String(t.getUTCMonth() + 1).padStart(2, '0')}/${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** UTC 瞬間 → 台北 'YYYY-MM-DD'（區間標示用） */
function taipeiYmd(ms: number): string {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** CSV 跳脫：含逗號/引號/換行時包雙引號，內部引號雙寫（同其他 /api/export/*） */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (...cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(',');

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'BASIC_REPORT');

  const { format } = await params;
  if (!ALLOWED_FORMATS.has(format))
    throw new ApiHttpError(400, '不支援的匯出格式', ERR.VALIDATION);

  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromMs = q.from ? taipeiDayMs(q.from) : Date.parse(month.fromIso);
  const toMs = q.to ? taipeiDayMs(q.to, 1) : Date.parse(month.toIso);
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  // 預約側：summary / daily / hourly / top-services 共用這一次查詢
  const [{ data: bookingRows, error: e1 }, { count: newCustomers, error: e2 },
    { data: itemRows, error: e3 }] = await Promise.all([
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
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const bookings = bookingRows ?? [];

  /* --- 營運總覽（同 /api/reports/summary 口徑：營收只算 COMPLETED） --- */
  let totalRevenue = 0;
  let completedBookings = 0;
  for (const b of bookings) {
    if (b.status === 'COMPLETED') {
      completedBookings += 1;
      totalRevenue += Number(b.final_price);
    }
  }

  /* --- 每日趨勢（同 /api/reports/daily：逐日補 0） --- */
  const days: { label: string; bookings: number; revenue: number }[] = [];
  for (let ms = fromMs; ms < toMs; ms += DAY_MS) {
    days.push({ label: taipeiLabel(ms), bookings: 0, revenue: 0 });
  }
  /* --- 時段分布（同 /api/reports/hourly：台北牆上時鐘小時，不分狀態） --- */
  const hourCounts = new Array<number>(24).fill(0);
  /* --- 熱門服務（同 /api/reports/top-services） --- */
  const byService = new Map<string, { name: string; bookings: number; revenue: number }>();

  for (const b of bookings) {
    const startMs = Date.parse(b.start_at);
    const bucket = days[Math.floor((startMs - fromMs) / DAY_MS)];
    if (bucket) {
      bucket.bookings += 1;
      if (b.status === 'COMPLETED') bucket.revenue += Number(b.final_price);
    }
    hourCounts[new Date(startMs + TAIPEI_OFFSET_MS).getUTCHours()] += 1;

    let agg = byService.get(b.service_id);
    if (!agg) {
      agg = { name: b.service_name, bookings: 0, revenue: 0 };
      byService.set(b.service_id, agg);
    }
    agg.bookings += 1;
    if (b.status === 'COMPLETED') agg.revenue += Number(b.final_price);
  }

  const topServices = [...byService.values()]
    .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
    .slice(0, 5);

  /* --- 熱門商品（同 /api/reports/top-products） --- */
  const byProduct = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const it of itemRows ?? []) {
    let agg = byProduct.get(it.product_id);
    if (!agg) {
      agg = { name: it.product_name, quantity: 0, revenue: 0 };
      byProduct.set(it.product_id, agg);
    }
    agg.quantity += it.quantity;
    agg.revenue += it.quantity * Number(it.price);
  }
  const topProducts = [...byProduct.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 10);

  /* ------------------------------------------------------------- 組 CSV */
  const lines: string[] = [];
  lines.push(row('營運報表'));
  lines.push(row('統計區間', `${taipeiYmd(fromMs)} ~ ${taipeiYmd(toMs - DAY_MS)}`));
  lines.push('');

  lines.push(row('營運總覽'));
  lines.push(row('項目', '數值'));
  lines.push(row('總預約數', bookings.length));
  lines.push(row('總營收', totalRevenue));
  lines.push(row('已完成預約', completedBookings));
  lines.push(row('新客戶', newCustomers ?? 0));
  lines.push('');

  lines.push(row('每日趨勢'));
  lines.push(row('日期', '預約數', '營收'));
  for (const d of days) lines.push(row(d.label, d.bookings, d.revenue));
  lines.push('');

  lines.push(row('預約時段分布'));
  lines.push(row('時段', '預約數', '尖峰'));
  const firstHour = hourCounts.findIndex((c) => c > 0);
  if (firstHour === -1) {
    // 區間內完全沒有預約：留白比補一排 0 誠實（頁面同樣顯示 EmptyState）
    lines.push(row('（此區間無預約）'));
  } else {
    let lastHour = 23;
    while (hourCounts[lastHour] === 0) lastHour -= 1;
    const peak = Math.max(...hourCounts);
    for (let h = firstHour; h <= lastHour; h += 1) {
      lines.push(row(`${String(h).padStart(2, '0')}:00`, hourCounts[h], hourCounts[h] === peak ? '尖峰' : ''));
    }
  }
  lines.push('');

  lines.push(row('熱門服務 TOP 5'));
  lines.push(row('排名', '服務名稱', '預約數', '營收'));
  topServices.forEach((s, i) => lines.push(row(i + 1, s.name, s.bookings, s.revenue)));
  lines.push('');

  lines.push(row('熱門商品 TOP 10'));
  lines.push(row('排名', '商品名稱', '銷售數量', '營收'));
  topProducts.forEach((p, i) => lines.push(row(i + 1, p.name, p.quantity, p.revenue)));

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'; // \uFEFF = UTF-8 BOM
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reports-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
