// 預約匯出的共用實作 —— /api/export/bookings（無 format 段，既有）與
// /api/export/bookings/:format（issue #33 第 ③ 筆）共用同一份，兩支不各寫一遍。
//
// 04 分冊 §B-6：產 CSV，UTF-8 加 BOM（Excel 開啟中文才不會亂碼），
// Content-Disposition: attachment，**不走 { success, data } 信封**，直接回檔案。
//
// 欄位 = 預約列表頁（src/app/tenant/bookings/page.tsx）的顯示欄：
//   預約編號 / 預約時間 / 顧客姓名 / 顧客電話 / 服務 / 員工 / 金額 / 狀態
// 狀態文案沿用 common.bookingStatus（與頁面 Badge 同字）。
// 資料源 bookings_view（0007：已 join 出 customer_name/customer_phone/
// service_name/staff_name）。?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，
// 含 to 當天），缺省 = 全部匯出。
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { taipeiTodayDateString } from '@/server/tz';
import { buildXlsx, xlsxResponse } from '@/server/xlsx';
import { common } from '@/i18n/zh-TW/common';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const bookingExportQuerySchema = z.object({
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

/**
 * CSV 跳脫 + 試算表公式防護。
 *
 * 顧客姓名、電話、服務名稱都可能來自顧客自己填的資料（LINE 預約流程），也就是
 * **攻擊者可控的字串**。以 `=` / `+` / `-` / `@` 開頭的儲存格會被 Excel 與
 * Google Sheets 當成公式求值，於是一個叫做 `=cmd|...` 的顧客可以讓店家一開啟
 * 匯出檔就執行外部內容。前面加一個單引號讓它一律以文字顯示。
 *
 * 這段防護原本只存在於 src/app/api/export/inventory/[format]/route.ts，
 * 預約匯出漏掉了；本輪補上（issue #33 ③ 順帶修）。數字欄位維持數字，不加引號。
 */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  const text = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(raw)
    ? `'${raw}`
    : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const BOOKING_EXPORT_HEADERS = [
  '預約編號', '預約時間', '顧客姓名', '顧客電話', '服務', '員工', '金額', '狀態',
] as const;

/**
 * 查一次、攤平一次，csv 與 xlsx 兩條路徑吃同一份結果。
 *
 * 刻意不在這裡做 CSV 跳脫：`csvCell()` 的公式防護（前置單引號）**只對 CSV 正確**。
 * xlsx 是結構化格式，`exceljs` 寫進去的字串就是字串、不會被當公式求值，硬加一個
 * 單引號反而會讓店家在 Excel 裡看到多出來的符號——那是把資料改壞，不是保護。
 * 這個分工與 `inventory/[format]` 的既有前例一致。
 */
async function fetchBookingCells(
  supabase: SupabaseClient,
  tenantId: string,
  q: z.infer<typeof bookingExportQuerySchema>,
): Promise<(string | number)[][]> {
  let query = supabase.from('bookings_view')
    .select('booking_no, start_at, customer_name, customer_phone, service_name, staff_name, final_price, status')
    .eq('tenant_id', tenantId)
    .order('start_at', { ascending: false });
  if (q.from) query = query.gte('start_at', taipeiDayIso(q.from));
  if (q.to) query = query.lt('start_at', taipeiDayIso(q.to, 1));

  const { data: rows, error } = await query;
  if (error) throw error;

  return (rows ?? []).map((b) => [
    b.booking_no,
    taipeiDateTime(b.start_at),
    b.customer_name,
    b.customer_phone,
    b.service_name,
    b.staff_name,
    Number(b.final_price),
    common.bookingStatus[b.status as keyof typeof common.bookingStatus] ?? b.status,
  ]);
}

export async function buildBookingsCsvResponse(
  supabase: SupabaseClient,
  tenantId: string,
  q: z.infer<typeof bookingExportQuerySchema>,
): Promise<Response> {
  const cells = await fetchBookingCells(supabase, tenantId, q);

  const lines = [BOOKING_EXPORT_HEADERS.map(csvCell).join(',')];
  for (const row of cells) lines.push(row.map(csvCell).join(','));

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'; // \uFEFF = UTF-8 BOM
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bookings-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * xlsx 分支（issue #33 第 ③ 筆的 excel 半邊）。
 *
 * 這一格原本標為「永久留白」，理由是「本專案沒有安裝任何 xlsx 產生器」。那個理由
 * 在 #246 之後就不成立了——`exceljs` 已安裝、`src/server/xlsx.ts` 已有共用產生器、
 * 顧客名單與報表匯出都已經出真的 Excel。留著只有預約匯出出不了，等於同一顆按鈕在
 * 不同頁面給出不一樣的能力。
 *
 * 但**原本那句判斷本身仍然有效**：把一份 CSV 命名成 `.xlsx` 是謊報檔案格式。
 * 所以這裡走 `buildXlsx()` 產真的活頁簿，不是改副檔名。
 */
export async function buildBookingsXlsxResponse(
  supabase: SupabaseClient,
  tenantId: string,
  q: z.infer<typeof bookingExportQuerySchema>,
): Promise<Response> {
  const cells = await fetchBookingCells(supabase, tenantId, q);
  return xlsxResponse(
    `bookings-${taipeiTodayDateString()}.xlsx`,
    await buildXlsx('預約清單', [...BOOKING_EXPORT_HEADERS], cells),
  );
}
