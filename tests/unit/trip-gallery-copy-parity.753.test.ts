/**
 * #753：複製行程的相簿必須與公開詳情頁對原行程輸出的相簿逐張相同
 * （先套用公開頁 URL 過濾，再截上限）；並鎖住 #752 審查 M5：刪除尾端圖片時必定送出 gallery。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PUBLIC_GALLERY_IMAGES,
  clampGalleryForCopy,
  omitUnchangedGallery,
  publicGalleryUrls,
} from '@/lib/trip-gallery';
import { MAX_PUBLIC_URL_CHARS, publicStringList, safePublicHttpsUrl } from '@/lib/public-url';

const ok = (n: number) => `https://img.test/${n}.jpg`;
const long = `https://img.test/${'a'.repeat(MAX_PUBLIC_URL_CHARS)}.jpg`;

describe('safePublicHttpsUrl 案例表', () => {
  it.each([
    ['https 有效', 'https://img.test/a.jpg', 'https://img.test/a.jpg'],
    ['前後空白會 trim', '  https://img.test/a.jpg  ', 'https://img.test/a.jpg'],
    ['http 丟棄', 'http://img.test/a.jpg', ''],
    ['javascript: 丟棄', 'javascript:alert(1)', ''],
    ['含 user:pass 丟棄', 'https://user:pass@img.test/a.jpg', ''],
    ['只有 username 丟棄', 'https://user@img.test/a.jpg', ''],
    ['相對路徑丟棄', '/uploads/a.jpg', ''],
    ['空字串', '', ''],
    ['非字串', 42, ''],
    ['超長丟棄', long, ''],
  ])('%s', (_name, input, expected) => {
    expect(safePublicHttpsUrl(input)).toBe(expected);
  });

  it('publicStringList：非陣列回 []，濾掉非字串與空白項並 trim', () => {
    expect(publicStringList('x')).toEqual([]);
    expect(publicStringList([' a ', 1, null, '  ', 'b'])).toEqual(['a', 'b']);
  });
});

describe('複製行程相簿與公開頁逐張相同', () => {
  const tenWithInvalidHead: unknown[] = [
    'http://img.test/insecure.jpg', 42, 'https://u:p@img.test/x.jpg', '', '/rel.jpg',
    ok(1), ok(2), ok(3), ok(4), ok(5), ok(6), ok(7), ok(8), ok(9),
  ];

  it('來源 > 8 張且前 8 筆含無效項：複本 = 公開 loader 對原行程輸出', () => {
    const publicView = publicGalleryUrls(tenWithInvalidHead);
    const copied = clampGalleryForCopy(tenWithInvalidHead as string[]);
    expect(publicGalleryUrls(copied)).toEqual(publicView);
    expect(copied).toHaveLength(MAX_PUBLIC_GALLERY_IMAGES);
    expect(copied![0]).toBe(ok(1));
    // 複本元素皆為來源中通過過濾的原始 trim 字串，順序保持
    expect(copied).toEqual(
      publicStringList(tenWithInvalidHead).filter((u) => safePublicHttpsUrl(u) !== '').slice(0, 8),
    );
  });

  it('非 ASCII 長 URL：原始 trim 後 ≤2048、正規化後 >2048，複本保留原字串且公開輸出逐張相同', () => {
    const wide = `https://example.com/${'中'.repeat(600)}`;
    expect(wide.length).toBeLessThanOrEqual(MAX_PUBLIC_URL_CHARS);
    expect(safePublicHttpsUrl(wide)).not.toBe('');
    expect(new URL(wide).toString().length).toBeGreaterThan(MAX_PUBLIC_URL_CHARS);
    const src = [ok(1), `  ${wide}  `, ok(2)];
    const copied = clampGalleryForCopy(src)!;
    expect(copied).toEqual([ok(1), wide, ok(2)]);
    expect(publicGalleryUrls(copied)).toEqual(publicGalleryUrls(src));
    expect(publicGalleryUrls(copied)).toHaveLength(3);
  });

  it('≤ 8 張全有效：原樣；undefined：undefined', () => {
    const six = [1, 2, 3, 4, 5, 6].map(ok);
    expect(clampGalleryForCopy(six)).toEqual(six);
    expect(clampGalleryForCopy(undefined)).toBeUndefined();
  });

  it('全有效但超過 8 張：只留前 8 張', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ok(i));
    expect(clampGalleryForCopy(twelve)).toEqual(twelve.slice(0, 8));
  });
});

describe('omitUnchangedGallery 送出判斷', () => {
  const original = { galleryUrls: [1, 2, 3, 4].map(ok) };

  it('刪除尾端圖片（長度變短）必定保留 galleryUrls', () => {
    const out = omitUnchangedGallery({ title: 't', galleryUrls: original.galleryUrls.slice(0, 3) }, original);
    expect(out.galleryUrls).toEqual(original.galleryUrls.slice(0, 3));
  });

  it('完全相同：拿掉 galleryUrls', () => {
    const out = omitUnchangedGallery({ title: 't', galleryUrls: [...original.galleryUrls] }, original);
    expect('galleryUrls' in out).toBe(false);
  });

  it('順序變更：保留', () => {
    const reordered = [...original.galleryUrls].reverse();
    expect(omitUnchangedGallery({ galleryUrls: reordered }, original).galleryUrls).toEqual(reordered);
  });
});
