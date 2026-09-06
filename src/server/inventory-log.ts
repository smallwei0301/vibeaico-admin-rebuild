/** Shared inventory log mapping for the list and CSV export routes. */
export const KNOWN_INVENTORY_LOG_TYPES = [
  'PURCHASE_IN',
  'SALE_OUT',
  'STOCKTAKE',
  'MANUAL',
  'DAMAGE',
  'RETURN_IN',
  'ORDER_CANCELLED',
] as const;

export type InventoryLogType = (typeof KNOWN_INVENTORY_LOG_TYPES)[number];

const KNOWN = new Set<string>(KNOWN_INVENTORY_LOG_TYPES);

export type MappedInventoryLog = {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  type: InventoryLogType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  operator: string | null;
};

export function mapInventoryLog(row: any): MappedInventoryLog {
  const raw: string = row.reason ?? '';
  const index = raw.indexOf(':');
  const prefix = index > 0 ? raw.slice(0, index) : raw;
  const known = KNOWN.has(prefix);

  return {
    id: row.id,
    createdAt: row.created_at,
    productId: row.product_id,
    productName: row.products?.name ?? '',
    type: known ? (prefix as InventoryLogType) : 'MANUAL',
    quantity: row.delta,
    stockBefore: row.stock_after - row.delta,
    stockAfter: row.stock_after,
    reason: known ? (index > 0 ? raw.slice(index + 1) : '') : raw,
    operator: null,
  };
}
