/**
 * issue #16 — QR 接線退版守門（Promote 頁與 LINE 設定頁）
 * 現有 qr-code.16.test.ts 只測 helper；本檔以讀原始碼守住兩頁的接線：
 * helper 被呼叫、真圖（非 Lucide 佔位）、真下載（非只 toast）、內容來源、檔名。
 * 本專案單元測試為 node 環境、無法掛載元件，作法同 ai-settings-wiring.27.test.ts。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { promotePage } from '@/i18n/zh-TW/pages/promote';
import { lineSettingsPage } from '@/i18n/zh-TW/pages/line-settings';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const promote = src('src/app/tenant/promote/page.tsx');
const line = src('src/app/tenant/line-settings/page.tsx');

const pages = [
  {
    name: 'Promote 頁',
    code: promote,
    imgSrc: /<img\s+src=\{qrDataUrl\}/,
    download: /triggerDownload\(\s*qrDataUrl\s*,\s*t\.qr\.filename\s*\)/,
    content: /const\s+qrContent\s*=\s*buildQrSourceUrl\(\s*publicUrl\s*\)/,
    create: /createQrDataUrl\(\s*qrContent\s*\)/,
    filename: promotePage.qr.filename,
    expectedFilename: '預約QRcode.png',
  },
  {
    name: 'LINE 設定頁',
    code: line,
    imgSrc: /<img\s+src=\{addFriendQr\}/,
    download: /triggerDownload\(\s*dataUrl\s*,\s*t\.botInfo\.qrFilename\s*\)/,
    content: /`https:\/\/line\.me\/R\/ti\/p\/\$\{encodeURIComponent\(lineBasicId\)\}`/,
    create: /createQrDataUrl\(\s*addFriendUrl\s*\)/,
    filename: lineSettingsPage.botInfo.qrFilename,
    expectedFilename: 'LINE加好友QRcode.png',
  },
];

describe('#16 QR 接線退版守門', () => {
  for (const p of pages) {
    describe(p.name, () => {
      it('從 @/lib/qr-code 匯入並呼叫 createQrDataUrl 與 triggerDownload（helper 不可被移除）', () => {
        expect(p.code, `${p.name}未 import '@/lib/qr-code'`).toMatch(/from\s+'@\/lib\/qr-code'/);
        expect(p.code, `${p.name}未呼叫 createQrDataUrl 產生 QR`).toMatch(/createQrDataUrl\(/);
        expect(p.code, `${p.name}未呼叫 triggerDownload`).toMatch(/triggerDownload\(/);
      });

      it('顯示真 QR 圖：<img src={qr…}>，不可只剩 Lucide QrCode 佔位圖示', () => {
        expect(p.code, `${p.name}缺少以 QR data URL 為 src 的 <img>，疑似退回 Lucide 佔位`).toMatch(p.imgSrc);
      });

      it('下載處理真的呼叫 triggerDownload 並帶入 i18n 檔名（不可只跳 toast）', () => {
        expect(p.code, `${p.name}下載未呼叫 triggerDownload(<QR data URL>, <i18n 檔名>)，疑似只跳 toast`).toMatch(p.download);
      });

      it('QR 內容來源正確（兩頁 payload 不可互相錯用）', () => {
        expect(p.code, `${p.name}QR 內容來源錯誤`).toMatch(p.content);
        expect(p.code, `${p.name}createQrDataUrl 未使用該頁的 QR 內容變數`).toMatch(p.create);
      });

      it('檔名 i18n 鍵值正確', () => {
        expect(p.filename, `${p.name}下載檔名 i18n 值錯誤`).toBe(p.expectedFilename);
      });
    });
  }

  it('Promote 與 LINE 設定頁使用不同 payload 來源', () => {
    expect(promote, 'Promote 頁不應使用 LINE 加好友網址').not.toMatch(/line\.me\/R\/ti\/p/);
    expect(line, 'LINE 設定頁不應使用 buildQrSourceUrl(publicUrl)').not.toMatch(/buildQrSourceUrl\(/);
  });
});
