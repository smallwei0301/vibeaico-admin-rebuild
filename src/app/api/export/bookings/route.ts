// GET /api/export/bookings?from&to — 預約列表匯出（04 分冊 §B-6），無 format 段。
// 實作在 src/server/export-bookings.ts，與 /api/export/bookings/:format 共用同一份。
import { handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { bookingExportQuerySchema, buildBookingsCsvResponse } from '@/server/export-bookings';

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = bookingExportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return buildBookingsCsvResponse(t.supabase, t.tenantId, q);
});
