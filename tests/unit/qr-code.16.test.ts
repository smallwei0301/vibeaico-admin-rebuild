import { describe, expect, it } from 'vitest';
import { buildQrSourceUrl, createQrDataUrl } from '@/lib/qr-code';

describe('createQrDataUrl', () => {
  it('產出 PNG data URL', async () => {
    const url = await createQrDataUrl('https://example.com/shop/abc?src=qr');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan(200);
  });
  it('空字串或空白拒絕', async () => {
    await expect(createQrDataUrl('')).rejects.toThrow();
    await expect(createQrDataUrl('   ')).rejects.toThrow();
  });
});

describe('buildQrSourceUrl', () => {
  it('無 query 時加上 src=qr', () => {
    expect(buildQrSourceUrl('https://a.com/s/x')).toBe('https://a.com/s/x?src=qr');
  });
  it('已有 query 時串接，已有 src 時覆寫', () => {
    expect(buildQrSourceUrl('https://a.com/s/x?a=1')).toBe('https://a.com/s/x?a=1&src=qr');
    expect(buildQrSourceUrl('https://a.com/s/x?src=line')).toBe('https://a.com/s/x?src=qr');
  });
  it('空值回空字串', () => {
    expect(buildQrSourceUrl('')).toBe('');
  });
});
