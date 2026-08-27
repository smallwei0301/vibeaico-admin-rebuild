/**
 * QR Code 產生的「接線正確性」測試（issue #16 / 補齊-1）
 * -----------------------------------------------------------------------------
 * 擁有者裁決（docs/integration/14-GAP-AUDIT.md §8.2）：安裝 `qrcode` 套件，
 * 不得自寫編碼器；追加驗收條件見 issue #16 comment
 * https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/16#issuecomment-5406087680：
 *
 *   「不要花力氣去測 qrcode 套件本身……QR 內容正確：產出的 QR 編碼的字串等於
 *    畫面上顯示的那個網址。用 qrcode 的 API 或一支解碼函式驗證，斷言解出來的
 *    字串與 getTenantSettings() 回的公開網址逐字相符——這是本 issue 真正要防
 *    的東西：下載到一張圖不代表那張圖指向對的地方」
 *
 * 解碼驗證選路（見任務回報說明）：裝 `jsqr` 這支獨立解碼套件，對 `src/lib/qr.ts`
 * 產生的真實 PNG 位元組解碼——不是重新驗證 qrcode 的核心編碼演算法（那是它自己
 * 的測試範圍），而是驗證「我們呼叫 qrcode 產生的圖，用另一套完全獨立的解碼器
 * 讀回來，字串是否等於我們餵進去的那個」，這正是「看起來像 QR、掃不出來」
 * 這種假成功唯一測得出來的地方。
 *
 * PNG → 原始像素的中介：`pngjs`（qrcode 自己 toBuffer('png') 內部就是用它编码，
 * 這裡反過來用它解碼——與 jsqr 完全不同的函式庫，不構成「用同一套邏輯自證」）。
 */
import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

import { buildPublicBookingUrl } from '@/config/tenant-settings';
import { generateQrDataUrl } from '@/lib/qr';

/**
 * 獨立解碼路徑：dataURL(base64 PNG) → Buffer → pngjs 解出 RGBA 像素
 * → jsqr 解出 QR 內容字串。完全不呼叫 qrcode 套件的任何 API。
 */
function decodeDataUrl(dataUrl: string): string | null {
  expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  const base64 = dataUrl.slice('data:image/png;base64,'.length);
  const buffer = Buffer.from(base64, 'base64');
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

describe('src/lib/qr.ts：generateQrDataUrl 產出的圖可被獨立解碼器讀回原字串', () => {
  it('英數網址（promote 頁公開預約網址的實際組法）', async () => {
    const url = buildPublicBookingUrl('https://vibeaico-admin.example.com', 'demo-shop-01');
    expect(url).toBe('https://vibeaico-admin.example.com/s/demo-shop-01');

    const dataUrl = await generateQrDataUrl(url);
    expect(decodeDataUrl(dataUrl)).toBe(url);
  });

  it('LINE 加好友連結（line-settings 頁的實際組法：https://line.me/R/ti/p/{lineBasicId}）', async () => {
    const lineBasicId = '@demo123';
    const addFriendUrl = `https://line.me/R/ti/p/${encodeURIComponent(lineBasicId)}`;
    expect(addFriendUrl).toBe('https://line.me/R/ti/p/%40demo123');

    const dataUrl = await generateQrDataUrl(addFriendUrl);
    expect(decodeDataUrl(dataUrl)).toBe(addFriendUrl);
  });

  it('promote 與 line-settings 兩處的 QR 內容不同——不是同一個網址貼兩次', async () => {
    const shopCode = 'demo-shop-01';
    const lineBasicId = '@demo123';

    const publicUrl = buildPublicBookingUrl('https://vibeaico-admin.example.com', shopCode);
    const addFriendUrl = `https://line.me/R/ti/p/${encodeURIComponent(lineBasicId)}`;
    expect(publicUrl).not.toBe(addFriendUrl);

    const [promoteQr, lineQr] = await Promise.all([
      generateQrDataUrl(publicUrl),
      generateQrDataUrl(addFriendUrl),
    ]);

    // 兩張圖本身不同（不同內容編出的 PNG bytes 不會相同）
    expect(promoteQr).not.toBe(lineQr);

    // 各自解碼後，分別等於各自畫面上顯示的那個網址——不是互相對調、也不是同一個
    const decodedPromote = decodeDataUrl(promoteQr);
    const decodedLine = decodeDataUrl(lineQr);
    expect(decodedPromote).toBe(publicUrl);
    expect(decodedLine).toBe(addFriendUrl);
    expect(decodedPromote).not.toBe(decodedLine);
  });

  it('帶查詢字串與常見符號的網址也能正確往返（各通路 utm_source 連結同一形狀）', async () => {
    const url = 'https://vibeaico-admin.example.com/s/demo-shop-01?utm_source=instagram';
    const dataUrl = await generateQrDataUrl(url);
    expect(decodeDataUrl(dataUrl)).toBe(url);
  });

  it('容錯等級可調整（Q）時仍正確往返——不是只有預設等級才碰巧能讀', async () => {
    const url = 'https://vibeaico-admin.example.com/s/demo-shop-01';
    const dataUrl = await generateQrDataUrl(url, { errorCorrectionLevel: 'Q' });
    expect(decodeDataUrl(dataUrl)).toBe(url);
  });

  it('已知輸入的健檢向量（純英數短字串，避免只在長網址上湊巧能讀）', async () => {
    const dataUrl = await generateQrDataUrl('https://example.com');
    expect(decodeDataUrl(dataUrl)).toBe('https://example.com');
  });
});
