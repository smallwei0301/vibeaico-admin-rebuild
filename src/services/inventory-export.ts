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
