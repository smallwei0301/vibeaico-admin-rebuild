import { ApiError } from './api';

export type DownloadedFile = {
  downloaded: boolean;
  fileName: string;
};

/** 只接受伺服器 Content-Disposition 的檔名；取不到時不猜檔名。 */
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

/**
 * 直接收下匯出檔案並觸發瀏覽器存檔。匯出端點成功不是 JSON envelope，
 * 所以錯誤必須在這裡讀取標準錯誤信封後拋出，交由頁面顯示。
 */
export async function downloadAttachment(url: string): Promise<DownloadedFile> {
  const res = await fetch(url, { credentials: 'include' });

  if (!res.ok) {
    let message = '匯出失敗，請稍後再試';
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      if (body.message) message = body.message;
      code = body.code;
    } catch {
      /* 反向代理等非 JSON 錯誤回應，保留預設訊息與狀態碼。 */
    }
    throw new ApiError(message, code, res.status);
  }

  const fileName = fileNameFromContentDisposition(res.headers.get('Content-Disposition'));
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  if (fileName) anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(href);
  }, 0);

  return { downloaded: true, fileName };
}
