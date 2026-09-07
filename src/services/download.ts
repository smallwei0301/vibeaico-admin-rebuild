// 附件下載共用工具（issue #246 從 inventory-export.ts 抽出）。
//
// 抽出的理由：顧客名單匯出也需要「把後端 Content-Disposition 的檔名交給瀏覽器」
// 這件事。若讓 reports.ts 去 import inventory-export.ts，相依方向會變得莫名其妙；
// 若各自複製一份，兩邊的檔名解析遲早會漂移——而「前端自組檔名」正是 #246 要修的
// 缺陷之一，不該在修它的同時又製造第二個來源。
//
// inventory-export.ts 仍 re-export 既有名稱，既有呼叫端與測試不受影響。
import { ApiError } from '@/lib/api';

export type AttachmentDownloadResult = {
  downloaded: boolean;
  /** 一律來自後端 Content-Disposition；前端不得自行組裝。 */
  fileName: string;
};

export const NOT_DOWNLOADED: AttachmentDownloadResult = { downloaded: false, fileName: '' };

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

export async function downloadAttachment(url: string): Promise<AttachmentDownloadResult> {
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
