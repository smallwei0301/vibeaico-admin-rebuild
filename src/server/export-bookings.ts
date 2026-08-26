/**
 * 預約列表匯出的 CSV 產生器（issue #33 第 ③ 筆）。
 *
 * 為什麼抽出來：`/api/export/bookings`（無 format 段，先有的）與
 * `/api/export/bookings/:format`（原站的形狀，本輪補的）產出的必須是**同一份
 * 檔案**。兩支各寫一份 CSV 組裝就是同一件事兩份實作——短期一樣、長期分岔，
 * 而分岔那天不會有測試會紅。
 *
 * 慣例同其他 /api/export/*：**不走 { success, data } 信封**，直接回檔案；
 * Content-Type: text/csv; charset=utf-8；Content-Disposition: attachment；
 * Cache-Control: no-store。檔名是呼叫端唯一的檔名來源（前端不得自組）。
 */
import { z } from 'zod';
import { taipeiTodayDateString } from '@/server/tz';
import { common } from '@/i18n/zh-TW/common';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const bookingsExportQuerySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

/**
 * 原站 reports 匯出的兩個選項（14 分冊 §8.5 擁有者裁決「CSV 與 Excel 兩者都做」）。
 * **兩者產出的都是 CSV**（UTF-8 加 BOM，Excel 開啟中文不亂碼），檔名副檔名也
 * 都是 .csv —— 專案沒有裝任何 xlsx 產生器，把 CSV 命名成 .xlsx 就是謊報檔案
 * 格式（CLAUDE.md「Never fabricate a known」）。理由與寫法逐字對齊
 * src/app/api/export/reports/[format]/route.ts 與 export/inventory/[format]。
 */
export const BOOKINGS_EXPORT_FORMATS = new Set(['csv', 'excel']);

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

type SupabaseLike = { from: (table: string) => any };

/**
 * 欄位 = 預約列表頁（src/app/tenant/bookings/page.tsx）的顯示欄：
 *   預約編號 / 日期時間 / 顧客(姓名+電話) / 服務 / 員工 / 金額 / 狀態
 *   —— CSV 攤平成 8 欄；狀態文案沿用 common.bookingStatus（與頁面 Badge 同字）。
 * 資料源 bookings_view（0007：已 join 出 customer_name/customer_phone/
 * service_name/staff_name）。?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，
 * 含 to 當天），缺省 = 全部匯出。店家量級小：一次查回（不分頁）。
 */
export async function buildBookingsCsv(
  t: { supabase: SupabaseLike; tenantId: string },
  q: { from?: string; to?: string },
): Promise<string> {
  let query = t.supabase.from('bookings_view')
    .select('booking_no, start_at, customer_name, customer_phone, service_name, staff_name, final_price, status')
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: false });
  if (q.from) query = query.gte('start_at', taipeiDayIso(q.from));
  if (q.to) query = query.lt('start_at', taipeiDayIso(q.to, 1));

  const { data: rows, error } = await query;
  if (error) throw error;

  const lines = [HEADERS.map(csvCell).join(',')];
  for (const b of (rows ?? []) as Array<Record<string, any>>) {
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

  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // \uFEFF = UTF-8 BOM
}

/** 檔案回應（不走 { success, data } 信封）。檔名由後端決定。 */
export function bookingsCsvResponse(csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bookings-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
