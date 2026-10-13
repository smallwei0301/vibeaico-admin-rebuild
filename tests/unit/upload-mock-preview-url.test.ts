import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { uploadImage } from '@/services/upload';

const file = () => new File([new Uint8Array(8)], 'cover.png', { type: 'image/png' });

afterEach(() => vi.restoreAllMocks());

describe('uploadImage mock 分支回傳可顯示的 URL（Codex P2）', () => {
  it('有 URL.createObjectURL 時回傳 blob: URL，而非裸檔名', async () => {
    const spy = vi.fn(() => 'blob:http://localhost/abc');
    vi.stubGlobal('URL', Object.assign(function () {}, { createObjectURL: spy }));
    const f = file();
    await expect(uploadImage(f, 'portfolio-images')).resolves.toEqual({ url: 'blob:http://localhost/abc' });
    expect(spy).toHaveBeenCalledWith(f);
    vi.unstubAllGlobals();
  });

  it('沒有 URL.createObjectURL 時退回 file.name', async () => {
    vi.stubGlobal('URL', Object.assign(function () {}, {}));
    await expect(uploadImage(file(), 'portfolio-images')).resolves.toEqual({ url: 'cover.png' });
    vi.unstubAllGlobals();
  });
});

describe('portfolio 頁面圖片渲染', () => {
  const page = readFileSync('src/app/tenant/portfolio/page.tsx', 'utf8');
  const m = page.match(/const isRenderableImageUrl = \(url: string\) => (\/.*\/)\.test\(url\);/);

  it('isRenderableImageUrl 接受 blob:，仍拒絕 javascript:/data:/裸檔名', () => {
    expect(m).not.toBeNull();
    const re = new RegExp((m as RegExpMatchArray)[1].slice(1, -1));
    expect(re.test('blob:http://localhost/abc')).toBe(true);
    expect(re.test('https://x/a.png')).toBe(true);
    expect(re.test('/a.png')).toBe(true);
    expect(re.test('javascript:alert(1)')).toBe(false);
    expect(re.test('data:image/png;base64,AAA')).toBe(false);
    expect(re.test('cover.png')).toBe(false);
  });

  it('卡片網格 <img> 帶 loading="lazy" 與 decoding="async"', () => {
    const card = page.slice(page.indexOf('isRenderableImageUrl(item.imageUrl)'));
    const img = card.slice(card.indexOf('<img'), card.indexOf('/>', card.indexOf('<img')));
    expect(img).toContain('loading="lazy"');
    expect(img).toContain('decoding="async"');
  });
});
