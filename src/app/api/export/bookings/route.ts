// GET /api/export/bookings?from&to — 預約列表匯出（04 分冊 §B-6）。
// 產 CSV：UTF-8 加 BOM（Excel 開啟中文才不會亂碼），Content-Disposition:
// attachment，**不走 { success, data } 信封**，直接回檔案。
//
// 欄位 = 預約列表頁（src/app/tenant/bookings/page.tsx）的顯示欄：
//   預約編號 / 日期時間 / 顧客(姓名+電話) / 服務 / 員工 / 金額 / 狀態
//   —— CSV 攤平成 8 欄；狀態文案沿用 common.bookingStatus（與頁面 Badge 同字）。
// 資料源 bookings_view（0007：已 join 出 customer_name/customer_phone/
// service_name/staff_name）。?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，
// 含 to 當天），缺省 = 全部匯出。店家量級小：一次查回（不分頁）。
import { z } from 'zod';
import { handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiTodayDateString } from '@/server/tz';
import { common } from '@/i18n/zh-TW/common';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

function taipeiDayIso(ymd: string, offsetDays = 0): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS).toISOString();
}

/** timestamptz → 台北牆上時鐘 'YYYY-MM-DD HH:mm' */
function taipeiDateTime(iso: string): string {
  const t = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
    + ` ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/** CSV 跳脫：含逗號/引號/換行時包雙引號，內部引號雙寫 */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = ['預約編號', '預約時間', '顧客姓名', '顧客電話', '服務', '員工', '金額', '狀態'];

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  let query = t.supabase.from('bookings_view')
    .select('booking_no, start_at, customer_name, customer_phone, service_name, staff_name, final_price, status')
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: false });
  if (q.from) query = query.gte('start_at', taipeiDayIso(q.from));
  if (q.to) query = query.lt('start_at', taipeiDayIso(q.to, 1));

  const { data: rows, error } = await query;
  if (error) throw error;

  const lines = [HEADERS.map(csvCell).join(',')];
  for (const b of rows ?? []) {
    lines.push([
      csvCell(b.booking_no),
      csvCell(taipeiDateTime(b.start_at)),
      csvCell(b.customer_name),
      csvCell(b.customer_phone),
      csvCell(b.service_name),
      csvCell(b.staff_name),
      csvCell(Number(b.final_price)),
      csvCell(common.bookingStatus[b.status as keyof typeof common.bookingStatus] ?? b.status),
    ].join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'; // \uFEFF = UTF-8 BOM
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bookings-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
