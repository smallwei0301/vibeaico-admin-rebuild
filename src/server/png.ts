import { deflateSync } from 'node:zlib';

/**
 * src/server/png.ts — 純色 PNG 產生器（不裝 sharp/canvas，就一個純色矩形，不值得
 * 為此加重依賴）。
 *
 * 用途：POST /api/settings/line/rich-menu/create 找不到店家自傳底圖、也找不到
 * richmenu-assets bucket 的主題圖檔時，用這個現生成一張指定顏色的底圖，讓「套用
 * 範本就能發布」不必依賴事先手動上傳好六張主題圖——那個依賴本身就是「模板用不了」
 * 的根因之一。
 */

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** hex 如 '#06c755' → [r,g,b] */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [6, 199, 85]; // 解析失敗就退回 LINE 綠，不炸掉發布流程
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** 產生指定寬高、純色填滿的 PNG（8-bit truecolor，無透明度）。 */
export function solidColorPng(width: number, height: number, hexColor: string): Buffer {
  const [r, g, b] = hexToRgb(hexColor);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每列：1 個 filter byte（0 = none）+ width*3 個 RGB byte
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r; raw[px + 1] = g; raw[px + 2] = b;
    }
  }
  const idatData = deflateSync(raw, { level: 6 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
