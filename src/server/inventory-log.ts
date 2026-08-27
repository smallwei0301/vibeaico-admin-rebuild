/**
 * 庫存異動列的共用轉換（`inventory_logs` → 頁面看到的 InventoryLog 形狀）。
 *
 * 為什麼要獨立一個檔：`GET /api/inventory/logs`（列表）與
 * `GET /api/export/inventory/:format`（匯出，issue #28 第 ⑤ 筆）**必須是同一套
 * 口徑**——匯出檔與畫面對不起來，比沒有匯出更糟。把 mapper 複製一份到匯出端點
 * 就是本專案反覆抓到的那種缺陷（同一件事兩份實作，短期一樣、長期分岔，
 * 分岔那天沒有任何測試會紅）。
 *
 * DB `inventory_logs` 只有 delta / reason / stock_after：
 *   quantity    = delta
 *   stockAfter  = stock_after
 *   stockBefore = stock_after - delta（推算）
 *   type/reason = reason 欄位存「TYPE:明細」複合格式（寫入端：adjust-stock、
 *                 product-orders manual/cancel、products POST），這裡拆回兩欄；
 *                 前綴不是已知 type 時整串當 reason、type 視為 MANUAL。
 *   operator    = DB 無此欄位 → 一律 null（已回報）。
 */
export const KNOWN_INVENTORY_LOG_TYPES = [
  'PURCHASE_IN', 'SALE_OUT', 'STOCKTAKE', 'MANUAL', 'DAMAGE', 'RETURN_IN', 'ORDER_CANCELLED',
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

export function mapInventoryLog(r: any): MappedInventoryLog {
  const raw: string = r.reason ?? '';
  const idx = raw.indexOf(':');
  const prefix = idx > 0 ? raw.slice(0, idx) : raw;
  const known = KNOWN.has(prefix);
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
