// GET /api/export/bookings/:format — issue #33 第 ③ 筆：原站的 jsApiCalls 是
// `/api/export/bookings/${format}`（docs/specs/bookings.json），我方原本只有
// 不帶 format 段的版本。本檔補上該段。
//
// 格式白名單與 src/app/api/export/inventory/[format]/route.ts 一致：**只有
// csv**，其餘一律 400。
//
// ⚠️ 為什麼不做 excel 分支：本專案沒有安裝任何 xlsx 產生器，把一份 CSV 命名成
// .xlsx 只是**謊報檔案格式**——使用者會拿到一個副檔名說是 Excel、內容卻是 CSV
// 的檔案，Excel 開啟時會跳出「格式與副檔名不符」的警告。這與 inventory 匯出
// 當初的處置相同，也符合 CLAUDE.md「成功訊息是一項事實主張」。
// 要真的支援 excel，需要先引入 xlsx 相依套件，那是獨立的一筆工作。
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { bookingExportQuerySchema, buildBookingsCsvResponse } from '@/server/export-bookings';

const SUPPORTED_FORMATS = ['csv'] as const;

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { format } = await params;
  if (!(SUPPORTED_FORMATS as readonly string[]).includes(format)) {
    throw new ApiHttpError(400, '目前僅支援 CSV 匯出', ERR.VALIDATION);
  }
  const q = bookingExportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return buildBookingsCsvResponse(t.supabase, t.tenantId, q);
});
