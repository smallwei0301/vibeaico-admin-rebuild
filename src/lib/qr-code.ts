import QRCode from 'qrcode';

/** 預設輸出寬度（px）；足以印在門口或名片上 */
export const QR_DEFAULT_WIDTH = 512;
export const QR_DEFAULT_MARGIN = 2;

export interface QrOptions {
  width?: number;
  margin?: number;
}

/** 產生 QR Code 的 PNG data URL（`data:image/png;base64,...`）；空內容直接拒絕。 */
export async function createQrDataUrl(text: string, opts: QrOptions = {}): Promise<string> {
  if (!text || !text.trim()) throw new Error('QR content is empty');
  return QRCode.toDataURL(text, {
    type: 'image/png',
    width: opts.width ?? QR_DEFAULT_WIDTH,
    margin: opts.margin ?? QR_DEFAULT_MARGIN,
    errorCorrectionLevel: 'M',
  });
}

/** 以 `<a download>` 觸發瀏覽器下載。 */
export function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 公開預約頁的 QR 來源連結：附上 `src=qr`，讓公開頁埋點
 * （`classifySource`，src/server/promotion-events.ts）把掃碼流量歸為 QR。
 * 原連結已有 query 時以 `&` 串接；已含 `src` 時覆寫。
 */
export function buildQrSourceUrl(publicUrl: string): string {
  if (!publicUrl) return '';
  const hashAt = publicUrl.indexOf('#');
  const hash = hashAt >= 0 ? publicUrl.slice(hashAt) : '';
  const base = hashAt >= 0 ? publicUrl.slice(0, hashAt) : publicUrl;
  const qAt = base.indexOf('?');
  const path = qAt >= 0 ? base.slice(0, qAt) : base;
  const params = new URLSearchParams(qAt >= 0 ? base.slice(qAt + 1) : '');
  params.set('src', 'qr');
  return `${path}?${params.toString()}${hash}`;
}
