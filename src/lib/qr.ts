/**
 * QR Code 產生與下載的共用邏輯（issue #16，補齊-1）。
 * -----------------------------------------------------------------------------
 * 擁有者裁決（docs/integration/14-GAP-AUDIT.md §8.2）：安裝 `qrcode` 套件，
 * 不得自寫編碼器——QR 有 Reed–Solomon 糾錯，自寫的典型失敗模式是「看起來像
 * QR、掃不出來」，外觀正常、單元測試也會綠，是本專案最怕的假成功型態。
 *
 * `promote`（公開商店頁網址）與 `line-settings`（LINE 加好友連結）兩頁共用
 * 這支檔案，不得各寫一份 QR 產生邏輯（issue #16 範圍要求）。
 */
import QRCode from 'qrcode';

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface GenerateQrOptions {
  /** 預設 'M'——與原站 canvas QR 元件常見設定一致，兼顧容錯與圖面密度。 */
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  /** 白邊寬度（modules），預設 2。 */
  margin?: number;
  /** 輸出圖片邊長（px），預設 320，足以列印在名片／門口貼紙上仍可掃描。 */
  width?: number;
}

const DEFAULT_OPTIONS: Required<GenerateQrOptions> = {
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 320,
};

/**
 * 產生 QR Code 的 PNG dataURL（base64）。純資料轉換，不觸碰 DOM——
 * 呼叫端負責把回傳值畫進 `<img>` 或直接拿去觸發下載。
 *
 * @param text 要編碼進 QR 的完整字串（呼叫端必須確保這就是畫面上顯示的那個網址，
 *   本函式不做任何轉換或截斷）。
 */
export async function generateQrDataUrl(
  text: string,
  options: GenerateQrOptions = {},
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: opts.errorCorrectionLevel,
    margin: opts.margin,
    width: opts.width,
  });
}

/**
 * 觸發瀏覽器把一個 dataURL 存成指定檔名的檔案。
 * 只能在有 `document` 的 client 環境呼叫（兩頁都已是 `'use client'`）。
 */
export function triggerDataUrlDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  /*
   * 不立即同步移除節點：瀏覽器處理 `download` 屬性（含檔名）是非同步的，
   * 太早把 <a> 從 DOM 拔掉曾實測導致 Chromium 忽略 `download` 指定的檔名、
   * 改存成通用的「download」——下載本身仍會觸發，但檔名這個「畫面上承諾
   * 的東西」就悄悄變成別的東西了，犯了本專案最忌諱的那種毛病。延後到下一輪
   * event loop 再移除，讓瀏覽器有機會先讀到完整屬性。
   */
  setTimeout(() => { document.body.removeChild(a); }, 0);
}

/**
 * 產生 QR 並立即觸發下載——兩頁「下載 QR Code」按鈕的共用進入點。
 * 失敗時把例外原樣拋出，由呼叫端決定 toast 文案（i18n 各頁自己的字典）。
 */
export async function downloadQrCode(
  text: string,
  filename: string,
  options?: GenerateQrOptions,
): Promise<void> {
  const dataUrl = await generateQrDataUrl(text, options);
  triggerDataUrlDownload(dataUrl, filename);
}
