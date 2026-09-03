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

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

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
  if (format !== 'csv') {
    throw new ApiHttpError(400, '目前僅支援 CSV 匯出', ERR.VALIDATION);
  }

  const queryParams = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  let query = tenant.supabase
    .from('inventory_logs')
    .select('*, products(name)')
    .eq('tenant_id', tenant.tenantId)
    .order('created_at', { ascending: false });
  if (queryParams.productId) query = query.eq('product_id', queryParams.productId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? [])
    .map(mapInventoryLog)
    .filter((log) => !queryParams.type || log.type === queryParams.type);

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
