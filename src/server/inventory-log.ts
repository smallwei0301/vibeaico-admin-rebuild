/**
 * 共用 inventory_logs → 庫存頁 InventoryLog 轉換。
 *
 * inventory_logs 只有 delta / reason / stock_after；頁面與匯出必須共用同一套
 * 推算與 TYPE:明細拆解規則，避免畫面和下載檔的口徑分岔。
 */
export const KNOWN_INVENTORY_LOG_TYPES = [
  'PURCHASE_IN', 'SALE_OUT', 'STOCKTAKE', 'MANUAL', 'DAMAGE', 'RETURN_IN', 'ORDER_CANCELLED',
] as const;

export type InventoryLogType = (typeof KNOWN_INVENTORY_LOG_TYPES)[number];

const KNOWN_TYPES = new Set<string>(KNOWN_INVENTORY_LOG_TYPES);

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

export function mapInventoryLog(r: any): MappedInventoryLog {
  const raw: string = r.reason ?? '';
  const idx = raw.indexOf(':');
  const prefix = idx > 0 ? raw.slice(0, idx) : raw;
  const known = KNOWN_TYPES.has(prefix);

  return {
    id: r.id,
    createdAt: r.created_at,
    productId: r.product_id,
    productName: r.products?.name ?? '',
    type: known ? (prefix as InventoryLogType) : 'MANUAL',
    quantity: r.delta,
    stockBefore: r.stock_after - r.delta,
    stockAfter: r.stock_after,
    reason: known ? (idx > 0 ? raw.slice(idx + 1) : '') : raw,
    operator: null,
  };
}
