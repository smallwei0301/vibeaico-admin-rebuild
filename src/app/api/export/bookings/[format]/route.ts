// GET /api/export/bookings/:format — issue #33 第 ③ 筆：原站的 jsApiCalls 是
// `/api/export/bookings/${format}`（docs/specs/bookings.json），我方原本只有
// 不帶 format 段的版本。本檔補上該段。
//
// 格式白名單：**只有 csv**，其餘一律 400。
//
// issue #246 更新：本註解原本寫「白名單與 inventory/[format] 一致」與「本專案
// 沒有安裝任何 xlsx 產生器」。兩句話現在都不成立了——`exceljs` 已依
// 14-GAP-AUDIT §8.3 安裝，inventory 也依 §8.5 補上了 xlsx 分支。留著會誤導。
//
// 那為什麼這裡仍然只有 csv？因為沒有任何裁示要求預約匯出出 Excel：#33 第 ③ 筆
// 只要求補上 format 路徑段與白名單，§8.5 的「CSV 與 Excel 兩者都做」明確只針對
// 庫存匯出。要加就是一筆有明確依據的獨立工作，而不是因為工具現在有了就順手擴張。
//
// 原本那句判斷仍然有效並已在 #246 落實：把一份 CSV 命名成 .xlsx 只是謊報檔案格式，
// 使用者會拿到副檔名說是 Excel、內容卻是 CSV 的檔案。真要支援就產真的 xlsx
// （見 src/server/xlsx.ts），不是改副檔名。
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
