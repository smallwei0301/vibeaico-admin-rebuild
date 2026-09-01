// GET /api/export/inventory/:format?productId&type — 庫存異動匯出（#28 item ⑤）。
// csv 與 excel 兩個白名單格式目前都回傳 UTF-8 BOM CSV；專案沒有 xlsx 產生器，
// 因此檔名保持 .csv，不把 CSV 偽裝成 Excel 二進位檔。
// 成功直接回檔案，不走 { success, data } envelope；錯誤仍由 handle 回傳標準錯誤信封。
import { z } from 'zod';
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiTodayDateString } from '@/server/tz';
import {
  KNOWN_INVENTORY_LOG_TYPES, mapInventoryLog, type InventoryLogType,
} from '@/server/inventory-log';
import { inventoryPage } from '@/i18n/zh-TW/pages/inventory';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const ALLOWED_FORMATS = new Set(['csv', 'excel']);

const querySchema = z.object({
  productId: z.string().uuid().optional(),
  type: z.enum(KNOWN_INVENTORY_LOG_TYPES).optional(),
});

/** timestamptz → 台北牆上時鐘，與其他匯出端點保持相同口徑。 */
function taipeiDateTime(iso: string): string {
  const t = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
    + ` ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  inventoryPage.columns.time,
  inventoryPage.columns.product,
  inventoryPage.columns.type,
  inventoryPage.columns.quantity,
  inventoryPage.columns.before,
  inventoryPage.columns.after,
  inventoryPage.columns.reason,
  inventoryPage.columns.operator,
];

export const GET = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'INVENTORY');

  const { format } = await params;
  if (!ALLOWED_FORMATS.has(format)) {
    throw new ApiHttpError(400, '不支援的匯出格式', ERR.VALIDATION);
  }

  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  let query = t.supabase
    .from('inventory_logs')
    .select('*, products(name)')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (q.productId) query = query.eq('product_id', q.productId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []).map(mapInventoryLog)
    .filter((log) => !q.type || log.type === q.type);
  const lines = [HEADERS.map(csvCell).join(',')];

  for (const log of rows) {
    lines.push([
      csvCell(taipeiDateTime(log.createdAt)),
      csvCell(log.productName),
      csvCell(inventoryPage.types[log.type as InventoryLogType] ?? log.type),
      csvCell(log.quantity),
      csvCell(log.stockBefore),
      csvCell(log.stockAfter),
      csvCell(log.reason),
      csvCell(log.operator ?? inventoryPage.labels.system),
    ].join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="inventory-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
