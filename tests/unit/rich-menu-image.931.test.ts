import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { RICH_MENU_GLYPHS } from '@/server/rich-menu-glyphs.generated';
import { RICH_MENU_CELL_BOUNDS } from '@/server/rich-menu';
import { composeRichMenuImage, normalizeTextColor, LINE_MAX_BYTES } from '@/server/rich-menu-image';

const MODES = Object.keys(MODE_PRESETS) as BusinessType[];

async function solidPng(rgb: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 2500, height: 1686, channels: 3, background: rgb } }).png().toBuffer();
}

/** 取某格中央區塊中「與底色差異大」的像素數與平均色 */
async function cellStats(jpeg: Buffer, cell: number, bg: [number, number, number]) {
  const b = RICH_MENU_CELL_BOUNDS[cell];
  const { data } = await sharp(jpeg)
    .extract({ left: b.x, top: b.y + Math.round(b.h * 0.3), width: b.w, height: Math.round(b.h * 0.4) })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0; let r = 0; let g = 0; let bl = 0; let hash = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 150) {
      n++; r += data[i]; g += data[i + 1]; bl += data[i + 2];
      hash = (hash * 31 + i) % 1000003;
    }
  }
  return { n, avg: n ? [r / n, g / n, bl / n] : [0, 0, 0], hash };
}

describe('#931 rich menu image composition', () => {
  it('every preset label has a glyph', () => {
    const labels = new Set(MODES.flatMap((m) => MODE_PRESETS[m].richMenuCells.map((c) => c.label)));
    expect(labels.size).toBeGreaterThanOrEqual(17);
    for (const l of labels) expect(RICH_MENU_GLYPHS[l], l).toBeTruthy();
  });

  it('noOverlay returns the original bytes untouched', async () => {
    const bytes = await solidPng({ r: 0, g: 140, b: 70 });
    const out = await composeRichMenuImage({ bytes, contentType: 'image/png', businessType: 'GUIDE', textColor: '#FFFFFF', noOverlay: true });
    expect(out.bytes.equals(bytes)).toBe(true);
    expect(out.contentType).toBe('image/png');
  });

  it('draws text: JPEG, 2500x1686, <1MB, pixels near cell center lean to textColor', async () => {
    const bytes = await solidPng({ r: 0, g: 140, b: 70 });
    const out = await composeRichMenuImage({ bytes, contentType: 'image/png', businessType: 'GUIDE', textColor: '#FFFFFF', noOverlay: false });
    expect(out.contentType).toBe('image/jpeg');
    expect(out.bytes.length).toBeLessThan(1024 * 1024);
    const meta = await sharp(out.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 2500, 1686]);
    for (let c = 0; c < 6; c++) {
      const s = await cellStats(out.bytes, c, [0, 140, 70]);
      expect(s.n, `cell ${c}`).toBeGreaterThan(500);
      expect(s.avg[0]).toBeGreaterThan(170); // 偏白
    }
  });

  it('resizes non-matching base images to 2500x1686', async () => {
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#224488' } }).png().toBuffer();
    const out = await composeRichMenuImage({ bytes, contentType: 'image/png', businessType: 'CLINIC', textColor: '#FFFFFF' });
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([2500, 1686]);
  });

  it('different business types draw different glyphs in the same cell', async () => {
    const bytes = await solidPng({ r: 0, g: 140, b: 70 });
    const a = await composeRichMenuImage({ bytes, contentType: 'image/png', businessType: 'LOCAL_SHOP', textColor: '#FFFFFF' });
    const b = await composeRichMenuImage({ bytes, contentType: 'image/png', businessType: 'GUIDE', textColor: '#FFFFFF' });
    const sa = await cellStats(a.bytes, 0, [0, 140, 70]);
    const sb = await cellStats(b.bytes, 0, [0, 140, 70]);
    expect(MODE_PRESETS.LOCAL_SHOP.richMenuCells[0].label).not.toBe(MODE_PRESETS.GUIDE.richMenuCells[0].label);
    expect(`${sa.n}:${sa.hash}`).not.toBe(`${sb.n}:${sb.hash}`);
  });

  it('textColor is applied and invalid colors fall back to white', async () => {
    expect(normalizeTextColor('#ff0000')).toBe('#FF0000');
    expect(normalizeTextColor('red')).toBe('#FFFFFF');
    expect(normalizeTextColor(undefined)).toBe('#FFFFFF');
    const bytes = await solidPng({ r: 255, g: 255, b: 255 });
    const red = await composeRichMenuImage({ bytes, contentType: 'image/png', businessType: 'LOCAL_SHOP', textColor: '#FF0000' });
    const bad = await composeRichMenuImage({ bytes: await solidPng({ r: 0, g: 0, b: 0 }), contentType: 'image/png', businessType: 'LOCAL_SHOP', textColor: 'javascript:1' });
    const sr = await cellStats(red.bytes, 0, [255, 255, 255]);
    expect(sr.n).toBeGreaterThan(500);
    expect(sr.avg[0]).toBeGreaterThan(sr.avg[1] + 80);
    const sb = await cellStats(bad.bytes, 0, [0, 0, 0]);
    expect(sb.avg[0]).toBeGreaterThan(170);
    expect(sb.avg[2]).toBeGreaterThan(170);
  });

  it('route calls composeRichMenuImage before upload', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/api/settings/line/rich-menu/create/route.ts'), 'utf8');
    expect(src).toContain('composeRichMenuImage');
    expect(src.indexOf('composeRichMenuImage(')).toBeLessThan(src.indexOf('lineUploadRichMenuImage(token'));
    expect(src).toContain('richMenuNoOverlay');
  });
});

describe('composeRichMenuImage 透明底圖與超大檔 (#931)', () => {
  it('全透明 PNG 合成後無文字區域為白色而非黑色', async () => {
    const png = await sharp({
      create: { width: 2500, height: 1686, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await composeRichMenuImage({ bytes: png, contentType: 'image/png', businessType: 'LOCAL_SHOP' });
    const { data } = await sharp(out.bytes)
      .extract({ left: 5, top: 5, width: 20, height: 20 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    expect(avg).toBeGreaterThan(240);
  });

  it('壓縮後仍超過上限時丟出 400', async () => {
    const png = await solidPng({ r: 10, g: 120, b: 200 });
    await expect(
      composeRichMenuImage({ bytes: png, contentType: 'image/png', businessType: 'LOCAL_SHOP', maxBytes: 100 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('composeRichMenuImage 底圖解碼容錯（#931 正式站回歸）', () => {
  // 正式站店家上傳的 2×2、79 bytes PNG；sharp 預設 failOn 會 libspng read error
  const PROD_2X2_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GB4T8TAwMDAwAqHwMBnkE1zwAAAABJRU5ErkJggg==';

  it('正式站 2×2 PNG 可合成為 2500×1686 JPEG', async () => {
    const bytes = Buffer.from(PROD_2X2_PNG_B64, 'base64');
    const out = await composeRichMenuImage({ bytes, contentType: 'image/png', businessType: 'LOCAL_SHOP' });
    expect(out.contentType).toBe('image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(2500);
    expect(meta.height).toBe(1686);
  });

  it('非圖片 bytes 丟 400 ApiHttpError 而非 500', async () => {
    await expect(
      composeRichMenuImage({
        bytes: Buffer.from('this is not an image'),
        contentType: 'image/png',
        businessType: 'LOCAL_SHOP',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('LINE 圖片上限邊界（#1107 Codex P2）', () => {
  it('上限取十進位 1,000,000 bytes', () => {
    expect(LINE_MAX_BYTES).toBe(1_000_000);
  });

  it('預設輸出低於上限；壓縮後仍 >= 上限即丟 400', async () => {
    const png = await solidPng({ r: 200, g: 30, b: 30 });
    const { bytes } = await composeRichMenuImage({ bytes: png, contentType: 'image/png', businessType: 'LOCAL_SHOP' });
    expect(bytes.length).toBeLessThan(LINE_MAX_BYTES);
    await expect(
      composeRichMenuImage({ bytes: png, contentType: 'image/png', businessType: 'LOCAL_SHOP', maxBytes: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
