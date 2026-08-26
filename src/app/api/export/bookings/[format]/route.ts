// GET /api/export/bookings/:format?from&to — 預約列表匯出的格式段
//（issue #33 第 ③ 筆）。
//
// 原站出處：docs/specs/bookings.json 的 jsApiCalls `/api/export/bookings/${format}`。
// 我方原本只有 /api/export/bookings（無 format 段），本檔補上原站的形狀。
// 形狀與白名單逐字對齊已存在的 /api/export/reports/[format] 與
// /api/export/inventory/[format]：
//   - format 白名單 'csv' | 'excel'（14 分冊 §8.5 擁有者裁決「兩者都做」），
//     其他值 400 REQ_001。
//   - **兩者產出的都是 CSV**（見 src/server/export-bookings.ts 的說明：
//     專案沒有裝 xlsx 產生器，把 CSV 命名成 .xlsx 就是謊報檔案格式）。
//   - **不走 { success, data } 信封**，直接回檔案；CSV 帶 UTF-8 BOM；
//     Content-Disposition: attachment，檔名由後端決定（前端不得自組）。
//
// 內容與 /api/export/bookings 完全相同——兩支共用
// src/server/export-bookings.ts 的 buildBookingsCsv()，不是第二份實作。
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  BOOKINGS_EXPORT_FORMATS, bookingsCsvResponse, bookingsExportQuerySchema, buildBookingsCsv,
} from '@/server/export-bookings';

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();

  const { format } = await params;
  if (!BOOKINGS_EXPORT_FORMATS.has(format))
    throw new ApiHttpError(400, '不支援的匯出格式', ERR.VALIDATION);

  const q = bookingsExportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return bookingsCsvResponse(await buildBookingsCsv(t, q));
});
