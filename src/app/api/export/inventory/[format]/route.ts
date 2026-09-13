import { z } from 'zod';
import { ApiHttpError, ERR, handle } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiTodayDateString } from '@/server/tz';
import {
  KNOWN_INVENTORY_LOG_TYPES,
  mapInventoryLog,
  type InventoryLogType,
} from '@/server/inventory-log';
import { inventoryPage } from '@/i18n/zh-TW/pages/inventory';
import { buildXlsx, xlsxResponse, type XlsxCell } from '@/server/xlsx';

// issue #246 / 14-GAP-AUDIT §8.5：「庫存匯出 CSV 與 Excel 兩者都做」。
// 在此之前只有 csv，其餘格式一律 400，裁示的另一半從未落地。
const SUPPORTED_FORMATS = ['csv', 'xlsx'] as const;

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const EXPORT_PAGE_SIZE = 1000;

const querySchema = z.object({
  productId: z.string().uuid().optional(),
  type: z.enum(KNOWN_INVENTORY_LOG_TYPES).optional(),
});

function taipeiDateTime(iso: string): string {
  const date = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  // Product names and free-form reasons are spreadsheet-controlled cells.
  // Prefix risky strings so Excel/Sheets display them as text instead of
  // evaluating attacker-controlled formulas. Numeric quantities stay numeric.
  const text = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(raw)
    ? `'${raw}`
    : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
  const tenant = await requireTenant();
  await requireFeature(tenant.tenantId, 'INVENTORY');

  const { format } = await params;
  if (!(SUPPORTED_FORMATS as readonly string[]).includes(format)) {
    throw new ApiHttpError(400, '目前僅支援 CSV 與 Excel 匯出', ERR.VALIDATION);
  }

  const queryParams = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const data: any[] = [];

  // PostgREST deployments may cap one response. Page deterministically so a
  // large export is not silently truncated at the server's per-request cap.
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    let query = tenant.supabase
      .from('inventory_logs')
      .select('*, products(name)')
      .eq('tenant_id', tenant.tenantId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1);
    if (queryParams.productId) query = query.eq('product_id', queryParams.productId);

    const { data: page, error } = await query;
    if (error) throw error;
    const pageRows = page ?? [];
    data.push(...pageRows);
    if (pageRows.length < EXPORT_PAGE_SIZE) break;
  }

  const rows = data
    .map(mapInventoryLog)
    .filter((log) => !queryParams.type || log.type === queryParams.type);

  // 兩種格式共用同一份攤平結果，避免欄位在兩條路徑上各自漂移。
  const cells: XlsxCell[][] = rows.map((log) => [
    taipeiDateTime(log.createdAt),
    log.productName,
    inventoryPage.types[log.type as InventoryLogType] ?? log.type,
    log.quantity,
    log.stockBefore,
    log.stockAfter,
    log.reason,
    log.operator ?? inventoryPage.labels.system,
  ]);

  if (format === 'xlsx') {
    const fileName = `inventory-${taipeiTodayDateString()}.xlsx`;
    return xlsxResponse(fileName, await buildXlsx('庫存異動', HEADERS, cells));
  }

  // csv 分支的行為刻意一字未改：BOM、CRLF、欄位順序與檔名慣例都與 #246 之前相同。
  const lines = [HEADERS.map(csvCell).join(',')];
  for (const cell of cells) lines.push(cell.map(csvCell).join(','));

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="inventory-${taipeiTodayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
