import { adapt } from '@/lib/api';
import {
  NOT_DOWNLOADED,
  downloadAttachment,
  fileNameFromContentDisposition,
  type AttachmentDownloadResult,
} from '@/services/download';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type InventoryExportQuery = {
  productId?: string;
  type?: string;
};

// issue #246：實作已移到 @/services/download（顧客名單匯出也要用同一份）。
// 這裡保留既有匯出名稱，既有呼叫端與 tests/unit/inventory-export.150 不需改動。
export type InventoryExportResult = AttachmentDownloadResult;
export { fileNameFromContentDisposition };

function queryString(query?: InventoryExportQuery): string {
  const params = new URLSearchParams();
  if (query?.productId) params.set('productId', query.productId);
  if (query?.type) params.set('type', query.type);
  const value = params.toString();
  return value ? `?${value}` : '';
}

export const exportInventoryCsv = (query?: InventoryExportQuery) =>
  adapt<InventoryExportResult>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(
      `${API_BASE}/api/export/inventory/csv${queryString(query)}`,
    ),
  );

/**
 * issue #33：`inventory/[format]` 的 `xlsx` 分支在 #246 就做好了，但**沒有任何
 * 呼叫端**——後端出得了真的 Excel，庫存頁卻只有一顆「匯出 CSV」。做了按不到，
 * 就是 PB-027 的「路由存在 ≠ 功能可用」。這裡把它接出來。
 */
export const exportInventoryXlsx = (query?: InventoryExportQuery) =>
  adapt<InventoryExportResult>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(
      `${API_BASE}/api/export/inventory/xlsx${queryString(query)}`,
    ),
  );
