import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { textStrokeFor, relativeLuminance, contrastRatio } from '@/lib/rich-menu-contrast';
import { composeRichMenuImage, buildRichMenuTextSvg } from '@/server/rich-menu-image';

describe('rich-menu-contrast #1109', () => {
  it('白字配深色描邊、黑字配淺色描邊', () => {
    expect(textStrokeFor('#FFFFFF').stroke).toBe('rgba(0,0,0,0.55)');
    expect(textStrokeFor('#000000').stroke).toBe('rgba(255,255,255,0.6)');
  });
  it('中間色依實際對比度選黑或白描邊', () => {
    expect(relativeLuminance('#06C755')).toBeGreaterThan(0.3);
    // #06C755 對黑 9.31:1 > 對白 2.26:1，應選深描邊
    expect(contrastRatio('#06C755', '#000000')).toBeGreaterThan(contrastRatio('#06C755', '#FFFFFF'));
    expect(textStrokeFor('#06C755').stroke).toBe('rgba(0,0,0,0.55)');
    // 暗中間色 #555555 對白較高，應選淺描邊
    expect(contrastRatio('#555555', '#FFFFFF')).toBeGreaterThan(contrastRatio('#555555', '#000000'));
    expect(textStrokeFor('#555555').stroke).toBe('rgba(255,255,255,0.6)');
    expect(textStrokeFor('#06C755')).toEqual(textStrokeFor('#06C755'));
  });
  it('寬度比例約 6%', () => {
    expect(textStrokeFor('#FFFFFF').widthRatio).toBeCloseTo(0.06);
  });
  it('SVG 使用依字色決定的描邊', () => {
    expect(buildRichMenuTextSvg('LOCAL_SHOP', '#FFFFFF')).toContain('stroke="rgba(0,0,0,0.55)"');
    expect(buildRichMenuTextSvg('LOCAL_SHOP', '#111111')).toContain('stroke="rgba(255,255,255,0.6)"');
  });
  it('白字在全白底圖上，文字區域有明顯暗色描邊像素', async () => {
    const white = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#FFFFFF' } })
      .png()
      .toBuffer();
    const { bytes } = await composeRichMenuImage({
      bytes: white, contentType: 'image/png', businessType: 'LOCAL_SHOP', textColor: '#FFFFFF',
    });
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    // 第一格（左上）中心附近
    const x0 = Math.round(info.width / 6) - 250, x1 = x0 + 500;
    const y0 = Math.round(info.height / 4) - 100, y1 = y0 + 200;
    let dark = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * info.width + x) * info.channels;
        if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) dark++;
      }
    }
    expect(dark).toBeGreaterThan(50);
  });
});
