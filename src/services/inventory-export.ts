import { adapt, ApiError } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type InventoryExportQuery = {
  productId?: string;
  type?: string;
};

export type InventoryExportResult = {
  downloaded: boolean;
  fileName: string;
};

const NOT_DOWNLOADED: InventoryExportResult = { downloaded: false, fileName: '' };

export function fileNameFromContentDisposition(header: string | null | undefined): string {
  if (!header) return '';

  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (extended) {
    const value = extended[1].trim();
    const parts = value.split("'");
    const encoded = parts.length >= 3 ? parts.slice(2).join("'") : value;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted) return quoted[1];

  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare ? bare[1].trim() : '';
}

function queryString(query?: InventoryExportQuery): string {
  const params = new URLSearchParams();
  if (query?.productId) params.set('productId', query.productId);
  if (query?.type) params.set('type', query.type);
  const value = params.toString();
  return value ? `?${value}` : '';
}

async function downloadAttachment(url: string): Promise<InventoryExportResult> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    let message = '匯出失敗，請稍後再試';
    let code: string | undefined;
    try {
      const body = (await response.json()) as { message?: string; code?: string };
      if (body.message) message = body.message;
      code = body.code;
    } catch {
      // Keep the generic message when an intermediary returns non-JSON.
    }
    throw new ApiError(message, code, response.status);
  }

  const fileName = fileNameFromContentDisposition(
    response.headers.get('Content-Disposition'),
  );
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  if (fileName) anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(href);
  }, 0);

  return { downloaded: true, fileName };
}

export const exportInventoryCsv = (query?: InventoryExportQuery) =>
  adapt<InventoryExportResult>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(
      `${API_BASE}/api/export/inventory/csv${queryString(query)}`,
    ),
  );
