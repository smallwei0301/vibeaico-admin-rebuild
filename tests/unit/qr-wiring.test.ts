/**
 * QR Code 兩頁接線靜態鏈路測試（issue #16 / 補齊-1）
 * -----------------------------------------------------------------------------
 * 對象：promote／line-settings 兩頁的「下載 QR Code」按鈕，issue #3 誠實化時
 * 因為專案裡沒有任何 QR 編碼能力而被停用（disabled + title 說明），issue #16
 * 依擁有者裁決（14 分冊 §8.2：安裝 `qrcode` 套件）補上真的產生與下載。
 *
 * 這裡只斷言「原始碼中的靜態鏈路」——按鈕真的接到 src/lib/qr.ts、內容真的來自
 * 畫面上顯示的那個網址變數（publicUrl / addFriendUrl），而不是兩頁互相抄錯、
 * 或抄一個寫死的字面值。實際下載行為由 Playwright 腳本
 * （scripts/verify/qr-download.cjs）對 Preview 站實測，見該腳本輸出。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有安裝
 *    @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的註解被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PROMOTE_PAGE = 'src/app/tenant/promote/page.tsx';
const LINE_SETTINGS_PAGE = 'src/app/tenant/line-settings/page.tsx';
const QR_LIB = 'src/lib/qr.ts';

describe('QR 產生與下載：兩頁共用同一支 src/lib/qr.ts，不得各寫一份', () => {
  const qrLibCode = withoutComments(src(QR_LIB));

  it('src/lib/qr.ts 使用 `qrcode` 套件，沒有自製編碼器（鐵則：不得自寫）', () => {
    expect(qrLibCode).toContain("from 'qrcode'");
    // 自製編碼器的典型指紋（Reed-Solomon、遮罩選擇、版本表）完全不該出現於程式碼本身
    expect(qrLibCode).not.toMatch(/reed.?solomon/i);
    expect(qrLibCode).not.toMatch(/galois/i);
    expect(qrLibCode).not.toMatch(/maskPattern\s*=\s*\d/i);
  });

  it('promote 頁 import 的是 src/lib/qr.ts，不是另外裝一份或另寫一份', () => {
    const code = src(PROMOTE_PAGE);
    expect(code).toContain("from '@/lib/qr'");
    expect(code).toContain('generateQrDataUrl');
    expect(code).not.toContain("from 'qrcode'"); // 頁面不得直接依賴套件，走共用層
  });

  it('line-settings 頁 import 的是 src/lib/qr.ts，不是另外裝一份或另寫一份', () => {
    const code = src(LINE_SETTINGS_PAGE);
    expect(code).toContain("from '@/lib/qr'");
    expect(code).toContain('generateQrDataUrl');
    expect(code).not.toContain("from 'qrcode'");
  });

  it('promote 頁的 QR 內容來自 publicUrl（公開商店頁網址），不是 addFriendUrl 之類的別的變數', () => {
    const code = src(PROMOTE_PAGE);
    expect(code).toMatch(/generateQrDataUrl\(publicUrl\)/);
    expect(code).not.toMatch(/generateQrDataUrl\(addFriendUrl\)/);
  });

  it('line-settings 頁的 QR 內容來自 addFriendUrl（LINE 加好友連結），不是 publicUrl 之類的別的變數', () => {
    const code = src(LINE_SETTINGS_PAGE);
    expect(code).toMatch(/generateQrDataUrl\(addFriendUrl\)/);
    expect(code).not.toMatch(/generateQrDataUrl\(publicUrl\)/);
    // addFriendUrl 的組法本身沒被改動——內容仍是 LINE 加好友連結格式
    expect(code).toContain("https://line.me/R/ti/p/${encodeURIComponent(lineBasicId)}");
  });

  it('兩頁下載都走 triggerDataUrlDownload，且各自帶不同的檔名（不是同一個檔名蓋過去）', () => {
    const promoteCode = src(PROMOTE_PAGE);
    const lineCode = src(LINE_SETTINGS_PAGE);
    expect(promoteCode).toContain('triggerDataUrlDownload');
    expect(lineCode).toContain('triggerDataUrlDownload');

    expect(promoteCode).toMatch(/triggerDataUrlDownload\(qrDataUrl, t\.qr\.filename\)/);
    expect(lineCode).toMatch(/triggerDataUrlDownload\(qrDataUrl, t\.botInfo\.qrFilename\)/);
  });

  it('下載鈕已重新啟用（不再是 issue #3 誠實化時的 disabled 硬停用）', () => {
    const promoteCode = src(PROMOTE_PAGE);
    const lineCode = src(LINE_SETTINGS_PAGE);
    // 按鈕仍可能在「QR 尚未產生」的過渡狀態顯示 disabled（受 qrDataUrl 是否存在控制），
    // 但不再是舊實作那種「永遠 disabled、沒有 onClick」的硬停用寫法。
    expect(promoteCode).toMatch(/onClick=\{downloadQr\}/);
    expect(lineCode).toMatch(/onClick=\{downloadQr\}/);
  });
});

describe('promote.ts / line-settings.ts i18n：QR 檔名與文案為真（不再是「尚未建置」）', () => {
  it('promote 的下載檔名對齊原站 docs/specs/promote.json 的「預約QRcode.png」', async () => {
    const { promotePage } = await import('@/i18n/zh-TW/pages/promote');
    expect(promotePage.qr.filename).toBe('預約QRcode.png');
  });

  it('line-settings 的下載檔名存在且非空，與 promote 的檔名不同', async () => {
    const { lineSettingsPage } = await import('@/i18n/zh-TW/pages/line-settings');
    const { promotePage } = await import('@/i18n/zh-TW/pages/promote');
    expect(lineSettingsPage.botInfo.qrFilename.length).toBeGreaterThan(0);
    expect(lineSettingsPage.botInfo.qrFilename).not.toBe(promotePage.qr.filename);
  });
});
