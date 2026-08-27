// GET /api/export/bookings?from&to — 預約列表匯出（04 分冊 §B-6）。
//
// 產檔的實作在 src/server/export-bookings.ts，與 /api/export/bookings/:format
// 共用（issue #33 ③：補 format 段時把 CSV 組裝抽成一份，避免兩支各寫一份）。
// 這一支保留是因為 issue #28 ③ 已把預約頁的匯出鈕接到它，接線點不動。
import { handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  bookingsCsvResponse, bookingsExportQuerySchema, buildBookingsCsv,
} from '@/server/export-bookings';

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = bookingsExportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return bookingsCsvResponse(await buildBookingsCsv(t, q));
});
