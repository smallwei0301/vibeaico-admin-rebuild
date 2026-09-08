// GET /api/export/bookings/:format — issue #33 第 ③ 筆：原站的 jsApiCalls 是
// `/api/export/bookings/${format}`（docs/specs/bookings.json），我方原本只有
// 不帶 format 段的版本。本檔補上該段。
//
// 格式白名單：`csv` 與 `xlsx`，其餘一律 400。
//
// ## 為什麼現在做 xlsx（本格原本標為「永久留白」）
//
// 原理由是「本專案沒有安裝任何 xlsx 產生器」。那句話在 #246 之後就不成立了：
// `exceljs` 已安裝、`src/server/xlsx.ts` 已有共用產生器、`inventory/[format]`
// 與顧客名單、報表匯出都已經出真的 Excel。留著只有預約匯出出不了 Excel，等於
// 同一顆「匯出」按鈕在不同頁面給出不一樣的能力。
//
// 依據不是「工具現在有了就順手擴張」，而是三項具體證據：
//   1. `14-GAP-AUDIT.md §8.5` 對匯出的裁示是「CSV 與 Excel 兩者都做，照 reports
//      的慣例」，而 reports 匯出確實兩種都出。
//   2. 原站的「匯出」按鈕是 `dropdown-toggle`（`docs/specs/bookings.json`
//      的 buttons），且端點路徑本身就帶 `${format}` 變數——單一格式不需要下拉，
//      也不需要格式段。
//   3. `common.exportExcel`（「匯出 Excel」）這句文案早就存在。
//
// **原本那句判斷本身仍然有效**：把一份 CSV 命名成 `.xlsx` 是謊報檔案格式，
// 使用者會拿到副檔名說是 Excel、內容卻是 CSV 的檔案。所以這裡走
// `buildXlsx()` 產真的活頁簿（見 `src/server/xlsx.ts`），不是改副檔名。
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  bookingExportQuerySchema,
  buildBookingsCsvResponse,
  buildBookingsXlsxResponse,
} from '@/server/export-bookings';

const SUPPORTED_FORMATS = ['csv', 'xlsx'] as const;

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { format } = await params;
  if (!(SUPPORTED_FORMATS as readonly string[]).includes(format)) {
    throw new ApiHttpError(400, '目前僅支援 CSV 與 Excel 匯出', ERR.VALIDATION);
  }
  const q = bookingExportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return format === 'xlsx'
    ? buildBookingsXlsxResponse(t.supabase, t.tenantId, q)
    : buildBookingsCsvResponse(t.supabase, t.tenantId, q);
});
